/**
 * GW2 Extension V1 (D129-D135): isolation boundaries, grouped operator dashboard, matched comparison plan.
 * Offline only: P7 published evidence and temporary copies; no Kane, no paid call, no gate change.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, rmSync, cpSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { authenticatedPrefix, feedbackBinding, readLinePrefix, FEEDBACK_MANIFEST_KEY } from '../gamewatch/gw2/ext/anchored.ts';
import { loadSubmissions, AccessRefused } from '../gamewatch/gw2/ext/inputs.ts';
import { activateAgentFeedback, activationProblems, servableFeedbackPage, AGENT_FEEDBACK_ENABLED } from '../gamewatch/gw2/ext/feedback.ts';
import { buildFeedbackForTest } from '../gamewatch/gw2/ext/feedback-testonly.ts';
import { buildAll } from '../gamewatch/gw2/ext/dashboard.ts';
import { renderV1, safeDashboardDirV1, AUDIENCE_META } from '../gamewatch/gw2/ext/dashboard-v1.ts';
import { groupNotifications } from '../gamewatch/gw2/ext/groups.ts';
import { blindSiteProblems } from '../gamewatch/gw2/ext/serving-guard.ts';
import { PLAN_V1, ARMS, SHARED, MANIPULATED, unmatchedFactors, OBJECTIVE_PHASE_1, OBJECTIVE_PHASE_2 } from '../gamewatch/gw2/ext/comparison-plan.ts';
import { readExecLedger, appendCheckpoint } from '../gamewatch/gw2/p7-exec.ts';
import { startGw2Server } from '../gamewatch/gw2/serve.ts';
import { PAID_RESEARCH_EXECUTION } from '../server/balance/v4/kanebudget.ts';

const ROOT = join(import.meta.dirname, '..');
const PUB = join(ROOT, 'evidence/gw2/p7-pilot'), EXP = join(PUB, 'exp');
const shaB = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const sha = (f: string) => shaB(readFileSync(f));
const spec = JSON.parse(readFileSync(join(EXP, 'partitions/spec/spec.json'), 'utf8'));
const ruleTexts: string[] = spec.game.rules.map((r: any) => r.text);
const S1 = '1e26529c62afc36e';
const all = buildAll(EXP);

/** A temporary copy of the published P7 directory; `edit` may change files and the external-record entries before the
 * ledger is rebuilt as a valid chain (so a test can forge a CONSISTENT record and check what the loader still refuses). */
function copy(edit?: (d: { exp: string; rec: string; prereg: any; entries: any[] }) => void) {
  const d = mkdtempSync(join(tmpdir(), 'gw2-ext-v1-'));
  cpSync(PUB, d, { recursive: true });
  const exp = join(d, 'exp'), rec = join(d, 'external-record');
  if (edit) {
    const entries = readExecLedger(rec).entries.map(e => structuredClone(e)), prereg = JSON.parse(readFileSync(join(rec, 'PREREGISTRATION.json'), 'utf8'));
    edit({ exp, rec, prereg, entries });
    writeFileSync(join(rec, 'PREREGISTRATION.json'), JSON.stringify(prereg, null, 1) + '\n');
    rmSync(join(rec, 'execution-ledger.ndjson'));
    for (const e of entries) appendCheckpoint(rec, e.event, e.event === 'preregistered' ? { ...e.data, preregSha256: sha(join(rec, 'PREREGISTRATION.json')) } : e.data, e.at);
  }
  return { d, exp, rec, done: () => rmSync(d, { recursive: true, force: true }) };
}
const graphLines = (exp: string) => readFileSync(join(exp, 'judgments.ndjson'), 'utf8').split('\n').filter(Boolean);

