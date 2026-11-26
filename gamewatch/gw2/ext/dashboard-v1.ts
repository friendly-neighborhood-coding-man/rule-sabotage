/**
 * GW2 Extension V1 operator dashboard (D132): the V0 dashboard with output B regrouped for review.
 *
 *   node --experimental-strip-types --no-warnings gamewatch/gw2/ext/dashboard-v1.ts <expDir> --out <new dir> [--label text]
 *
 * B (unmatched actions) is grouped build → rule → outcome field in expandable <details> groups, with discrepancy types
 * and observation counts shown in separate columns, a partition filter (discovery / held-out), and every observation
 * with its evidence reference and provenance inside its group. The provisional-specification warning stays at the top,
 * and every row says "unmatched (not classified)". A (behaviour), C (contradictions) and measures are the V0 pages.
 * Every page carries <meta name="gamewatch-audience" content="operator-only">, which blindSiteProblems (serving-guard.ts)
 * refuses in any served site. The V0 dashboard (evidence/gw2/ext-v0/p7-operator) is kept unchanged.
 * Output: a NEW directory, inside the repository only under evidence/gw2/ext-v1/. Deterministic, no timestamps.
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { assertWritableOutput, repoRelative } from '../paths.ts';
import { buildAll, render } from './dashboard.ts';
import { groupNotifications } from './groups.ts';
import { esc, CSS } from './html.ts';

export const DASHBOARD_V1_ROOT = 'evidence/gw2/ext-v1/';
export const AUDIENCE_META = '<meta name="gamewatch-audience" content="operator-only">';
export function safeDashboardDirV1(d: string) {
  const abs = resolve(d), rel = repoRelative(abs);
  if (/(^|[\\/])(partitions|site)([\\/]|$)/.test(abs)) throw new Error(`refusing ${abs}: never inside a partitions/ or site/ directory`);
  if (rel !== null) { if (!rel.startsWith(DASHBOARD_V1_ROOT)) throw new Error(`refusing ${rel}: inside the repository the V1 dashboard may only be written under ${DASHBOARD_V1_ROOT}`); assertWritableOutput(abs); }
  if (existsSync(abs)) throw new Error(`refusing ${rel ?? abs}: the directory exists (never overwritten)`);
  return abs;
}

const j = (v: unknown) => esc(JSON.stringify(v));
const pp = (o: Record<string, number>) => `discovery ${o.discovery} · held-out ${o.heldout}`;
const parts = (o: Record<string, number>) => Object.entries(o).filter(([, n]) => n > 0).map(([p]) => p).join(' ');
const FILTER_JS = `<script>function gwFilter(){var on={};document.querySelectorAll('input[data-filter]').forEach(function(c){on[c.dataset.filter]=c.checked});`
  + `document.querySelectorAll('tr[data-partition]').forEach(function(r){r.hidden=!on[r.dataset.partition]});`
  + `document.querySelectorAll('[data-partitions]').forEach(function(g){g.hidden=!g.dataset.partitions.split(' ').some(function(p){return on[p]})})}</script>`;

export function renderUnmatchedGrouped(B: any, allBuilds: { id: string; label: string | null }[]) {
  const groups = groupNotifications(B.notifications, allBuilds);
  const bname = (b: { id: string; label: string | null }) => esc(b.label ? `${b.id} (${b.label})` : b.id);
  const head = (cells: string[]) => `<tr>${cells.map(c => `<th>${esc(c)}</th>`).join('')}</tr>`;
  const countCells = (g: any) => `<td>${g.observations}</td><td>${esc(pp(g.observationsByPartition))}</td><td>${g.situations}</td><td>${g.units}</td>`;
  const body = groups.map(g => {
    const rules = g.rules.map(r => {
      const fields = r.fields.map(f => `<details class="g3" data-partitions="${parts(f.observationsByPartition)}"><summary><b>${esc(f.field)}</b>: ${f.discrepancyTypes.length} discrepancy type(s); ${f.observations} observation(s) (${esc(pp(f.observationsByPartition))}), ${f.situations} situation(s), ${f.units} unit(s)</summary>`
        + `<h4>Discrepancy types</h4><table>${head(['Comparison', 'Expected (spec)', 'Observed', 'Observations', 'By partition', 'Situations', 'Units'])}${f.discrepancyTypes.map(t => `<tr><td>${esc(t.comparison)}</td><td>${j(t.expected)}</td><td>${j(t.observed)}</td>${countCells(t)}</tr>`).join('')}</table>`
        + `<h4>Observations (evidence and provenance)</h4><table>${head(['Notification', 'Partition', 'Situation', 'Unit', 'Pointer', 'Compared with', 'Expected', 'Observed', 'Status'])}`
        + f.observationsList.map(o => `<tr data-partition="${esc(o.partition)}"><td class="mono">${esc(o.id)}</td><td>${esc(o.partition)}</td><td class="mono">${esc(o.situation)} <span class="small">(${esc(o.kind)})</span></td><td class="mono">${esc(o.unitType)} ${esc(o.unit)}</td><td class="mono">${esc(o.pointer)}</td><td class="mono">${esc(o.comparedWith ?? '')}</td><td>${j(o.expected)}</td><td>${j(o.observed)}</td><td>unmatched (not classified)</td></tr>`).join('')
        + `</table></details>`).join('');
      return `<details class="g2" data-partitions="${parts(r.observationsByPartition)}"><summary><b>${esc(r.rule.id)}</b> ${esc(r.rule.text ?? '')}<br><span class="small">${r.discrepancyTypes} discrepancy type(s) over ${r.fields.length} outcome field(s); ${r.observations} observation(s) (${esc(pp(r.observationsByPartition))}), ${r.situations} situation(s), ${r.units} unit(s)</span></summary>${fields}</details>`;
    }).join('');
    return `<details class="g1" ${g.observations ? `data-partitions="${parts(g.observationsByPartition)}"` : ''}><summary><b>${bname(g.build)}</b>: ${g.rules.length} rule(s) with unmatched actions; ${g.observations} observation(s) (${esc(pp(g.observationsByPartition))}), ${g.situations} situation(s), ${g.units} unit(s)</summary>${rules || '<p class="small">No unmatched actions for this build under the encoded rules.</p>'}</details>`;
  }).join('');
  const summary = `<table>${head(['Build', 'Rules', 'Discrepancy types', 'Observations', 'By partition', 'Situations', 'Units'])}${groups.map(g => `<tr><td>${bname(g.build)}</td><td>${g.rules.length}</td><td>${g.rules.reduce((k, r) => k + r.discrepancyTypes, 0)}</td>${countCells(g)}</tr>`).join('')}</table>`;
  const html = `<p class="banner">${esc(B.specification.note)}. Encoding <span class="mono">${esc(B.specification.encoding)}</span>, review: ${esc(B.specification.review)}. Each observation is an observed outcome that differs from the encoded specification. It is <b>not</b> classified as a bug.</p>`
    + `<p>${B.notifications.length} unmatched actions. No agent submission is involved. Discrepancy types (distinct expected → observed patterns) and observation counts are separate columns and are never combined.</p>`
    + `<p class="filters">Show partitions: <label><input type="checkbox" data-filter="discovery" checked onchange="gwFilter()"> discovery</label> <label><input type="checkbox" data-filter="heldout" checked onchange="gwFilter()"> held-out</label> <span class="small">(the filter hides rows and groups; the counts in each summary are fixed)</span></p>`
    + `<h2>By build</h2>${summary}<h2>Groups: build → rule → outcome field</h2>${body}`
    + `<h2>Rules without notifications possible</h2><table>${head(['Rule', 'Encoding status', 'Reason'])}${B.notEncoded.map((r: any) => `<tr><td>${esc(r.rule)}</td><td>${esc(r.status)}</td><td>${esc(r.reason ?? '')}</td></tr>`).join('')}</table>`
    + `<h2>Missing information</h2><table>${head(['Rule', 'Partition', 'Build', 'Excluded situations', 'Outcomes not recorded'])}${B.missingInformation.map((m: any) => `<tr data-partition="${esc(m.partition)}"><td>${esc(m.rule)}</td><td>${esc(m.partition)}</td><td>${esc(m.build)}</td><td>${j(m.excluded)}</td><td>${m.outcomeUnknown}</td></tr>`).join('')}</table>` + FILTER_JS;
  return { html, groups };
}

const GROUP_CSS = 'details{border:1px solid #d6d9dd;border-radius:4px;margin:6px 0;padding:4px 8px}details.g2{margin-left:14px}details.g3{margin-left:14px;background:#fafbfc}summary{cursor:pointer}h4{margin:8px 0 2px}.filters{background:#f3f5f7;padding:6px 10px}';
const NAV = `<nav><a href="index.html">Overview</a><a href="behaviour.html">A. How the game actually works</a><a href="unmatched-actions.html">B. Unmatched actions</a><a href="contradictions.html">C. Hypothesis contradictions</a><a href="measures.html">Measures</a></nav>`;
const BANNER = `<p class="banner">Operator view. Contains specification-derived information (B) and held-out results (A, C). Never serve these pages to a discovery session.</p>`;
const pageV1 = (title: string, body: string) => `<!doctype html><meta charset="utf-8">${AUDIENCE_META}<title>${esc(title)}</title><style>${CSS}${GROUP_CSS}</style>${NAV}${BANNER}<h1>${esc(title)}</h1>${body}\n`;
const tagOperator = (html: string) => html.replace('<!doctype html><meta charset="utf-8">', `<!doctype html><meta charset="utf-8">${AUDIENCE_META}`);

export function renderV1(x: ReturnType<typeof buildAll>, label: string): Record<string, string> {
  const v0 = render(x, label), { A, B, C } = x;
  const allBuilds = Object.entries((A.builds ?? {}) as Record<string, { label: string | null }>).map(([id, l]) => ({ id, label: l.label }));
  const { html, groups } = renderUnmatchedGrouped(B, allBuilds);
  const index = pageV1(`GW2 Extension V1: ${label}`, `<p>Three independent outputs, each from its own channel:</p><ul><li><a href="behaviour.html">A. How the game actually works</a>: the agent's behavioural hypotheses, built without the specification (${A.hypotheses.length} submissions).</li>`
    + `<li><a href="unmatched-actions.html">B. Unmatched action notifications</a>: specification–observation, system level, ${B.notifications.length} observations in ${groups.reduce((k, g) => k + g.rules.length, 0)} (build, rule) group(s); specification ${esc(B.specification.review)}.</li><li><a href="contradictions.html">C. Hypothesis contradictions</a>: hypothesis–observation, ${C.contradictions.length} contradictions, ${C.conflictsBetweenHypotheses.length} conflicts between hypotheses.</li></ul>`);
  return { ...Object.fromEntries(Object.entries(v0).map(([f, t]) => [f, f.endsWith('.html') ? tagOperator(t) : t])),
    'index.html': index, 'unmatched-actions.html': pageV1('B. Unmatched action notifications', html), 'unmatched-groups.json': JSON.stringify({ schema: 'gamewatch/gw2-ext-unmatched-groups@1', specification: B.specification, groups }, null, 1) + '\n' };
}

export function writeDashboardV1(exp: string, out: string, label: string) {
  const dir = safeDashboardDirV1(out), files = renderV1(buildAll(exp), label);
  mkdirSync(dir, { recursive: true });
  for (const [f, t] of Object.entries(files)) writeFileSync(join(dir, f), t, { flag: 'wx' });
  return { dir, files: Object.keys(files) };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('gw2/ext/dashboard-v1.ts')) {
  const a = process.argv.slice(2), i = a.indexOf('--out'), li = a.indexOf('--label'), exp = a.find((x, k) => !x.startsWith('--') && a[k - 1] !== '--out' && a[k - 1] !== '--label');
  if (!exp || i < 0) { console.error('usage: dashboard-v1.ts <expDir> --out <new dir> [--label text]'); process.exit(2); }
  const r = writeDashboardV1(isAbsolute(exp) ? exp : join(process.cwd(), exp), a[i + 1], li >= 0 ? a[li + 1] : exp);
  console.log(`operator dashboard V1: ${r.files.length} files in ${r.dir}`);
}
