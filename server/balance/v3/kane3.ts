/**
 * Balance Designer V3: the PREPARED (not executed) Kane investigation of the 100-game dataset.
 *
 * Phase rule: this phase spends 0 Kane credits. runKaneV3() refuses to start unless the caller passes an explicit
 * operator approval record AND the environment carries KANE_V3_APPROVED=<runId>; no code path in this phase does.
 * The test double (tests/fixtures/fake-kane.mjs, FAKE_KANE_V3=1) exercises the plumbing without Kane.
 *
 *  1. serveDossier(): loopback-only HTTP server for the static dossier. The notebook form gets a per-call nonce.
 *     Every POST is stored verbatim (ndjson) with arrival time, nonce validity and the call window, then parsed by
 *     parseNotebookEntry() into a typed proposal. Nothing in a POST is executed.
 *  2. kaneExplore() (V2, kane-cli objective mode) drives one call. A note counts only if the kane-cli process
 *     completed (run_end passed) AND the entry is valid; otherwise CAPABILITY_LIMITATION.
 *  3. Provenance: a registered Kane proposal carries the raw notes file, its sha256 and the note id (checked).
 */
import { createServer, type Server } from 'node:http';
import { readFileSync, existsSync, appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, extname, sep } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { parseNotebookEntry, type Proposal } from './proposals.ts';
import { QUESTIONS } from './pages.ts';

export type V3Entry = { noteId: string; callId: string; kind: 'exploration'; receivedAt: string; validNonce: boolean; inWindow: boolean; rawBody: string; bytes: number; problems: string[]; proposal: Proposal };
export type V3Session = { callId: string; kind: 'exploration'; nonce: string; open: boolean; startedAt: string; closedAt: string | null; notes: V3Entry[]; file: string; maxNotes: number; gameIds: Set<string>; datasetHash: string; isTestDouble: boolean };

