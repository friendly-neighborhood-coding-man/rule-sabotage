/**
 * Balance Designer V2: hypothesis contracts, provenance and pre-registration.
 *
 * - A contract is registered (hashed, deep-frozen, journalled) BEFORE any experiment result exists. Once the
 *   first result is recorded, registration closes; evaluating a contract whose hash changed is refused.
 * - Provenance is checked, not trusted: origin "kane" needs a stored raw Kane output file whose sha256 matches,
 *   a note id present in that raw file, and a real (non test-double) kane-cli. Anything else cannot claim Kane.
 * - Outcomes are SUPPORTED / REFUTED / INCONCLUSIVE / NOT_TESTED, decided by pre-registered predictions on
 *   experiment effects with uncertainty. SUPPORTED means "the predictions held on these seeds", never "proven".
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { METRICS, type Effect } from './metrics.ts';

export type Origin = 'kane' | 'kane-test-double' | 'deterministic' | 'claude' | 'operator';
export type KaneRef = { callId: string; rawFile: string; rawSha256: string; noteId: string; cliVersion: string; isTestDouble: boolean };
export type Provenance = { origin: Origin; author: string; note: string; kane?: KaneRef };
export type Design = 'selfplay' | 'head-to-head' | 'observational';
export type Direction = 'decrease' | 'increase' | 'change' | 'no-change';
export type Prediction = {
  id: string; experiment: string; design: Design; metric: string; direction: Direction; minEffect: number;
  role: 'primary' | 'discriminating' | 'secondary'; versus?: string[]; text: string;
};
export type HypothesisContract = {
  schema: 'rule-sabotage/hypothesis@1'; id: string; version: number; title: string; provenance: Provenance;
  observation: { text: string; evidenceRefs: string[] }; mechanism: string;
  competingExplanation: string; competitors: string[]; requiredData: string[]; interventions: string[]; heldConstant: string[];
  primaryMetric: string; secondaryMetrics: string[]; safetyMetrics: string[]; predictions: Prediction[];
  rejectionCriteria: string; expectedFailureModes: string[]; kaneRunIds: string[];
};
export type Outcome = 'SUPPORTED' | 'REFUTED' | 'INCONCLUSIVE' | 'NOT_TESTED';
export type PredictionResult = { id: string; status: 'met' | 'contradicted' | 'unclear' | 'not-run'; effect: Effect | null; reason: string };
export type Evaluation = { id: string; contractHash: string; outcome: Outcome; predictions: PredictionResult[]; reasons: string[]; counterexamples: string[]; kane: { corroboration: 'AGREES' | 'DISAGREES' | 'UNVERIFIED' | 'NOT_ASKED'; detail: string } };

const sortKeys = (v: unknown): unknown => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sortKeys(x)])) : v);
export const contractHash = (c: HypothesisContract) => createHash('sha256').update(JSON.stringify(sortKeys(c))).digest('hex').slice(0, 16);
export const sha256File = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');
function deepFreeze<T>(v: T): T { if (v && typeof v === 'object') { Object.values(v).forEach(deepFreeze); Object.freeze(v); } return v; }

/** Why this provenance is not acceptable (empty = acceptable). */
export function checkProvenance(p: Provenance): string[] {
  const out: string[] = [];
  if (!['kane', 'kane-test-double', 'deterministic', 'claude', 'operator'].includes(p.origin)) out.push(`unknown origin ${p.origin}`);
  if (p.origin === 'kane' || p.origin === 'kane-test-double') {
    const k = p.kane;
    if (!k) return [...out, `origin ${p.origin} needs a Kane reference (raw output file, sha256, note id)`];
    if (!existsSync(k.rawFile)) out.push(`raw Kane file ${k.rawFile} does not exist`);
    else {
      if (sha256File(k.rawFile) !== k.rawSha256) out.push('raw Kane file sha256 does not match');
      if (!readFileSync(k.rawFile, 'utf8').includes(`"noteId":"${k.noteId}"`)) out.push(`note ${k.noteId} is not in the raw Kane file`);
    }
    if (p.origin === 'kane' && (k.isTestDouble || /test-double/.test(k.cliVersion))) out.push('a Kane test double cannot be labelled as Kane');
    if (p.origin === 'kane-test-double' && !k.isTestDouble) out.push('origin kane-test-double used for a real Kane run');
  } else if (p.kane) out.push(`origin ${p.origin} must not carry a Kane reference`);
  return out;
}

