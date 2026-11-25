/**
 * Import GW1's three Kane findings and their three post-freeze labels into a GW2 judgment graph, by reference (P2).
 *
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/import-gw1.ts [out.ndjson]   default evidence/gw2/gw1-import/judgments.ndjson
 *
 * Reads, never writes, the frozen GW1 files:
 *   evidence/gamewatch/review/notes.ndjson                     the three submitted findings (quoted verbatim, line + hash)
 *   evidence/gamewatch/review/run/GW1-blind-review/stdout.ndjson  kane-cli 0.10.4 output (Kane provenance)
 *   evidence/gamewatch/review/run/GW1-blind-review/args.json      kane-cli invocation record (Kane provenance)
 *   gamewatch/private/evaluation/labels.json                   the post-freeze labels (by JSON pointer + file hash)
 *   gamewatch/private/mutations.json                           what the labels were judged against (by hash)
 * Deterministic: every timestamp comes from the source files; no import time is recorded. The output is a new file and
 * an existing output is never overwritten or extended.
 *
 * The finding nodes are historical imports attributed to kane-cli 0.10.4 (authentic Kane output, verified against the
 * stored stdout/args). The label nodes are historical imports by the GW1 preparing session (Claude Code); its model
 * version is not recorded in labels.json, and the author version says so instead of guessing. No node says which
 * finding is right: the clean finding and the two anomaly findings coexist, each with its own label.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './paths.ts';
import { append, fileSha256, sha256, type NodeInput } from './judgments.ts';

export const GW1 = {
  notes: 'evidence/gamewatch/review/notes.ndjson',
  stdout: 'evidence/gamewatch/review/run/GW1-blind-review/stdout.ndjson',
  args: 'evidence/gamewatch/review/run/GW1-blind-review/args.json',
  labels: 'gamewatch/private/evaluation/labels.json',
  mutations: 'gamewatch/private/mutations.json',
} as const;

export function gw1Nodes(root = ROOT): { findings: NodeInput[]; labels: (finding: string[]) => NodeInput[] } {
  const ref = (path: string) => ({ path, sha256: fileSha256(join(root, path)) });
  const noteLines = readFileSync(join(root, GW1.notes), 'utf8').replace(/\r\n/g, '\n').split('\n').filter(Boolean);
  const args = JSON.parse(readFileSync(join(root, GW1.args), 'utf8'));
  const author = { kind: 'agent' as const, id: 'kane-cli', version: String(args.version) };
  const findings = noteLines.map((line, i): NodeInput => {
    const note = JSON.parse(line), lineRef = { ...ref(GW1.notes), line: i + 1, lineSha256: sha256(line) };
    return {
      kind: 'finding', parents: [], author, origin: 'historical-import', at: note.at,
      evidenceRefs: [lineRef],
      body: { verbatim: line, category: note.category, run: 'GW1-blind-review', finding: i + 1 },
      provenance: { kaneStdout: ref(GW1.stdout), kaneArgs: ref(GW1.args), note: lineRef },
    };
  });
  const L = JSON.parse(readFileSync(join(root, GW1.labels), 'utf8'));
  const mutationsRef = ref(GW1.mutations);
  const labels = (findingIds: string[]) => (L.findings as Record<string, unknown>[]).map((l, i): NodeInput => {
    const n = Number(l.finding);
    if (l.submittedAt !== JSON.parse(noteLines[n - 1]).at) throw new Error(`label ${i} does not match finding ${n} by submission time`);
    return {
      kind: 'label', parents: [{ id: findingIds[n - 1], relation: 'evaluates' }],
      author: { kind: 'agent', id: 'claude-code: GW1 preparing session (labeller)', version: `not recorded in ${GW1.labels} (labelledAt ${L.labelledAt})` },
      origin: 'historical-import', at: String(L.labelledAt),
      evidenceRefs: [{ ...ref(GW1.labels), pointer: `/findings/${i}` }, mutationsRef],
      criteria: `GW1 post-freeze label against ${GW1.mutations} (sha256 ${mutationsRef.sha256}); labelledBy: ${L.labelledBy}`,
      reason: String(l.why),
      body: { label: l.label, detects: l.detects, category: l.category, finding: n, labelEntry: l }, // the original bytes stay in labels.json (pointer + file hash)
    };
  });
  return { findings, labels };
}

export function importGw1(out: string, root = ROOT) {
  if (existsSync(out)) throw new Error(`refusing to import into an existing file (append-only, never regenerated in place): ${out}`);
  const { findings, labels } = gw1Nodes(root);
  const ids = findings.map(f => append(out, f, { root }).id);
  const labelIds = labels(ids).map(l => append(out, l, { root }).id);
  return { findings: ids, labels: labelIds };
}

if (process.argv[1]?.endsWith('gw2/import-gw1.ts')) {
  const out = process.argv[2] ?? join(ROOT, 'evidence/gw2/gw1-import/judgments.ndjson');
  try { const r = importGw1(out); console.log(`imported ${r.findings.length} findings and ${r.labels.length} labels into ${out}`); }
  catch (e) { console.error((e as Error).message); process.exit(5); }
}