// ---------------------------------------------------------------- 1. authenticated pre-evaluation prefix
test('authenticated prefix: only the externally anchored pre-evaluation lines are read; later evaluation nodes are never loaded', () => {
  const p = authenticatedPrefix(EXP), lines = graphLines(EXP);
  assert.equal(p.count, 11); assert.equal(p.freezeCount, 8);
  assert.equal(p.bytesRead, Buffer.byteLength(lines.slice(0, 11).join('\n') + '\n'));
  assert.ok(p.bytesRead < statSync(join(EXP, 'judgments.ndjson')).size, 'the suffix exists but was not read');
  assert.ok(lines.slice(11).some(l => JSON.parse(l).node.kind === 'evaluation'), 'the published graph does have later evaluation nodes');
  assert.deepEqual([...new Set(p.nodes.map(n => n.kind))].sort(), ['hypothesis', 'representation']);
  const s = loadSubmissions(EXP); assert.equal(s.hyps.length, 8); assert.equal(s.graphPrefix, 11);
  assert.deepEqual(readLinePrefix(join(EXP, 'judgments.ndjson'), 2).lines, lines.slice(0, 2));
});

test('authenticated prefix: a corrupted suffix is never parsed; a truncated or edited prefix, a moved anchor or an evaluation node in the prefix is refused', () => {
  const ref = authenticatedPrefix(EXP).nodes.map(n => n.id);
  let c = copy();
  try { // garbage after the prefix: never read, so the prefix still authenticates and yields the same nodes
    const f = join(c.exp, 'judgments.ndjson'), l = graphLines(c.exp);
    writeFileSync(f, [...l.slice(0, 11), 'NOT JSON {', '\u0000\u0000'].join('\n') + '\n');
    assert.deepEqual(authenticatedPrefix(c.exp).nodes.map(n => n.id), ref);
    writeFileSync(f, l.slice(0, 10).join('\n') + '\n'); assert.throws(() => authenticatedPrefix(c.exp), /ends after 10 lines/);
    writeFileSync(f, [...l.slice(0, 4), l[4].replace('"H-', '"X-'), ...l.slice(5)].join('\n') + '\n'); assert.throws(() => authenticatedPrefix(c.exp), AccessRefused);
  } finally { c.done(); }
  c = copy(); try { const f = join(c.exp, 'hypotheses/FREEZE.json'); writeFileSync(f, readFileSync(f, 'utf8') + ' '); assert.throws(() => authenticatedPrefix(c.exp), /FREEZE.json differs from its external anchor/); } finally { c.done(); }
  c = copy(); try { const f = join(c.rec, 'execution-ledger.ndjson'); writeFileSync(f, readFileSync(f, 'utf8').replace('"steps":21', '"steps":22')); assert.throws(() => authenticatedPrefix(c.exp), /ledger fails/); } finally { c.done(); }
  c = copy(); try { rmSync(join(c.rec, 'execution-ledger.ndjson')); assert.throws(() => authenticatedPrefix(c.exp), /no external execution ledger/); } finally { c.done(); }
  // a consistently forged record that moves the seal anchor to include the first evaluation node
  c = copy(({ exp, entries }) => {
    const l = graphLines(exp), sf = join(exp, 'hypotheses/REPRESENTATIONS.json'), seal = JSON.parse(readFileSync(sf, 'utf8'));
    seal.graphHead = { count: 12, lastLineSha256: shaB(l[11]) }; writeFileSync(sf, JSON.stringify(seal, null, 1) + '\n');
    const se = entries.find(e => e.event === 'representation-seal'); se.data.sealSha256 = sha(sf); se.data.graph = seal.graphHead;
  });
  try { assert.throws(() => authenticatedPrefix(c.exp), /not submissions or representations \(evaluation\)/); } finally { c.done(); }
  // a seal whose graph head disagrees with the external anchor
  c = copy(({ entries }) => { const se = entries.find(e => e.event === 'representation-seal'); se.data.graph = { ...se.data.graph, count: 10 }; });
  try { assert.throws(() => authenticatedPrefix(c.exp), /differs from the externally anchored seal prefix/); } finally { c.done(); }
});