/** Structural checks on one contract: every prediction must be testable by an allowlisted experiment and metric. */
export function checkContract(c: HypothesisContract, experiments: Record<string, { designs: Design[] }>): string[] {
  const out: string[] = [];
  if (c.schema !== 'rule-sabotage/hypothesis@1') out.push('schema');
  if (!/^H[\w-]+$/.test(c.id)) out.push('id must look like H…');
  for (const f of ['title', 'mechanism', 'competingExplanation', 'rejectionCriteria'] as const) if (!String(c[f] ?? '').trim()) out.push(`${f} missing`);
  if (!c.observation?.text) out.push('observation missing');
  if (!c.predictions?.length) out.push('no predictions');
  if (!c.predictions?.some(p => p.role === 'primary')) out.push('needs at least one primary prediction');
  if (!c.predictions?.some(p => p.role === 'discriminating')) out.push('needs at least one discriminating prediction (one that an alternative hypothesis predicts differently)');
  if (!METRICS[c.primaryMetric]) out.push(`primary metric ${c.primaryMetric} unknown`);
  for (const p of c.predictions ?? []) {
    if (!METRICS[p.metric]) out.push(`${p.id}: metric ${p.metric} unknown`);
    if (p.design !== 'observational' && !experiments[p.experiment]) out.push(`${p.id}: experiment ${p.experiment} is not allowlisted`);
    else if (p.design !== 'observational' && !experiments[p.experiment].designs.includes(p.design)) out.push(`${p.id}: experiment ${p.experiment} does not run as ${p.design}`);
    if (!(p.minEffect > 0)) out.push(`${p.id}: minEffect must be > 0 (a prediction needs a material size)`);
    if (p.role === 'discriminating' && !p.versus?.length) out.push(`${p.id}: a discriminating prediction must name the hypothesis it discriminates against`);
  }
  out.push(...checkProvenance(c.provenance));
  return out;
}

const opposite = (a: Direction, b: Direction) => (a === 'decrease' && b === 'increase') || (a === 'increase' && b === 'decrease') || ((a === 'no-change') !== (b === 'no-change'));
/** A discriminating prediction discriminates only if each named rival predicts the SAME measurement differently (or not at all). */
export function discriminates(p: Prediction, rival: HypothesisContract | undefined): { ok: boolean; why: string } {
  if (!rival) return { ok: false, why: 'rival hypothesis not registered' };
  const same = rival.predictions.filter(q => q.experiment === p.experiment && q.metric === p.metric && q.design === p.design);
  if (!same.length) return { ok: true, why: `${rival.id} makes no prediction here` };
  if (same.every(q => opposite(p.direction, q.direction))) return { ok: true, why: `${rival.id} predicts ${same.map(q => q.direction).join('/')}` };
  return { ok: false, why: `${rival.id} predicts the same (${same.map(q => q.direction).join('/')}): not discriminating` };
}

