/**
 * GW2 Extension V0 operator dashboard (D127): the GameWatch operator view of the three outputs, kept apart.
 *
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/ext/dashboard.ts <expDir> --out <new dir>
 *
 * Writes index.html (navigation and warning), behaviour.html (A), unmatched-actions.html (B), contradictions.html (C),
 * measures.html, and the JSON of each. OPERATOR ONLY: B is specification-derived and A/C contain held-out results.
 * The output directory must be new, outside any partitions/ or site directory, and inside the repository only under
 * evidence/gw2/ext-v0/. The GW1 dashboard (gamewatch/dashboard.ts) and the blind site are not touched; the GW2 review
 * server only serves its --site directory, so nothing written here reaches a discovery session.
 * Deterministic: no timestamps; the same evidence gives the same bytes.
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { assertWritableOutput, repoRelative } from '../paths.ts';
import { buildBehaviour } from './behaviour.ts';
import { buildNotifications } from './notifications.ts';
import { buildContradictions } from './contradictions.ts';
import { measures } from './measures.ts';
import { esc, CSS } from './html.ts';

export const DASHBOARD_ROOT = 'evidence/gw2/ext-v0/';
export function safeDashboardDir(d: string) {
  const abs = resolve(d), rel = repoRelative(abs);
  if (/(^|[\\/])(partitions|site)([\\/]|$)/.test(abs)) throw new Error(`refusing ${abs}: never inside a partitions/ or site/ directory`);
  if (rel !== null) { if (!rel.startsWith(DASHBOARD_ROOT)) throw new Error(`refusing ${rel}: inside the repository the dashboard may only be written under ${DASHBOARD_ROOT}`); assertWritableOutput(abs); }
  if (existsSync(abs)) throw new Error(`refusing ${rel ?? abs}: the directory exists (never overwritten)`);
  return abs;
}

export function buildAll(exp: string) {
  const A = buildBehaviour(exp), B = buildNotifications(exp), C = buildContradictions(exp);
  return { A, B, C, M: measures(exp, A, B, C) };
}

const page = (title: string, body: string) => `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style>`
  + `<nav><a href="index.html">Overview</a><a href="behaviour.html">A. How the game actually works</a><a href="unmatched-actions.html">B. Unmatched actions</a><a href="contradictions.html">C. Hypothesis contradictions</a><a href="measures.html">Measures</a></nav>`
  + `<p class="banner">Operator view. Contains specification-derived information (B) and held-out results (A, C). Never serve these pages to a discovery session.</p><h1>${esc(title)}</h1>${body}\n`;
const j = (v: unknown) => esc(JSON.stringify(v));
const table = (head: string[], rows: string[][]) => `<table><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;

export function render(x: ReturnType<typeof buildAll>, label: string): Record<string, string> {
  const { A, B, C, M } = x;
  const buildName = (b: { id: string; label: string | null }) => esc(b.label ? `${b.id} (${b.label})` : b.id);
  const behaviour = page('A. How the game actually works', `<p class="small">Built without the specification. Statements are the agent's own words, verbatim; fidelity of a representation is declared by its author, not checked.</p>`
    + A.hypotheses.map((h: any) => `<h2>${esc(h.ref)} <span class="small">session ${esc(h.session)}</span></h2>`
      + table(['Statement (verbatim)', 'Confidence', 'Cited evidence', 'Verification status', 'Coverage held-out'], [[esc(h.submitted.statement), esc(h.submitted.confidence), esc(h.submitted.citedEvidence), esc(h.verificationStatus), `${h.coverage.heldout.k} / ${h.coverage.heldout.n}`]])
      + h.representations.map((r: any) => `<p class="mono small">Structured representation ${esc(r.representation.slice(0, 12))} (${esc(r.origin)}, fidelity declared ${esc(r.fidelityDeclared)}, not checked): ${j(r.structured)}</p>` + table(['Build', 'Clause', 'Discovery: evaluated / supported / counterexamples', 'Held-out checks: matching / contradicting / unknown', 'First counterexamples (discovery)'],
        r.byBuild.flatMap((b: any) => b.clauses.map((c: any) => [buildName({ id: b.build, label: b.label }), `${c.clause} (${esc(c.situation)})`, `${c.discovery.evaluated} / ${c.discovery.fullySupported} / ${c.discovery.counterexamples}`,
          `${c.heldout.outcomeChecks.matching} / ${c.heldout.outcomeChecks.contradicting} / ${c.heldout.outcomeChecks.unknown}`, `<span class="mono">${esc(c.discovery.listedCounterexamples.slice(0, 5).map((y: any) => `${y.situation} ${y.field}: predicted ${JSON.stringify(y.predicted)}, observed ${JSON.stringify(y.observed)}`).join('; '))}</span>`])))).join('')).join(''));
  const unmatched = page('B. Unmatched action notifications', `<p class="banner">${esc(B.specification.note)}. Encoding <span class="mono">${esc(B.specification.encoding)}</span>, review: ${esc(B.specification.review)}. Each row is an observed outcome that differs from the encoded specification. It is <b>not</b> classified as a bug.</p>`
    + `<p>${B.notifications.length} unmatched actions. No agent submission is involved.</p>`
    + table(['Rule', 'Specification text', 'Partition', 'Build', 'Outcome', 'Expected (spec)', 'Observed', 'Evidence'], B.notifications.map((n: any) => [esc(n.rule.id), esc(n.rule.text), esc(n.partition), buildName(n.build), esc(n.field), j(n.expected), j(n.observed), `<span class="mono">${esc(n.evidence.situation)}</span>`]))
    + `<h2>Rules without notifications possible</h2>` + table(['Rule', 'Encoding status', 'Reason'], B.notEncoded.map((r: any) => [esc(r.rule), esc(r.status), esc(r.reason ?? '')]))
    + `<h2>Missing information</h2>` + table(['Rule', 'Partition', 'Build', 'Excluded situations', 'Outcomes not recorded'], B.missingInformation.map((m: any) => [esc(m.rule), esc(m.partition), esc(m.build), j(m.excluded), String(m.outcomeUnknown)])));
  const contra = page('C. Hypothesis contradictions', `<p class="small">Hypothesis–observation only; no specification. Discovery and held-out are separate columns. Conflicts between hypotheses are shown, not resolved.</p>`
    + table(['Hypothesis', 'Confidence', 'Partition', 'Build', 'Outcome', 'Predicted', 'Observed', 'Evidence'], C.contradictions.map((c: any) => [`${esc(c.hypothesis.ref)} <span class="small">${esc(c.hypothesis.session)}</span>`, esc(c.hypothesis.confidence), esc(c.partition), buildName(c.build), esc(c.field), j(c.predicted), j(c.observed), `<span class="mono">${esc(c.evidence.situation)}</span>`]))
    + `<h2>Conflicts between hypotheses</h2>` + table(['Partition', 'Situation', 'Outcome', 'Predictions'], C.conflictsBetweenHypotheses.map((c: any) => [esc(c.partition), `<span class="mono">${esc(c.situation)}</span>`, esc(c.field), esc(c.predictions.map((p: any) => `${p.ref}: ${JSON.stringify(p.predicted)}`).join('; '))]))
    + `<h2>Not machine-evaluable</h2>` + table(['Hypothesis', 'Session', 'Reason'], C.notEvaluable.map((n: any) => [esc(n.ref), esc(n.session), esc(n.reason)])));
  const meas = page('Measures (separate, never combined)', ['systemDiscrepancyDetection', 'agentBehaviouralDiscovery', 'machineVerifiableDescriptions'].map(k => `<h2>${esc(k)}</h2><pre class="mono">${esc(JSON.stringify((M as any)[k], null, 1))}</pre>`).join(''));
  const index = page(`GW2 Extension V0: ${label}`, `<p>Three independent outputs, each from its own channel:</p><ul><li><a href="behaviour.html">A. How the game actually works</a>: the agent's behavioural hypotheses, built without the specification (${A.hypotheses.length} submissions).</li>`
    + `<li><a href="unmatched-actions.html">B. Unmatched action notifications</a>: specification–observation, system level, ${B.notifications.length} notifications; specification ${esc(B.specification.review)}.</li><li><a href="contradictions.html">C. Hypothesis contradictions</a>: hypothesis–observation, ${C.contradictions.length} contradictions, ${C.conflictsBetweenHypotheses.length} conflicts between hypotheses.</li></ul>`);
  return { 'index.html': index, 'behaviour.html': behaviour, 'unmatched-actions.html': unmatched, 'contradictions.html': contra, 'measures.html': meas,
    'behaviour.json': JSON.stringify(A, null, 1) + '\n', 'unmatched-actions.json': JSON.stringify(B, null, 1) + '\n', 'contradictions.json': JSON.stringify(C, null, 1) + '\n', 'measures.json': JSON.stringify(M, null, 1) + '\n' };
}

export function writeDashboard(exp: string, out: string, label: string) {
  const dir = safeDashboardDir(out), files = render(buildAll(exp), label);
  mkdirSync(dir, { recursive: true });
  for (const [f, t] of Object.entries(files)) writeFileSync(join(dir, f), t, { flag: 'wx' });
  return { dir, files: Object.keys(files) };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('gw2/ext/dashboard.ts')) {
  const a = process.argv.slice(2), i = a.indexOf('--out'), exp = a.find((x, k) => !x.startsWith('--') && a[k - 1] !== '--out' && a[k - 1] !== '--label'), li = a.indexOf('--label');
  if (!exp || i < 0) { console.error('usage: dashboard.ts <expDir> --out <new dir> [--label text]'); process.exit(2); }
  const r = writeDashboard(isAbsolute(exp) ? exp : join(process.cwd(), exp), a[i + 1], li >= 0 ? a[li + 1] : exp);
  console.log(`operator dashboard: ${r.files.length} files in ${r.dir}`);
}
