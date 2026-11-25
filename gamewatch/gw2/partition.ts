/**
 * GW2 P3: partition an evidence bundle into discovery / spec / heldout / eval, each with its own manifest.
 *
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/partition.ts <procedure.json> <bundle.json> <expDir> [--fixture]
 *
 * The bundle is the unchanged output of gamewatch/run-evidence.ts (`gamewatch/evidence@1`); it is read, never changed.
 * The split is a deterministic function of a FROZEN procedure file (Q5): disjoint match seeds and disjoint case-script
 * variants, a provisional discovery share target, and a fixed selection order that puts observable rule coverage in
 * both partitions before the exact proportion. It never looks at agent output. A procedure frozen after the bundle was
 * generated is refused, unless the run is explicitly a fixture (`--fixture`), which every output then says.
 *
 * Outputs under <expDir>/partitions/:
 *   discovery/observations.json   blind observations (no rules, neutral per-partition ids, no script titles, no build
 *                                 labels or notes, no seeds, no generator metadata)
 *   discovery/site/               the blind discovery site (gamewatch/gw2/blind-site.ts): the declared input boundary
 *   spec/spec.json                the documented rules (intended behaviour)
 *   heldout/observations.json     held-out observations, blind, with their own neutral ids
 *   eval/eval.json                id maps (neutral -> original), coverage per partition, ground-truth references by hash
 *   <p>/MANIFEST.json             LF-normalised SHA-256 of every file of that partition
 *   PARTITION.json                procedure and bundle references, the chosen assignment, coverage, manifest hashes
 *   INPUT_BOUNDARY.json           the directory the agent is served, and its exact file list
 * Held-out and eval files are only to be read through gamewatch/gw2/freeze.ts (after a valid hypothesis freeze).
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, assertWritableOutput, repoRelative } from './paths.ts';
import { fileSha256 } from './judgments.ts';
import type { GWBundle, GWCase, GWMatch, GWEvent, GWStep, GWTurnRow } from '../evidence.ts';

export const PROCEDURE_SCHEMA = 'gamewatch/gw2-partition-procedure@1';
export const MANIFEST_SCHEMA = 'gamewatch/gw2-partition-manifest@1';
export const BLIND_SCHEMA = 'gamewatch/gw2-blind-observations@1';
export const PARTITIONS = ['discovery', 'spec', 'heldout', 'eval'] as const;
export type Partition = typeof PARTITIONS[number];

export type Procedure = {
  schema: typeof PROCEDURE_SCHEMA; id: string; frozenAt: string; salt: string; discoveryTarget: number;
  seeds: number[]; scripts: { id: string; title: string }[]; variantSuffixes: string[];
  coverageMap: { path: string; sha256: string }; groundTruth: { path: string; sha256: string }[];
  selection: string[]; notes?: string[];
};
export type BlindCase = { caseId: string; kind: 'scripted'; build: string; script: string; firstMover: string; steps: GWStep[] };
export type BlindMatch = { matchId: string; build: string; policy: Record<string, string>; firstMover: string; winner: string; reason: string; turns: number; scored: Record<string, number>; rows: GWTurnRow[] };
export type BlindObservations = { schema: typeof BLIND_SCHEMA; partition: 'discovery' | 'heldout'; builds: string[]; cases: BlindCase[]; matches: BlindMatch[] };

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

export class PartitionError extends Error {}

/** Validate a procedure file. Throws PartitionError listing every problem. */
export function loadProcedure(file: string, root = ROOT): Procedure {
  const p = JSON.parse(readFileSync(file, 'utf8')), bad: string[] = [];
  if (!isObj(p)) throw new PartitionError('procedure is not an object');
  if (p.schema !== PROCEDURE_SCHEMA) bad.push(`schema must be ${PROCEDURE_SCHEMA}`);
  if (typeof p.id !== 'string' || !/^[a-z0-9][a-z0-9.-]*$/.test(p.id)) bad.push('id must be a lowercase slug');
  if (typeof p.frozenAt !== 'string' || Number.isNaN(Date.parse(p.frozenAt))) bad.push('frozenAt must be an ISO time');
  if (typeof p.salt !== 'string' || p.salt.length < 8) bad.push('salt must be a string of at least 8 characters');
  if (typeof p.discoveryTarget !== 'number' || !(p.discoveryTarget > 0 && p.discoveryTarget < 1)) bad.push('discoveryTarget must be in (0, 1)');
  if (!Array.isArray(p.seeds) || p.seeds.length < 2 || !p.seeds.every(Number.isInteger) || new Set(p.seeds).size !== p.seeds.length) bad.push('seeds must be at least 2 distinct integers');
  if (!Array.isArray(p.scripts) || !p.scripts.every(s => isObj(s) && typeof s.id === 'string' && typeof s.title === 'string')) bad.push('scripts must list {id, title}');
  if (!Array.isArray(p.variantSuffixes) || !p.variantSuffixes.every(x => typeof x === 'string' && x.startsWith('-'))) bad.push('variantSuffixes must be strings starting with "-"');
  for (const r of [p.coverageMap, ...(Array.isArray(p.groundTruth) ? p.groundTruth : [null])]) {
    if (!isObj(r) || typeof r.path !== 'string' || typeof r.sha256 !== 'string') { bad.push('coverageMap and groundTruth entries must be {path, sha256}'); continue; }
    const abs = join(root, r.path);
    if (!existsSync(abs)) bad.push(`${r.path} not found`); else if (fileSha256(abs) !== r.sha256) bad.push(`${r.path} does not match its frozen sha256`);
  }
  if (!Array.isArray(p.selection) || !p.selection.length) bad.push('selection order must be stated');
  if (bad.length) throw new PartitionError(`invalid partition procedure ${file}:\n  ${bad.join('\n  ')}`);
  return p as Procedure;
}

