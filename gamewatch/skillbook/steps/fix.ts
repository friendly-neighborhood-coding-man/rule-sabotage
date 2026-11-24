/**
 * Analyzer: hand the findings to a coding agent in a BLIND workspace and let it reproduce, fix and re-run.
 * Uses the agent's own CLI as an ordinary command (GW_AGENT_CMD, a JSON argv; "{brief}" and "{dir}" are replaced), so
 * the agent's own permission and billing rules apply. Nothing here adds permission flags. Default: Claude Code headless.
 *   node gamewatch/skillbook/steps/fix.ts <build-label> <workspace-dir> <notes.ndjson>
 * Succeeds when the agent wrote CLOSED_LOOP_REPORT.md in the workspace.
 */
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT } from '../../builds.ts';

const [label, ws, notes] = process.argv.slice(2);
const dir = resolve(ws);
if (!existsSync(join(dir, 'server/v6/engine.ts'))) {
  // kane findings only (valid nonce), verbatim
  const kane = readFileSync(notes, 'utf8').split('\n').filter(Boolean).filter(l => { const n = JSON.parse(l); return n.source === 'kane' && n.nonceValid; }).join('\n') + '\n';
  const tmp = join(ROOT, 'evidence/gamewatch/review/kane-findings.ndjson');
  writeFileSync(tmp, kane);
  execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', join(ROOT, 'gamewatch/closed-loop/export-workspace.ts'), label, dir, tmp], { stdio: 'inherit' });
}
const brief = `Follow gamewatch/closed-loop/AGENT_BRIEF.md in this directory (${dir}). The findings are in KANE_FINDINGS.ndjson.`;
const cmd = (process.env.GW_AGENT_CMD ? JSON.parse(process.env.GW_AGENT_CMD) as string[] : ['claude', '-p', '{brief}']).map(a => a.replace('{brief}', brief).replace('{dir}', dir));
console.log(`agent: ${cmd[0]} (cwd ${dir})`);
const r = spawnSync(cmd[0], cmd.slice(1), { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' });
if (r.error) { console.error(`could not start the agent CLI: ${r.error.message}`); process.exit(127); }
process.exit(r.status === 0 && existsSync(join(dir, 'CLOSED_LOOP_REPORT.md')) ? 0 : 3);
