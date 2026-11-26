/**
 * GW2 P8 corrections (operator review PHASE_8_CONDITIONALLY_APPROVED, 2026-11-26 04:19 UTC; D117-D120).
 *
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/p8-corrections.ts [--out evidence/gw2/p8/<new file>]
 *
 * The P8 output (evidence/gw2/p8/REPRODUCTION.json, gamewatch/gw2/p8-reproduce.ts run()) is kept unchanged. This module
 * adds the corrected analyses as a separate, deterministic output (REPRODUCTION-2.json):
 *   - novelty is reported per held-out counterexample as a NOVEL INDIVIDUAL VALUE (a behavioural input value that never
 *     occurs in the comparison pool) or a NOVEL COMBINATION of individually observed values (the smallest unseen
 *     sub-combinations are listed), each at two scopes: the discovery situations the clause applies to, and all discovery
 *     situations of the same kind and build;
 *   - page access is split into delivered BEFORE the hypothesis was submitted, delivered only AFTER it, and never delivered,
 *     from the access journal's sequence numbers. "Delivered" means the server returned the page (HTTP 200); it is not
 *     evidence that the agent read any particular part of it.
 * Nothing under evidence/gw2/p7-pilot/ is written; the evaluation gate is not opened.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './paths.ts';
import { reproduce, lawCounts, run as runV1, writeOutput, safeOutputPath, PUB } from './p8-reproduce.ts';
import { SITUATION_FIELDS, type Situation } from './situations.ts';
import { checkRepresentation } from './hypothesis.ts';

const EXP = join(ROOT, PUB, 'exp');
export const NOT_COMPARED = ['build', 'turn'] as const; // identity and ordinal position, not behavioural inputs
type V = Situation['fields'][string];

export type Novelty = {
  class: 'novel-individual-value' | 'novel-combination-of-observed-values' | 'observed-combination' | 'empty-pool';
  individual: string[];          // field=value never seen in the pool
  combinations: string[][];      // minimal unseen sub-combinations (size 2..maxSize), only when no individual novelty
  unknownFields: string[];       // fields whose value is null here (not compared)
  poolSize: number;
};

const fmt = (f: string, v: V) => `${f}=${JSON.stringify(v)}`;
function subsets<T>(xs: T[], k: number): T[][] { if (k === 0) return [[]]; if (xs.length < k) return []; const [h, ...t] = xs; return [...subsets(t, k - 1).map(s => [h, ...s]), ...subsets(t, k)]; }

/** Novelty of one situation's behavioural inputs against a pool of situations of the same kind. */
export function novelty(s: Situation, pool: Situation[], maxSize = 3): Novelty {
  const fields = Object.keys(SITUATION_FIELDS[s.kind].inputs).filter(f => !(NOT_COMPARED as readonly string[]).includes(f));
  const known = fields.filter(f => s.fields[f] !== null && s.fields[f] !== undefined), unknownFields = fields.filter(f => !known.includes(f));
  if (!pool.length) return { class: 'empty-pool', individual: [], combinations: [], unknownFields, poolSize: 0 };
  const individual = known.filter(f => !pool.some(d => d.fields[f] === s.fields[f]));
  if (individual.length) return { class: 'novel-individual-value', individual: individual.map(f => fmt(f, s.fields[f])), combinations: [], unknownFields, poolSize: pool.length };
  const seen = (fs: string[]) => pool.some(d => fs.every(f => d.fields[f] === s.fields[f]));
  const minimal: string[][] = [];
  for (let k = 2; k <= Math.min(maxSize, known.length); k++)
    for (const c of subsets(known, k)) if (!seen(c) && !minimal.some(m => m.every(f => c.includes(f)))) minimal.push(c);
  if (!minimal.length && seen(known)) return { class: 'observed-combination', individual: [], combinations: [], unknownFields, poolSize: pool.length };
  return { class: 'novel-combination-of-observed-values', individual: [], combinations: (minimal.length ? minimal : [known]).map(c => c.map(f => fmt(f, s.fields[f]))), unknownFields, poolSize: pool.length };
}

