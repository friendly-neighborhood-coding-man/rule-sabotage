/**
 * GW2 P3 blind leak check (AC-P3.1, AC-P3.2) over the ACTUAL declared input directory of an experiment.
 *
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/leak-check.ts <expDir> [out.json]
 *
 * Reads <expDir>/partitions/ (INPUT_BOUNDARY.json, the four partitions, PARTITION.json) and the ground-truth files
 * referenced by the eval partition. Scans every file of the served directory: file names, raw HTML source (titles,
 * meta, attributes, navigation, forms) and the visible text. Exit 0 = no leak; 1 = leaks (listed).
 *
 * Forbidden in the input boundary:
 *   rule ids R1–R15; any 8-word run from a documented rule text; original script titles and script ids; build labels
 *   and build notes; mutation ids (in non-square contexts), mutation classes and 8-word runs of mutation descriptions;
 *   case, match, script and build ids of any other partition and the original ids; seeds; generator metadata (commit,
 *   generation time, source paths, evidence source text); the game's name and version string;
 *   script tags, embedded JSON, data- attributes, HTML comments, meta tags other than charset;
 *   links that leave the directory or point at a missing file; form actions other than /report and /hypothesis;
 *   files not listed in the input boundary or the discovery manifest; files byte-identical to a spec/heldout/eval file.
 *
 * Not a leak, but reported as residual semantic clues (Q10): effect names and engine/referee messages that are
 * genuinely observable in normal gameplay, with the longest word run they share with any rule text. Blind discovery
 * does not exclude prior knowledge or semantic hints carried by these names.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT, assertWritableOutput } from './paths.ts';
import { fileSha256 } from './judgments.ts';

const words = (s: string) => s.toLowerCase().replace(/[’']/g, '').match(/[a-z0-9]+/g) ?? [];
const runs = (s: string, n: number) => { const w = words(s), out: string[] = []; for (let i = 0; i + n <= w.length; i++) out.push(w.slice(i, i + n).join(' ')); return out; };
const text = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
function walk(dir: string): string[] { return readdirSync(dir).sort().flatMap(n => { const f = join(dir, n); return statSync(f).isDirectory() ? walk(f) : [f]; }); }
/** Longest run of consecutive words shared by a and b. */
export function longestSharedRun(a: string, b: string): string {
  const A = words(a), B = words(b); let best = '';
  for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) { let k = 0; while (A[i + k] !== undefined && A[i + k] === B[j + k]) k++; if (k > words(best).length) best = A.slice(i, i + k).join(' '); }
  return best;
}