/** Family of a script id: the id without a variant suffix (shield-human -> shield). Scripts without one are their own family. */
export const family = (id: string, suffixes: string[]) => { const s = suffixes.find(x => id.endsWith(x)); return s ? id.slice(0, -s.length) : id; };

type Pat = Record<string, unknown>;
const matchEv = (e: GWEvent, p: Pat) => Object.entries(p).every(([k, v]) => k === 'minChainDepth' ? Number(e.chainDepth ?? 0) >= Number(v) : k === 'refused' ? false : e[k] === v);

/**
 * Observable rule coverage, with the semantics of gamewatch/skillbook/steps/gaps.ts: a rule is covered in a set of
 * observations when EVERY event pattern of the rule occurs at least once on EVERY build.
 */
export function coverageOf(units: { build: string; events: GWEvent[]; refusedPlacements: number }[], cov: Record<string, Pat[]>, builds: string[]) {
  const covered: string[] = [], missing: Record<string, string[]> = {};
  for (const [rule, pats] of Object.entries(cov)) {
    const gaps: string[] = [];
    for (const b of builds) pats.forEach(p => {
      const us = units.filter(u => u.build === b);
      const hit = p.refused ? us.some(u => u.refusedPlacements > 0) : us.some(u => u.events.some(e => matchEv(e, p)));
      if (!hit) gaps.push(`${b} ${JSON.stringify(p)}`);
    });
    if (gaps.length) missing[rule] = gaps; else covered.push(rule);
  }
  return { covered, missing };
}
const caseUnit = (c: GWCase) => ({ build: c.build, events: c.steps.flatMap(s => s.events), refusedPlacements: c.steps.filter(s => s.outcome === 'refused' && /^place/.test(s.action)).length });
const matchUnit = (m: GWMatch) => ({ build: m.build, events: m.rows.flatMap(r => r.events), refusedPlacements: 0 });

/**
 * Deterministic split. Candidates: every orientation of every variant family (one variant -> discovery, the other ->
 * heldout), every assignment of single-variant scripts, every non-empty proper subset of seeds for discovery. Scored, in
 * the procedure's frozen order: (1) rules covered in BOTH partitions, (2) the smaller of the two coverage counts,
 * (3) closeness of the discovery share of observations to the target, (4) enumeration order (fixed by the salt).
 */