export type Registered = { contract: HypothesisContract; hash: string; registeredAt: string; journalSeq: number };
export class Registry {
  private items = new Map<string, Registered>();
  private closedAt: string | null = null;
  private experiments: Record<string, { designs: Design[] }>;
  private journal: (type: string, data: unknown) => { seq: number };
  constructor(experiments: Record<string, { designs: Design[] }>, journal: (type: string, data: unknown) => { seq: number }) { this.experiments = experiments; this.journal = journal; }
  get closed() { return this.closedAt !== null; }
  register(c: HypothesisContract): Registered {
    if (this.closedAt) throw new Error(`Pre-registration closed at ${this.closedAt}: ${c.id} cannot be registered after results exist.`);
    if (this.items.has(c.id)) throw new Error(`${c.id} is already registered (contracts are immutable; register a new version id instead).`);
    const errs = checkContract(c, this.experiments);
    if (errs.length) throw new Error(`Contract ${c.id} refused: ${errs.join('; ')}`);
    const contract = deepFreeze(structuredClone(c));
    const hash = contractHash(contract);
    const e = this.journal('hypothesis-registered', { id: c.id, version: c.version, hash, origin: c.provenance.origin, contract });
    const r: Registered = { contract, hash, registeredAt: new Date().toISOString(), journalSeq: e.seq };
    this.items.set(c.id, r);
    return r;
  }
  /** Called when the first experiment result is recorded. */
  close(reason: string) { if (!this.closedAt) { this.closedAt = new Date().toISOString(); this.journal('preregistration-closed', { reason, hypotheses: [...this.items.values()].map(r => ({ id: r.contract.id, hash: r.hash, journalSeq: r.journalSeq })) }); } }
  get(id: string) { return this.items.get(id); }
  all() { return [...this.items.values()]; }
  /** Refuses if the contract object changed since registration. */
  verify(id: string): Registered {
    const r = this.items.get(id);
    if (!r) throw new Error(`${id} was never registered`);
    if (contractHash(r.contract) !== r.hash) throw new Error(`${id} changed after registration`);
    return r;
  }
}

export type ResultLookup = (experiment: string, design: Design, metric: string) => { effect: Effect; manipulationOk: boolean; manipulationDetail: string; resultSeq: number } | null;

/** Judge one prediction against its effect estimate. Small or noisy samples end "unclear", never "met". */
export function judge(p: Prediction, e: Effect | null, minUnits: number, minEvents = 0): { status: PredictionResult['status']; reason: string } {
  if (!e || e.effect === null) return { status: 'not-run', reason: 'no result' };
  if (e.units < minUnits) return { status: 'unclear', reason: `too few independent seeds (${e.units} < ${minUnits}) for an interval` };
  if (!e.ci) return { status: 'unclear', reason: 'no usable interval (too many bootstrap resamples contain no events of this kind)' };
  const ev = [e.events?.control, e.events?.treatment].filter((x): x is number => typeof x === 'number');
  if (ev.length && Math.min(...ev) < minEvents) return { status: 'unclear', reason: `too few underlying events (${ev.join(' / ')} < ${minEvents}); an interval over so few events is not judged` };
  const [lo, hi] = e.ci, m = p.minEffect, f = (x: number) => x.toFixed(3);
  const ctx = `effect ${f(e.effect)} [95% CI ${f(lo)}, ${f(hi)}], material = ${m}`;
  let status: PredictionResult['status'] = 'unclear';
  if (p.direction === 'decrease') status = hi < 0 && e.effect <= -m ? 'met' : lo > -m ? 'contradicted' : 'unclear';
  if (p.direction === 'increase') status = lo > 0 && e.effect >= m ? 'met' : hi < m ? 'contradicted' : 'unclear';
  if (p.direction === 'change') status = (lo > 0 || hi < 0) && Math.abs(e.effect) >= m ? 'met' : lo > -m && hi < m ? 'contradicted' : 'unclear';
  if (p.direction === 'no-change') status = lo > -m && hi < m ? 'met' : (lo > 0 || hi < 0) && Math.abs(e.effect) >= m ? 'contradicted' : 'unclear';
  if (status === 'met' && e.batches.length === 2 && e.batches.some(b => b === null || Math.sign(b) !== Math.sign(e.effect!)) && p.direction !== 'no-change') return { status: 'unclear', reason: `${ctx}; but the two independent seed batches disagree (${e.batches.join(' vs ')})` };
  return { status, reason: ctx };
}

