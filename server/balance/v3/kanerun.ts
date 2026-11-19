/**
 * Balance Designer V3: the one authorised Kane research call, its zero-credit preflight, and registration.
 *
 *  preflight  zero credits: serve the dossier on loopback, walk the suggested route in a real headless Chromium
 *             (page sizes, links, the quick notebook form, nonce, parse result), then one objective-mode call through
 *             the SAME code path with the kane-cli TEST DOUBLE. Nothing from the preflight can be labelled Kane.
 *  call       exactly one real objective-mode call: approval record + KANE_V3_APPROVED token, refuses if any V3 Kane
 *             call was ever started (journal), real CLI only, credit balance read before and after, conservative
 *             pre-call estimate against the 80-credit ceiling (a single call is bounded by steps and timeout, NOT
 *             hard-capped by credits). Raw stdout/stderr, every notebook POST and a timestamped terminal log are kept.
 *  register   provenance checked (raw notes sha256, note id, real CLI) and every entry written verbatim + parsed to
 *             balance/v3/kane-proposals.json, journalled before any validation game.
 */
import { mkdirSync, writeFileSync, readFileSync, appendFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { kaneProbe, kaneCredits, TEST_DOUBLE_VERSION } from '../../kane.ts';
import { kaneExplore, type ExploreResult } from '../v2/kane2.ts';
import { appendJournal, readJournal } from '../journal.ts';
import { checkProvenance } from '../v2/contracts.ts';
import { openV3Session, serveDossier, sealProvenance, objectiveV3, assertKaneApproved, KANE_V3_PLAN, type Approval, type V3Session } from './kane3.ts';
import { checkProposal, PROPOSAL_METRICS, type Proposal } from './proposals.ts';
import { ROOT } from './batch.ts';
import { V3_JOURNAL } from './screen.ts';

const now = () => new Date().toISOString();
const sha = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');
function datasetInfo(dir: string) {
  const run = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')) as { runId: string; datasetHash: string };
  const ids = new Set(readFileSync(join(dir, 'games.ndjson'), 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l).gameId as string));
  return { runId: run.runId, datasetHash: run.datasetHash, ids, manifestSha256: sha(join(dir, 'manifest.json')).slice(0, 16) };
}