type Entry = { seq: number; type: string; kind?: string; evidenceId?: string | null; status?: number; hypIndex?: number };
export const journal = (session: string, exp = EXP): Entry[] => readFileSync(join(exp, 'sessions', session, 'access.ndjson'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

/** When a page was delivered relative to a submission: before it, only after it, or never (HTTP 200 only). */
export function delivery(j: Entry[], unit: string, submissionSeq: number | null): 'delivered-before-submission' | 'delivered-only-after-submission' | 'never-delivered' {
  const d = j.filter(e => e.type === 'request' && e.kind === 'evidence' && e.status === 200 && e.evidenceId === unit).map(e => e.seq);
  if (!d.length) return 'never-delivered';
  if (submissionSeq === null) return 'delivered-only-after-submission'; // no submission event: nothing was delivered "before" it
  return d.some(x => x < submissionSeq) ? 'delivered-before-submission' : 'delivered-only-after-submission';
}
export const submissionSeq = (j: Entry[], index: number): number | null => j.find(e => e.type === 'hypothesis' && e.hypIndex === index)?.seq ?? null;

const count = <T extends string>(xs: T[]) => xs.reduce((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {} as Record<string, number>);

export function analyseV2(r = reproduce()) {
  const byId = new Map(r.nodes.map(n => [n.id, n]));
  const labels = Object.keys(r.parts.discovery).sort();
  const reps = r.cands.flatMap(h => h.representations.map(rep => ({ h, rep, body: byId.get(h.hypothesis)!.body as any })));
  return reps.map(({ h, rep, body }) => {
    const session = String(body.session), j = journal(session), sub = submissionSeq(j, Number(body.index));
    const clauses = checkRepresentation(rep.representation).clauses.flatMap(c => c.ok ? [c.clause] : []) as any[];
    return { hypothesis: h.ref, session, representation: rep.id, submissionJournalSeq: sub,
      deliveredBeforeSubmission: [...new Set(j.filter(e => e.type === 'request' && e.kind === 'evidence' && e.status === 200 && sub !== null && e.seq < sub).map(e => e.evidenceId!))].sort(),
      byBuild: labels.map(label => {
        const disc = r.parts.discovery[label] ?? [], held = r.parts.heldout[label] ?? [];
        const out: any = { build: label };
        for (const c of clauses) {
          const d = lawCounts(c, disc), ho = lawCounts(c, held), unit = (s: Situation) => s.id.split('/')[0];
          const kindPool = disc.filter(s => s.kind === c.situation);
          const dAccess = d.contradicted.map(s => delivery(j, unit(s), sub));
          const hoRows = ho.contradicted.map(s => ({ situation: s.id, applicableScope: novelty(s, d.applicable), kindScope: novelty(s, kindPool) }));
          Object.assign(out, {
            discovery: { applicable: d.applicable.length, contradicted: d.contradicted.length, byDelivery: count(dAccess),
              unitsDeliveredBeforeSubmissionWithCounterexample: [...new Set(d.contradicted.filter((s, i) => dAccess[i] === 'delivered-before-submission').map(unit))].sort() },
            heldout: { applicable: ho.applicable.length, contradicted: ho.contradicted.length, delivery: 'never delivered: held-out pages are not served to discovery sessions',
              noveltyApplicableScope: count(hoRows.map(x => x.applicableScope.class)), noveltyKindScope: count(hoRows.map(x => x.kindScope.class)),
              counterexamples: hoRows.filter(x => x.applicableScope.class !== 'observed-combination' || x.kindScope.class !== 'observed-combination') },
          });
        }
        return out;
      }) };
  });
}

export function specDeviationDelivery(v1 = runV1()) {
  const sessions = [...new Set(reproduce().freeze.hypotheses.map((h: any) => String(h.session)))].sort();
  const first = Object.fromEntries(sessions.map(s => { const j = journal(s); return [s, { j, firstSubmission: j.find(e => e.type === 'hypothesis')?.seq ?? null }]; }));
  return v1.specDeviations.map((d: any) => ({ rule: d.rule, byPartition: d.byPartition.map((p: any) => p.partition !== 'discovery' ? { partition: p.partition, build: p.build, units: p.units, delivery: 'held-out: never delivered' } : {
    partition: p.partition, build: p.build, units: p.units,
    deliveredBeforeFirstSubmission: Object.fromEntries(Object.keys(p.openedBySessions).map(u => [u, sessions.filter(s => delivery(first[s].j, u, first[s].firstSubmission) === 'delivered-before-submission')])),
    deliveredOnlyAfterFirstSubmission: Object.fromEntries(Object.keys(p.openedBySessions).map(u => [u, sessions.filter(s => delivery(first[s].j, u, first[s].firstSubmission) === 'delivered-only-after-submission')]).filter(([, v]) => (v as string[]).length)),
  }) }));
}

export function runV2() {
  const v1 = runV1();
  return {
    schema: 'gamewatch/gw2-p8-reproduction@2',
    corrects: { file: 'evidence/gw2/p8/REPRODUCTION.json', schema: 'gamewatch/gw2-p8-reproduction@1', kept: 'unchanged; this file adds corrected analyses and replaces no number in it' },
    reproductionOk: v1.ok, reproductionChecks: v1.checks.length,
    corrections: [
      { id: 'D117', what: 'the reproduction CLI refuses any --out inside the repository other than a NEW file under evidence/gw2/p8/, and never overwrites an existing file' },
      { id: 'D118', what: 'novelty split into novel individual values and novel combinations of individually observed values, at the applicable scope and the kind scope' },
      { id: 'D119', what: 'page access split into delivered before submission, delivered only after submission, never delivered; delivery (HTTP 200) is not reading' },
    ],
    counterexamples: analyseV2(), specDeviations: specDeviationDelivery(v1),
    definitions: {
      'novel-individual-value': 'at least one behavioural input value of the situation never occurs in the pool',
      'novel-combination-of-observed-values': 'every behavioural input value occurs somewhere in the pool, but not together; the smallest unseen sub-combinations (2-3 fields) are listed',
      'observed-combination': 'the full behavioural input tuple occurs in the pool',
      applicableScope: 'pool = discovery situations of the same build to which the clause applies',
      kindScope: 'pool = all discovery situations of the same kind and build',
      notCompared: [...NOT_COMPARED],
      'delivered-before-submission': 'the server delivered the page (HTTP 200) to the submitting session before the journal recorded this hypothesis; says nothing about which part was read',
      'delivered-only-after-submission': 'first delivered after this hypothesis was recorded',
      'never-delivered': 'never delivered to the submitting session',
    },
  };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('gw2/p8-corrections.ts')) {
  const i = process.argv.indexOf('--out');
  if (i > 0) safeOutputPath(process.argv[i + 1]);
  const out = runV2(), text = JSON.stringify(out, null, 1) + '\n';
  if (i > 0) console.log(`written ${writeOutput(process.argv[i + 1], text)}`); else process.stdout.write(text);
  process.exitCode = out.reproductionOk ? 0 : 1;
}
