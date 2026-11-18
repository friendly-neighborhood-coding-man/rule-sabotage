/**
 * Deterministic candidate optimizer and promotion gate.
 * Candidates are small, bounded weight changes derived from anomalies; only anomalies whose
 * finding is Kane-CONFIRMED (real kane-cli) can make a candidate eligible for promotion.
 */
import { type Weights, type FeatureKey, validateWeights, BOUNDS } from '../weights.ts';
import type { Anomaly } from './anomaly.ts';
import type { Finding } from './evidence.ts';
import type { Metrics } from './selfplay.ts';

export type Change = { path: string; target: string; field: 'utility' | 'upkeep'; old: number; proposed: number; reason: string; anomalyId: string; anomalyFingerprint: string; findingStatus: Finding['status'] };
export type Candidate = { id: string; version: string; parent: string; changes: Change[]; weights: Weights; eligible: boolean; eligibilityReason: string; source: 'optimizer' | 'v0.3-bundle' };
export type OptimizerConfig = { maxCandidates: number; maxRelativeStep: number; scoreSteps: number[]; upkeepSteps: number[] };

const r2 = (x: number) => Math.round(x * 100) / 100;
const clamp = (x: number, [lo, hi]: readonly [number, number]) => Math.max(lo, Math.min(hi, x));
const get = (w: Weights, field: Change['field'], target: string) => (field === 'utility' ? w.featureUtilityToActivator[target as FeatureKey] : w.placementUpkeep[target]);
const set = (w: Weights, ch: Change) => { if (ch.field === 'utility') w.featureUtilityToActivator[ch.target as FeatureKey] = ch.proposed; else w.placementUpkeep[ch.target] = ch.proposed; };

export function proposeCandidates(base: Weights, anomalies: Anomaly[], findings: Finding[], cfg: OptimizerConfig, cycle: number): Candidate[] {
  const byFp = new Map(findings.map(f => [f.fingerprint, f]));
  // Only anomalies that were investigated and not refuted produce candidates; refuted ones are dropped with the reason kept in the report.
  const usable = anomalies.filter(a => a.knob && byFp.has(a.fingerprint) && byFp.get(a.fingerprint)!.status !== 'REFUTED');
  const perAnomaly: { a: Anomaly; f: Finding; changes: Change[] }[][] = usable.map(a => {
    const f = byFp.get(a.fingerprint)!, k = a.knob!;
    const mk = (field: Change['field'], target: string, proposed: number, why: string): Change => ({
      path: field === 'utility' ? `featureUtilityToActivator.${target}` : `placementUpkeep.${target}`, target, field, old: get(base, field, target), proposed, reason: why, anomalyId: a.id, anomalyFingerprint: a.fingerprint, findingStatus: f.status,
    });
    const opts: Change[][] = [];
    const why = `(${a.metric} ${a.value} vs threshold ${a.threshold})`;
    if (k.kind === 'utility') for (const st of cfg.scoreSteps) {
      const step = Math.min(st, cfg.maxRelativeStep), old = base.featureUtilityToActivator[k.feature];
      const nv = r2(clamp(old * (k.direction === 'toward-zero' ? 1 - step : 1 + step), BOUNDS.utility));
      if (nv !== old) opts.push([mk('utility', k.feature, nv, `${a.type}: move the V0.3 activator utility ${k.feature} (prices ${k.effect}) ${Math.round(step * 100)}% ${k.direction === 'toward-zero' ? 'toward 0, because the measured consequence is smaller than the prior' : 'away from 0'} ${why}`)]);
    }
    if (k.kind === 'upkeep') for (const st of cfg.upkeepSteps) {
      const old = base.placementUpkeep[k.effect], cap = Math.max(st, old * cfg.maxRelativeStep);
      const nv = r2(clamp(old + (k.direction === 'up' ? Math.min(st, cap) : -Math.min(st, cap)), BOUNDS.upkeep));
      if (nv !== old) opts.push([mk('upkeep', k.effect, nv, `${a.type}: ${k.direction === 'up' ? 'raise' : 'lower'} the placement upkeep of ${k.effect} by ${r2(Math.abs(nv - old))} ${why}`)]);
    }
    if (k.kind === 'upkeep-pair') for (const st of cfg.upkeepSteps)
      opts.push(k.effects.map(e => mk('upkeep', e, r2(clamp(base.placementUpkeep[e] + st, BOUNDS.upkeep)), `${a.type}: raise the placement upkeep of both halves of the pair by ${st} ${why}`)));
    return opts.map(changes => ({ a, f, changes }));
  });
  // round-robin across anomalies (highest severity first), so several hypotheses get a candidate
  const picked: { a: Anomaly; f: Finding; changes: Change[] }[] = [];
  for (let i = 0; picked.length < cfg.maxCandidates && perAnomaly.some(l => l.length > i); i++)
    for (const l of perAnomaly) if (l[i] && picked.length < cfg.maxCandidates) picked.push(l[i]);
  return picked.map((p, i) => {
    const w: Weights = structuredClone(base);
    delete (w as Weights & { hash?: string }).hash;
    for (const c of p.changes) set(w, c);
    w.parent = base.version; w.version = `${base.version}+c${cycle}.${i + 1}`; w.createdAt = new Date().toISOString(); w.origin = `balance-loop optimizer, cycle ${cycle}`;
    w.label = `Candidate ${i + 1} of cycle ${cycle}: ${p.changes.map(c => `${c.path} ${c.old}→${c.proposed}`).join(', ')}`;
    const v = validateWeights(w);
    if (!v.ok) throw new Error(`optimizer produced invalid weights: ${v.errors.join('; ')}`);
    const eligible = p.f.status === 'CONFIRMED' && p.f.verifier === 'kane-cli';
    return {
      id: `C${i + 1}`, version: w.version, parent: base.version, changes: p.changes, weights: w, eligible, source: 'optimizer' as const,
      eligibilityReason: eligible ? `based on ${p.a.id}, CONFIRMED by kane-cli` : `based on ${p.a.id} whose finding is ${p.f.status} (${p.f.verifier}): evaluated for the record, cannot be promoted`,
    };
  });
}