export async function kanePreflight(datasetDir: string, outDir: string, o: { fakeCli: string; port?: number }) {
  const d = datasetInfo(datasetDir);
  mkdirSync(outDir, { recursive: true });
  const checks: { check: string; pass: boolean; detail: string }[] = [];
  const ok = (check: string, pass: boolean, detail: string) => checks.push({ check, pass, detail });
  // 1. browser walk of the suggested route with a real headless Chromium (no Kane, no network beyond loopback)
  const s1 = openV3Session(join(outDir, 'browser'), 'PF1', { gameIds: d.ids, datasetHash: d.datasetHash, isTestDouble: true });
  const { server, url } = await serveDossier(datasetDir, s1, o.port ?? 0, () => 'preflight-browser');
  const base = url.replace(':0/', `:${(server.address() as { port: number }).port}/`);
  s1.open = true;
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const route: { url: string; bytes: number; textChars: number; links: number }[] = [];
  const visit = async (u: string) => { const r = await page.goto(u); const html = await r!.text(); const text = await page.innerText('body'); route.push({ url: u.replace(/^http:\/\/127\.0\.0\.1:\d+/, ''), bytes: html.length, textChars: text.length, links: await page.locator('a').count() }); return html; };
  await visit(base);
  await visit(new URL('conditions.html', base).href);
  const cx = await visit(new URL('counterexamples.html', base).href);
  const replayLinks = [...cx.matchAll(/href="(\.\.\/replays\/[\w-]+\.html)"/g)].map(m => m[1]).slice(0, 3);
  for (const r of replayLinks) await visit(new URL(r, new URL('counterexamples.html', base)).href);
  const nb = await visit(new URL('notebook.html', base).href);
  ok('route pages load', route.length === 4 + replayLinks.length && replayLinks.length === 3, `${route.length} pages, largest ${Math.max(...route.map(r => r.bytes))} bytes`);
  ok('notebook carries the session nonce in every form', (nb.match(new RegExp(`value="${s1.nonce}"`, 'g')) ?? []).length === 2, 'quick + long form');
  const ids = [...d.ids];
  const entry = ['entry: hypothesis', 'title: PREFLIGHT scripted entry (not Kane)', 'cause: starting-rules', 'explanation: PREFLIGHT: checks that a quick entry typed into the text box is parsed into a typed proposal.', `evidence: ${ids[0]} ${ids[1]}`, 'prediction1: first_mover_win_rate decrease 0.15', 'prediction2: mean_turns no-change 3', 'intervention: S3_FIRST_TURN_ACTIONS', 'value: 2', 'sideEffects: none', 'competing: PREFLIGHT competing explanation', `counterexample: ${ids[2]}`, 'acceptance: PREFLIGHT', 'disproof: PREFLIGHT', 'verdict: '].join('\n');
  await page.fill('#structured', entry);
  await page.click('text=Submit quick entry');
  await page.waitForLoadState();
  await page.goto(new URL('notebook.html', base).href);
  await page.fill('#structured', 'entry: conclusion\ntitle: PREFLIGHT conclusion\ncause: no-defect\nverdict: more-evidence-needed');
  await page.click('text=Submit quick entry');
  await page.waitForLoadState();
  await browser.close(); server.close(); s1.open = false;
  const [h, c] = s1.notes;
  ok('quick hypothesis entry parsed with no problems', !!h && h.problems.length === 0 && h.proposal.predictions.length === 2 && h.proposal.intervention?.id === 'S3_FIRST_TURN_ACTIONS', h ? h.problems.join('; ') || 'ok' : 'no entry');
  ok('quick conclusion entry parsed with no problems', !!c && c.problems.length === 0 && c.proposal.verdict === 'more-evidence-needed', c ? c.problems.join('; ') || 'ok' : 'no entry');
  // rough step budget: one navigation per page + about 3 actions per entry (focus, type, submit)
  const steps = route.length + 3 * 5;
  ok('suggested route + 5 entries fits the step limit', steps <= KANE_V3_PLAN.calls[0].maxSteps, `about ${steps} of ${KANE_V3_PLAN.calls[0].maxSteps} steps`);
  // 2. the same objective-mode code path with the TEST DOUBLE
  const prevCli = process.env.KANE_CLI, prevV3 = process.env.FAKE_KANE_V3;
  process.env.KANE_CLI = o.fakeCli; process.env.FAKE_KANE_V3 = '1';
  const s2 = openV3Session(join(outDir, 'test-double'), 'PF2', { gameIds: d.ids, datasetHash: d.datasetHash, isTestDouble: true });
  const sv = await serveDossier(datasetDir, s2, 0, () => TEST_DOUBLE_VERSION);
  const u2 = sv.url.replace(':0/', `:${(sv.server.address() as { port: number }).port}/`);
  const r = await kaneExplore({ session: s2 as never, url: u2, objective: objectiveV3(), dir: join(outDir, 'test-double'), maxSteps: 5, timeoutS: 60 });
  sv.server.close(); sealProvenance(s2);
  if (prevCli === undefined) delete process.env.KANE_CLI; else process.env.KANE_CLI = prevCli;
  if (prevV3 === undefined) delete process.env.FAKE_KANE_V3; else process.env.FAKE_KANE_V3 = prevV3;
  ok('test-double objective call completes through the real code path', r.execution === 'COMPLETE' && r.isTestDouble, `${r.execution}, version ${r.version}`);
  ok('test-double entries captured and labelled kane-test-double', s2.notes.length === 2 && s2.notes.every(n => n.proposal.provenance.origin === 'kane-test-double'), `${s2.notes.length} entries`);
  ok('objective states no conclusion and names no prewritten hypothesis', !/HC\d|HD1|proposals\.json/.test(objectiveV3()), 'objective text checked');
  const res = { at: now(), credits: 0, dataset: d.runId, manifestSha256: d.manifestSha256, route, steps, checks, pass: checks.every(x => x.pass) };
  writeFileSync(join(outDir, 'preflight.json'), JSON.stringify(res, null, 2));
  return res;
}

