#!/usr/bin/env python3
"""Verify the vendored SkillFlow runner: sha256 of every vendored file must match VENDOR.json (LF-normalised).
With --upstream DIR, also check that DIR (a SkillFlow checkout at the pinned commit) has identical files.
    python gamewatch/vendor/verify.py [--upstream /path/to/skillflow]
"""
import hashlib, json, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent / "skillflow"
V = json.loads((HERE / "VENDOR.json").read_text(encoding="utf-8"))
h = lambda p: hashlib.sha256(p.read_bytes().replace(b"\r\n", b"\n")).hexdigest()
bad = [f for f, s in V["files"].items() if h(HERE / f) != s]
if "--upstream" in sys.argv:
    up = Path(sys.argv[sys.argv.index("--upstream") + 1])
    head = subprocess.run(["git", "-C", str(up), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    if head != V["commit"]:
        bad.append(f"upstream checkout is at {head or '?'}, pinned {V['commit']}")
    bad += [f"{f} differs from upstream" for f in V["files"] if h(up / f) != h(HERE / f)]
print("vendored SkillFlow OK" if not bad else "MISMATCH: " + "; ".join(bad), f"(commit {V['commit'][:12]})")
sys.exit(1 if bad else 0)
