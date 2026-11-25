/**
 * GW2 verdict-time coverage report (P1). For each counted finding, and for the end of the session, and for every
 * evidence item in the inventory, it reports five things separately:
 *   1. serverAccess         recorded | not-recorded | unavailable | invalid | uncertain   (from the server's access journal)
 *   2. reconstructedVisit   recorded | no-record | not-available     (from the agent's own browser log, if supplied, via
 *                           the imported community tool gamewatch/skillbook/steps/visit-coverage.mjs, run unchanged)
 *   3. cited                exact identifier match in THIS finding (gamewatch/gw2/inventory.ts)
 *   4. citedWithoutAccess   cited, but no server-recorded access before the finding (or, for GW1, no reconstructed visit)
 *   5. accessEvidence       what the access columns rest on: journal status, attribution, or "no journal exists"
 * "Before the finding" is decided by the server's sequence numbers (seq of the served request < seq of the finding
 * event), never by comparing wall-clock times, and an earlier finding never gets credit for later access.
 *
 *   GW2 session:  coverage.ts session <bundle.json> <sessionDir> <outDir> [--kane-stdout f --index site/index.html]
 *   GW1 replay:   coverage.ts gw1 <bundle.json> <site/index.html> <kane stdout.ndjson> <notes.ndjson> <outDir>
 * Writes <outDir>/coverage.json and <outDir>/COVERAGE.md. Findings are quoted verbatim. Read-only for its inputs.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadInventory, citations, readNdjson, type Inventory } from './inventory.ts';
import { loadSession, servedIndex } from './session.ts';
import { assertWritableOutput, repoRelative, ROOT } from './paths.ts';

const VISIT_TOOL = join(ROOT, 'gamewatch/skillbook/steps/visit-coverage.mjs');
export const NO_GW1_JOURNAL = 'No server-side access journal exists for GW1: the GW1 review server (gamewatch/kane/serve.ts) recorded form submissions only. Server access is therefore "unavailable" for every GW1 item; it is not "not accessed". No server access record has been, or can be, reconstructed for GW1.';

type Reconstruction = { columns: number; visited: Map<string, boolean[]>; firstVisit: Map<string, { at: string; step: number }>; raw: string };

/** Run the imported follow-up unchanged and parse its checklist (one column per finding, then "Run end"). */
export function reconstruct(index: string, stdout: string, notes: string): Reconstruction {
  const r = spawnSync(process.execPath, [VISIT_TOOL, index, stdout, notes], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`visit-coverage.mjs failed: ${r.stderr}`);
  const visited = new Map<string, boolean[]>(), firstVisit = new Map<string, { at: string; step: number }>();
  let section = '', columns = 0;
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('## ')) { section = line.slice(3).trim(); continue; }
    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    if (!cells.length || /^-+$/.test(cells[0]) || cells[0] === 'Evidence') { if (cells[0] === 'Evidence' && section === 'Evidence checklist') columns = cells.length - 1; continue; }
    if (section === 'Evidence checklist') visited.set(cells[0], cells.slice(1).map(c => c.startsWith('✓')));
    if (section === 'Recorded actions' && !firstVisit.has(cells[0])) firstVisit.set(cells[0], { at: cells[1], step: Number(cells[2]) });
  }
  return { columns, visited, firstVisit, raw: r.stdout };
}

type Item = { id: string; serverAccess: string; reconstructedVisit: string; cited: boolean; citedWithoutAccess: boolean };
type Column = { label: string; seq: number | null; at: string | null; category: string | null; verbatim: string | null; items: Item[]; summary: Record<string, unknown> };

function summarise(items: Item[], inv: Inventory) {
  const n = (f: (i: Item) => boolean, kind: 'C' | 'M') => items.filter(i => i.id.startsWith(kind + '-') && f(i)).length;
  return {
    serverRecorded: { cases: n(i => i.serverAccess === 'recorded', 'C'), matches: n(i => i.serverAccess === 'recorded', 'M') },
    reconstructedVisits: { cases: n(i => i.reconstructedVisit === 'recorded', 'C'), matches: n(i => i.reconstructedVisit === 'recorded', 'M') },
    of: { cases: inv.cases.length, matches: inv.matches.length },
    cited: items.filter(i => i.cited).map(i => i.id), citedWithoutAccess: items.filter(i => i.citedWithoutAccess).map(i => i.id),
  };
}

