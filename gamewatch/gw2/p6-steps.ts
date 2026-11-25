/**
 * GW2 P6: the steps of the GW2 SkillBook (gamewatch/gw2/book.json), run one at a time by the UNCHANGED vendored
 * SkillFlow runner (gamewatch/vendor/skillflow/runner.py). Each step does one thing and writes a small JSON verdict
 * (`ok`, plus what it checked) so the runner's existing acceptance operators suffice. No model, no Kane.
 *
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/p6-steps.ts <step> <verdict.json> <expDir> [options]
 *
 * Steps (book order): procedures · partition · session-plan · [investigate: kane-boundary.ts, gated] · closure ·
 * import · freeze · representations · three-way · heldout · discriminate · report · integrity.
 * Exit codes: 0 ok · 1 the step's check failed (verdict says why) · 2 usage.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { ROOT, assertWritableOutput, repoRelative } from './paths.ts';
import { fileSha256, verify as verifyGraph } from './judgments.ts';
import { loadGenerationProcedure } from './generate.ts';
import { loadProcedure, partition, verifyPartitions } from './partition.ts';
import { leakCheck } from './leak-check.ts';
import { writeSessionPlan, freezeHypotheses, verifyFreeze, verifyLedger, readSessionPlan } from './freeze.ts';
import { sessionClosure } from './session-close.ts';
import { importSession } from './import-session.ts';
import { appendSubmitterRepresentations, sealRepresentations, verifyRepresentationSeal } from './representations.ts';
import { evaluateExperiment, evalLaw } from './verify.ts';
import { evaluateHeldout, loadSealedInputs, predictive, P5_ENCODING } from './heldout.ts';
import { discriminate } from './discriminate.ts';
import { checkRepresentation, type Clause } from './hypothesis.ts';
import { loadSession, servedIndex } from './session.ts';
import { wilson } from '../../server/balance/v3/stats.ts';

export const P6_REPORT_SCHEMA = 'gamewatch/gw2-p6-report@1';
export const P6_REPORTER = { id: 'gamewatch/gw2/p6-steps.ts#report', version: '1' } as const;
const json = (x: unknown) => JSON.stringify(x, null, 1) + '\n';
const abs = (p: string) => (isAbsolute(p) ? p : join(ROOT, p));
const sessionDirs = (exp: string) => existsSync(join(exp, 'sessions')) ? readdirSync(join(exp, 'sessions')).sort().map(s => join(exp, 'sessions', s)) : [];
const latest = (exp: string, prefix: string) => {
  const d = join(exp, 'evaluations'), fs = existsSync(d) ? readdirSync(d).filter(f => f.startsWith(prefix + '-') && f.endsWith('.json')) : [];
  const f = fs.sort((a, b) => Number(a.slice(prefix.length + 1, -5)) - Number(b.slice(prefix.length + 1, -5))).pop();
  return f ? JSON.parse(readFileSync(join(d, f), 'utf8')) : null;
};
const rate = (k: number, n: number) => ({ k, n, rate: n ? Math.round(k / n * 1000) / 1000 : null, wilson95: n ? wilson(k, n) : null });

/** Per-profile metrics, kept separate (EXPERIMENT_DESIGN §3, AC-P6.3). Pure over its inputs. */
export function profileMetrics(input: {
  investigators: { session: string; profile: string }[];
  nodes: { id: string; kind: string; body: Record<string, any> }[];
  heldout: any; threeWay: any;
  predictionsByRep: Map<string, { situations: Set<string>; matching: number; recorded: number; contradicting: number }>;
  heldoutSituations: number;
  access: Map<string, { served: Set<string>; citedWithoutAccess: string[]; cited: string[] }>;
}) {
  const defectsPresent = new Set<string>((input.threeWay?.implementationCorrectness ?? []).filter((x: any) => x.scope?.partition === 'heldout' && x.value === 'deviates').map((x: any) => `${x.rule}@${x.scope.build}`));
  const hyps = new Map<string, any>((input.heldout?.hypotheses ?? []).map((h: any) => [h.hypothesis, h]));
  const tw = new Map<string, any>((input.threeWay?.hypotheses ?? []).map((h: any) => [h.hypothesis, h]));
  return input.investigators.map(({ session, profile }) => {
    const mine = input.nodes.filter(n => (n.kind === 'hypothesis' || n.kind === 'abstention') && n.body.session === session);
    const primary = mine.filter(n => hyps.get(n.id)?.analysisSet?.eligible === true), hyp = primary.filter(n => n.kind === 'hypothesis');
    const reps = hyp.flatMap(n => (hyps.get(n.id)?.representations ?? []).filter((r: any) => r.representationStatus !== 'not-representable').map((r: any) => r.representation as string));
    const situations = new Set<string>(); let matching = 0, recorded = 0, contradicting = 0;
    for (const r of reps) { const p = input.predictionsByRep.get(r); if (!p) continue; p.situations.forEach(s => situations.add(s)); matching += p.matching; recorded += p.recorded; contradicting += p.contradicting; }
    const detected = new Set<string>();
    for (const n of hyp) for (const r of tw.get(n.id)?.representations ?? []) for (const p of r.byPartition ?? []) if (p.partition === 'heldout')
      for (const x of p.readings ?? []) if (x.reading === 'accurate-description-of-a-defect' && defectsPresent.has(`${x.rule}@${p.build}`)) detected.add(`${x.rule}@${p.build}`);
    const a = input.access.get(session);
    return {
      session, profile, label: 'TEST DOUBLE: measures the measuring machinery, not an agent',
      submissions: { hypotheses: mine.filter(n => n.kind === 'hypothesis').length, abstentions: mine.filter(n => n.kind === 'abstention').length, primary: primary.length, excludedFromPrimary: mine.length - primary.length },
      representations: { sealed: reps.length, hypothesesWithout: hyp.filter(n => !(hyps.get(n.id)?.representations ?? []).length).length },
      coverage: { ...rate(situations.size, input.heldoutSituations), unit: 'held-out situations with at least one prediction ÷ held-out situations (assertions made ÷ opportunities)' },
      accuracy: { ...rate(matching, recorded), unit: 'held-out outcome checks matching ÷ checks with a recorded outcome (over assertions made; descriptive)' },
      incorrectAssertions: { contradictingChecks: contradicting, unit: 'held-out outcome checks contradicted by the recorded outcome (count, not netted against anything)' },
      detection: { ...rate(detected.size, defectsPresent.size), detected: [...detected].sort(), unit: 'held-out (rule, build) spec deviations with an accurate description of a defect ÷ deviations present; abstention counts as not detected' },
      citations: { cited: a?.cited.length ?? 0, citedWithoutAccess: a?.citedWithoutAccess.length ?? 0, pagesServed: a?.served.size ?? 0, unit: 'evidence ids cited in submissions; cited before the server journal records that page served to this session' },
    };
  });
}