export async function runKaneV3Call(datasetDir: string, approvalFile: string, o: { port?: number; log?: (l: string) => void } = {}) {
  const log = o.log ?? console.log;
  const d = datasetInfo(datasetDir);
  const approval = JSON.parse(readFileSync(approvalFile, 'utf8')) as Approval & { quote?: string };
  assertKaneApproved(approval, d.runId);
  if (approval.maxCalls !== 1) throw new Error('approval must be for exactly one call');
  if (readJournal(V3_JOURNAL).some(e => e.type === 'kane-v3-call-start')) throw new Error('A V3 Kane call was already started (journal). Only ONE is authorised; no retries.');
  const plan = KANE_V3_PLAN.calls[0];
  if (plan.estimatedCredits > approval.maxCredits) throw new Error(`estimate ${plan.estimatedCredits} exceeds the ${approval.maxCredits}-credit ceiling`);
  const probe = await kaneProbe();
  if (!probe.installed || probe.loggedIn === false) throw new Error(`kane-cli not ready: ${probe.detail}`);
  if (probe.version === TEST_DOUBLE_VERSION) throw new Error('KANE_CLI points at the test double; the real call needs the real kane-cli');
  const before = await kaneCredits();
  if (!before || before.credits === null) throw new Error('could not read the Kane credit balance before the call; refusing (conservative pre-call check)');
  if (before.credits < approval.maxCredits * 1.5) throw new Error(`balance ${before.credits} is below 1.5x the ceiling; refusing`);
  const stamp = now().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
  const outDir = join(ROOT, 'evidence/balance/v3/kane', `${stamp}-KX3`);
  mkdirSync(outDir, { recursive: true });
  const term = join(outDir, 'terminal.log');
  const say = (l: string) => { const t = `[${now()}] ${l}`; appendFileSync(term, t + '\n'); log(t); };
  appendJournal(V3_JOURNAL, 'kane-v3-call-start', d.runId, null, { callId: 'KX3', approval: { by: approval.approvedBy, at: approval.approvedAt, maxCredits: approval.maxCredits, maxCalls: approval.maxCalls }, cli: probe.version, maxSteps: plan.maxSteps, timeoutS: plan.timeoutS, estimatedCredits: plan.estimatedCredits, creditsBefore: before.credits, dataset: { runId: d.runId, datasetHash: d.datasetHash, manifestSha256: d.manifestSha256 }, dir: `evidence/balance/v3/kane/${stamp}-KX3` });
  say(`REAL KANE V3 CALL KX3: kane-cli ${probe.version}, max ${plan.maxSteps} steps, timeout ${plan.timeoutS}s, estimate ${plan.estimatedCredits} credits, ceiling ${approval.maxCredits} (not a hard cap), balance before ${before.credits}`);
  const session: V3Session = openV3Session(outDir, 'KX3', { gameIds: d.ids, datasetHash: d.datasetHash, isTestDouble: false });
  const sv = await serveDossier(datasetDir, session, o.port ?? 4391, () => probe.version);
  const url = sv.url;
  say(`dossier served read-only at ${url} (notebook POSTs captured to kane-notes.ndjson)`);
  let r: ExploreResult;
  try { r = await kaneExplore({ session: session as never, url, objective: objectiveV3(), dir: outDir, maxSteps: plan.maxSteps, timeoutS: plan.timeoutS, onLine: l => say(`kane> ${l.slice(0, 400)}`) }); }
  finally { sv.server.close(); }
  const notesSha = sealProvenance(session);
  const after = await kaneCredits();
  const used = after?.credits != null ? Math.round((before.credits - after.credits) * 1000) / 1000 : null;
  writeFileSync(join(outDir, 'kane-v3-entries.json'), JSON.stringify(session.notes, null, 2));
  const summary = { callId: 'KX3', execution: r.execution, capability: r.capability, capabilityDetail: r.capabilityDetail, runEnd: r.runEnd, exitCode: r.exitCode, timedOut: r.timedOut, elapsedMs: r.elapsedMs, entries: session.notes.length, validEntries: session.notes.filter(n => !n.problems.length).length, creditsBefore: before.credits, creditsAfter: after?.credits ?? null, creditsUsed: used, runEndCredits: r.runEnd?.credits ?? null, notesSha256: notesSha, stdoutSha256: r.sha256.stdout, cli: probe.version, objective: r.objective, args: r.args };
  writeFileSync(join(outDir, 'kane-v3-call.json'), JSON.stringify(summary, null, 2));
  appendJournal(V3_JOURNAL, 'kane-v3-call-end', d.runId, null, summary);
  say(`KX3 finished: execution ${r.execution}, ${session.notes.length} entries (${summary.validEntries} without problems), credits used ${used} (run_end reported ${r.runEnd?.credits ?? 'n/a'})`);
  return { outDir, summary, session };
}