export function sessionCoverage(inv: Inventory, sessionDir: string, rec?: Reconstruction) {
  const s = loadSession(sessionDir), j = s.journal, { served } = servedIndex(j);
  const usable = j.status === 'valid' || j.status === 'incomplete';
  const access = (id: string, beforeSeq: number | null): string => {
    if (j.status === 'unavailable') return 'unavailable';
    if (j.status === 'invalid') return 'invalid';
    if (j.attribution === 'uncertain') return 'uncertain';
    const e = served.get(id);
    if (e && (beforeSeq === null || e.firstSeq < beforeSeq)) return 'recorded';
    return j.status === 'incomplete' ? 'uncertain' : 'not-recorded';
  };
  const findings = s.findings.filter(f => f.counts).sort((a, b) => (a.seq ?? Infinity) - (b.seq ?? Infinity) || a.noteIndex - b.noteIndex);
  const endSeq = usable ? j.lines.length : null;
  const ids = [...inv.cases, ...inv.matches];
  const columns: Column[] = [...findings.map((f, k) => ({ f, k })), { f: null, k: findings.length }].map(({ f, k }) => {
    const c = f ? citations(f.note, inv) : null, seq = f ? f.seq : endSeq;
    const items = ids.map(id => {
      const sa = f && f.seq === null && usable ? 'uncertain' : access(id, seq);
      const rv = rec ? (rec.visited.get(id)?.[k] ? 'recorded' : 'no-record') : 'not-available';
      const cited = !!c?.evidence.includes(id);
      return { id, serverAccess: sa, reconstructedVisit: rv, cited, citedWithoutAccess: cited && sa !== 'recorded' };
    });
    return { label: f ? `Finding ${k + 1}` : 'Session end', seq, at: f ? String(f.note.at) : null, category: f ? String(f.note.category ?? '') : null, verbatim: f ? f.line : null, items, summary: summarise(items, inv) };
  });
  return {
    schema: 'gamewatch/gw2-coverage@1', mode: 'gw2-session', exp: s.meta.exp, session: s.meta.session,
    accessEvidence: { journal: j.status, reasons: j.reasons, attribution: j.attribution, ordering: 'server sequence numbers' },
    reconstruction: rec ? 'agent browser log via visit-coverage.mjs (secondary signal)' : 'not supplied',
    uncountedFindings: s.findings.filter(f => !f.counts).map(f => ({ noteIndex: f.noteIndex, join: f.join, verbatim: f.line })),
    columns,
  };
}

export function gw1Coverage(inv: Inventory, index: string, stdout: string, notesF: string) {
  const rec = reconstruct(index, stdout, notesF);
  const ev = readNdjson(stdout).records as Record<string, unknown>[];
  const lo = Date.parse(String(ev.find(e => e.type === 'stream_start')?.ts)), hi = Date.parse(String(ev.find(e => e.type === 'run_end')?.ts));
  const { lines, records } = readNdjson(notesF);
  // the same selection the follow-up uses: Kane notes with a valid nonce inside the recorded run, in time order
  const valid = records.map((n, i) => ({ n, line: lines[i] })).filter(({ n }) => n.source === 'kane' && n.nonceValid === true && Date.parse(String(n.at)) >= lo && Date.parse(String(n.at)) <= hi)
    .sort((a, b) => Date.parse(String(a.n.at)) - Date.parse(String(b.n.at)));
  if (valid.length + 1 !== rec.columns) throw new Error(`finding count mismatch: ${valid.length} findings, ${rec.columns} reconstruction columns`);
  const ids = [...inv.cases, ...inv.matches];
  const columns: Column[] = [...valid.map((v, k) => ({ v, k })), { v: null, k: valid.length }].map(({ v, k }) => {
    const c = v ? citations(v.n, inv) : null;
    const items = ids.map(id => {
      const rv = rec.visited.get(id)?.[k] ? 'recorded' : 'no-record', cited = !!c?.evidence.includes(id);
      return { id, serverAccess: 'unavailable', reconstructedVisit: rv, cited, citedWithoutAccess: cited && rv !== 'recorded' };
    });
    return { label: v ? `Finding ${k + 1}` : 'Run end', seq: null, at: v ? String(v.n.at) : String(ev.find(e => e.type === 'run_end')?.ts), category: v ? String(v.n.category) : null, verbatim: v ? v.line : null, items, summary: summarise(items, inv) };
  });
  const firstVisits = Object.fromEntries([...rec.firstVisit].map(([id, x]) => [id, x]));
  return {
    schema: 'gamewatch/gw2-coverage@1', mode: 'gw1-historical-replay',
    accessEvidence: { journal: 'unavailable', statement: NO_GW1_JOURNAL, ordering: 'wall-clock timestamps of the note (server time) and of Kane\'s own step log; no server sequence numbers exist for GW1' },
    reconstruction: 'Kane step remarks via the imported community tool gamewatch/skillbook/steps/visit-coverage.mjs (unchanged). A recorded visit is a recognised completed click/navigation, not proof the page loaded or was read; no record is not proof of absence.',
    inputs: Object.fromEntries(Object.entries({ index, stdout, notes: notesF }).map(([k, v]) => [k, repoRelative(v) ?? v])), firstRecordedVisits: firstVisits, columns,
  };
}

