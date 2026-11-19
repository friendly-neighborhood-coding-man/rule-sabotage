/**
 * Balance Designer V2: the two Kane roles, kept apart.
 *
 *  A. EXPLORATION (kane-cli objective mode): `kane-cli run "<objective>" --url <read-only page> --agent --headless
 *     --max-steps N --timeout S`. The page holds raw data and an "Investigation notebook" HTML form. Whatever
 *     the browser agent submits is captured verbatim by our loopback server, with the run's nonce, arrival time
 *     and the kane-cli process window. kane-cli 0.10.4 has no documented structured "hypothesis" output, so the
 *     form IS the output channel; run_end.summary is kept too. If neither yields a usable note, the result is
 *     CAPABILITY_LIMITATION and the run continues with labelled operator/Claude/deterministic hypotheses only.
 *
 *  B. VERIFICATION (kane-cli --analyzer-only): factual conditions on served pages, via kaneVerify (V1 adapter).
 *
 * Nothing Kane writes is executed. Note fields are allowlisted; free text is stored and displayed (escaped) only.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { kaneProbe, runCapture, TEST_DOUBLE_VERSION } from '../../kane.ts';
import { paidCallTokenActive, isGateTestFixture, CAP_WARNING } from '../v4/kanebudget.ts';

export const COMPONENTS: Record<string, { label: string; experiment: string | null }> = {
  'rule-geometry': { label: 'Where a rule sends pieces (board geometry)', experiment: 'E4' },
  'planner-valuation': { label: 'How the AI scores the benefit of its own traps', experiment: 'E2' },
  'placement-search': { label: 'Which cells the AI considers for a trap', experiment: 'E3' },
  'weights': { label: 'The V0.3 prior weights / blend', experiment: 'E1a' },
  'randomness': { label: 'Random outcomes and what the AI knows about them', experiment: 'E5' },
  'metric': { label: 'The balance measurement itself', experiment: null },
  'no-defect': { label: 'Nothing is wrong: the behaviour is good play', experiment: null },
  'other': { label: 'Something else', experiment: null },
};
export const NOTE_METRICS: Record<string, string> = {
  tp_self_share: 'Teleports set off by the installer’s own pieces (share)',
  ew_self_trigger_share: 'East/west shove triggers set off by the installer’s own pieces (share)',
  ew_aligned_share: 'East/west shoves placed in the placer’s own forward direction (share)',
  tp_self_benefit: 'Squares gained when a piece chooses to step on its own teleport',
  tp_per_game: 'Teleport placements per game',
  treated_win_rate: 'Head-to-head strength of the changed AI',
};

export type Note = {
  noteId: string; callId: string; kind: 'exploration' | 'challenge'; receivedAt: string; validNonce: boolean; inWindow: boolean; rawBody: string; bytes: number;
  fields: { explanation: string; component: string; metric: string; direction: string; alternative: string; counterexample: string; defect: string; hypothesis: string; verdict: string };
  problems: string[];
};
export type Session = { callId: string; kind: Note['kind']; nonce: string; open: boolean; startedAt: string; closedAt: string | null; notes: Note[]; file: string; maxNotes: number };

const clip = (s: unknown, n: number) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, n);
/** One notebook session per Kane call. Notes outside the call window or with the wrong nonce are kept but marked invalid. */
export function openSession(dir: string, callId: string, kind: Note['kind'], maxNotes = 5): Session {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'kane-notes.ndjson');
  if (!existsSync(file)) writeFileSync(file, '');
  return { callId, kind, nonce: randomBytes(9).toString('hex'), open: false, startedAt: '', closedAt: null, notes: [], file, maxNotes };
}
export function acceptNote(s: Session, rawBody: string): Note {
  const form = new URLSearchParams(rawBody);
  const g = (k: string, n = 1200) => clip(form.get(k), n);
  const problems: string[] = [];
  const validNonce = g('nonce', 64) === s.nonce, inWindow = s.open;
  if (!validNonce) problems.push('wrong or missing nonce');
  if (!inWindow) problems.push('arrived outside the Kane call window');
  if (s.notes.length >= s.maxNotes) problems.push(`more than ${s.maxNotes} notes in one call`);
  const fields = { explanation: g('explanation'), component: g('component', 40), metric: g('metric', 40), direction: g('direction', 20), alternative: g('alternative'), counterexample: g('counterexample', 200), defect: g('defect', 10), hypothesis: g('hypothesis', 10), verdict: g('verdict', 20) };
  if (fields.component && !COMPONENTS[fields.component]) problems.push(`component "${fields.component}" is not one of the listed options`);
  if (fields.metric && !NOTE_METRICS[fields.metric]) problems.push(`metric "${fields.metric}" is not one of the listed options`);
  if (fields.direction && !['decrease', 'increase'].includes(fields.direction)) problems.push('direction must be decrease or increase');
  if (s.kind === 'exploration' && fields.explanation.trim().length < 15) problems.push('explanation too short to be a hypothesis');
  const n: Note = { noteId: `${s.callId}-N${s.notes.length + 1}`, callId: s.callId, kind: s.kind, receivedAt: new Date().toISOString(), validNonce, inWindow, rawBody: clip(rawBody, 8192), bytes: rawBody.length, fields, problems };
  s.notes.push(n);
  appendFileSync(s.file, JSON.stringify(n) + '\n');
  return n;
}