/** Dimensions on which a profile could "look better", with the direction that counts as better. */
export const DIMENSIONS: { key: string; better: 'higher' | 'lower'; get: (m: ReturnType<typeof profileMetrics>[number]) => number | null }[] = [
  { key: 'coverage', better: 'higher', get: m => m.coverage.rate },
  { key: 'accuracy', better: 'higher', get: m => m.accuracy.rate },
  { key: 'detection', better: 'higher', get: m => m.detection.rate },
  { key: 'incorrect assertions', better: 'lower', get: m => m.incorrectAssertions.contradictingChecks },
  { key: 'cited without access', better: 'lower', get: m => m.citations.citedWithoutAccess },
];
/** Where profile a is strictly better than b. A null value (no assertion made, so no rate) is never better. */
export function ranksAbove(a: ReturnType<typeof profileMetrics>[number], b: ReturnType<typeof profileMetrics>[number]) {
  return DIMENSIONS.filter(d => { const x = d.get(a), y = d.get(b); if (x === null) return false; if (y === null) return true; return d.better === 'higher' ? x > y : x < y; }).map(d => d.key);
}

function accessOf(exp: string) {
  const out = new Map<string, { served: Set<string>; citedWithoutAccess: string[]; cited: string[] }>();
  for (const d of sessionDirs(exp)) {
    const s = loadSession(d), { served } = servedIndex(s.journal), session = String(s.meta.session), cited: string[] = [], without: string[] = [];
    for (const f of [...s.findings, ...s.hypotheses]) for (const id of String((f.note as Record<string, unknown>).evidence ?? '').match(/\b[CM]-[0-9a-f]{6}\b/g) ?? []) {
      cited.push(id); const e = served.get(id); if (!e || f.seq === null || e.firstSeq > f.seq) without.push(id);
    }
    out.set(session, { served: new Set(served.keys()), cited, citedWithoutAccess: without });
  }
  return out;
}

