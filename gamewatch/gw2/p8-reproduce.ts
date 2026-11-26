/**
 * GW2 P8: offline reproduction of the P7 pilot results from the PUBLISHED (redacted) evidence alone.
 *
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/p8-reproduce.ts [--out <file>]
 *
 * No network, no Kane, no paid call, and nothing under evidence/gw2/p7-pilot/ is written (the evaluation gate, which
 * appends to the evaluation ledger, is NOT opened). What it does:
 *
 *  1. Anchors. The published external record verifies as a hash chain; FREEZE.json, REPRESENTATIONS.json, the graph prefix
 *     at the seal and the raw seals equal the hashes anchored in it; every published file matches REDACTION_RECORD.json,
 *     and each redacted raw file's ORIGINAL hash equals its raw seal and the graph provenance (the published copy cannot
 *     re-hash the originals; the operator holds them).
 *  2. Inputs. Partition files are read only if their bytes match the manifests bound by the freeze. Hypotheses are the
 *     frozen ones; representations are those sealed before the first evaluation opening (graph prefix of 11 nodes).
 *  3. Re-evaluation. The committed library cores (heldoutCore, discriminateCore, threeWay) are re-run on these inputs and
 *     compared field by field with the committed evaluation files (heldout-2, discrimination-3, three-way-1).
 *  4. An independent per-situation re-count of every represented law clause (own evaluator over evalExpr), compared
 *     with the committed counts, and the P8 counterexample classification (opened / accessible / absent from discovery).
 *
 * The output is deterministic (no timestamps) so the committed REPRODUCTION.json can be checked byte for byte.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from './paths.ts';
import { verify as verifyGraph } from './judgments.ts';
import { readExecLedger } from './p7-exec.ts';
import { extractSituations, alignBuilds, SITUATION_FIELDS, type Situation } from './situations.ts';
import { heldoutCore, primaryFromNode, P5_ENCODING, type Cand, type Parts, type Groups } from './heldout.ts';
import { discriminateCore } from './discriminate.ts';
import { threeWay, loadEncoding } from './verify.ts';
import { checkRepresentation, evalExpr, isUnknown } from './hypothesis.ts';

export const PUB = 'evidence/gw2/p7-pilot';
const EXP = join(ROOT, PUB, 'exp'), REC = join(ROOT, PUB, 'external-record');
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const fsha = (f: string) => sha(readFileSync(f));
const json = (f: string) => JSON.parse(readFileSync(f, 'utf8'));
const canon = (x: unknown): string => JSON.stringify(x, (_k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
type Check = { check: string; ok: boolean; detail?: string };

export function reproduce() {
  const checks: Check[] = [];
  const ok = (check: string, cond: boolean, detail?: string) => { checks.push({ check, ok: !!cond, ...(cond || !detail ? {} : { detail }) }); return !!cond; };

  // 1. anchors
  const rec = readExecLedger(REC);
  ok('external execution ledger verifies as a hash chain', rec.problems.length === 0, rec.problems.join('; '));
  const ev = (e: string) => rec.entries.filter((x: any) => x.event === e) as any[];
  ok('external ledger events', canon(rec.entries.map((e: any) => e.event)) === canon(['preregistered', 'session-end', 'session-end', 'session-end', 'hypothesis-freeze', 'representation-seal', 'integrity']));
  const freezeF = join(EXP, 'hypotheses/FREEZE.json'), sealF = join(EXP, 'hypotheses/REPRESENTATIONS.json');
  ok('FREEZE.json equals its external anchor', fsha(freezeF) === ev('hypothesis-freeze')[0]?.data.freezeSha256);
  ok('REPRESENTATIONS.json equals its external anchor', fsha(sealF) === ev('representation-seal')[0]?.data.sealSha256);
  const graphF = join(EXP, 'judgments.ndjson'), lines = readFileSync(graphF, 'utf8').split('\n').filter(Boolean);
  const anchorAt = (a: { count: number; lastLineSha256: string }) => lines.length >= a.count && sha(lines[a.count - 1]) === a.lastLineSha256;
  ok('graph prefix at the freeze equals its external anchor', anchorAt(ev('hypothesis-freeze')[0].data.graph));
  ok('graph prefix at the seal equals its external anchor', anchorAt(ev('representation-seal')[0].data.graph));
  ok('graph at the integrity checkpoint equals its external anchor', anchorAt(ev('integrity')[0].data.graph) && lines.length === ev('integrity')[0].data.graph.count);
  const g = verifyGraph(graphF, { checkRefs: false });
  ok('judgment graph structure and hash chain (references to redacted raw files not re-hashed)', g.ok, `first bad line ${g.firstBadLine}`);
  const red = json(join(ROOT, PUB, 'REDACTION_RECORD.json')), byFile = new Map<string, any>(red.files.map((f: any) => [f.file, f]));
  ok('every published file matches its published hash', red.files.every((f: any) => existsSync(join(ROOT, f.file)) && fsha(join(ROOT, f.file)) === f.publishedSha256));
  for (const s of ev('session-end')) {
    const dir = `${PUB}/exp/kane-runs/${s.data.session}`, seal = json(join(ROOT, dir, 'RAW_SEAL.json'));
    ok(`raw seal ${s.data.session}: equals its external anchor`, canon(seal.files) === canon(s.data.rawSeal) && fsha(join(ROOT, dir, 'RAW_SEAL.json')) === s.data.rawSealSha256);
    ok(`raw seal ${s.data.session}: original hashes in the redaction record equal the seal`, Object.entries(seal.files).every(([n, h]) => byFile.get(`${dir}/${n}`)?.originalSha256 === h));
  }
  for (const n of g.nodes) {
    const k = (n as any).provenance?.kaneStdout; if (!k) continue;
    ok(`graph provenance of ${n.id.slice(0, 12)}: original stdout hash`, byFile.get(k.path)?.originalSha256 === k.sha256);
  }

  // 2. inputs (manifest-bound partitions, frozen hypotheses, sealed representations)
  const freeze = json(freezeF), seal = json(sealF);
  const part = (p: string, file: string) => {
    const dir = join(EXP, 'partitions', p), mf = join(dir, 'MANIFEST.json');
    if (fsha(mf) !== freeze.manifests[p]) throw new Error(`${p}/MANIFEST.json is not the manifest bound by the freeze`);
    if (fsha(join(dir, file)) !== json(mf).files[file]) throw new Error(`${p}/${file} differs from its manifest`);
    return JSON.parse(readFileSync(join(dir, file), 'utf8'));
  };
  const spec = part('spec', 'spec.json'), E = part('eval', 'eval.json'), evalMap = E.idMaps;
  ok('partition files match the manifests bound by the freeze', true);
  const parts = { discovery: {}, heldout: {} } as Parts, groups = { discovery: {}, heldout: {} } as Record<'discovery' | 'heldout', Record<string, Groups>>;
  const twParts: { partition: string; builds: string[]; situations: Situation[] }[] = [];
  for (const p of ['discovery', 'heldout'] as const) {
    const obs = part(p, 'observations.json'), map = evalMap[p]?.builds ?? {};
    const al = alignBuilds(extractSituations(obs), map, evalMap.discovery?.builds ?? {});
    const seeds: number[] = E.assignment?.[p]?.seeds ?? [], ms = evalMap[p]?.matchSeeds;
    const basis = ms ? 'matches grouped by seed (eval/ matchSeeds); cases grouped by script' : seeds.length === 1 ? `matches grouped by seed: the partition has the single seed ${seeds[0]}; cases grouped by script` : `cases grouped by script; matches ungrouped (${seeds.length} seeds, no per-match seed map): each match is an upper bound on independence`;
    for (const b of obs.builds as string[]) {
      const label = map[b] ?? b, of = new Map<string, string>();
      for (const c of obs.cases.filter((c: any) => c.build === b)) of.set(`case:${c.caseId}`, `script:${c.script}`);
      for (const m of obs.matches.filter((m: any) => m.build === b)) of.set(`match:${m.matchId}`, ms ? `seed:${ms[m.matchId]}` : seeds.length === 1 ? `seed:${seeds[0]}` : `match:${m.matchId}`);
      parts[p][label] = al.sits.filter(s => s.build === (al.alignment[b]?.discoveryId ?? b));
      groups[p][label] = { of, basis };
    }
    twParts.push({ partition: p, builds: (obs.builds as string[]).map(b => al.alignment[b]?.discoveryId ?? b).sort(), situations: al.sits });
  }
  const cutoff = ev('representation-seal')[0].data.graph.count;
  const nodes = g.nodes.slice(0, cutoff), byId = new Map(nodes.map(n => [n.id, n]));
  const frozenIds = new Set<string>(freeze.hypotheses.map((h: any) => h.id));
  const cands: Cand[] = nodes.filter(n => frozenIds.has(n.id)).map(n => ({
    hypothesis: n.id, ref: String((n.body as any).ref ?? ''), kind: n.kind, primary: primaryFromNode(n as never),
    representations: seal.representations.filter((r: any) => r.hypothesis === n.id).map((r: any) => { const x = byId.get(r.id)!, b = x.body as any; return { id: r.id, origin: r.origin, fidelity: b.fidelity?.declared ?? 'unknown', author: `${x.author.kind}:${x.author.id}`, representation: b.representation }; }),
  }));
  return { checks, cands, parts, groups, twParts, spec, nodes, freeze, seal };
}

/** Own per-situation evaluation of a law clause: applicable situations and contradicted ones (recorded outcome ≠ expectation). */
export function lawCounts(clause: any, sits: Situation[]) {
  const applicable: Situation[] = [], contradicted: Situation[] = [], matching: Situation[] = [];
  for (const s of sits) {
    if (s.kind !== clause.situation) continue;
    const w = clause.when ? evalExpr(clause.when, s.fields as any) : true;
    if (isUnknown(w) || w !== true) continue;
    applicable.push(s);
    let bad = false, recorded = false;
    for (const x of clause.expect) { const want = evalExpr(x.equals, s.fields as any), got = s.fields[x.field]; if (got === null || got === undefined || isUnknown(want)) continue; recorded = true; if (want !== got) bad = true; }
    if (recorded) (bad ? contradicted : matching).push(s);
  }
  return { applicable, contradicted, matching };
}