export function openV3Session(dir: string, callId: string, o: { gameIds: Set<string>; datasetHash: string; isTestDouble: boolean; maxNotes?: number }): V3Session {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'kane-notes.ndjson');
  if (!existsSync(file)) writeFileSync(file, '');
  return { callId, kind: 'exploration', nonce: randomBytes(9).toString('hex'), open: false, startedAt: '', closedAt: null, notes: [], file, maxNotes: o.maxNotes ?? 6, gameIds: o.gameIds, datasetHash: o.datasetHash, isTestDouble: o.isTestDouble };
}
/** Store one POST verbatim, then parse it. The provenance placeholder is completed (sha256) only after the call ends. */
export function acceptV3Entry(s: V3Session, rawBody: string, cliVersion: string | null): V3Entry {
  const form = new URLSearchParams(rawBody);
  const noteId = `${s.callId}-N${s.notes.length + 1}`;
  const problems: string[] = [];
  const validNonce = (form.get('nonce') ?? '') === s.nonce, inWindow = s.open;
  if (!validNonce) problems.push('wrong or missing nonce');
  if (!inWindow) problems.push('arrived outside the Kane call window');
  if (s.notes.length >= s.maxNotes) problems.push(`more than ${s.maxNotes} entries in one call`);
  const origin = s.isTestDouble ? 'kane-test-double' : 'kane';
  // Provenance is completed after the call (raw file sha256); checkProvenance() is applied at registration.
  const provenance = { origin, author: s.isTestDouble ? 'kane-cli TEST DOUBLE' : 'Kane (kane-cli objective mode)', note: `notebook entry ${noteId}`, kane: { callId: s.callId, rawFile: s.file, rawSha256: 'PENDING', noteId, cliVersion: cliVersion ?? 'unknown', isTestDouble: s.isTestDouble } } as Proposal['provenance'];
  const { proposal, problems: p2 } = parseNotebookEntry(rawBody, { id: `HK3-${noteId}`, provenance, gameIds: s.gameIds, datasetHash: s.datasetHash });
  problems.push(...p2.filter(x => !/raw Kane file sha256|note .* is not in the raw Kane file/.test(x)));
  const e: V3Entry = { noteId, callId: s.callId, kind: 'exploration', receivedAt: new Date().toISOString(), validNonce, inWindow, rawBody: rawBody.slice(0, 16384), bytes: rawBody.length, problems, proposal };
  s.notes.push(e);
  appendFileSync(s.file, JSON.stringify({ ...e, noteId }) + '\n');
  return e;
}
/** After the call: seal every entry's provenance with the raw file's sha256 (so checkProvenance can verify it later). */
export function sealProvenance(s: V3Session) {
  const sha = createHash('sha256').update(readFileSync(s.file)).digest('hex');
  for (const n of s.notes) if (n.proposal.provenance.kane) n.proposal.provenance.kane.rawSha256 = sha;
  return sha;
}

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.css': 'text/css' };
/** Loopback server for the dataset directory (dossier/, replays/, dashboard/). GET only, plus POST /notebook. */
export async function serveDossier(datasetDir: string, s: V3Session, port: number, cliVersion: () => string | null): Promise<{ server: Server; url: string }> {
  const root = resolve(datasetDir);
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'POST' && u.pathname === '/notebook') {
      let body = ''; req.on('data', c => { body += c; if (body.length > 65536) req.destroy(); });
      req.on('end', () => { const e = acceptV3Entry(s, body, cliVersion()); res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><p>Entry ${e.noteId} stored${e.problems.length ? ` with problems: ${e.problems.join('; ').replace(/[<>&]/g, '')}` : ''}. <a href="/dossier/notebook.html">Add another entry</a></p>`); });
      return;
    }
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    const p = resolve(root, '.' + decodeURIComponent(u.pathname === '/' ? '/dossier/index.html' : u.pathname));
    if (!(p === root || p.startsWith(root + sep)) || !existsSync(p) || /sealed|kane-/.test(p)) { res.writeHead(404); res.end('not found'); return; }
    let b = readFileSync(p);
    if (p.endsWith(`${sep}notebook.html`)) b = Buffer.from(b.toString('utf8').replace(/name="nonce" value="[^"]*"/, `name="nonce" value="${s.nonce}"`).replace(/action="[^"]*"/, 'action="/notebook"'));
    res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' }); res.end(b);
  });
  await new Promise<void>((r, j) => { server.once('error', j); server.listen(port, '127.0.0.1', () => r()); });
  return { server, url: `http://127.0.0.1:${port}/dossier/index.html` };
}

/** The objective given to kane-cli. It asks questions; it states no conclusion. */
export function objectiveV3(maxEntries = 5) {
  return `You are a game-balance researcher. The site you are on is a research dossier of 100 games of a board game played by a local computer planner against itself under five different starting conditions. Read the overview, the condition comparison, the trajectories, the patterns, the counterexamples and the limitations, and open at least four individual game replays. Then answer these questions in your own words: ${QUESTIONS.map((q, i) => `(${i + 1}) ${q}`).join(' ')} For every competing explanation you consider, submit one hypothesis entry in the Notebook page (title, cause, explanation, the game ids that show it, at least one prediction with a minimum size, an intervention from the catalog to test it, side effects, a competing explanation, a counterexample game, an acceptance test, what would disprove it). Submit at most ${maxEntries - 1} hypotheses and then exactly one final conclusion entry. Concluding that no change is justified is allowed. Do not invent game ids; use only ids that appear on the site.`;
}
export const KANE_V3_PLAN = {
  status: 'PREPARED_NOT_RUN',
  calls: [{ id: 'KX3', role: 'exploration + experiment design (kane-cli objective mode)', maxSteps: 40, timeoutS: 900, estimatedCredits: 55, note: 'V2 objective call with 25 steps used 40.1 credits; 40 steps on a larger dossier is estimated at about 55.' }],
  optional: [{ id: 'KC3', role: 'analyzer challenge of the registered hypotheses against raw rows', estimatedCredits: 10 }],
  ceilingCredits: 80, maxCalls: 2,
  approval: 'Needs Eric’s explicit go-ahead naming the calls and the credit ceiling. Not authorised in the V3 screening phase.',
};

export type Approval = { approvedBy: string; approvedAt: string; runId: string; maxCredits: number; maxCalls: number };
/** Hard gate. Throws unless an approval record AND the matching environment token are present. */
export function assertKaneApproved(a: Approval | null, runId: string) {
  if (!a || a.runId !== runId || !(a.maxCredits > 0) || !(a.maxCalls > 0)) throw new Error('Kane V3 is PREPARED, not authorised: an explicit operator approval record for this run id is required.');
  if (process.env.KANE_V3_APPROVED !== runId) throw new Error(`Kane V3 refused: set KANE_V3_APPROVED=${runId} in addition to the approval record.`);
}