export function p6Report(exp: string, o: { at?: string; encoding?: string } = {}) {
  const inv = JSON.parse(readFileSync(join(exp, 'INVESTIGATORS.json'), 'utf8')).sessions as { session: string; profile: string }[];
  const heldout = latest(exp, 'heldout'), threeWay = latest(exp, 'three-way');
  if (!heldout || !threeWay) throw new Error('report needs the three-way and held-out evaluations');
  const g = loadSealedInputs(exp, P6_REPORTER, { encoding: o.encoding }); // a recorded gate opening, after the freeze and seal
  const predictionsByRep = new Map<string, { situations: Set<string>; matching: number; recorded: number; contradicting: number }>();
  for (const h of g.cands) for (const r of h.representations) {
    const chk = checkRepresentation(r.representation); if (chk.status === 'not-representable') continue;
    const clauses = chk.clauses.flatMap(c => c.ok ? [c.clause] : []) as Clause[], agg = { situations: new Set<string>(), matching: 0, recorded: 0, contradicting: 0 };
    for (const [, sits] of Object.entries(g.parts.heldout)) {
      const p = predictive(clauses, sits);
      agg.matching += p.outcomeChecks.matching; agg.contradicting += p.outcomeChecks.contradicting; agg.recorded += p.outcomeChecks.matching + p.outcomeChecks.contradicting;
      for (const c of clauses) if (c.form === 'law') for (const id of evalLaw(c, sits).predictions.keys()) agg.situations.add(id);
    }
    predictionsByRep.set(r.id, agg);
  }
  const heldoutSituations = Object.values(g.parts.heldout).reduce((n, s) => n + s.length, 0);
  const metrics = profileMetrics({ investigators: inv, nodes: g.nodes as never, heldout, threeWay, predictionsByRep, heldoutSituations, access: accessOf(exp) });
  const byProfile = Object.fromEntries(metrics.map(m => [m.profile, m]));
  const abst = byProfile['over-abstaining'], acc = byProfile['accurate'];
  const abstentionCheck = abst && acc ? { overAbstainingAboveAccurateOn: ranksAbove(abst, acc), allowed: ['incorrect assertions'],
    why: 'The over-abstaining profile makes no assertion, so it has no contradicted prediction: it is "better" on incorrect assertions only because it asserts nothing. Its accuracy has no denominator (no rate), its coverage is 0 and its detection counts every abstention as not detected, so it never ranks above the accurate profile on those (EXPERIMENT_DESIGN §3 abstention handling).' } : null;
  const report = { schema: P6_REPORT_SCHEMA, at: o.at ?? new Date().toISOString(), exp: repoRelative(exp) ?? exp, label: inv.every(s => s.profile !== 'kane') ? 'All sessions are scripted TEST DOUBLES started through the Kane invocation boundary. They measure the machinery, not any agent.' : 'Real Kane sessions (exploratory capability and feasibility study; not an architecture comparison, no claim of improvement).',
    dataset: (JSON.parse(readFileSync(join(exp, 'partitions', 'PARTITION.json'), 'utf8')).procedure?.id === 'p7-partition-1') ? 'P7 evidence (p7-generation-1, p7-partition-1)' : 'P5 development and dry-run dataset (U1, D93)', profiles: metrics, abstentionCheck,
    rule: 'Dimensions are reported side by side and never combined; no ranking by a single column is reported. Detection counts abstention as not detected; error counts are over assertions made.',
    sources: { heldout: heldout.evaluator, threeWay: threeWay.evaluator, seal: g.seal.sealSha256, freeze: g.g.freezeSha256 } };
  writeFileSync(assertWritableOutput(join(exp, 'P6_REPORT.json')), json(report));
  writeFileSync(assertWritableOutput(join(exp, 'P6_REPORT.md')), renderReport(report));
  return report;
}

