/**
 * GW2 P3 correction (Q19): explicit session closure and per-session seals.
 *
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/session-close.ts status <sessionDir>
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/session-close.ts declare <sessionDir> --by <role-id> --reason "<why>"
 *
 * A review session is CLOSED only when its directory holds CLOSED.json (`gamewatch/gw2-session-close@1`), written once
 * (never overwritten). The record seals the session's raw outputs and submission records (session.json, access.ndjson,
 * notes.ndjson, hypotheses.ndjson) by LF-normalised SHA-256 and line count.
 *   server-close       written by gamewatch/gw2/serve.ts when the server is closed: for logging-on AND logging-off
 *                      sessions, so a logging-disabled session is closed explicitly too, never inferred from
 *                      "logging was off".
 *   operator-declared  written by an operator role (operator-01, ...) with a reason, for a session whose server did not
 *                      close it (a crash, a killed process). The outputs are kept as they are and sealed; the session's
 *                      experimental validity is still computed from its journal (no session-end = unsuitable for the
 *                      primary analysis). Declaring closure never repairs or promotes anything.
 * `sessionClosure` fails closed: a missing, malformed or contradicted seal is not "closed".
 * Like every GW2 integrity record, a seal makes later edits DETECTABLE; it does not prevent them (Q14: P7 anchors and
 * seal hashes are also kept in the operator record outside the repository).
 */