export function split(bundle: GWBundle, proc: Procedure, cov: Record<string, Pat[]>) {
  const titleToId = new Map(proc.scripts.map(s => [s.title, s.id]));
  const scriptOf = (c: GWCase) => { const id = titleToId.get(c.title); if (!id) throw new PartitionError(`case ${c.caseId}: script title not in the frozen procedure`); return id; };
  const bundleSeeds = [...new Set(bundle.matches.map(m => m.seed))].sort((a, b) => a - b);
  if (bundleSeeds.join() !== [...proc.seeds].sort((a, b) => a - b).join()) throw new PartitionError(`bundle match seeds ${bundleSeeds.join(',')} differ from the frozen seeds ${proc.seeds.join(',')}`);
  const builds = bundle.builds.map(b => b.label);
  const scriptIds = [...new Set(bundle.cases.map(scriptOf))].sort();
  const fams = new Map<string, string[]>();
  for (const id of scriptIds) { const f = family(id, proc.variantSuffixes); fams.set(f, [...(fams.get(f) ?? []), id].sort()); }
  const order = (xs: string[]) => [...xs].sort((a, b) => sha(`${proc.salt}:${a}`).localeCompare(sha(`${proc.salt}:${b}`)));
  const pairs = order([...fams.keys()].filter(f => fams.get(f)!.length === 2)), singles = order([...fams.keys()].filter(f => fams.get(f)!.length === 1));
  const multi = [...fams.entries()].filter(([, v]) => v.length > 2);
  if (multi.length) throw new PartitionError(`families with more than two variants are not supported by procedure @1: ${multi.map(([k]) => k).join(', ')}`);
  const seeds = [...proc.seeds].sort((a, b) => sha(`${proc.salt}:seed:${a}`).localeCompare(sha(`${proc.salt}:seed:${b}`)));
  const unitsByScript = new Map(scriptIds.map(id => [id, bundle.cases.filter(c => scriptOf(c) === id).map(caseUnit)]));
  const unitsBySeed = new Map(seeds.map(s => [s, bundle.matches.filter(m => m.seed === s).map(matchUnit)]));
  const nCases = (ids: string[]) => ids.reduce((a, id) => a + unitsByScript.get(id)!.length, 0), nMatches = (ss: number[]) => ss.reduce((a, s) => a + unitsBySeed.get(s)!.length, 0);
  const total = bundle.cases.length + bundle.matches.length;
  let best: { key: number[]; disc: { scripts: string[]; seeds: number[] }; held: { scripts: string[]; seeds: number[] }; share: number } | null = null;
  const better = (a: number[], b: number[]) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };
  // Fast path: one bit per (rule, pattern, build); a unit's mask has the bits it exercises; a rule is covered when all
  // of its bits are set in the OR of the partition's masks. Same result as coverageOf (checked for the chosen split).
  const bits: { rule: string; test: (u: ReturnType<typeof caseUnit>) => boolean; build: string }[] = [];
  for (const [rule, pats] of Object.entries(cov)) for (const b of builds) for (const p of pats)
    bits.push({ rule, build: b, test: u => u.build === b && (p.refused ? u.refusedPlacements > 0 : u.events.some(e => matchEv(e, p))) });
  const maskOf = (us: ReturnType<typeof caseUnit>[]) => us.reduce((m, u) => bits.reduce((mm, bt, i) => bt.test(u) ? mm | (1n << BigInt(i)) : mm, m), 0n);
  const sMask = new Map(scriptIds.map(id => [id, maskOf(unitsByScript.get(id)!)])), dMask = new Map(seeds.map(x => [x, maskOf(unitsBySeed.get(x)!)]));
  const ruleMasks = Object.keys(cov).map(r => bits.reduce((m, bt, i) => bt.rule === r ? m | (1n << BigInt(i)) : m, 0n));
  const count = (m: bigint) => ruleMasks.filter(rm => (m & rm) === rm).length;
  const both = (a: bigint, b: bigint) => ruleMasks.filter(rm => (a & rm) === rm && (b & rm) === rm).length;
  let idx = 0;
  for (let po = 0; po < 1 << pairs.length; po++) for (let so = 0; so < 1 << singles.length; so++) for (let sm = 1; sm < (1 << seeds.length) - 1; sm++) {
    const dS: string[] = [], hS: string[] = [];
    pairs.forEach((f, i) => { const [a, b] = fams.get(f)!; if (po >> i & 1) { dS.push(b); hS.push(a); } else { dS.push(a); hS.push(b); } });
    singles.forEach((f, i) => (so >> i & 1 ? hS : dS).push(fams.get(f)![0]));
    const dSeeds = seeds.filter((_, i) => sm >> i & 1), hSeeds = seeds.filter((_, i) => !(sm >> i & 1));
    dS.sort(); hS.sort(); dSeeds.sort((a, b) => a - b); hSeeds.sort((a, b) => a - b);
    const mD = [...dS.map(x => sMask.get(x)!), ...dSeeds.map(x => dMask.get(x)!)].reduce((a, b) => a | b, 0n);
    const mH = [...hS.map(x => sMask.get(x)!), ...hSeeds.map(x => dMask.get(x)!)].reduce((a, b) => a | b, 0n);
    const share = (nCases(dS) + nMatches(dSeeds)) / total;
    const key = [both(mD, mH), Math.min(count(mD), count(mH)), -Math.abs(share - proc.discoveryTarget), -idx++];
    if (!best || better(key, best.key)) best = { key, disc: { scripts: dS, seeds: dSeeds }, held: { scripts: hS, seeds: hSeeds }, share };
  }
  if (!best) throw new PartitionError('no candidate split');
  const units = (sel: { scripts: string[]; seeds: number[] }) => [...sel.scripts.flatMap(id => unitsByScript.get(id)!), ...sel.seeds.flatMap(x => unitsBySeed.get(x)!)];
  const covD = coverageOf(units(best.disc), cov, builds), covH = coverageOf(units(best.held), cov, builds);
  if (covD.covered.length !== count([...best.disc.scripts.map(x => sMask.get(x)!), ...best.disc.seeds.map(x => dMask.get(x)!)].reduce((a, b) => a | b, 0n))) throw new PartitionError('internal: coverage fast path disagrees');
  const all = coverageOf([...bundle.cases.map(caseUnit), ...bundle.matches.map(matchUnit)], cov, builds);
  const rules = Object.keys(cov);
  return {
    discovery: best.disc, heldout: best.held, scriptOf, builds,
    share: { discovery: best.share, target: proc.discoveryTarget, discoveryObservations: Math.round(best.share * total), heldoutObservations: total - Math.round(best.share * total) },
    coverage: {
      semantics: 'a rule is covered when every event pattern of gamewatch/adapters/rule-sabotage.coverage.json for it occurs at least once on every build (gaps.ts semantics)',
      wholeBundle: all.covered, discovery: covD.covered, heldout: covH.covered,
      notCoveredInDiscovery: rules.filter(r => !covD.covered.includes(r)), notCoveredInHeldout: rules.filter(r => !covH.covered.includes(r)),
      notCoveredAnywhere: rules.filter(r => !all.covered.includes(r)), missing: { discovery: covD.missing, heldout: covH.missing },
    },
    candidates: idx,
  };
}