function renderReport(r: any): string {
  const rows = (r.profiles as any[]).map(m => `| ${m.profile} | ${m.submissions.hypotheses} / ${m.submissions.abstentions} | ${m.coverage.k}/${m.coverage.n} | ${m.accuracy.rate === null ? 'no assertion (no rate)' : `${m.accuracy.k}/${m.accuracy.n} = ${m.accuracy.rate}`} | ${m.incorrectAssertions.contradictingChecks} | ${m.detection.k}/${m.detection.n} | ${m.citations.citedWithoutAccess} of ${m.citations.cited} |`);
  return [`# GW2 P6 test-double report`, '', `**${r.label}**`, '', `Dataset: ${r.dataset}.`, '',
    '| Profile | Hypotheses / abstentions | Coverage (held-out situations) | Held-out accuracy | Incorrect assertions | Defects described accurately | Cited without access |', '|---|---|---|---|---|---|---|', ...rows, '',
    r.rule, '', r.abstentionCheck ? `**Over-abstaining vs accurate.** Ranks above on: ${r.abstentionCheck.overAbstainingAboveAccurateOn.join(', ') || 'nothing'}. ${r.abstentionCheck.why}` : '', ''].join('\n');
}

/** Final integrity verification of every sealed artifact of the experiment. */
export function integrity(exp: string) {
  const checks: { check: string; ok: boolean; detail: string }[] = [];
  const add = (check: string, ok: boolean, detail = '') => checks.push({ check, ok, detail });
  const parts = verifyPartitions(exp); add('partition manifests', !parts.length, parts.join('; '));
  for (const d of sessionDirs(exp)) { const c = sessionClosure(d); add(`session ${d.split(/[\\/]/).pop()} closed and sealed`, c.status === 'closed', c.problems.join('; ')); }
  const g = verifyGraph(join(exp, 'judgments.ndjson'), { checkRefs: true }); add('judgment graph', g.ok, g.ok ? `${g.count} nodes` : String(g.problems[0]?.problem));
  const f = verifyFreeze(exp); add('hypothesis freeze', f.ok, f.problems.join('; '));
  const s = verifyRepresentationSeal(exp); add('representation seal', s.ok, s.problems.join('; '));
  const l = verifyLedger(join(exp, 'evaluation-ledger.ndjson')); add('evaluation ledger', l.ok && l.count > 0, `${l.count} entries ${l.problems.join('; ')}`);
  const plan = readSessionPlan(exp); add('declared sessions all present', sessionDirs(exp).length === plan.expectedSessions, `${sessionDirs(exp).length} of ${plan.expectedSessions}`);
  return { ok: checks.every(c => c.ok), checks };
}