/** The V0.3 bundle's own human proposal, evaluated next to the optimizer's candidates. Never eligible: it is not derived from a Kane-verified finding. */
export function bundleCandidate(base: Weights, bundle: Weights, id: string): Candidate | null {
  const changes: Change[] = [];
  for (const k of Object.keys(bundle.featureUtilityToActivator) as FeatureKey[]) if (bundle.featureUtilityToActivator[k] !== base.featureUtilityToActivator[k])
    changes.push({ path: `featureUtilityToActivator.${k}`, target: k, field: 'utility', old: base.featureUtilityToActivator[k], proposed: bundle.featureUtilityToActivator[k], reason: 'V0.3 bundle heuristic-proposal-v1-NOT-KANE (human-authored, not derived from this run)', anomalyId: '-', anomalyFingerprint: '-', findingStatus: 'UNVERIFIED' });
  if (!changes.length) return null;
  const w: Weights = { ...structuredClone(base), featureUtilityToActivator: { ...bundle.featureUtilityToActivator }, version: `${base.version}+v03-candidate`, parent: base.version, origin: bundle.origin, label: bundle.label };
  delete (w as Weights & { hash?: string }).hash;
  return { id, version: w.version, parent: base.version, changes, weights: w, eligible: false, source: 'v0.3-bundle', eligibilityReason: 'V0.3 bundle proposal (NOT Kane-derived): evaluated for the record, cannot be promoted' };
}

// ---------------------------------------------------------------- comparison + gate
export type PromotionConfig = {
  requireKaneConfirmed: boolean; targetImprovementMin: number; maxFirstPlayerDeviationIncrease: number; maxDiversityDrop: number;
  maxMedianTurnsChange: number; maxDrawRateIncrease: number; maxTurnLimitRate: number;
};
export type Gate = { name: string; pass: boolean; detail: string; hard: boolean };
export type Comparison = { candidate: string; target: { metric: string; baseline: number; candidate: number; improvement: number }[]; gates: Gate[]; pass: boolean; score: number; rejectReasons: string[] };

/** The measurable target of an anomaly on held-out metrics: lower is better. */
export function targetValue(a: Anomaly, m: Metrics): { metric: string; value: number } | null {
  const e = m.effects[a.subject];
  switch (a.type) {
    case 'cost-not-realized': return { metric: `calibration error |predicted − realized| per trigger of ${a.subject}`, value: e ? Math.abs(e.predictedMean - e.realizedMean) : 0 };
    case 'dominant-effect': return { metric: `placement share of ${a.subject} × (win rate when used − 0.5)`, value: e ? e.share * Math.max(0, (e.winRateWhenUsed ?? 0.5) - 0.5) : 0 };
    case 'overpowered-combo': { const c = m.combos?.[a.subject]; return c ? { metric: `win rate of players using ${a.subject}, above 0.5`, value: Math.max(0, c.winRate - 0.5) } : null; }
    case 'wasted-placements': return { metric: `unused-cell rate of ${a.subject}`, value: e?.unusedRate ?? 0 };
    case 'never-selected': return { metric: `1 − placement share of ${a.subject}`, value: 1 - (e?.share ?? 0) };
    default: return null;
  }
}