export type Check = { check: string; result: 'pass' | 'fail'; hits: string[] };
export function leakCheck(expDir: string, root = ROOT) {
  const P = join(expDir, 'partitions');
  const boundary = JSON.parse(readFileSync(join(P, 'INPUT_BOUNDARY.json'), 'utf8')), site = join(P, boundary.served);
  const spec = JSON.parse(readFileSync(join(P, 'spec/spec.json'), 'utf8')), ev = JSON.parse(readFileSync(join(P, 'eval/eval.json'), 'utf8'));
  const partition = JSON.parse(readFileSync(join(P, 'PARTITION.json'), 'utf8'));
  const proc = JSON.parse(readFileSync(join(root, partition.procedure.path), 'utf8'));
  const bundle = JSON.parse(readFileSync(join(root, partition.bundle.path), 'utf8'));
  const discMan = JSON.parse(readFileSync(join(P, 'discovery/MANIFEST.json'), 'utf8'));
  const gt = (ev.groundTruth as { path: string }[]).map(g => JSON.parse(readFileSync(join(root, g.path), 'utf8')));
  const mutations: { id: string; class: string; [k: string]: unknown }[] = gt.find(g => Array.isArray(g.mutations))?.mutations ?? [];
  const files = walk(site), rel = (f: string) => relative(site, f).split('\\').join('/');
  const pages = files.map(f => ({ name: rel(f), raw: readFileSync(f, 'utf8') })).map(p => ({ ...p, vis: text(p.raw), all: p.name + '\n' + p.raw + '\n' + text(p.raw) }));
  const checks: Check[] = [];
  const add = (check: string, hits: string[]) => checks.push({ check, result: hits.length ? 'fail' : 'pass', hits: [...new Set(hits)].slice(0, 50) });
  const token = (needle: string) => new RegExp(`(^|[^A-Za-z0-9_-])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9_-])`, 'i');
  const scanTokens = (label: string, needles: string[]) => add(label, pages.flatMap(p => needles.filter(n => token(n).test(p.all)).map(n => `${p.name}: ${n}`)));
  const scanPhrases = (label: string, phrases: string[]) => add(label, pages.flatMap(p => { const t = p.all.toLowerCase(); return phrases.filter(x => x && t.includes(x.toLowerCase())).map(x => `${p.name}: "${x}"`); }));

  // spec leakage
  add('rule ids R1–R15', pages.flatMap(p => [...p.all.matchAll(/(^|[^A-Za-z0-9_-])(R(?:1[0-5]|[1-9]))($|[^A-Za-z0-9_-])/g)].map(m => `${p.name}: ${m[2]}`)));
  const ruleRuns = new Set((spec.game.rules as { text: string }[]).flatMap(r => runs(r.text, 8)));
  add('8-word runs from rule texts', pages.flatMap(p => runs(p.vis + ' ' + p.name, 8).filter(r => ruleRuns.has(r)).map(r => `${p.name}: "${r}"`)));
  scanPhrases('original script titles', (proc.scripts as { title: string }[]).map(s => s.title));
  scanTokens('script ids', (proc.scripts as { id: string }[]).map(s => s.id));
  scanTokens('build labels', (spec.builds as { label: string }[]).map(b => b.label));
  scanPhrases('build notes', (spec.builds as { note: string }[]).map(b => b.note));
  // ground truth
  const squareLike = (id: string) => /^[A-M][1-9]$/.test(id);
  scanTokens('mutation ids (not shaped like a board square)', mutations.map(m => m.id).filter(id => !squareLike(id)));
  add('mutation ids shaped like a board square, in a mutation context', pages.flatMap(p => mutations.map(m => m.id).filter(squareLike).filter(id => new RegExp(`(mutation|defect|bug|B-?id)\\W{0,3}${id}\\b`, 'i').test(p.vis)).map(id => `${p.name}: ${id}`)));
  scanPhrases('mutation classes', mutations.map(m => m.class));
  const mutRuns = new Set(mutations.flatMap(m => Object.values(m).filter(v => typeof v === 'string' && (v as string).split(' ').length > 8).flatMap(v => runs(v as string, 8))));
  add('8-word runs from mutation descriptions', pages.flatMap(p => runs(p.vis, 8).filter(r => mutRuns.has(r)).map(r => `${p.name}: "${r}"`)));
  // other partitions and originals
  const maps = ev.idMaps as Record<string, Record<string, Record<string, string>>>;
  const ownIds = new Set(Object.values(maps.discovery).flatMap(m => Object.keys(m)));
  const foreign = [...Object.values(maps.heldout).flatMap(m => Object.keys(m)), ...Object.values(maps.discovery).flatMap(m => Object.values(m)), ...Object.values(maps.heldout).flatMap(m => Object.values(m)), ...bundle.cases.map((c: { caseId: string }) => c.caseId), ...bundle.matches.map((m: { matchId: string }) => m.matchId)].filter(x => !ownIds.has(x));
  scanTokens('ids of another partition or original ids', [...new Set(foreign)]);
  // metadata
  scanTokens('seeds', [...new Set([...proc.seeds, ...bundle.cases.map((c: { seed: number }) => c.seed), ...bundle.matches.map((m: { seed: number }) => m.seed)].map(String))]);
  scanPhrases('generator metadata and source text', [bundle.generatedAt, bundle.generator?.commit, bundle.generator?.command, 'evidence/gamewatch', 'gamewatch/private', 'evidence.json', ...bundle.source].filter(Boolean));
  scanPhrases('game name and version', [bundle.game.name, bundle.game.version]);
  // structure: embedded content, metadata, navigation, forms
  add('script tags, embedded JSON, data- attributes, comments', pages.flatMap(p => [/<script/i, /application\/(ld\+)?json/i, /\sdata-[a-z]/i, /<!--/].filter(r => r.test(p.raw)).map(r => `${p.name}: ${r}`)));
  add('meta tags other than charset', pages.flatMap(p => [...p.raw.matchAll(/<meta\b[^>]*>/gi)].filter(m => !/^<meta charset="utf-8">$/i.test(m[0])).map(m => `${p.name}: ${m[0]}`)));
  const names = new Set(pages.map(p => p.name));
  add('navigation stays inside the input directory', pages.flatMap(p => [...p.raw.matchAll(/\b(?:href|src)="([^"]*)"/g)].map(m => m[1]).filter(h => /^[a-z]+:|^\/\/|^\/|\.\./i.test(h) || !names.has(h.split('#')[0])).map(h => `${p.name}: ${h}`)));
  add('form actions', pages.flatMap(p => [...p.raw.matchAll(/\baction="([^"]*)"/g)].map(m => m[1]).filter(a => a !== '/report' && a !== '/hypothesis').map(a => `${p.name}: ${a}`)));
  add('anonymous file names', pages.map(p => p.name).filter(n => !/^(index|report|hypothesis|case-C-[0-9a-f]{6}|match-M-[0-9a-f]{6})\.html$/.test(n)));
  // declared input boundary (AC-P3.2)
  const listed = boundary.files as Record<string, string>;
  add('served directory = INPUT_BOUNDARY.json listing', [...pages.map(p => p.name).filter(n => !(n in listed)).map(n => `not listed: ${n}`), ...Object.keys(listed).filter(n => !names.has(n)).map(n => `listed but missing: ${n}`), ...files.filter(f => listed[rel(f)] && fileSha256(f) !== listed[rel(f)]).map(f => `changed: ${rel(f)}`)]);
  add('every served file is a discovery-manifest file', files.map(rel).filter(n => discMan.files[`site/${n}`] !== listed[n] || !discMan.files[`site/${n}`]).map(n => `site/${n}`));
  const otherHashes = new Map<string, string>();
  for (const p of ['spec', 'heldout', 'eval']) for (const [f, h] of Object.entries(JSON.parse(readFileSync(join(P, p, 'MANIFEST.json'), 'utf8')).files as Record<string, string>)) otherHashes.set(h, `${p}/${f}`);
  add('no spec/heldout/eval file in the served directory', files.filter(f => otherHashes.has(fileSha256(f))).map(f => `${rel(f)} = ${otherHashes.get(fileSha256(f))}`));
  add('served directory is inside the discovery partition', relative(join(P, 'discovery'), site).startsWith('..') ? [site] : []);

  // residual semantic clues (Q10): reported, not failures
  const obs = JSON.parse(readFileSync(join(P, 'discovery/observations.json'), 'utf8'));
  const effectNames = [...new Set([...obs.cases.flatMap((c: { steps: { events: { effect?: string }[] }[] }) => c.steps.flatMap(s => s.events.map(e => e.effect))), ...obs.matches.flatMap((m: { rows: { events: { effect?: string }[] }[] }) => m.rows.flatMap(r => r.events.map(e => e.effect)))].filter(Boolean))].sort() as string[];
  const messages = [...new Set([...obs.cases.flatMap((c: { steps: { note?: string }[] }) => c.steps.map(s => s.note)), ...obs.matches.map((m: { reason: string }) => m.reason)].filter(Boolean))] as string[];
  const rules = spec.game.rules as { id: string; text: string }[];
  const clue = (s: string) => { let best = { rule: '', run: '', at: Infinity }; for (const r of rules) { const x = longestSharedRun(s, r.text), at = words(r.text).join(' ').indexOf(x); if (words(x).length > words(best.run).length || (x && words(x).length === words(best.run).length && at < best.at)) best = { rule: r.id, run: x, at }; } return { rule: best.rule, run: best.run }; };
  const residual = {
    note: 'Observable in normal gameplay, so kept (Q10). They carry semantic hints; blind discovery does not exclude prior knowledge or these hints. Rule ids shown here are for the operator; they are not in the input boundary.',
    effectNames: effectNames.map(n => ({ name: n, ...clue(n) })),
    engineMessages: messages.map(m => ({ message: m, ...clue(m), sharedWords: words(clue(m).run).length })).filter(x => x.sharedWords >= 4).sort((a, b) => b.sharedWords - a.sharedWords),
    knownPrior: 'An agent may recognise the game from its mechanics (board, effect names) and recall prior knowledge of Rule Sabotage; nothing here prevents that.',
  };
  const fails = checks.filter(c => c.result === 'fail');
  return { schema: 'gamewatch/gw2-leak-check@1', exp: relative(root, expDir) || expDir, served: boundary.served, files: files.length, ok: !fails.length, checks, residualSemanticClues: residual };
}

if (process.argv[1]?.endsWith('gw2/leak-check.ts')) {
  const [exp, out] = process.argv.slice(2);
  if (!exp) { console.error('usage: leak-check.ts <expDir> [out.json]'); process.exit(2); }
  const r = leakCheck(exp);
  if (out) writeFileSync(assertWritableOutput(out), JSON.stringify(r, null, 1) + '\n');
  for (const c of r.checks) console.log(`${c.result === 'pass' ? 'PASS' : 'FAIL'}  ${c.check}${c.hits.length ? `\n      ${c.hits.slice(0, 10).join('\n      ')}` : ''}`);
  console.log(`${r.ok ? 'no leak found' : 'LEAKS FOUND'} in ${r.files} served files; residual semantic clues: ${r.residualSemanticClues.effectNames.length} effect names, ${r.residualSemanticClues.engineMessages.length} engine messages sharing >= 4 words with a rule`);
  process.exit(r.ok ? 0 : 1);
}

