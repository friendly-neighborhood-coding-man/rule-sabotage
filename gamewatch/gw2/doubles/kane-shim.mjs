#!/usr/bin/env node
/**
 * GW2 P6 deterministic Kane CLI stand-in (TEST DOUBLE). It is started through the REAL Kane invocation boundary
 * (server/kane.ts runCapture with KANE_CLI pointing here) with exactly the argv a real objective-mode call would get:
 *   run <objective> --url <index> --agent --headless --max-steps N --timeout S
 * It calls no model and no network beyond the local review server named by --url. It investigates the served pages
 * over HTTP like a browsing agent, submits through the served forms (nonce from the page), and prints Kane-shaped NDJSON
 * (stream_start, step, run_end). Its behaviour is one of five scripted investigator profiles (GW2_DOUBLE_PROFILE):
 *   accurate            reads every page it cites; submits claims that hold on every build
 *   careless            reads only the index; submits the same claims citing pages it never opened, plus a finding
 *   over-abstaining     reads the index and one page; abstains on everything
 *   confident-wrong     reads a few pages; submits wrong claims with high confidence
 *   defect-describer    reads every match page, finds the build whose first mover gets one extra action, and describes
 *                       that build's behaviour with a build-specific condition (discovery build id)
 * Every submission is labelled TEST DOUBLE and measures no agent.
 */
import { appendFileSync } from 'node:fs';

const VERSION = '0.0.0-test-double';
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log(`kane-cli ${VERSION}`); process.exit(0); }
if (args[0] !== 'run') { console.error(`kane-shim: unsupported command ${args[0] ?? '(none)'}`); process.exit(64); }
const opt = k => { const i = args.indexOf(k); return i > 0 ? args[i + 1] : undefined; };
const url = opt('--url'), maxSteps = Number(opt('--max-steps') ?? 0), profile = process.env.GW2_DOUBLE_PROFILE ?? '';
if (process.env.GW2_SHIM_MARKER) appendFileSync(process.env.GW2_SHIM_MARKER, `${profile}\n`);
const emit = o => process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), ...o }) + '\n');
emit({ type: 'stream_start', mode: 'objective', test_double: true });
if (!url || !args.includes('--agent') || !args.includes('--headless') || !(maxSteps > 0)) { emit({ type: 'error', message: 'kane-shim: incomplete objective-mode argv' }); process.exit(2); }
const base = new URL('.', url), headers = { 'user-agent': `kane-cli-test-double/${profile}` };
let steps = 0;
const step = remark => { steps++; emit({ type: 'step', step: steps, remark }); if (steps > maxSteps) throw new Error('step budget exhausted'); };
const get = async p => { step(`open ${p}`); return (await fetch(new URL(p, base), { headers })).text(); };
const post = async (p, form) => { step(`submit ${p}`); return (await fetch(new URL(p, base), { method: 'POST', headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) })).text(); };

const TD = 'TEST DOUBLE (scripted): ';
const SCHEMA = 'gamewatch/gw2-hypothesis@1';
const f = name => ({ op: 'field', name }), c = value => ({ op: 'const', value });
const eq = (a, b) => ({ op: 'eq', args: [a, b] }), add = (a, b) => ({ op: 'add', args: [a, b] }), and = (...a) => ({ op: 'and', args: a });
const rep = (...clauses) => JSON.stringify({ schema: SCHEMA, clauses });
const ACTIONS = add(f('piecesOnBoard'), f('pendingBonus'));
// claims that hold on every build of the P5 development dataset
const SOUND = [
  { statement: `${TD}an unshielded piece that walks onto a Send home cell goes back to its start.`, confidence: 'high',
    representation: rep({ form: 'law', situation: 'effect-entry', when: and(eq(f('effectKind'), c('send-home')), eq(f('pieceShieldedBefore'), c(false)), eq(f('capped'), c(false))), expect: [{ field: 'sentHome', equals: c(true) }] }) },
  { statement: `${TD}an effect cannot be placed right next to a piece.`, confidence: 'medium',
    representation: rep({ form: 'law', situation: 'effect-placement', when: eq(f('nearAnyPiece'), c(true)), expect: [{ field: 'placed', equals: c(false) }] }) },
  { statement: `${TD}the side that did not move first gets one action per own piece on the board plus extras it earned.`, confidence: 'medium',
    representation: rep({ form: 'law', situation: 'turn-start', when: eq(f('isFirstMover'), c(false)), expect: [{ field: 'actionsGranted', equals: ACTIONS }] }) },
];
const WRONG = [
  { statement: `${TD}every turn starts with exactly three actions.`, confidence: 'high', representation: rep({ form: 'law', situation: 'turn-start', expect: [{ field: 'actionsGranted', equals: c(3) }] }) },
  { statement: `${TD}effects can be placed anywhere, including next to pieces.`, confidence: 'high', representation: rep({ form: 'law', situation: 'effect-placement', when: eq(f('nearAnyPiece'), c(true)), expect: [{ field: 'placed', equals: c(true) }] }) },
  { statement: `${TD}a Send home cell never sends a piece home.`, confidence: 'high', representation: rep({ form: 'law', situation: 'effect-entry', when: eq(f('effectKind'), c('send-home')), expect: [{ field: 'sentHome', equals: c(false) }] }) },
];
const links = (html, kind) => [...new Set([...html.matchAll(new RegExp(`href="(${kind}-[A-Za-z0-9-]+\\.html)"`, 'g'))].map(m => m[1]))].sort();
const idOf = page => page.replace(/^(case|match)-/, '').replace(/\.html$/, '');
const rows = html => [...html.matchAll(/<tr><td>(\d+)<\/td><td>(Human|AI)<\/td><td>(\d+)<\/td><td>(\d+)<\/td>/g)].map(m => ({ side: m[2], pieces: Number(m[3]), granted: Number(m[4]) }));