export function renderMarkdown(r: ReturnType<typeof sessionCoverage> | ReturnType<typeof gw1Coverage>): string {
  const L: string[] = [`# GameWatch GW2 verdict-time coverage (${r.mode})`, ''];
  if (r.mode === 'gw1-historical-replay') L.push(`> ${(r.accessEvidence as { statement: string }).statement}`, '');
  else L.push(`Access journal: **${r.accessEvidence.journal}**${r.accessEvidence.reasons.length ? ` (${r.accessEvidence.reasons.join('; ')})` : ''}; attribution: ${r.accessEvidence.attribution}. Ordering: ${r.accessEvidence.ordering}.`, '');
  L.push(`Reconstruction: ${r.reconstruction}`, '', 'A server-recorded access means the server served the page to this session. It does not show that the page was rendered, read or understood. Missing or unusable instrumentation is reported as such, never as "not accessed".', '',
    '| Column | Category (verbatim) | Server-recorded (cases / matches) | Reconstructed visits (cases / matches) | Cited | Cited without access |', '|---|---|---|---|---|---|');
  for (const c of r.columns) {
    const s = c.summary as ReturnType<typeof summarise>;
    const srv = r.mode === 'gw1-historical-replay' ? 'unavailable (no GW1 journal)' : `${s.serverRecorded.cases}/${s.of.cases} / ${s.serverRecorded.matches}/${s.of.matches}`;
    const recv = r.reconstruction === 'not supplied' ? 'not available' : `${s.reconstructedVisits.cases}/${s.of.cases} / ${s.reconstructedVisits.matches}/${s.of.matches}`;
    L.push(`| ${c.label}${c.seq !== null ? ` (seq ${c.seq})` : ''}${c.at ? ` ${c.at}` : ''} | ${c.category ?? '—'} | ${srv} | ${recv} | ${s.cited.join(', ') || '—'} | ${s.citedWithoutAccess.join(', ') || '—'} |`);
  }
  L.push('', '## Findings, verbatim', '');
  for (const c of r.columns) if (c.verbatim) L.push(`${c.label}:`, '', '```json', c.verbatim, '```', '');
  return L.join('\n') + '\n';
}

if (process.argv[1]?.endsWith('gw2/coverage.ts')) {
  const [mode, ...a] = process.argv.slice(2);
  const opt = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  let r, outDir: string;
  if (mode === 'session' && a.length >= 3) {
    const ks = opt('--kane-stdout'), ix = opt('--index');
    outDir = assertWritableOutput(a[2]);
    r = sessionCoverage(loadInventory(a[0]), a[1], ks && ix ? reconstruct(ix, ks, join(a[1], 'notes.ndjson')) : undefined);
  } else if (mode === 'gw1' && a.length === 5) {
    outDir = assertWritableOutput(a[4]);
    r = gw1Coverage(loadInventory(a[0]), a[1], a[2], a[3]);
  } else { console.error('usage: coverage.ts session <bundle> <sessionDir> <outDir> [--kane-stdout f --index html] | gw1 <bundle> <index.html> <stdout.ndjson> <notes.ndjson> <outDir>'); process.exit(2); }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'coverage.json'), JSON.stringify(r, null, 1) + '\n');
  writeFileSync(join(outDir, 'COVERAGE.md'), renderMarkdown(r));
  for (const c of r.columns) { const s = c.summary as ReturnType<typeof summarise>; console.log(`${c.label}: server ${r.mode === 'gw1-historical-replay' ? 'unavailable' : `${s.serverRecorded.cases}/${s.of.cases} cases ${s.serverRecorded.matches}/${s.of.matches} matches`}; reconstructed ${s.reconstructedVisits.cases}/${s.of.cases} cases ${s.reconstructedVisits.matches}/${s.of.matches} matches; cited without access: ${s.citedWithoutAccess.join(', ') || 'none'}`); }
}