// ---------------------------------------------------------------- 2. feedback partition bound to the pre-registration
function addFeedback(exp: string, obs: any, role: string | null) {
  const fb = join(exp, 'partitions/feedback'); mkdirSync(fb, { recursive: true });
  const t = JSON.stringify(obs); writeFileSync(join(fb, 'observations.json'), t);
  writeFileSync(join(fb, 'MANIFEST.json'), JSON.stringify({ ...(role ? { role } : {}), files: { 'observations.json': shaB(t) } }));
  return sha(join(fb, 'MANIFEST.json'));
}
test('feedback partition: refused unless the externally anchored pre-registration binds its manifest hash (V0 assertions kept)', () => {
  const obs = JSON.parse(readFileSync(join(EXP, 'partitions/discovery/observations.json'), 'utf8'));
  const fb = (exp: string, rec: string) => buildFeedbackForTest(exp, { session: S1, partitions: ['discovery', 'feedback'], rec });
  assert.throws(() => feedbackBinding(EXP), /binds no feedback partition/, 'P7 has no feedback partition');
  let c = copy(); // a well-formed feedback partition that the pre-registration does not bind
  try { addFeedback(c.exp, obs, 'feedback'); assert.throws(() => fb(c.exp, c.rec), /binds no feedback partition/); } finally { c.done(); }
  c = copy(({ exp, prereg }) => { prereg.files[FEEDBACK_MANIFEST_KEY] = addFeedback(exp, obs, null); });
  try { assert.throws(() => fb(c.exp, c.rec), /role "feedback"/); } finally { c.done(); }
  c = copy(({ exp, prereg }) => { prereg.files[FEEDBACK_MANIFEST_KEY] = addFeedback(exp, { ...obs, builds: [...obs.builds, 'build-c1dc'] }, 'feedback'); });
  try { assert.throws(() => fb(c.exp, c.rec), /builds the agent never saw/); } finally { c.done(); }
  c = copy(({ exp, prereg }) => { prereg.files[FEEDBACK_MANIFEST_KEY] = addFeedback(exp, obs, 'feedback'); });
  try {
    assert.equal(feedbackBinding(c.exp, c.rec).manifestSha256, sha(join(c.exp, 'partitions/feedback/MANIFEST.json')));
    const f = fb(c.exp, c.rec);
    assert.deepEqual(f.partitionsRead, ['discovery/observations.json', 'feedback/observations.json']);
    assert.equal(f.items.filter(i => i.evidence === 'feedback').length, 390);
    addFeedback(c.exp, { ...obs, cases: obs.cases.slice(1) }, 'feedback'); // swapped after the pre-registration
    assert.throws(() => fb(c.exp, c.rec), /not the manifest bound by the pre-registration/);
  } finally { c.done(); }
  c = copy(({ exp, prereg }) => { prereg.files[FEEDBACK_MANIFEST_KEY] = addFeedback(exp, obs, 'feedback'); });
  try { const f = join(c.rec, 'PREREGISTRATION.json'); writeFileSync(f, readFileSync(f, 'utf8') + ' '); assert.throws(() => fb(c.exp, c.rec), /does not start with this pre-registration/); } finally { c.done(); }
});