/** Neutral id for one partition. Different partitions (and different salts) give different ids for the same original. */
export const neutral = (salt: string, p: string, kind: 'C' | 'M' | 'S' | 'B', orig: string) => {
  const h = sha(`gw2-blind:${salt}:${p}:${kind}:${orig}`);
  return kind === 'B' ? `build-${h.slice(0, 4)}` : `${kind}-${h.slice(0, kind === 'S' ? 4 : 6)}`;
};

/** Blind transform: keeps what the engine reported (states, events, engine/referee messages); drops everything else. */
export function blind(bundle: GWBundle, p: 'discovery' | 'heldout', sel: { scripts: string[]; seeds: number[] }, salt: string, scriptOf: (c: GWCase) => string) {
  const map = { cases: {} as Record<string, string>, matches: {} as Record<string, string>, builds: {} as Record<string, string>, scripts: {} as Record<string, string> };
  for (const b of bundle.builds) map.builds[neutral(salt, p, 'B', b.label)] = b.label;
  const nb = (label: string) => neutral(salt, p, 'B', label);
  const cases: BlindCase[] = bundle.cases.filter(c => sel.scripts.includes(scriptOf(c))).map(c => {
    const id = neutral(salt, p, 'C', c.caseId), s = neutral(salt, p, 'S', scriptOf(c));
    map.cases[id] = c.caseId; map.scripts[s] = scriptOf(c);
    return { caseId: id, kind: 'scripted', build: nb(c.build), script: s, firstMover: c.firstMover, steps: c.steps };
  }).sort((a, b) => a.caseId.localeCompare(b.caseId));
  const matches: BlindMatch[] = bundle.matches.filter(m => sel.seeds.includes(m.seed)).map(m => {
    const id = neutral(salt, p, 'M', m.matchId); map.matches[id] = m.matchId;
    return { matchId: id, build: nb(m.build), policy: m.policy, firstMover: m.firstMover, winner: m.winner, reason: m.reason, turns: m.turns, scored: m.scored, rows: m.rows };
  }).sort((a, b) => a.matchId.localeCompare(b.matchId));
  const obs: BlindObservations = { schema: BLIND_SCHEMA, partition: p, builds: Object.keys(map.builds).sort(), cases, matches };
  return { obs, map };
}