export type ExploreResult = {
  callId: string; role: 'exploration' | 'challenge'; status: 'complete' | 'incomplete' | 'timeout' | 'unavailable' | 'error' | 'skipped';
  capability: 'OK' | 'CAPABILITY_LIMITATION' | 'NOT_RUN'; capabilityDetail: string;
  version: string | null; isTestDouble: boolean; objective: string; args: string[]; url: string; startedAt: string; finishedAt: string; elapsedMs: number;
  runEnd: { status: string | null; summary: string | null; credits: number | null } | null; exitCode: number | null; timedOut: boolean;
  files: { stdout: string | null; stderr: string | null; notes: string; result: string }; sha256: { stdout: string | null; notes: string | null };
  validNotes: string[];
  /** Tracked separately from the notes: did the kane-cli process itself finish (run_end received, no timeout, run_end status passed)? */
  execution: 'COMPLETE' | 'RUN_END_NOT_PASSED' | 'INCOMPLETE' | 'TIMEOUT' | 'FAILED' | 'NOT_RUN';
};
const sha = (f: string) => (existsSync(f) ? createHash('sha256').update(readFileSync(f)).digest('hex') : null);

/** Parse objective-mode NDJSON. Only a run_end counts; everything else is kept verbatim in the raw file. */
export function parseObjectiveRun(stdout: string): ExploreResult['runEnd'] {
  let end: Record<string, unknown> | null = null;
  for (const line of stdout.split(/\r?\n/)) { const t = line.trim(); if (!t.startsWith('{')) continue; try { const e = JSON.parse(t); if (e?.type === 'run_end') end = e; } catch { /* keep raw only */ } }
  if (!end) return null;
  return { status: typeof end.status === 'string' ? end.status : null, summary: typeof end.summary === 'string' ? end.summary.slice(0, 4000) : (typeof end.reason === 'string' ? end.reason.slice(0, 4000) : null), credits: typeof end.credits_consumed === 'number' ? end.credits_consumed : null };
}

