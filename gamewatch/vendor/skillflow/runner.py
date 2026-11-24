#!/usr/bin/env python3
"""SkillFlow: a minimal executable SkillBook runner (Python standard library only).

A SkillBook is a JSON file listing tasks. The runner executes ONE task at a time: it checks the task's required inputs
and authorization, writes a context file holding only that task's skill and spec, runs the task's command (any CLI,
including a coding agent's own CLI), checks the declared outputs and acceptance conditions, and picks the next task
from the validated result and exit code. Every step is logged and checkpointed, so an interrupted run can be resumed.

    python runner.py validate BOOK.json
    python runner.py run BOOK.json --state DIR [--workdir DIR] [--var KEY=VALUE ...]
    python runner.py resume --state DIR
    python runner.py status --state DIR

Exit codes: 0 done, 2 stopped for missing authorization, 3 stopped (failure, retries exhausted, @stop), 4 a limit was
reached, 5 invalid book or state.

The runner never adds permission or billing flags to a command, never retries beyond the book's limits, and has no
knowledge of any domain: everything domain-specific lives in the book, its skills and the commands it runs.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import os
import signal
import subprocess
import sys
from pathlib import Path

VERSION = "0.1.0"
TERMINALS = {"@done": "done", "@stop": "stopped"}
OPS = {
    "==": lambda a, b: a == b, "!=": lambda a, b: a != b, ">=": lambda a, b: a >= b, "<=": lambda a, b: a <= b,
    ">": lambda a, b: a > b, "<": lambda a, b: a < b, "in": lambda a, b: a in b, "contains": lambda a, b: b in a,
}


class BookError(Exception):
    pass


def now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()


# ----------------------------------------------------------------------------------------------- book
def load_book(path: Path) -> dict:
    try:
        book = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        raise BookError(f"cannot read book {path}: {e}")
    validate(book, path.parent)
    return book


def validate(book: dict, base: Path) -> None:
    if book.get("skillflow") != 1:
        raise BookError('book must declare "skillflow": 1')
    tasks = book.get("tasks")
    if not isinstance(tasks, list) or not tasks:
        raise BookError("book needs a non-empty task list")
    ids = [t.get("id") for t in tasks]
    if len(set(ids)) != len(ids) or not all(isinstance(i, str) and i and not i.startswith("@") for i in ids):
        raise BookError("task ids must be unique, non-empty and must not start with @")
    if book.get("start", ids[0]) not in ids:
        raise BookError("start must name a task")
    for t in tasks:
        where = f"task {t['id']}"
        if not isinstance(t.get("run"), list) or not t["run"] or not all(isinstance(a, str) for a in t["run"]):
            raise BookError(f"{where}: run must be a non-empty list of strings (argv, no shell)")
        for k in ("skill", "spec"):
            if k in t and not (base / t[k]).is_file():
                raise BookError(f"{where}: {k} file {t[k]} not found")
        nxt = t.get("next", {})
        if not isinstance(nxt, dict) or "pass" not in nxt:
            raise BookError(f"{where}: next must map at least 'pass' to a task id or terminal")
        for key, target in nxt.items():
            if key not in ("pass", "fail") and not key.startswith("exit:"):
                raise BookError(f"{where}: unknown transition key {key}")
            if target not in ids and target not in TERMINALS:
                raise BookError(f"{where}: transition {key} -> unknown target {target}")
        for c in t.get("accept", []):
            if not ({"file", "json", "exit"} & set(c)):
                raise BookError(f"{where}: acceptance condition needs file, json or exit: {c}")
            if "op" in c and c["op"] not in OPS:
                raise BookError(f"{where}: unknown op {c['op']}")
        if not isinstance(t.get("retries", 0), int) or t.get("retries", 0) < 0:
            raise BookError(f"{where}: retries must be a non-negative integer")


# ----------------------------------------------------------------------------------------------- state
class Run:
    def __init__(self, state_dir: Path):
        self.dir = state_dir
        self.file = state_dir / "state.json"
        self.log_file = state_dir / "log.ndjson"
        self.s: dict = json.loads(self.file.read_text(encoding="utf-8")) if self.file.exists() else {}

    def save(self) -> None:
        tmp = self.file.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.s, indent=1) + "\n", encoding="utf-8")
        os.replace(tmp, self.file)  # atomic checkpoint

    def log(self, event: str, **kw) -> None:
        with self.log_file.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"at": now(), "event": event, **kw}) + "\n")


def subst(text: str, env: dict) -> str:
    for k, v in env.items():
        text = text.replace("{" + k + "}", v)
    return text


def check(cond: dict, workdir: Path, code: int, env: dict) -> tuple[bool, str]:
    if "exit" in cond:
        ok = code == cond["exit"]
        return ok, f"exit {code} == {cond['exit']}"
    if "file" in cond:
        p = workdir / subst(cond["file"], env)
        return p.is_file() and p.stat().st_size > 0, f"file {p} exists and is not empty"
    p = workdir / subst(cond["json"], env)
    try:
        v = json.loads(p.read_text(encoding="utf-8"))
        for part in [x for x in cond.get("path", "").split(".") if x]:
            v = v[int(part)] if isinstance(v, list) else v[part]
    except (OSError, json.JSONDecodeError, KeyError, IndexError, ValueError, TypeError) as e:
        return False, f"json {p} {cond.get('path', '')}: {type(e).__name__}"
    if "op" not in cond:
        return bool(v), f"json {p} {cond.get('path', '')} is truthy ({v!r})"
    try:
        ok = OPS[cond["op"]](v, cond["value"])
    except TypeError:
        ok = False
    return ok, f"json {p} {cond.get('path', '')} = {v!r} {cond['op']} {cond['value']!r}"


def context_file(run: Run, book: dict, base: Path, t: dict, env: dict) -> Path:
    """Write the context for ONE task: its skill, its spec and its contract. Nothing about other tasks."""
    parts = [f"# Task {t['id']}: {t.get('title', '')}", ""]
    for k in ("skill", "spec"):
        if k in t:
            parts += [f"## {k.capitalize()} ({t[k]})", "", (base / t[k]).read_text(encoding="utf-8").strip(), ""]
    parts += ["## Contract", "", f"Required inputs: {', '.join(subst(x, env) for x in t.get('requires', [])) or 'none'}",
              f"Required outputs: {', '.join(subst(x, env) for x in t.get('produces', [])) or 'none'}",
              f"Acceptance: {json.dumps(t.get('accept', []))}", ""]
    p = run.dir / "context" / f"{t['id']}.md"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("\n".join(parts), encoding="utf-8")
    return p


def authorized(run: Run, name: str) -> bool:
    env_key = "SKILLFLOW_AUTH_" + "".join(c if c.isalnum() else "_" for c in name).upper()
    return (run.dir / "authorizations" / name).is_file() or bool(os.environ.get(env_key))


def step(run: Run, book: dict, base: Path) -> str | None:
    """Execute the current task once. Returns a final status, or None to continue."""
    s = run.s
    tasks = {t["id"]: t for t in book["tasks"]}
    order = [t["id"] for t in book["tasks"]]
    t = tasks[s["current"]]
    workdir = Path(s["workdir"])
    env = {**s["vars"], "state": str(run.dir), "workdir": str(workdir), "task": t["id"], "bookdir": str(base), "python": sys.executable}
    limits = book.get("limits", {})
    if s["steps"] >= limits.get("max_steps", 100):
        run.log("limit", what="max_steps", value=s["steps"])
        return "limit-reached"
    if t.get("authorization") and not authorized(run, t["authorization"]):
        run.log("needs-authorization", task=t["id"], authorization=t["authorization"],
                how=f"create {run.dir / 'authorizations' / t['authorization']} (the operator's approval record), then resume")
        return "needs-authorization"
    missing = [x for x in (subst(r, env) for r in t.get("requires", [])) if not (workdir / x).exists()]
    s["attempts"][t["id"]] = s["attempts"].get(t["id"], 0) + 1
    s["steps"] += 1
    attempt = s["attempts"][t["id"]]
    ctx = context_file(run, book, base, t, env)
    env["context"] = str(ctx)
    run.log("task-start", task=t["id"], attempt=attempt, context=str(ctx))
    code, timed_out, results = None, False, []
    if missing:
        run.log("inputs-missing", task=t["id"], missing=missing)
        accepted = False
    else:
        argv = [subst(a, env) for a in t["run"]]
        out_dir = run.dir / "runs" / f"{s['steps']:03d}-{t['id']}"
        out_dir.mkdir(parents=True, exist_ok=True)
        penv = {**os.environ, "SKILLFLOW_TASK": t["id"], "SKILLFLOW_CONTEXT": str(ctx), "SKILLFLOW_STATE": str(run.dir), "SKILLFLOW_WORKDIR": str(workdir)}
        s["running"] = {"task": t["id"], "since": now()}
        run.save()
        with (out_dir / "stdout.txt").open("wb") as so, (out_dir / "stderr.txt").open("wb") as se:
            try:
                p = subprocess.run(argv, cwd=workdir, stdout=so, stderr=se, env=penv, timeout=t.get("timeout_s", 3600))
                code = p.returncode
            except subprocess.TimeoutExpired:
                code, timed_out = -1, True
            except OSError as e:
                se.write(f"could not start: {e}\n".encode())
                code = 127
        s.pop("running", None)
        conds = [{"file": x} for x in t.get("produces", [])] + t.get("accept", [])
        if not any("exit" in c for c in t.get("accept", [])) and not any(k.startswith("exit:") for k in t.get("next", {})):
            conds.append({"exit": 0})
        results = [(c, *check(c, workdir, code, env)) for c in conds]
        accepted = not timed_out and all(ok for _, ok, _ in results)
    run.log("task-end", task=t["id"], attempt=attempt, exit=code, timed_out=timed_out, accepted=accepted,
            checks=[{"ok": ok, "check": d} for _, ok, d in results])
    nxt = t.get("next", {})
    target = nxt.get(f"exit:{code}") if code is not None and f"exit:{code}" in nxt else None
    if target is None:
        if accepted:
            target = nxt["pass"]
        elif attempt <= t.get("retries", 0):
            run.log("retry", task=t["id"], attempt=attempt, of=t.get("retries", 0) + 1)
            return None
        elif "fail" in nxt:
            target = nxt["fail"]
        else:
            run.log("retries-exhausted", task=t["id"], attempts=attempt)
            s["history"].append({"task": t["id"], "attempt": attempt, "exit": code, "accepted": accepted, "next": None})
            return "failed"
    s["history"].append({"task": t["id"], "attempt": attempt, "exit": code, "accepted": accepted, "next": target})
    if target in TERMINALS:
        run.log("terminal", task=t["id"], terminal=target)
        return TERMINALS[target]
    if order.index(target) <= order.index(t["id"]):
        s["backtracks"] += 1
        if s["backtracks"] > limits.get("max_backtracks", 0):
            run.log("limit", what="max_backtracks", value=s["backtracks"], task=t["id"], target=target)
            return "limit-reached"
        s["attempts"][target] = 0  # a backward jump re-opens the target's retry budget; the global bound still holds
        run.log("backtrack", task=t["id"], target=target, count=s["backtracks"])
    s["current"] = target
    return None


EXIT = {"done": 0, "needs-authorization": 2, "stopped": 3, "failed": 3, "interrupted": 3, "limit-reached": 4}


def drive(run: Run, book: dict, base: Path) -> int:
    def interrupted(*_):
        run.s["status"] = "interrupted"
        run.save()
        run.log("interrupted", task=run.s.get("current"))
        sys.exit(EXIT["interrupted"])
    signal.signal(signal.SIGINT, interrupted)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, interrupted)
    run.s["status"] = "running"
    run.save()
    while True:
        final = step(run, book, base)
        run.save()
        if final:
            run.s["status"] = final
            run.save()
            run.log("run-end", status=final, task=run.s["current"])
            print(f"SkillFlow: {final} at task {run.s['current']} (state {run.dir})")
            return EXIT[final]


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="skillflow", description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("validate"); v.add_argument("book")
    r = sub.add_parser("run"); r.add_argument("book"); r.add_argument("--state", required=True); r.add_argument("--workdir"); r.add_argument("--var", action="append", default=[])
    for name in ("resume", "status"):
        x = sub.add_parser(name); x.add_argument("--state", required=True)
    sub.choices["resume"].add_argument("--allow-book-change", action="store_true")
    a = ap.parse_args(argv)
    try:
        if a.cmd == "validate":
            book = load_book(Path(a.book))
            print(f"ok: {len(book['tasks'])} tasks")
            return 0
        state = Path(a.state).resolve()
        run = Run(state)
        if a.cmd == "status":
            print(json.dumps({k: run.s.get(k) for k in ("book", "status", "current", "steps", "backtracks", "attempts")}, indent=1))
            return 0
        if a.cmd == "run":
            if run.s:
                raise BookError(f"state {state} already holds a run; use resume or a new --state")
            bp = Path(a.book).resolve()
            book = load_book(bp)
            state.mkdir(parents=True, exist_ok=True)
            run.s = {"skillflow": VERSION, "book": str(bp), "book_sha256": sha256(bp), "workdir": str(Path(a.workdir or bp.parent).resolve()),
                     "vars": dict(x.split("=", 1) for x in a.var), "current": book.get("start", book["tasks"][0]["id"]),
                     "status": "new", "steps": 0, "backtracks": 0, "attempts": {}, "history": [], "started": now()}
            run.log("run-start", book=str(bp), sha256=run.s["book_sha256"], runner=VERSION)
        else:
            if not run.s:
                raise BookError(f"no run in {state}")
            if run.s["status"] in ("done", "stopped", "failed"):
                print(f"SkillFlow: run already ended ({run.s['status']})")
                return EXIT[run.s["status"]]
            bp = Path(run.s["book"])
            book = load_book(bp)
            if sha256(bp) != run.s["book_sha256"] and not a.allow_book_change:
                raise BookError("the book changed since the run started; pass --allow-book-change to resume anyway")
            if run.s["status"] == "limit-reached":
                raise BookError("the run reached a limit; start a new run")
            run.log("resume", task=run.s["current"], previous=run.s["status"], was_running=run.s.pop("running", None))
        return drive(run, book, bp.parent)
    except BookError as e:
        print(f"SkillFlow: {e}", file=sys.stderr)
        return 5


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