const json = (x: unknown) => JSON.stringify(x, null, 1) + '\n';
function walk(dir: string): string[] {
  return readdirSync(dir).sort().flatMap(n => { const f = join(dir, n); return statSync(f).isDirectory() ? walk(f) : [f]; });
}
/** Write <dir>/MANIFEST.json listing every other file in <dir> with its LF-normalised SHA-256. */
export function writeManifest(dir: string, partition: Partition, extra: Record<string, unknown>) {
  const files = Object.fromEntries(walk(dir).filter(f => relative(dir, f) !== 'MANIFEST.json').map(f => [relative(dir, f).split('\\').join('/'), fileSha256(f)]));
  writeFileSync(join(dir, 'MANIFEST.json'), json({ schema: MANIFEST_SCHEMA, partition, ...extra, files }));
  return fileSha256(join(dir, 'MANIFEST.json'));
}
/** Check a partition directory against its manifest: same file set, same hashes. */
export function verifyManifest(dir: string): string[] {
  const m = JSON.parse(readFileSync(join(dir, 'MANIFEST.json'), 'utf8')), bad: string[] = [];
  if (m.schema !== MANIFEST_SCHEMA) bad.push(`${dir}: not a partition manifest`);
  const onDisk = walk(dir).map(f => relative(dir, f).split('\\').join('/')).filter(f => f !== 'MANIFEST.json');
  for (const f of onDisk) if (!(f in m.files)) bad.push(`${m.partition}: file not in manifest: ${f}`);
  for (const [f, h] of Object.entries(m.files as Record<string, string>)) {
    if (!existsSync(join(dir, f))) bad.push(`${m.partition}: missing ${f}`); else if (fileSha256(join(dir, f)) !== h) bad.push(`${m.partition}: changed ${f}`);
  }
  return bad;
}