export async function runStep(step: string, verdict: string, exp: string, o: Record<string, string | undefined>) {
  const at = o.at, write = (v: Record<string, unknown>) => { const f = assertWritableOutput(verdict); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, json({ step, ...v })); return v.ok === true; };
  switch (step) {
    case 'procedures': {
      const gen = loadGenerationProcedure(abs(o.generation!)), part = loadProcedure(abs(o.partition!));
      const prov = JSON.parse(readFileSync(join(dirname(abs(o.bundle!)), 'PROVENANCE.json'), 'utf8'));
      const problems: string[] = [];
      if (prov.procedure?.id !== gen.id || prov.procedure?.sha256 !== fileSha256(abs(o.generation!))) problems.push('bundle provenance names another generation procedure');
      if (prov.bundle?.sha256 !== fileSha256(abs(o.bundle!))) problems.push('bundle hash differs from its provenance');
      if (Date.parse(prov.startedAt) <= Date.parse(gen.frozenAt)) problems.push('bundle generated before its procedure was frozen');
      return write({ ok: !problems.length, generation: gen.id, partition: part.id, bundleSha256: fileSha256(abs(o.bundle!)), problems });
    }
    case 'partition': {
      const r = await partition(abs(o.partition!), abs(o.bundle!), exp, { structuredField: true });
      const leak = leakCheck(exp);
      writeFileSync(assertWritableOutput(join(exp, 'LEAK_CHECK.json')), json(leak));
      return write({ ok: leak.ok && !verifyPartitions(exp).length, assignment: { discovery: r.split.discovery, heldout: r.split.heldout }, leakCheck: { ok: leak.ok, files: leak.files } });
    }
    case 'session-plan': {
      const n = Number(o.sessions); writeSessionPlan(exp, n, `P6: one test-double session per investigator profile (${o.profiles})`);
      return write({ ok: readSessionPlan(exp).expectedSessions === n, expectedSessions: n });
    }
    case 'closure': {
      const c = sessionDirs(exp).map(d => ({ session: d.split(/[\\/]/).pop(), ...sessionClosure(d) }));
      return write({ ok: c.length > 0 && c.every(x => x.status === 'closed'), sessions: c.map(x => ({ session: x.session, status: x.status, closure: x.closure })) });
    }
    case 'import': {
      const graph = join(exp, 'judgments.ndjson');
      for (const d of sessionDirs(exp)) {
        const run = join(exp, 'kane-runs', d.split(/[\\/]/).pop()!), label = JSON.parse(readFileSync(join(d, 'session.json'), 'utf8')).label;
        // a real Kane session (P7) is imported only with its stored stdout and args (Kane provenance); test doubles never are
        importSession(d, graph, label === 'kane' ? { kane: { stdout: join(run, 'stdout.ndjson'), args: join(run, 'args.json') } } : {});
      }
      const v = verifyGraph(graph, { checkRefs: true });
      return write({ ok: v.ok, nodes: v.count });
    }
    case 'freeze': { const f = freezeHypotheses(exp, { at }); return write({ ok: true, counts: f.counts, freezeSha256: f.freezeSha256 }); }
    case 'representations': {
      const sub = appendSubmitterRepresentations(exp, { at }), seal = sealRepresentations(exp, { at }), chk = verifyRepresentationSeal(exp);
      return write({ ok: chk.ok && seal.counts.externalTranslation === 0, submitter: sub.length, sealed: seal.representations.length, externalTranslations: seal.counts.externalTranslation, note: 'U3 (D95): submitter-authored representations only; no translation, no repair' });
    }
    case 'three-way': { const r = evaluateExperiment(exp, { at, encoding: o.encoding ?? P5_ENCODING }); return write({ ok: true, file: repoRelative(r.file) ?? r.file }); }
    case 'heldout': { const r = evaluateHeldout(exp, { at, encoding: o.encoding }); return write({ ok: true, file: repoRelative(r.file) ?? r.file, primary: r.report.primaryAnalysis.hypotheses.length }); }
    case 'discriminate': { const r = discriminate(exp, { at, encoding: o.encoding }); return write({ ok: true, file: repoRelative(r.file) ?? r.file, pairs: r.report.pairs.length }); }
    case 'report': { const r = p6Report(exp, { at, encoding: o.encoding }); const ok = r.abstentionCheck === null || r.abstentionCheck.overAbstainingAboveAccurateOn.every(k => r.abstentionCheck!.allowed.includes(k)); return write({ ok, profiles: r.profiles.length, abstentionCheck: r.abstentionCheck }); } // abstentionCheck is null without test-double profiles (P7)
    case 'integrity': { const r = integrity(exp); return write({ ok: r.ok, checks: r.checks }); }
    default: throw new Error(`unknown step ${step}`);
  }
}

if (process.argv[1]?.endsWith('gw2/p6-steps.ts')) {
  const a = process.argv.slice(2), opt: Record<string, string> = {};
  const pos: string[] = [];
  for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) opt[a[i].slice(2)] = a[++i]; else pos.push(a[i]);
  const [step, verdict, exp] = pos;
  if (!step || !verdict || !exp) { console.error('usage: p6-steps.ts <step> <verdict.json> <expDir> [--bundle f --generation f --partition f --sessions n --profiles a,b --at ISO --encoding f]'); process.exit(2); }
  try { const ok = await runStep(step, abs(verdict), abs(exp), opt); console.log(`${step}: ${ok ? 'ok' : 'FAILED'}`); process.exit(ok ? 0 : 1); }
  catch (e) { console.error(`${step}: ${(e as Error).message}`); try { writeFileSync(assertWritableOutput(abs(verdict)), json({ step, ok: false, error: (e as Error).message })); } catch { /* verdict not writable */ } process.exit(1); }
}