// ---------------------------------------------------------------- 3. test-only construction vs runtime activation
test('runtime activation refuses while disabled, even with an authorization; test-only feedback is marked and never servable; the runtime never imports the test-only module', () => {
  assert.equal(AGENT_FEEDBACK_ENABLED, false);
  const preregSha256 = sha(join(PUB, 'external-record/PREREGISTRATION.json'));
  const auth = { arm: 'treatment', runId: 'R-1', preregSha256, operatorAuthorization: 'written authorization (test double)' };
  assert.throws(() => activateAgentFeedback(EXP, { session: S1 }), /not enabled/);
  assert.throws(() => activateAgentFeedback(EXP, { session: S1, authorization: auth }), /not enabled/);
  const pr = (runs: unknown) => ({ preregSha256, prereg: { plan: { agentFeedback: { runs } } } });
  assert.deepEqual(activationProblems(true, auth, pr(['R-1'])), [], 'the activation rule itself, on a test double');
  assert.match(activationProblems(false, auth, pr(['R-1'])).join(), /not enabled/);
  assert.match(activationProblems(true, undefined, pr(['R-1'])).join(), /no authorization/);
  assert.match(activationProblems(true, { ...auth, arm: 'control' }, pr(['R-1'])).join(), /only in the treatment arm/);
  assert.match(activationProblems(true, { ...auth, preregSha256: '0'.repeat(64) }, pr(['R-1'])).join(), /does not name the externally anchored/);
  assert.match(activationProblems(true, auth, pr(['R-2'])).join(), /does not list run R-1/);
  assert.match(activationProblems(true, { ...auth, operatorAuthorization: ' ' }, pr(['R-1'])).join(), /no written operator authorization/);
  assert.match(activationProblems(true, auth, null).join(), /no externally anchored pre-registration/);
  const f = buildFeedbackForTest(EXP, { session: S1 });
  assert.equal(f.testOnly, true); assert.equal(f.items.length, 390); assert.equal(f.graphPrefix, 11);
  assert.throws(() => servableFeedbackPage(f), /test-only feedback is never served/);
  const src = readFileSync(join(ROOT, 'gamewatch/gw2/ext/feedback.ts'), 'utf8'), imports = src.split('\n').filter(l => /^\s*import\b/.test(l));
  assert.ok(imports.length && imports.every(l => !/testonly/i.test(l)), 'feedback.ts imports the test-only module');
  for (const m of ['feedback-core.ts', 'anchored.ts', 'inputs.ts', 'contradictions.ts'])
    assert.ok(!/testonly/i.test(readFileSync(join(ROOT, 'gamewatch/gw2/ext', m), 'utf8').split('\n').filter(l => /^\s*import\b/.test(l)).join()), m);
});

