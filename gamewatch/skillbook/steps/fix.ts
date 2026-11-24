/**
 * Analyzer: hand the findings to a coding agent in a BLIND workspace and let it reproduce, fix and re-run.
 * Uses the agent's own CLI as an ordinary command (GW_AGENT_CMD, a JSON argv; "{brief}" and "{dir}" are replaced), so
 * the agent's own permission and billing rules apply. Nothing here adds permission flags. Default: Claude Code headless.
 *   node gamewatch/skillbook/steps/fix.ts <build-label> <workspace-dir> <notes.ndjson>
 *
 * ONE repair attempt per experiment: the attempt is recorded in evidence/gamewatch/repair/attempt.json before the agent
 * starts, and a second invocation (for example the regression review looping back) refuses with exit 3, so the run goes
 * on to the report. The agent's output is FROZEN as soon as it exits, before anything else touches the workspace:
 * every file it changed or added is copied to evidence/gamewatch/repair/output/ and hashed in repair/FREEZE.json.
 * Succeeds (exit 0) when the agent wrote CLOSED_LOOP_REPORT.md in the workspace (even if it was stopped at the time limit).
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, renameSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { ROOT } from '../../builds.ts';
import { snapshot, diffSnapshots } from './repair-freeze.ts';

const [label, ws, notes] = process.argv.slice(2);
const dir = resolve(ws);
const REP = join(ROOT, 'evidence/gamewatch/repair');
const attemptF = join(REP, 'attempt.json');
if (existsSync(attemptF)) {
  const a = JSON.parse(readFileSync(attemptF, 'utf8'));
  console.log(`one repair attempt per experiment: an attempt already ran (started ${a.startedAt}); no further attempt. See evidence/gamewatch/repair/.`);
  process.exit(3);
}
mkdirSync(REP, { recursive: true });
if (!existsSync(join(dir, 'server/v6/engine.ts'))) {
  // Kane findings only (valid nonce), verbatim, in the order submitted: the agent gets every one, including a "clean" one.
  const kane = readFileSync(notes, 'utf8').split('\n').filter(Boolean).filter(l => { const n = JSON.parse(l); return n.source === 'kane' && n.nonceValid; }).join('\n') + '\n';
  const tmp = join(ROOT, 'evidence/gamewatch/review/kane-findings.ndjson');
  writeFileSync(tmp, kane);
  execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', join(ROOT, 'gamewatch/closed-loop/export-workspace.ts'), label, dir, tmp], { stdio: 'inherit' });
}
const before = snapshot(dir);
writeFileSync(join(REP, 'baseline.json'), JSON.stringify({ workspace: dir, takenAt: new Date().toISOString(), files: before }, null, 1) + '\n');
// Keep the starting text of the code the agent may change, so diffs can be made later without re-exporting.
for (const f of Object.keys(before)) if (/^(server|gamewatch|tests|scripts|client)\//.test(f) || f === 'package.json') {
  const t = join(REP, 'baseline-files', f); mkdirSync(dirname(t), { recursive: true }); copyFileSync(join(dir, f), t);
}
const brief = `Follow gamewatch/closed-loop/AGENT_BRIEF.md in this directory (${dir}). The findings are in KANE_FINDINGS.ndjson.`;
const cmd = (process.env.GW_AGENT_CMD ? JSON.parse(process.env.GW_AGENT_CMD) as string[] : ['claude', '-p', '{brief}']).map(a => a.replace('{brief}', brief).replace('{dir}', dir));
const startedAt = new Date().toISOString();
writeFileSync(attemptF, JSON.stringify({ startedAt, build: label, workspace: dir, agent: cmd[0], argv: cmd.slice(1) }, null, 1) + '\n');
console.log(`agent: ${cmd[0]} (cwd ${dir})`);
// The agent must finish before the SkillBook task's own timeout (3600 s), or the freeze below would never run: stop the
// whole process tree at GW_AGENT_TIMEOUT_S (default 3300 s) and freeze whatever it produced.
const limitS = Number(process.env.GW_AGENT_TIMEOUT_S ?? 3300);
const t0 = Date.now();
const r = await new Promise<{ status: number | null; error?: Error; timedOut: boolean }>(res => {
  const win = process.platform === 'win32';
  const child = spawn(cmd[0], cmd.slice(1), { cwd: dir, stdio: 'inherit', shell: win, detached: !win });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    console.error(`agent still running after ${limitS} s: stopping it and freezing what it produced`);
    if (win && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else if (child.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); } }
  }, limitS * 1000);
  child.on('error', error => { clearTimeout(timer); res({ status: null, error, timedOut }); });
  child.on('close', status => { clearTimeout(timer); res({ status, timedOut }); });
});
const ms = Date.now() - t0;

// ---- freeze the agent's output, before the regression re-run or anything else writes to the workspace
const after = snapshot(dir);
const d = diffSnapshots(before, after);
for (const f of [...d.changed, ...d.added]) { const t = join(REP, 'output', f); mkdirSync(dirname(t), { recursive: true }); copyFileSync(join(dir, f), t); }
const freeze = {
  schema: 'gamewatch/repair-freeze@1', frozenAt: new Date().toISOString(), startedAt, ms, timedOut: r.timedOut, limitS,
  agentExit: r.error ? `could not start: ${r.error.message}` : r.status, report: existsSync(join(dir, 'CLOSED_LOOP_REPORT.md')),
  note: 'The coding agent\'s output, frozen when the agent exited and before any independent evaluation. output/ holds every file it changed or added; hashes are LF-normalised sha256.',
  changed: d.changed, added: d.added, removed: d.removed,
  files: Object.fromEntries([...d.changed, ...d.added].map(f => [f, { before: before[f] ?? null, after: after[f] }])),
};
writeFileSync(join(REP, 'FREEZE.json'), JSON.stringify(freeze, null, 1) + '\n');
// The next task re-runs the playtests in the workspace; run-evidence.ts reuses raw game files that already exist, so move
// the agent's own raw games aside (kept, not deleted) to make that re-run a fresh collection on the corrected code.
const raw = join(dir, 'evidence/gamewatch/raw');
if (existsSync(raw)) renameSync(raw, join(dir, `evidence/gamewatch/raw-agent-${Date.now()}`));
console.log(`repair output frozen: ${d.changed.length} changed, ${d.added.length} added, ${d.removed.length} removed -> evidence/gamewatch/repair/`);
if (r.error) { console.error(`could not start the agent CLI: ${r.error.message}`); process.exit(127); }
// Go on to the re-run whenever the agent left a report (its exit status and any timeout are recorded in FREEZE.json).
process.exit(freeze.report ? 0 : 3);