const NOT_COMPARED = new Set(['build', 'turn']); // identity and ordinal position, not behavioural inputs
export function novelInputs(s: Situation, seen: Situation[]) {
  return Object.keys(SITUATION_FIELDS[s.kind].inputs).filter(f => !NOT_COMPARED.has(f) && !seen.some(d => d.fields[f] === s.fields[f])).map(f => `${f}=${JSON.stringify(s.fields[f])}`);
}

export function analyse(r: ReturnType<typeof reproduce>) {
  const access = (session: string) => new Set(readFileSync(join(EXP, 'sessions', session, 'access.ndjson'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter((e: any) => e.type === 'request' && e.kind === 'evidence' && e.status === 200).map((e: any) => e.evidenceId));
  const byId = new Map(r.nodes.map(n => [n.id, n]));
  const reps = r.cands.flatMap(h => h.representations.map(rep => ({ h, rep, session: String((byId.get(h.hypothesis)!.body as any).session) })));
  const labels = Object.keys(r.parts.discovery).sort();
  return reps.map(({ h, rep, session }) => {
    const opened = access(session), clauses = checkRepresentation(rep.representation).clauses.flatMap(c => c.ok ? [c.clause] : []) as any[];
    return { hypothesis: h.ref, session, representation: rep.id, openedEvidence: [...opened].sort(), byBuild: labels.map(label => {
      const out: any = { build: label };
      for (const c of clauses) {
        const d = lawCounts(c, r.parts.discovery[label] ?? []), ho = lawCounts(c, r.parts.heldout[label] ?? []);
        const unit = (s: Situation) => s.id.split('/')[0];
        const dOpened = d.contradicted.filter(s => opened.has(unit(s))), dNotOpened = d.contradicted.filter(s => !opened.has(unit(s)));
        const hoClass = ho.contradicted.map(s => {
          const novel = novelInputs(s, d.applicable);
          const cls = novel.length ? 'absent-from-discovery: input values never present in the applicable discovery situations'
            : d.contradicted.length ? 'kind already exemplified by counterexamples in accessible discovery evidence'
            : 'not a counterexample in discovery, although each input value occurred there';
          return { situation: s.id, class: cls, novelInputs: novel };
        });
        const tally = (k: string) => hoClass.filter(x => x.class.startsWith(k)).length;
        Object.assign(out, {
          discovery: { applicable: d.applicable.length, matching: d.matching.length, contradicted: d.contradicted.length,
            contradictedInEvidenceOpenedBySession: dOpened.length, contradictedInAccessibleEvidenceNotOpened: dNotOpened.length,
            openedUnitsWithCounterexample: [...new Set(dOpened.map(unit))].sort(), unitsWithCounterexample: new Set(d.contradicted.map(unit)).size },
          heldout: { applicable: ho.applicable.length, matching: ho.matching.length, contradicted: ho.contradicted.length,
            alreadyExemplifiedInDiscovery: tally('kind already'), absentFromDiscovery: tally('absent-from-discovery'), notCounterexampleInDiscoveryButValuesSeen: tally('not a counterexample'),
            absentCases: hoClass.filter(x => !x.class.startsWith('kind already')) },
        });
      }
      return out;
    }) };
  });
}

export function run() {
  const r = reproduce(), checks = r.checks;
  const ok = (check: string, cond: boolean, detail?: string) => checks.push({ check, ok: !!cond, ...(cond || !detail ? {} : { detail }) });
  const cmp = (name: string, a: unknown, b: unknown) => ok(name, canon(a) === canon(b), 'differs');
  const ev = (f: string) => json(join(EXP, 'evaluations', f));
  const H = ev('heldout-2.json'), D = ev('discrimination-3.json'), T = ev('three-way-1.json');
  const discoveryBuilds = Object.keys(json(join(EXP, 'partitions/eval/eval.json')).idMaps.discovery?.builds ?? {}).sort();
  const hc = heldoutCore(r.cands, r.parts, { groups: r.groups.heldout, discoveryBuilds });
  cmp('held-out evaluation re-derived: hypotheses equal heldout-2.json', hc.hypotheses, H.hypotheses);
  cmp('held-out evaluation re-derived: columns equal heldout-2.json', hc.columns, H.columns);
  const enc = loadEncoding(P5_ENCODING, r.spec.game.rules);
  const declared = r.nodes.filter(n => n.kind === 'hypothesis').flatMap(n => n.parents.filter(p => p.relation === 'alternative-to').map(p => [n.id, p.id] as [string, string]));
  const dc = discriminateCore(r.cands, r.parts, enc.usable, declared);
  cmp('discrimination re-derived: candidates equal discrimination-3.json', dc.candidates, D.candidates);
  cmp('discrimination re-derived: pairs equal discrimination-3.json', dc.pairs, D.pairs);
  const hyps = r.nodes.filter(n => r.freeze.hypotheses.some((h: any) => h.id === n.id)).map(n => ({ id: n.id, kind: n.kind,
    representations: r.nodes.filter(x => x.kind === 'representation' && x.parents.some(p => p.id === n.id && p.relation === 'represents')).map(x => ({ id: x.id, author: x.author, representation: (x.body as any).representation, fidelity: (x.body as any).fidelity })) }));
  const tw = threeWay(hyps as any, r.twParts as any, enc);
  cmp('three-way re-derived: hypotheses equal three-way-1.json', tw.hypotheses, T.hypotheses);
  cmp('three-way re-derived: implementation correctness (O↔S) equals three-way-1.json', tw.implementationCorrectness, T.implementationCorrectness);
  const A = analyse(r);
  // independent re-count against the committed evaluator counts
  for (const a of A) {
    const h = H.hypotheses.find((x: any) => x.ref === a.hypothesis && x.representations?.some((y: any) => y.representation === a.representation));
    const rep = h.representations.find((y: any) => y.representation === a.representation);
    for (const b of a.byBuild) {
      const c = rep.byBuild.find((x: any) => x.build === b.build);
      ok(`${a.hypothesis} ${b.build}: own re-count equals the evaluator (discovery contradicted ${b.discovery.contradicted}, held-out ${b.heldout.matching}/${b.heldout.contradicted})`,
        b.discovery.contradicted === c.discoveryFit.support.counterExample && b.discovery.applicable === c.discoveryFit.evaluated && b.heldout.matching === c.heldout.outcomeChecks.matching && b.heldout.contradicted === c.heldout.outcomeChecks.contradicting);
    }
  }
  // where the spec deviations of the held-out comparison were also visible in discovery, and who opened those pages
  const sessions = [...new Set(A.map(a => a.session)), ...r.freeze.hypotheses.map((h: any) => h.session)].filter((x, i, a) => a.indexOf(x) === i).sort();
  const openedBy = (unitId: string) => sessions.filter(se => readFileSync(join(EXP, 'sessions', se, 'access.ndjson'), 'utf8').split('\n').filter(Boolean).some(l => { const e = JSON.parse(l); return e.type === 'request' && e.kind === 'evidence' && e.status === 200 && e.evidenceId === unitId; }));
  const deviating = (T.implementationCorrectness as any[]).filter(x => x.value === 'deviates');
  const specDeviations = [...new Set(deviating.map(x => x.rule))].sort().map(rule => {
    const clauses = enc.usable.find(u => u.rule === rule)!.clauses as any[];
    return { rule, byPartition: deviating.filter(x => x.rule === rule).map(x => {
      const label = Object.keys(r.parts[x.scope.partition as 'discovery' | 'heldout']).find(l => r.twParts.find(t => t.partition === x.scope.partition)!.situations.some(s => s.build === x.scope.build && r.parts[x.scope.partition as 'discovery' | 'heldout'][l].includes(s)))!;
      const sits = r.parts[x.scope.partition as 'discovery' | 'heldout'][label];
      const units = new Set<string>();
      for (const c of clauses) if (c.form === 'law') lawCounts(c, sits).contradicted.forEach(s => units.add(s.id.split('/')[0]));
      if (clauses.some(c => c.form !== 'law')) for (const w of x.witnesses ?? []) units.add(String(w).split('/')[0]);
      const list = [...units].sort();
      return { partition: x.scope.partition, build: label, contradictingOutcomeChecks: x.scope.outcomeChecks?.contradicting ?? null, units: list.length,
        unitsSource: clauses.some(c => c.form !== 'law') ? 'invariance clause: units from the committed three-way witnesses' : 'law clauses: units re-counted here',
        ...(x.scope.partition === 'discovery' ? { openedBySessions: Object.fromEntries(list.map(u => [u, openedBy(u)]).filter(([, v]) => (v as string[]).length)) } : {}) };
    }) };
  });
  const totals = { matching: A.flatMap(a => a.byBuild).reduce((s, b) => s + b.heldout.matching, 0), contradicting: A.flatMap(a => a.byBuild).reduce((s, b) => s + b.heldout.contradicted, 0) };
  ok('held-out totals 194 matching / 190 contradicting', totals.matching === 194 && totals.contradicting === 190);
  return { schema: 'gamewatch/gw2-p8-reproduction@1', source: { published: PUB, note: 'published redacted copy only; originals not needed; evaluation gate not opened; nothing written under the published evidence' },
    ok: checks.every(c => c.ok), checks, heldoutTotals: totals, counterexamples: A, specDeviations,
    definitions: {
      contradictedInEvidenceOpenedBySession: 'discovery counterexamples inside a case or match page that the submitting session opened (access journal, HTTP 200)',
      contradictedInAccessibleEvidenceNotOpened: 'discovery counterexamples in pages that were served to every session but this session did not open',
      alreadyExemplifiedInDiscovery: 'held-out counterexample whose behavioural input values all occur in applicable discovery situations, where discovery already had counterexamples to the same clause',
      absentFromDiscovery: `held-out counterexample with at least one behavioural input value (fields other than ${[...NOT_COMPARED].join(', ')}) that never occurs among the discovery situations to which the clause applies, same build`,
      notCounterexampleInDiscoveryButValuesSeen: 'held-out counterexample whose input values each occurred in discovery, while the clause had no discovery counterexample',
    } };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('gw2/p8-reproduce.ts')) {
  const i = process.argv.indexOf('--out'), out = run(), text = JSON.stringify(out, null, 1) + '\n';
  if (i > 0) { const f = process.argv[i + 1]; mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text); }
  for (const c of out.checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.check}${c.detail ? ` (${c.detail})` : ''}`);
  console.log(out.ok ? `reproduction: OK (${out.checks.length} checks)` : 'reproduction: FAILED');
  process.exitCode = out.ok ? 0 : 1;
}
