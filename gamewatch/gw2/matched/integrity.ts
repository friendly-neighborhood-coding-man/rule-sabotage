/**
 * GW2 matched comparison: execution integrity (final preflight, items 2 and 3). Checked before EVERY call and before the
 * single held-out opening; any problem refuses continuation (nothing is repaired, nothing is retried).
 *
 * A call is one sealing transaction, recorded in the external ledger in this order:
 *   call-start → call-end → raw-seal → server-closed → freeze-<phase> → (phase 1 only) revision-page
 * A transaction that is missing a later step without a recorded failure (a crash) is INCOMPLETE: no further call may
 * start. A step that fails is recorded explicitly ("call-failed", then "experiment-stopped"), never retried. A failed
 * transaction must be a clean prefix (no gap, nothing recorded after the failure), and every step it did record is
 * verified exactly like a completed one: a failure never exempts a raw seal, a closure, a journal or a freeze.
 *
 * For every completed transaction the actual files are re-verified against their anchors:
 *   - raw seal: RAW_SEAL.json hash equals the ledger, and every raw file equals the seal;
 *   - server session: CLOSED.json valid and unviolated with the anchored seal hash; the access journal is the anchored
 *     file, re-read with its hash chain, and the site it recorded serving equals the site that was meant to be served;
 *   - freeze: loadFrozen (anchored FREEZE file, byte-exact anchored graph prefix);
 *   - the session graph: its first lines still equal the latest anchored head;
 *   - phase-2 site: every file equals its anchored construction record (revision-page.siteFiles).
 * The discovery site is checked against the pre-registered discovery manifest before every phase-1 call.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readExecLedger, verifyRawSeal } from '../p7-exec.ts';
import { sessionClosure } from '../session-close.ts';
import { readJournal } from '../journal.ts';
import { readLinePrefix } from '../ext/anchored.ts';
import { loadFrozen, sessionDir, graphOf } from './sessions.ts';
import { siteProblems } from './revision-page.ts';

const fsha = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');
export const TRANSACTION = ['call-start', 'call-end', 'raw-seal', 'server-closed', 'freeze'] as const;

/** Files of the discovery site as the pre-registered manifest lists them ("site/<f>" entries). */
export function discoverySiteRecord(evidence: string, manifestSha256: string): Record<string, string> {
  const mf = join(evidence, 'partitions/discovery/MANIFEST.json');
  if (fsha(mf) !== manifestSha256) throw new Error('discovery MANIFEST.json is not the pre-registered manifest');
  const files = JSON.parse(readFileSync(mf, 'utf8')).files as Record<string, string>;
  return Object.fromEntries(Object.entries(files).filter(([f]) => f.startsWith('site/')).map(([f, h]) => [f.slice(5), h]));
}
export const discoverySiteProblems = (evidence: string, manifestSha256: string) =>
  siteProblems(join(evidence, 'partitions/discovery/site'), discoverySiteRecord(evidence, manifestSha256), 'discovery site');