// ---------------------------------------------------------------- 4. blinded serving routes
function get(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((res, rej) => { const r = request({ host: '127.0.0.1', port, path, method: 'GET' }, x => { let b = ''; x.setEncoding('utf8'); x.on('data', c => b += c); x.on('end', () => res({ status: x.statusCode ?? 0, body: b })); }); r.on('error', rej); r.end(); });
}
test('serving routes: the blinded agent server never returns an operator page, a specification rule or an unmatched action', async () => {
  const d = mkdtempSync(join(tmpdir(), 'gw2-ext-v1-serve-'));
  try {
    const site = join(d, 'site'), ops = join(d, 'ops');
    cpSync(join(EXP, 'partitions/discovery/site'), site, { recursive: true });
    mkdirSync(ops); for (const [f, t] of Object.entries(renderV1(all, 'test'))) writeFileSync(join(ops, f), t);
    writeFileSync(join(d, 'spec.json'), readFileSync(join(EXP, 'partitions/spec/spec.json')));
    assert.deepEqual(blindSiteProblems(site, ruleTexts), [], 'the served site holds no operator output');
    assert.ok(blindSiteProblems(ops, ruleTexts).length >= 10, 'the guard recognizes operator output');
    const srv = await startGw2Server({ exp: 'gw2-ext-v1-serve-test', out: join(d, 'out'), site, label: 'test-double' });
    try {
      const pages = readdirSync(site).filter(f => f.endsWith('.html')).sort();
      for (const p of ['/', ...pages.map(p => `/${p}`)]) {
        const r = await get(srv.port, p);
        if (p !== '/') assert.equal(r.status, 200, p);
        for (const t of ruleTexts) assert.ok(!r.body.includes(t), `${p} contains spec text`);
        assert.ok(!r.body.includes('gamewatch-audience') && !/Unmatched action|encoded specification|Operator view/i.test(r.body), `${p} contains operator content`);
      }
      for (const p of ['/unmatched-actions.html', '/unmatched-groups.json', '/contradictions.html', '/measures.json', '/../ops/unmatched-actions.html', '/%2e%2e/ops/unmatched-actions.html',
        '/..%2fops%2funmatched-actions.html', '/%2e%2e%2f%2e%2e%2fexp/partitions/spec/spec.json', '/../spec.json', '/ops/index.html', '/..\\ops\\index.html']) {
        const r = await get(srv.port, p);
        assert.notEqual(r.status, 200, p);
        for (const t of ruleTexts) assert.ok(!r.body.includes(t), p);
        assert.ok(!r.body.includes('gamewatch-audience'), p);
      }
      // a protocol-relative path is parsed as host "ops" + /index.html: it can only reach the blind site's own index
      const pr = await get(srv.port, '//ops/index.html');
      assert.equal(pr.body, (await get(srv.port, '/index.html')).body); assert.ok(!pr.body.includes('gamewatch-audience'));
    } finally { await srv.close(); }
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- 5. grouped operator dashboard
test('grouped unmatched actions: build → rule → field, types and counts separate, every observation and its provenance kept', () => {
  const B = all.B, builds = [{ id: 'build-06b9', label: 'QX-41' }, { id: 'build-3caf', label: 'QX-73' }];
  const g = groupNotifications(B.notifications, builds);
  assert.deepEqual(g.map(x => [x.build.id, x.observations]), [['build-06b9', 0], ['build-3caf', 338]], 'a build without unmatched actions is still shown');
  const flat = g.flatMap(b => b.rules.flatMap(r => r.fields.flatMap(f => f.observationsList)));
  assert.deepEqual(flat.map(o => o.id).sort(), B.notifications.map((n: any) => n.id).sort(), 'the groups hold exactly the notifications');
  for (const o of flat) { const n = B.notifications.find((x: any) => x.id === o.id); assert.deepEqual([o.partition, o.situation, o.kind, o.unit, o.unitType, o.pointer, o.comparedWith, o.expected, o.observed], [n.partition, n.evidence.situation, n.evidence.kind, n.evidence.unit, n.evidence.unitType, n.evidence.pointer, n.comparedWith ?? null, n.expected, n.observed]); }
  const b3 = g[1];
  assert.deepEqual(b3.rules.map(r => [r.rule.id, r.observations, r.discrepancyTypes]), [['R3', 320, 3], ['R7', 10, 4], ['R8', 2, 1], ['R14', 6, 2]]);
  const r3 = b3.rules[0].fields[0];
  assert.deepEqual(r3.discrepancyTypes.map(t => [t.expected, t.observed, t.observations]), [[3, 4, 131], [1, 2, 114], [2, 3, 75]]);
  for (const r of b3.rules) for (const f of r.fields) {
    assert.equal(f.discrepancyTypes.reduce((k, t) => k + t.observations, 0), f.observations, 'type counts add up to the observations');
    assert.equal(f.observationsByPartition.discovery + f.observationsByPartition.heldout, f.observations);
  }
  assert.ok(b3.rules[1].fields.every(f => f.discrepancyTypes.every(t => t.comparison === 'cross-build invariance')));
  assert.equal(b3.situations, 328, 'situations are counted separately from observations (one situation can differ in two fields)');
});

test('V1 operator dashboard: committed bytes equal the renderer; V0 kept; operator marker, provisional warning, filters, no classification; guarded output', () => {
  const files = renderV1(all, 'P7 pilot (published evidence)'), dir = join(ROOT, 'evidence/gw2/ext-v1/p7-operator');
  assert.deepEqual(readdirSync(dir).sort(), Object.keys(files).sort());
  for (const [f, t] of Object.entries(files)) assert.equal(readFileSync(join(dir, f), 'utf8'), t, f);
  for (const [f, t] of Object.entries(files)) if (f.endsWith('.html')) assert.ok(t.includes(AUDIENCE_META), f);
  const u = files['unmatched-actions.html'];
  assert.match(u, /PROVISIONAL/); assert.match(u, /data-filter="discovery"/); assert.match(u, /data-filter="heldout"/); assert.match(u, /<details class="g1"/);
  assert.equal((u.match(/<tr data-partition="(discovery|heldout)"><td class="mono">/g) ?? []).length, 338, 'one row per observation');
  assert.equal((u.match(/unmatched \(not classified\)/g) ?? []).length, 338);
  assert.ok(!/\b(bug|defect)s?\b/i.test(u.replace('<b>not</b> classified as a bug', '')), 'nothing is called a bug or defect');
  for (const d of [join(ROOT, 'evidence/gw2/ext-v0/p7-operator-v1'), join(ROOT, 'evidence/gw2/ext-v1/p7-operator'), join(EXP, 'partitions/discovery/site/ops'), join(ROOT, 'docs/ops'), join(tmpdir(), 'x/site/ops')])
    assert.throws(() => safeDashboardDirV1(d), /refusing/, d);
  const rec = JSON.parse(readFileSync(join(PUB, 'REDACTION_RECORD.json'), 'utf8'));
  assert.deepEqual(rec.files.map((f: any) => sha(join(ROOT, f.file))), rec.files.map((f: any) => f.publishedSha256), 'no published P7 file changed');
});

// ---------------------------------------------------------------- 6. matched comparison plan
test('matched comparison: prepared, not executable; the arms share one object and differ only in hypothesis feedback; spec hidden in both', () => {
  assert.equal(PLAN_V1.executable, false); assert.equal(PLAN_V1.gate, 'disabled'); assert.equal(PAID_RESEARCH_EXECUTION, 'disabled');
  assert.deepEqual([...MANIPULATED], ['hypothesisFeedback']);
  assert.deepEqual(unmatchedFactors(ARMS.control, ARMS.treatment), []);
  assert.equal(ARMS.control.shared, ARMS.treatment.shared, 'one shared object, not two copies');
  assert.deepEqual(Object.keys(ARMS.control).sort(), Object.keys(ARMS.treatment).sort());
  assert.equal(ARMS.control.hypothesisFeedback.shown, false); assert.equal(ARMS.treatment.hypothesisFeedback.shown, true);
  assert.deepEqual(unmatchedFactors(ARMS.control, { ...ARMS.treatment, shared: { ...SHARED, budgets: { ...SHARED.budgets, phase2: { ...SHARED.budgets.phase2, maxSteps: 41 } } } }), ['.shared.budgets.phase2.maxSteps'], 'a budget difference is detected');
  assert.deepEqual(unmatchedFactors(ARMS.control, { ...ARMS.treatment, shared: { ...SHARED, objectives: { ...SHARED.objectives, phase2: OBJECTIVE_PHASE_2 + ' ' } } }), ['.shared.objectives.phase2'], 'an objective difference is detected');
  assert.equal(SHARED.objectives.phase1Sha256, shaB(OBJECTIVE_PHASE_1)); assert.equal(SHARED.objectives.phase2Sha256, shaB(OBJECTIVE_PHASE_2));
  assert.equal(SHARED.specification.shownToAgent, false); assert.deepEqual([...SHARED.evidence.agentVisible], ['discovery']);
  for (const o of [OBJECTIVE_PHASE_1, OBJECTIVE_PHASE_2]) { assert.ok(!/specification|defect|bug/i.test(o)); for (const t of ruleTexts) assert.ok(!o.includes(t)); }
  assert.match(OBJECTIVE_PHASE_1, /structured representation/); assert.match(OBJECTIVE_PHASE_2, /revision\.html/);
  assert.ok(Object.isFrozen(SHARED) && Object.isFrozen(SHARED.budgets));
  assert.match(PLAN_V1.historicalBaseline.role, /not a matched control/);
  assert.deepEqual([...SHARED.operatorOutputs].length, 3);
});