export function evaluateHypothesis(reg: Registry, id: string, lookup: ResultLookup, minUnits: number, minEvents = 0): Evaluation {
  const r = reg.verify(id), c = r.contract;
  const preds: PredictionResult[] = [];
  const reasons: string[] = [];
  for (const p of c.predictions) {
    const res = lookup(p.experiment, p.design, p.metric);
    if (!res) { preds.push({ id: p.id, status: 'not-run', effect: null, reason: `${p.experiment}/${p.design} was not run` }); continue; }
    if (res.resultSeq <= r.journalSeq) throw new Error(`${id}: result for ${p.experiment} predates the registration (journal seq ${res.resultSeq} ≤ ${r.journalSeq})`);
    const j = judge(p, res.effect, minUnits, minEvents);
    if (!res.manipulationOk && j.status !== 'not-run') { preds.push({ id: p.id, status: 'unclear', effect: res.effect, reason: `manipulation check failed (${res.manipulationDetail}): the intervention did not do what it declared, so the result is confounded` }); continue; }
    let status = j.status, reason = j.reason;
    if (p.role === 'discriminating' && status === 'met') {
      const bad = (p.versus ?? []).map(v => ({ v, d: discriminates(p, reg.get(v)?.contract) })).filter(x => !x.d.ok);
      if (bad.length) { status = 'unclear'; reason += `; NOT discriminating: ${bad.map(b => b.d.why).join('; ')}`; }
    }
    preds.push({ id: p.id, status, effect: res.effect, reason });
  }
  const primary = c.predictions.filter(p => p.role === 'primary').map(p => preds.find(x => x.id === p.id)!);
  const disc = c.predictions.filter(p => p.role === 'discriminating').map(p => preds.find(x => x.id === p.id)!);
  let outcome: Outcome;
  if (primary.every(p => p.status === 'not-run')) { outcome = 'NOT_TESTED'; reasons.push('no primary prediction could be tested'); }
  else if (primary.some(p => p.status === 'contradicted')) { outcome = 'REFUTED'; reasons.push(`primary prediction contradicted: ${primary.filter(p => p.status === 'contradicted').map(p => `${p.id} (${p.reason})`).join('; ')}`); }
  else if (primary.every(p => p.status === 'met') && disc.length && disc.every(p => p.status === 'met')) { outcome = 'SUPPORTED'; reasons.push('every primary and discriminating prediction held on these seeds (support, not proof)'); }
  else { outcome = 'INCONCLUSIVE'; reasons.push(...[...primary, ...disc].filter(p => p.status !== 'met').map(p => `${p.id}: ${p.status} (${p.reason})`)); }
  return { id, contractHash: r.hash, outcome, predictions: preds, reasons, counterexamples: [], kane: { corroboration: 'NOT_ASKED', detail: '' } };
}

/** Kane can only lower confidence: a real disagreement or counterexample turns SUPPORTED into INCONCLUSIVE. Never the reverse. */
export function applyKaneChallenge(e: Evaluation, k: { corroboration: Evaluation['kane']['corroboration']; detail: string; counterexamples?: string[] }): Evaluation {
  const out = { ...e, kane: { corroboration: k.corroboration, detail: k.detail }, counterexamples: [...e.counterexamples, ...(k.counterexamples ?? [])], reasons: [...e.reasons] };
  if (e.outcome === 'SUPPORTED' && (k.corroboration === 'DISAGREES' || (k.counterexamples?.length ?? 0) > 0)) { out.outcome = 'INCONCLUSIVE'; out.reasons.push(`Kane challenge: ${k.detail}`); }
  return out;
}

/** The V1 check (13 rows, statement + negation) establishes a fact about rows. It is never enough for a causal outcome. */
export function v1ConfirmationOnly(): Outcome { return 'NOT_TESTED'; }