export async function kaneExplore(o: { session: Session; url: string; objective: string; dir: string; maxSteps: number; timeoutS: number; onLine?: (l: string) => void }): Promise<ExploreResult> {
  const t0 = Date.now(), startedAt = new Date().toISOString();
  mkdirSync(o.dir, { recursive: true });
  const probe = await kaneProbe();
  const r: ExploreResult = {
    callId: o.session.callId, role: o.session.kind, status: 'unavailable', capability: 'NOT_RUN', capabilityDetail: '', version: probe.version, isTestDouble: probe.version === TEST_DOUBLE_VERSION,
    objective: o.objective, args: [], url: o.url, startedAt, finishedAt: '', elapsedMs: 0, runEnd: null, exitCode: null, timedOut: false,
    files: { stdout: null, stderr: null, notes: o.session.file, result: join(o.dir, 'kane-explore-result.json') }, sha256: { stdout: null, notes: null }, validNotes: [], execution: 'NOT_RUN',
  };
  const done = () => {
    o.session.open = false; o.session.closedAt = new Date().toISOString();
    r.finishedAt = new Date().toISOString(); r.elapsedMs = Date.now() - t0;
    r.validNotes = o.session.notes.filter(n => !n.problems.length).map(n => n.noteId);
    r.sha256 = { stdout: r.files.stdout ? sha(r.files.stdout) : null, notes: sha(o.session.file) };
    r.execution = r.status === 'unavailable' ? 'NOT_RUN' : r.status === 'error' ? 'FAILED' : r.status === 'timeout' ? 'TIMEOUT' : r.status !== 'complete' ? 'INCOMPLETE' : r.runEnd?.status === 'passed' ? 'COMPLETE' : 'RUN_END_NOT_PASSED';
    // Successful autonomous hypothesis generation needs BOTH a complete kane-cli execution and at least one valid note.
    if (r.status === 'unavailable' || r.status === 'error') { r.capability = 'NOT_RUN'; }
    else if (r.validNotes.length && r.execution === 'COMPLETE') { r.capability = 'OK'; r.capabilityDetail = `${r.validNotes.length} valid notebook note(s) submitted by the browser agent during a complete kane-cli run`; }
    else if (r.validNotes.length) { r.capability = 'CAPABILITY_LIMITATION'; r.capabilityDetail = `${r.validNotes.length} valid-looking note(s) arrived, but the kane-cli run did not complete successfully (execution ${r.execution}${r.runEnd?.status ? `, run_end ${r.runEnd.status}` : ''}); the notes are kept as raw evidence and NOT registered as Kane hypotheses`; }
    else { r.capability = 'CAPABILITY_LIMITATION'; r.capabilityDetail = `kane-cli objective mode ran (${r.status}${r.runEnd?.status ? `, run_end ${r.runEnd.status}` : ''}) but produced no valid notebook note${o.session.notes.length ? ` (${o.session.notes.length} rejected: ${o.session.notes.map(n => n.problems.join('/')).join('; ')})` : ''}; ${r.runEnd?.summary ? 'only a free-text summary is available, which is kept but not turned into a hypothesis' : 'no summary either'}`; }
    writeFileSync(r.files.result, JSON.stringify(r, null, 2));
    return r;
  };
  if (!probe.installed || probe.loggedIn === false) { r.capabilityDetail = `Kane unavailable: ${probe.detail}`; return done(); }
  // V4 credit safety: a REAL kane-cli research run needs the single-use token of server/balance/v4/kanebudget.ts runPaidCall.
  if (!r.isTestDouble && !isGateTestFixture(probe.version) && !paidCallTokenActive()) { r.capabilityDetail = `Paid Kane call refused (V4 credit safety: paid research calls are disabled by default). ${CAP_WARNING}`; return done(); }
  // Windows .cmd shims: our objective never contains double quotes or percent signs.
  const objective = o.objective.replace(/["%!^]/g, '');
  r.args = ['run', objective, '--url', o.url, '--agent', '--headless', '--max-steps', String(o.maxSteps), '--timeout', String(o.timeoutS)];
  o.session.open = true; o.session.startedAt = new Date().toISOString();
  let out: Awaited<ReturnType<typeof runCapture>>;
  try { out = await runCapture(r.args, Number(process.env.KANE_KILL_AFTER_MS) || (o.timeoutS + 30) * 1000, o.onLine); }
  catch (e) { r.status = 'error'; r.capabilityDetail = `could not start kane-cli: ${(e as Error).message}`; return done(); }
  r.files.stdout = join(o.dir, 'kane-stdout.ndjson'); r.files.stderr = join(o.dir, 'kane-stderr.txt');
  writeFileSync(r.files.stdout, out.stdout); writeFileSync(r.files.stderr, out.stderr);
  r.exitCode = out.code; r.timedOut = out.timedOut;
  r.runEnd = parseObjectiveRun(out.stdout);
  r.status = out.timedOut ? 'timeout' : r.runEnd ? 'complete' : 'incomplete';
  return done();
}