export async function partition(procFile: string, bundleFile: string, expDir: string, opts: { fixture?: boolean; root?: string } = {}) {
  const root = opts.root ?? ROOT, proc = loadProcedure(procFile, root);
  const bundle = JSON.parse(readFileSync(bundleFile, 'utf8')) as GWBundle;
  if (bundle.schema !== 'gamewatch/evidence@1') throw new PartitionError('bundle is not gamewatch/evidence@1');
  const generatedBeforeFreeze = Date.parse(bundle.generatedAt) < Date.parse(proc.frozenAt);
  if (generatedBeforeFreeze && !opts.fixture) throw new PartitionError(`the bundle was generated (${bundle.generatedAt}) before the procedure was frozen (${proc.frozenAt}); experimental observations must be generated after the freeze. Use --fixture only for a labelled non-experimental fixture.`);
  const fixture = opts.fixture ? 'FIXTURE: a historical bundle used as a deterministic fixture. It was generated before this procedure was frozen, so this is NOT an experimental partition.' : null;
  const out = assertWritableOutput(join(expDir, 'partitions'));
  if (existsSync(out)) throw new PartitionError(`refusing to overwrite existing partitions: ${out}`);
  const cov = JSON.parse(readFileSync(join(root, proc.coverageMap.path), 'utf8')).rules as Record<string, Pat[]>;
  const s = split(bundle, proc, cov);
  const D = blind(bundle, 'discovery', s.discovery, proc.salt, s.scriptOf), H = blind(bundle, 'heldout', s.heldout, proc.salt, s.scriptOf);
  // ids must be unique across partitions and never equal an original id
  const orig = new Set([...bundle.cases.map(c => c.caseId), ...bundle.matches.map(m => m.matchId)]);
  const ids = [...Object.keys(D.map.cases), ...Object.keys(D.map.matches), ...Object.keys(H.map.cases), ...Object.keys(H.map.matches)];
  if (new Set(ids).size !== ids.length || ids.some(i => orig.has(i))) throw new PartitionError('neutral id collision; change the salt in a new procedure');
  const dir = (p: Partition) => { const d = join(out, p); mkdirSync(d, { recursive: true }); return d; };
  const ref = (f: string) => ({ path: repoRelative(f) ?? f, sha256: fileSha256(f) });
  const common = { procedure: { id: proc.id, ...ref(procFile) }, bundle: ref(bundleFile), ...(fixture ? { fixture } : {}) };
  const dd = dir('discovery');
  writeFileSync(join(dd, 'observations.json'), json(D.obs));
  const { buildBlindSite } = await import('./blind-site.ts');
  buildBlindSite(D.obs, join(dd, 'site'));
  writeFileSync(join(dir('spec'), 'spec.json'), json({ schema: 'gamewatch/gw2-spec@1', game: bundle.game, source: bundle.source, builds: bundle.builds }));
  writeFileSync(join(dir('heldout'), 'observations.json'), json(H.obs));
  writeFileSync(join(dir('eval'), 'eval.json'), json({
    schema: 'gamewatch/gw2-eval@1',
    idMaps: { discovery: D.map, heldout: H.map },
    assignment: { discovery: s.discovery, heldout: s.heldout },
    coverage: s.coverage,
    groundTruth: proc.groundTruth.map(g => ({ ...g, note: 'referenced by hash, not copied; Q9: P7 ground truth is kept outside the repository' })),
  }));
  const manifests: Record<string, string> = {};
  for (const p of PARTITIONS) manifests[p] = writeManifest(join(out, p), p, common);
  const site = join(dd, 'site');
  writeFileSync(join(out, 'INPUT_BOUNDARY.json'), json({
    schema: 'gamewatch/gw2-input-boundary@1', served: 'discovery/site',
    files: Object.fromEntries(walk(site).map(f => [relative(site, f).split('\\').join('/'), fileSha256(f)])),
    isolation: 'Logical separation on one machine: the review server is started with --site <expDir>/partitions/discovery/site and serves only files under it (GW1 path containment). spec/, heldout/ and eval/ are on the same disk and are not OS-isolated; an agent with shell or file access could read them. No OS sandbox, container or separate account is used.',
  }));
  writeFileSync(join(out, 'PARTITION.json'), json({
    schema: 'gamewatch/gw2-partition@1', ...common, generatedBeforeFreeze,
    assignment: { discovery: s.discovery, heldout: s.heldout }, share: s.share, candidatesConsidered: s.candidates,
    coverage: { semantics: s.coverage.semantics, discovery: s.coverage.discovery, heldout: s.coverage.heldout, notCoveredInDiscovery: s.coverage.notCoveredInDiscovery, notCoveredInHeldout: s.coverage.notCoveredInHeldout, notCoveredAnywhere: s.coverage.notCoveredAnywhere },
    counts: { discovery: { cases: D.obs.cases.length, matches: D.obs.matches.length }, heldout: { cases: H.obs.cases.length, matches: H.obs.matches.length } },
    manifests, note: 'Assignment and coverage name original script ids and seeds; this file is outside the input boundary. The split depends only on the frozen procedure and engine-reported events, never on agent output.',
  }));
  return { out, split: s, manifests };
}

/** Verify every partition manifest and the input boundary listing. Returns problems (empty = OK). */
export function verifyPartitions(expDir: string): string[] {
  const out = join(expDir, 'partitions'), bad: string[] = [];
  for (const p of PARTITIONS) bad.push(...verifyManifest(join(out, p)));
  const P = JSON.parse(readFileSync(join(out, 'PARTITION.json'), 'utf8'));
  for (const p of PARTITIONS) if (fileSha256(join(out, p, 'MANIFEST.json')) !== P.manifests[p]) bad.push(`${p}: MANIFEST.json differs from PARTITION.json`);
  return bad;
}

if (process.argv[1]?.endsWith('gw2/partition.ts')) {
  const [proc, bundle, exp] = process.argv.slice(2).filter(a => !a.startsWith('--'));
  if (!exp) { console.error('usage: partition.ts <procedure.json> <bundle.json> <expDir> [--fixture]'); process.exit(2); }
  try {
    const r = await partition(proc, bundle, exp, { fixture: process.argv.includes('--fixture') });
    const c = r.split.coverage;
    console.log(`partitions written to ${r.out}\n  discovery: scripts ${r.split.discovery.scripts.join(', ')}; seeds ${r.split.discovery.seeds.join(', ')}\n  heldout:   scripts ${r.split.heldout.scripts.join(', ')}; seeds ${r.split.heldout.seeds.join(', ')}\n  discovery share ${r.split.share.discovery.toFixed(3)} (target ${r.split.share.target})\n  rules not covered in discovery: ${c.notCoveredInDiscovery.join(', ') || 'none'}; in heldout: ${c.notCoveredInHeldout.join(', ') || 'none'}`);
  } catch (e) { console.error((e as Error).message); process.exit(5); }
}