export function compare(c: Candidate, anomalies: Anomaly[], base: Metrics, cand: Metrics, cfg: PromotionConfig, safety: { invariantsPass: boolean; engineHashUnchanged: boolean; detail: string }): Comparison {
  const gates: Gate[] = [];
  const g = (name: string, pass: boolean, detail: string, hard = false) => gates.push({ name, pass, detail, hard });
  const fpDev = (m: Metrics) => Math.abs(m.firstPlayerWinRate - 0.5);
  g('safety: no illegal actions, engine errors or softlocks on held-out games', cand.safety.illegal === 0 && cand.safety.errors === 0 && cand.safety.softlocks === 0, `illegal ${cand.safety.illegal}, errors ${cand.safety.errors}, softlocks ${cand.safety.softlocks}`, true);
  g('safety: engine invariant suite passes (symmetry, fire-once, chain cap, softlock, legality) and engine source unchanged', safety.invariantsPass && safety.engineHashUnchanged, safety.detail, true);
  g('evidence: based on a Kane-CONFIRMED finding (real kane-cli)', !cfg.requireKaneConfirmed || c.eligible, c.eligibilityReason, true);
  const targets = [...new Set(c.changes.map(x => x.anomalyId))].filter(id => anomalies.some(a => a.id === id)).map(id => anomalies.find(a => a.id === id)!).map(a => {
    const b = targetValue(a, base);
    // no baseline value on held-out seeds = the anomaly did not reproduce there: nothing to improve, the gate fails
    if (!b) return { metric: `${a.id} (${a.type} ${a.subject}) not reproduced on held-out baseline`, baseline: 0, candidate: 0, improvement: 0 };
    // the candidate made the pattern disappear entirely (for example nobody plays the combo any more)
    const k = targetValue(a, cand) ?? { metric: b.metric, value: 0 };
    return { metric: b.metric, baseline: Math.round(b.value * 1000) / 1000, candidate: Math.round(k.value * 1000) / 1000, improvement: b.value > 0 ? Math.round(((b.value - k.value) / b.value) * 1000) / 1000 : 0 };
  }).filter(Boolean) as Comparison['target'];
  g(`target: the anomaly metric improves by at least ${cfg.targetImprovementMin * 100}% on held-out seeds`, targets.length > 0 && targets.every(t => t.improvement >= cfg.targetImprovementMin), targets.map(t => `${t.metric}: ${t.baseline} → ${t.candidate} (${(t.improvement * 100).toFixed(1)}%)`).join('; ') || 'no measurable target');
  g(`fairness: first-player deviation from 50% grows by at most ${cfg.maxFirstPlayerDeviationIncrease}`, fpDev(cand) - fpDev(base) <= cfg.maxFirstPlayerDeviationIncrease, `first-player win rate ${base.firstPlayerWinRate} → ${cand.firstPlayerWinRate}`);
  g(`diversity: normalised effect entropy drops by at most ${cfg.maxDiversityDrop}`, base.diversity.effectEntropyNorm - cand.diversity.effectEntropyNorm <= cfg.maxDiversityDrop, `${base.diversity.effectEntropyNorm} → ${cand.diversity.effectEntropyNorm}; distinct openings ${base.diversity.distinctOpenings} → ${cand.diversity.distinctOpenings}`);
  const mt = base.turns.median ? Math.abs(cand.turns.median - base.turns.median) / base.turns.median : 0;
  g(`game length: median turns changes by at most ${cfg.maxMedianTurnsChange * 100}%`, mt <= cfg.maxMedianTurnsChange, `median ${base.turns.median} → ${cand.turns.median}`);
  g(`draws: draw rate grows by at most ${cfg.maxDrawRateIncrease}`, cand.drawRate - base.drawRate <= cfg.maxDrawRateIncrease, `${base.drawRate} → ${cand.drawRate}`);
  g(`stalling: at most ${cfg.maxTurnLimitRate * 100}% of games hit the turn limit`, cand.turnLimitRate <= cfg.maxTurnLimitRate, `${cand.turnLimitRate}`);
  g('counterplay: lead changes per game do not fall by more than 30%', base.counterplay.leadChangesPerGame === 0 || cand.counterplay.leadChangesPerGame >= base.counterplay.leadChangesPerGame * 0.7, `lead changes/game ${base.counterplay.leadChangesPerGame} → ${cand.counterplay.leadChangesPerGame}; comeback rate ${base.counterplay.comebackRate} → ${cand.counterplay.comebackRate}`);
  const pass = gates.every(x => x.pass);
  const score = (targets.reduce((a, t) => a + t.improvement, 0) / Math.max(1, targets.length)) + 0.5 * (cand.diversity.effectEntropyNorm - base.diversity.effectEntropyNorm) - (fpDev(cand) - fpDev(base));
  return { candidate: c.id, target: targets, gates, pass, score: Math.round(score * 1000) / 1000, rejectReasons: gates.filter(x => !x.pass).map(x => `${x.name}: ${x.detail}`) };
}

/** Next promoted version: bump the patch number of the parent (0.3.0 -> 0.3.1). */
export function nextVersion(parent: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(parent);
  return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : `${parent}.1`;
}