/** Verify provenance and write every entry verbatim + parsed. Entries with problems are kept but not registered as hypotheses. */
export function registerKaneEntries(callDir: string) {
  const call = JSON.parse(readFileSync(join(callDir, 'kane-v3-call.json'), 'utf8')) as { execution: string; cli: string; notesSha256: string; creditsUsed: number | null };
  const entries = JSON.parse(readFileSync(join(callDir, 'kane-v3-entries.json'), 'utf8')) as { noteId: string; rawBody: string; problems: string[]; proposal: Proposal; receivedAt: string; validNonce: boolean; inWindow: boolean }[];
  const notesFile = join(callDir, 'kane-notes.ndjson');
  const fileSha = sha(notesFile);
  const out = entries.map(e => {
    const p: Proposal = structuredClone(e.proposal);
    if (p.provenance.kane) p.provenance.kane.rawFile = resolve(notesFile).replace(/\\/g, '/').replace(resolve(ROOT).replace(/\\/g, '/') + '/', '');
    const provProblems = checkProvenance({ ...p.provenance, kane: p.provenance.kane ? { ...p.provenance.kane, rawFile: notesFile } : undefined });
    const structural = checkProposal({ ...p, provenance: { ...p.provenance, kane: p.provenance.kane ? { ...p.provenance.kane, rawFile: notesFile } : undefined } });
    const problems = [...new Set([...e.problems, ...provProblems, ...structural])];
    const registered = problems.length === 0 && call.execution === 'COMPLETE';
    // Informational only (NOT used to register): where Kane wrote a metric's exact on-page LABEL instead of its id, show the id it names.
    const raw = new URLSearchParams(e.rawBody).get('structured') ?? '';
    const labelToId = Object.fromEntries(Object.entries(PROPOSAL_METRICS).map(([k, v]) => [v.toLowerCase(), k]));
    const exactLabelMetrics = [...raw.matchAll(/^prediction[12]:\s*(.+?)\s+(increase|decrease|no-change)\s+([\d.]+)\s*$/gim)].map(m => ({ written: m[1], id: labelToId[m[1].trim().toLowerCase()] ?? (PROPOSAL_METRICS[m[1].trim()] ? m[1].trim() : null), direction: m[2].toLowerCase(), size: Number(m[3]) }));
    return { noteId: e.noteId, receivedAt: e.receivedAt, validNonce: e.validNonce, inWindow: e.inWindow, rawBody: e.rawBody, rawStructured: raw || null, problems, registered, proposal: p, informational: { exactLabelMetrics, note: 'Exact-label lookup shown for the reader only. Registration uses the strict parse that was frozen before the call.' } };
  });
  const file = join(ROOT, 'balance/v3/kane-proposals.json');
  const doc = { schema: 'rule-sabotage/v3-kane-proposals@1', call: { dir: callDir.replace(/\\/g, '/').split('/rule-sabotage-live/').pop(), execution: call.execution, cli: call.cli, notesSha256: fileSha, recordedNotesSha256: call.notesSha256, creditsUsed: call.creditsUsed }, note: 'Every entry Kane submitted, verbatim (rawBody / rawStructured) and as parsed. Only entries with no problems from a COMPLETE real call are registered as Kane hypotheses.', entries: out };
  writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
  const fsha = createHash('sha256').update(readFileSync(file).toString().replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);
  const j = appendJournal(V3_JOURNAL, 'kane-proposals-registered', 'KX3', null, { file: 'balance/v3/kane-proposals.json', sha256: fsha, notesSha256: fileSha, entries: out.map(e => `${e.noteId}:${e.registered ? 'registered' : `not registered (${e.problems.join('; ').slice(0, 120)})`}`), note: 'registered before any validation game' });
  return { file, entries: out, journal: j.seq, sameSha: fileSha === call.notesSha256 };
}
export { existsSync };