import { readFileSync, existsSync, openSync, writeSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { assertWritableOutput } from './paths.ts';
import { fileSha256, ROLE_ID } from './judgments.ts';
import { readJournal } from './journal.ts';

export const CLOSE_SCHEMA = 'gamewatch/gw2-session-close@1';
export const SEALED_FILES = ['session.json', 'access.ndjson', 'notes.ndjson', 'hypotheses.ndjson'] as const;
export class SessionCloseError extends Error {}
export type Closure = { status: 'closed' | 'not-closed' | 'invalid' | 'seal-violated'; closure: 'server-close' | 'operator-declared' | null; problems: string[]; sealSha256: string | null };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const lineCount = (f: string) => readFileSync(f, 'utf8').split('\n').filter(Boolean).length;
function seal(dir: string) {
  return Object.fromEntries(SEALED_FILES.map(f => [f, existsSync(join(dir, f)) ? { sha256: fileSha256(join(dir, f)), lines: lineCount(join(dir, f)) } : null]));
}

export function sealSession(dir: string, o: { closure: 'server-close' | 'operator-declared'; by: string; reason?: string; at?: string }) {
  const metaF = join(dir, 'session.json');
  if (!existsSync(metaF)) throw new SessionCloseError(`not a GW2 session directory (no session.json): ${dir}`);
  const meta = JSON.parse(readFileSync(metaF, 'utf8'));
  if (o.closure === 'operator-declared') {
    if (!ROLE_ID.test(o.by)) throw new SessionCloseError(`an operator-declared closure needs a role id such as operator-01 (got "${o.by}")`);
    if (!o.reason?.trim()) throw new SessionCloseError('an operator-declared closure needs a stated reason');
  }
  const journal = meta.logging === 'on' ? readJournal(join(dir, String(meta.journal ?? 'access.ndjson')), { logging: 'on', session: meta.session }) : null;
  const rec = {
    schema: CLOSE_SCHEMA, exp: meta.exp, session: meta.session, closure: o.closure, closedBy: o.by, ...(o.reason ? { reason: o.reason } : {}),
    closedAt: o.at ?? new Date().toISOString(), logging: meta.logging,
    journal: journal ? { status: journal.status, sessionEnd: journal.lines.some(l => l.type === 'session-end') } : null,
    outputs: seal(dir),
    statement: 'Session closed. The listed outputs are sealed by hash; any later change, addition or removal is reported as a seal violation. Closing a session does not change its experimental validity.',
  };
  const out = assertWritableOutput(join(dir, 'CLOSED.json'));
  let fd: number;
  try { fd = openSync(out, 'wx'); } catch { throw new SessionCloseError(`session ${meta.session} is already closed (CLOSED.json exists and is never overwritten)`); }
  try { writeSync(fd, JSON.stringify(rec, null, 1) + '\n'); } finally { closeSync(fd); }
  return rec;
}

/** Fail-closed closure status of one session directory. */
export function sessionClosure(dir: string): Closure {
  const f = join(dir, 'CLOSED.json'), none = { closure: null, sealSha256: null };
  if (!existsSync(f)) return { status: 'not-closed', problems: ['no CLOSED.json: the session was not closed (server still running, crashed, or never closed)'], ...none };
  let c: Record<string, unknown>, meta: Record<string, unknown>;
  try { c = JSON.parse(readFileSync(f, 'utf8')); } catch { return { status: 'invalid', problems: ['CLOSED.json is not valid JSON'], ...none }; }
  try { meta = JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8')); } catch { return { status: 'invalid', problems: ['session.json is missing or not valid JSON'], ...none }; }
  const bad: string[] = [];
  if (!isObj(c)) return { status: 'invalid', problems: ['CLOSED.json is not an object'], ...none };
  if (c.schema !== CLOSE_SCHEMA) bad.push(`schema is not ${CLOSE_SCHEMA}`);
  if (c.session !== meta.session) bad.push(`CLOSED.json is for session ${String(c.session)}, not ${String(meta.session)}`);
  if (c.closure !== 'server-close' && c.closure !== 'operator-declared') bad.push('closure must be server-close or operator-declared');
  if (typeof c.closedBy !== 'string' || !c.closedBy) bad.push('closedBy missing');
  if (c.closure === 'operator-declared' && (!ROLE_ID.test(String(c.closedBy)) || typeof c.reason !== 'string' || !c.reason.trim())) bad.push('an operator-declared closure needs a role id and a reason');
  if (typeof c.closedAt !== 'string' || Number.isNaN(Date.parse(c.closedAt))) bad.push('closedAt is not a time');
  if (c.logging !== meta.logging) bad.push('logging differs from session.json');
  if (!isObj(c.outputs) || SEALED_FILES.some(k => !(k in (c.outputs as object)))) bad.push(`outputs must list ${SEALED_FILES.join(', ')}`);
  if (meta.logging === 'on' && c.closure === 'server-close' && !(isObj(c.journal) && c.journal.sessionEnd === true)) bad.push('a server-close of a logging-on session needs a journal with session-end');
  if (bad.length) return { status: 'invalid', closure: null, problems: bad, sealSha256: null };
  const now = seal(dir), violated: string[] = [];
  for (const k of SEALED_FILES) {
    const was = (c.outputs as Record<string, { sha256: string; lines: number } | null>)[k], is = now[k];
    if (was === null && is !== null) violated.push(`${k} was added after the session was closed`);
    else if (was !== null && is === null) violated.push(`${k} was removed after the session was closed`);
    else if (was && is && (was.sha256 !== is.sha256 || was.lines !== is.lines)) violated.push(`${k} changed after the session was closed`);
  }
  const closure = c.closure as Closure['closure'];
  return violated.length ? { status: 'seal-violated', closure, problems: violated, sealSha256: fileSha256(f) } : { status: 'closed', closure, problems: [], sealSha256: fileSha256(f) };
}

if (process.argv[1]?.endsWith('gw2/session-close.ts')) {
  const [cmd, dir] = process.argv.slice(2), arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  if (!cmd || !dir) { console.error('usage: session-close.ts status <sessionDir> | declare <sessionDir> --by <role-id> --reason "<why>"'); process.exit(2); }
  try {
    if (cmd === 'status') { const r = sessionClosure(dir); console.log(`${r.status}${r.closure ? ` (${r.closure})` : ''}${r.problems.length ? `:\n  ${r.problems.join('\n  ')}` : ''}`); process.exit(r.status === 'closed' ? 0 : 1); }
    else if (cmd === 'declare') { const r = sealSession(dir, { closure: 'operator-declared', by: String(arg('--by') ?? ''), reason: arg('--reason') }); console.log(`session ${r.session} closed by ${r.closedBy} (operator-declared)`); }
    else { console.error(`unknown command ${cmd}`); process.exit(2); }
  } catch (e) { console.error((e as Error).message); process.exit(5); }
}
