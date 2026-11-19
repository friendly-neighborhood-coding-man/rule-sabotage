/**
 * V4: offline replay of the five STORED KX3 Kane submissions through the normalizer. Reads the immutable V3 files,
 * writes balance/v4/kane-normalized.json. Never contacts Kane, never edits V3 files, never registers anything
 * against V3's completed games: a VALIDATED_PROPOSAL here is only ELIGIBLE for a future, approved, prospective test.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { ROOT } from '../v3/batch.ts';
import { normalizeEntry, NORMALIZER_VERSION, normalizerHash } from './normalize.ts';
import { checkProvenance, type Provenance } from '../v2/contracts.ts';

export const KX3_DIR = 'evidence/balance/v3/kane/2026-11-19T15-41-35Z-KX3';
export const SCREEN_DIR = 'evidence/balance/v3/datasets/2026-11-19T13-38-38Z-v3-screen';
const sha = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');

export function replayKaneKX3(write = true) {
  const dir = join(ROOT, KX3_DIR);
  const notesFile = join(dir, 'kane-notes.ndjson'), entriesFile = join(dir, 'kane-v3-entries.json');
  const before = { notes: sha(notesFile), entries: sha(entriesFile) };
  const entries = JSON.parse(readFileSync(entriesFile, 'utf8')) as { noteId: string; callId: string; receivedAt: string; rawBody: string; proposal: { provenance: Provenance } }[];
  const run = JSON.parse(readFileSync(join(ROOT, SCREEN_DIR, 'run.json'), 'utf8')) as { datasetHash: string };
  const gameIds = new Set(readFileSync(join(ROOT, SCREEN_DIR, 'games.ndjson'), 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l).gameId as string));
  const records = entries.map(e => {
    const prov: Provenance = { ...e.proposal.provenance, kane: e.proposal.provenance.kane ? { ...e.proposal.provenance.kane, rawFile: notesFile } : undefined };
    const provProblems = checkProvenance(prov);
    const r = normalizeEntry(e, { provenance: prov, gameIds, datasetHash: run.datasetHash, id: `HK4-${e.noteId}` });
    // portable path in the stored record
    const portable = (p: Provenance): Provenance => ({ ...p, kane: p.kane ? { ...p.kane, rawFile: `${KX3_DIR}/kane-notes.ndjson` } : undefined });
    r.provenance.kaneAuthored = portable(r.provenance.kaneAuthored);
    r.candidate.proposal.provenance = portable(r.candidate.proposal.provenance);
    if (r.validated) r.validated.provenance = portable(r.validated.provenance);
    return { ...r, provenanceCheck: provProblems.length ? provProblems : 'PASS (raw file sha256, note id, real CLI)' };
  });
  const after = { notes: sha(notesFile), entries: sha(entriesFile) };
  if (before.notes !== after.notes || before.entries !== after.entries) throw new Error('V3 raw Kane files changed during replay');
  const doc = {
    schema: 'rule-sabotage/v4-kane-normalized@1', normalizer: NORMALIZER_VERSION, normalizerHash: normalizerHash(),
    source: { dir: KX3_DIR, notesSha256: after.notes, entriesSha256: after.entries, dataset: SCREEN_DIR, datasetHash: run.datasetHash },
    historicalResult: 'UNCHANGED: under the parser frozen before the V3 call, 0 of 5 entries were registered and every Kane hypothesis is NOT_TESTED (balance/v3/kane-proposals.json). This file does not alter that.',
    eligibility: 'A VALIDATED_PROPOSAL below is a system-normalized representation of a Kane-authored entry. It may only be registered PROSPECTIVELY, before games that have not been played, after an operator approves that experiment. humanApprovedExperiment is null for all.',
    counts: Object.fromEntries(['VALIDATED_PROPOSAL', 'REJECTED_AMBIGUOUS', 'REJECTED_INVALID'].map(s => [s, records.filter(r => r.status === s).length])),
    records,
  };
  if (write) writeFileSync(join(ROOT, 'balance/v4/kane-normalized.json'), JSON.stringify(doc, null, 2) + '\n');
  return doc;
}