/** Every integrity problem of the execution so far ([] = may continue). */
export function executionProblems(run: string, rec: string): string[] {
  const R = readExecLedger(rec), p: string[] = [];
  if (!R.ok) return [`external ledger fails: ${R.problems.join('; ')}`];
  const L = R.entries as any[], stopped = L.some(e => e.event === 'experiment-stopped');
  for (const start of L.filter(e => e.event === 'call-start')) {
    const { runId, session, phase } = start.data, of = (ev: string) => L.filter(e => e.event === ev && e.data.runId === runId);
    const failed = of('call-failed');
    const end = of('call-end'), seal = of('raw-seal'), closed = of('server-closed');
    const fz = L.filter(e => e.event === `freeze-${phase}` && e.data.session === session);
    const rp = phase === 1 ? L.filter(e => e.event === 'revision-page' && e.data.session === session) : [];
    const steps: [string, any[]][] = [['call-end', end], ['raw-seal', seal], ['server-closed', closed], [`freeze-${phase}`, fz], ...(phase === 1 ? [['revision-page', rp] as [string, any[]]] : [])];
    for (const [k, v] of steps) if (v.length > 1) p.push(`${runId}: ${k} recorded ${v.length} times`);
    if (failed.length > 1) p.push(`${runId}: call-failed recorded ${failed.length} times`);
    if (failed.length) {
      // a failed transaction (final preflight follow-up): it must be a clean prefix of the transaction, stopped, with no
      // step recorded after the failure; every step it DID record is verified like any other (nothing is skipped)
      const fseq = failed[0].seq;
      if (!L.some(e => e.event === 'experiment-stopped' && e.seq > fseq)) p.push(`${runId} failed but the experiment is not marked stopped after the failure`);
      const recorded = steps.map(([k, v]) => [k, v.length > 0, v[0]?.seq] as const);
      const firstMissing = recorded.findIndex(([, has]) => !has);
      if (firstMissing >= 0 && recorded.slice(firstMissing).some(([, has]) => has)) p.push(`${runId} failed with a gap in its transaction (steps recorded after a missing one)`);
      for (const [k, has, seq] of recorded) if (has && seq! > fseq) p.push(`${runId}: ${k} was recorded after the call failed`);
    } else {
      const missing = steps.filter(([k, v]) => v.length !== 1 && !(k === 'revision-page' && L.some(e => e.event === 'experiment-stopped' && (e.data.after === runId || String(e.data.reason ?? '').startsWith(runId))))).map(([k]) => k);
      if (missing.length) { p.push(`${runId}: incomplete sealing transaction (missing ${missing.join(', ')}); no further call may start`); continue; }
    }
    if (seal.length) {
      const raw = join(sessionDir(run, session), `raw-${phase}`), rs = verifyRawSeal(raw);
      if (!rs.ok) p.push(`${runId} raw: ${rs.problems.join('; ')}`);
      else if (rs.sealSha256 !== seal[0].data.rawSealSha256) p.push(`${runId} RAW_SEAL.json differs from its anchor`);
    }
    if (closed.length) {
      const c = closed[0].data, dir = join(run, c.dir), cl = sessionClosure(dir);
      if (cl.status !== 'closed') p.push(`${runId} server session ${cl.status}: ${cl.problems.join('; ')}`);
      else if (cl.sealSha256 !== c.closureSealSha256) p.push(`${runId} server session seal differs from its anchor`);
      const jf = join(dir, 'access.ndjson');
      if (!existsSync(jf) || fsha(jf) !== c.journalSha256) p.push(`${runId} access journal differs from its anchor`);
      else {
        const meta = JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8')), j = readJournal(jf, { logging: 'on', session: meta.session });
        if (j.status !== c.journalStatus) p.push(`${runId} access journal now reads ${j.status}, anchored ${c.journalStatus}`);
        const served = (j.lines.find((l: any) => l.type === 'session-start') as any)?.site?.files ?? null;
        if (JSON.stringify(served) !== JSON.stringify(c.servedSite)) p.push(`${runId} the site recorded in the journal differs from the anchored served site`);
      }
    }
    if (fz.length) { try { loadFrozen(run, rec, session, phase); } catch (e) { p.push(`${runId} ${(e as Error).message}`); } }
    if (rp.length === 1) p.push(...siteProblems(join(sessionDir(run, session), 'site-2'), rp[0].data.siteFiles, `${session} phase-2 site`));
  }
  // each session graph: the latest anchored head still holds byte for byte
  const heads = new Map<string, any>();
  for (const e of L) if (/^freeze-[12]$/.test(e.event)) heads.set(e.data.session, e.data.graph);
  for (const [session, head] of heads) {
    if (!head?.count) continue;
    try { const { lines } = readLinePrefix(graphOf(run, session), head.count); if (createHash('sha256').update(lines[head.count - 1]).digest('hex') !== head.lastLineSha256) p.push(`${session} graph differs from its latest anchor`); }
    catch (e) { p.push(`${session} graph: ${(e as Error).message}`); }
  }
  return p;
}