try {
  const index = await get('index.html');
  const cases = links(index, 'case'), matches = links(index, 'match');
  const form = await get('hypothesis.html'), nonce = form.match(/name="nonce" value="([0-9a-f]+)"/)?.[1] ?? '';
  const submit = (h, cite) => post('hypothesis', { ...h, evidence: cite.map(idOf).join(' '), nonce });
  let summary = '';
  if (profile === 'accurate') {
    const read = [...cases, ...matches.slice(0, 4)];
    for (const p of read) await get(p);
    for (const h of SOUND) await submit(h, read.slice(0, 3));
    summary = `submitted ${SOUND.length} hypotheses after reading ${read.length} pages`;
  } else if (profile === 'careless') {
    const cite = [...cases.slice(0, 3), ...matches.slice(0, 2)];
    for (const h of SOUND) await submit(h, cite);
    await post('report', { category: 'bug', claim: `${TD}the game looks fine`, evidence: cite.map(idOf).join(' '), confidence: 'high', nonce });
    summary = `submitted ${SOUND.length} hypotheses and a finding citing ${cite.length} pages it did not open`;
  } else if (profile === 'over-abstaining') {
    if (cases[0]) await get(cases[0]);
    for (const scope of ['action allocation at turn start', 'what effect cells do when entered', 'where effects may be placed'])
      await submit({ abstain: 'yes', abstainScope: `${TD}not enough certainty about ${scope}.`, confidence: 'low' }, []);
    summary = 'abstained on every question';
  } else if (profile === 'confident-wrong') {
    const read = cases.slice(0, 2);
    for (const p of read) await get(p);
    for (const h of WRONG) await submit(h, read);
    summary = `submitted ${WRONG.length} confident hypotheses`;
  } else if (profile === 'defect-describer') {
    const byBuild = new Map();
    for (const p of matches) {
      const html = await get(p), build = html.match(/Build <b>(build-[0-9a-f]{4})<\/b>/)?.[1], first = html.match(/first mover (Human|AI)/)?.[1];
      if (!build || !first) continue;
      const d = byBuild.get(build) ?? { plus1: 0, plain: 0, pages: [] };
      for (const r of rows(html)) if (r.side === first) { if (r.granted === r.pieces + 1) d.plus1++; else if (r.granted === r.pieces) d.plain++; }
      d.pages.push(p); byBuild.set(build, d);
    }
    const odd = [...byBuild].filter(([, d]) => d.plus1 > d.plain).map(([b]) => b).sort();
    for (const b of odd) {
      const cite = byBuild.get(b).pages.slice(0, 3);
      await submit({ statement: `${TD}on ${b}, the side that moved first gets one more action at each of its turn starts than pieces plus earned extras; the other side gets pieces plus extras.`, confidence: 'high',
        representation: rep(
          { form: 'law', situation: 'turn-start', when: and(eq(f('build'), c(b)), eq(f('isFirstMover'), c(true))), expect: [{ field: 'actionsGranted', equals: add(ACTIONS, c(1)) }] },
          { form: 'law', situation: 'turn-start', when: and(eq(f('build'), c(b)), eq(f('isFirstMover'), c(false))), expect: [{ field: 'actionsGranted', equals: ACTIONS }] }) }, cite);
    }
    const others = [...byBuild.keys()].filter(b => !odd.includes(b)).sort();
    for (const b of others) await submit({ statement: `${TD}on ${b}, each side gets one action per own piece plus earned extras, whoever moved first.`, confidence: 'medium',
      representation: rep({ form: 'law', situation: 'turn-start', when: eq(f('build'), c(b)), expect: [{ field: 'actionsGranted', equals: ACTIONS }] }) }, byBuild.get(b).pages.slice(0, 3));
    summary = `described ${odd.length} build(s) with a first-mover extra action and ${others.length} without`;
  } else {
    emit({ type: 'error', message: `kane-shim: unknown profile ${JSON.stringify(profile)}` });
    emit({ type: 'run_end', status: 'error', summary: 'unknown profile', steps });
    process.exit(3);
  }
  emit({ type: 'run_end', status: 'passed', summary: `${TD}${summary}`, steps });
} catch (e) {
  emit({ type: 'run_end', status: 'error', summary: String(e?.message ?? e), steps });
  process.exit(3);
}
