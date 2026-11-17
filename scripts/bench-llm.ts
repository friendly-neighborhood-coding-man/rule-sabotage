/**
 * LLM provider/model benchmark (REAL API calls, synthetic game data only).
 *   npm run bench:llm
 * Runs the same 50-case suite as eval:openrouter (20 KO + 10 EN rules, 10 must-reject, 10 AI turns)
 * against each NVIDIA model it can find, and optionally an OpenRouter baseline.
 *
 * Env:
 *   NVIDIA_API_KEY (required for NVIDIA rows), NVIDIA_BASE_URL (default https://integrate.api.nvidia.com/v1)
 *   BENCH_MODELS=id1,id2     exact NVIDIA model ids (otherwise discovered from GET /models by name)
 *   BENCH_INCLUDE_OPENROUTER=1  also run the current OPENROUTER_MODEL as a baseline
 *   LLM_MIN_INTERVAL_MS      request pacing (default here: 1700 ms ≈ 35 requests/min, under a 40 RPM limit)
 * The model's RAW answer is scored (before the deterministic policy and before any offline fallback),
 * so the numbers measure the model, not our safety net. Game logic is not changed by this script.
 * Writes evidence/llm-bench/bench-<ts>.json and .md.
 */
import { writeFile, mkdir } from 'node:fs/promises';
process.env.RULE_SABOTAGE_NO_LISTEN = '1';
process.env.KANE_REFEREE = 'off';
process.env.LLM_MIN_INTERVAL_MS ||= '1700';
const { decideAI } = await import('../server/game.ts');
const { planTurn } = await import('../server/ai.ts');
const { chatJSON, stats, cooldownLeftMs, ProviderError, INTERPRET_SYSTEM, INTERPRET_SCHEMA, interpretUserPrompt, provider } = await import('../server/openrouter.ts');
const { parseModelInterpretation } = await import('../server/rules.ts');
const { init, applyPlacement, applyMove, endTurn } = await import('../server/engine.ts');
const { KO, EN, BAD } = await import('./llm-cases.ts');

const WANTED: [string, RegExp][] = [
  ['Nemotron 3.5 Bolt E4B', /nemotron.*(3[._-]?5).*bolt|nemotron.*bolt.*e4b|bolt.*e4b/i],
  ['Mistral Large 4', /mistral.*large.*\b4\b|mistral-large-4|mistral.*large[-_]?4/i],
  ['MiniMax M3.1 Flash', /minimax.*m3[._-]?1.*flash|minimax-m3\.1/i],
];
const nvBase = (process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1').replace(/\/+$/, '');

async function discover(): Promise<{ found: { want: string; id: string }[]; missing: string[]; catalog: number; note: string }> {
  if (process.env.BENCH_MODELS) {
    const ids = process.env.BENCH_MODELS.split(',').map(x => x.trim()).filter(Boolean);
    return { found: ids.map(id => ({ want: WANTED.find(([, re]) => re.test(id))?.[0] ?? 'manual', id })), missing: [], catalog: -1, note: 'BENCH_MODELS given' };
  }
  if (!process.env.NVIDIA_API_KEY) return { found: [], missing: WANTED.map(w => w[0]), catalog: 0, note: 'NVIDIA_API_KEY not set' };
  try {
    const r = await fetch(`${nvBase}/models`, { headers: { Authorization: `Bearer ${process.env.NVIDIA_API_KEY}` } });
    const ids: string[] = ((await r.json()) as { data?: { id: string }[] }).data?.map(m => m.id) ?? [];
    const found: { want: string; id: string }[] = [], missing: string[] = [];
    for (const [want, re] of WANTED) { const id = ids.find(i => re.test(i)); if (id) found.push({ want, id }); else missing.push(want); }
    // Show near misses so a renamed model can be picked by hand with BENCH_MODELS.
    const near = ids.filter(i => /nemotron|mistral-large|minimax/i.test(i)).slice(0, 25);
    return { found, missing, catalog: ids.length, note: `catalog ${ids.length} models; related ids: ${near.join(', ') || 'none'}` };
  } catch (e) { return { found: [], missing: WANTED.map(w => w[0]), catalog: 0, note: `model list failed: ${(e as Error).message}` }; }
}

const rawLabel = (v: any) => {
  if (!v || typeof v !== 'object') return 'invalid';
  if (v.status === 'reject') return 'reject';
  const k = v.kind === 'shove' ? `shove-${v.dir}-${v.amount}` : String(v.kind);
  return k + (v.status === 'approximate' ? '~' : '');
};
const pipeLabel = (i: any) => i.status === 'reject' ? 'reject' : `${i.effect.kind === 'shove' ? `shove-${i.effect.dir}-${i.effect.amount}` : i.effect.kind}${i.status === 'approximate' ? '~' : ''}`;

async function withRateLimitWait<T>(fn: () => Promise<T>, counters: { waits: number }): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof ProviderError && e.kind === 'rate_limited') { counters.waits++; await new Promise(r => setTimeout(r, cooldownLeftMs() + 500)); return fn(); }
    throw e;
  }
}

async function runModel(label: string) {
  const startIdx = stats.length, counters = { waits: 0 };
  const rows: any[] = [];
  for (const [set, cases] of [['ko', KO], ['en', EN], ['reject', BAD]] as const) {
    for (const c of cases) {
      const t0 = Date.now();
      let raw: unknown = null, err: string | null = null, valid = false, pipe = 'n/a';
      try {
        raw = await withRateLimitWait(() => chatJSON('interpret_rule', INTERPRET_SYSTEM, interpretUserPrompt(c.text), INTERPRET_SCHEMA, { temperature: 0, maxTokens: 200, timeoutMs: 30_000 }), counters);
        try { pipe = pipeLabel(parseModelInterpretation(raw, c.text)); valid = true; } catch (e) { err = `schema: ${(e as Error).message}`; }
      } catch (e) { err = e instanceof ProviderError ? `${e.kind}: ${e.message}` : String(e); }
      const got = valid ? rawLabel(raw) : 'invalid';
      rows.push({ set, text: c.text, expect: c.expect, raw: got, rawCorrect: got === c.expect, pipeline: pipe, pipelineCorrect: pipe === c.expect, valid, err, ms: Date.now() - t0 });
      console.log(`${label}\t${set}\t${got === c.expect ? 'OK ' : 'BAD'}\t${Date.now() - t0}ms\t${c.text} -> ${got}${err ? ` (${err.slice(0, 80)})` : ''}`);
    }
  }
  const ai: any[] = [];
  for (let i = 0; i < 10; i++) {
    const st = init(5000 + i);
    for (let k = 0; k < (i % 4) * 2 && !st.winner; k++) {
      const p = planTurn(st, { me: st.current }).chosen;
      if (p.placement) applyPlacement(st, st.current, p.placement);
      for (const m of p.moves) { if (st.winner) break; try { applyMove(st, st.current, m); } catch { break; } }
      if (!st.winner) endTurn(st);
    }
    if (st.winner) continue;
    if (st.current !== 'ai') endTurn(st);
    if (cooldownLeftMs()) { counters.waits++; await new Promise(r => setTimeout(r, cooldownLeftMs() + 500)); }
    const d = await decideAI(st);
    ai.push({ seed: 5000 + i, ok: d.decision.source === 'openrouter', ms: d.decision.ms, chosen: d.decision.plan.chosen, ruleText: d.text, fallback: d.decision.fallbackReason });
    console.log(`${label}\tai\t${d.decision.source === 'openrouter' ? 'OK ' : 'BAD'}\t${d.decision.ms}ms\t${d.decision.fallbackReason ?? d.decision.plan.chosen}`);
  }
  const calls = stats.slice(startIdx);
  const okCalls = calls.filter(c => c.ok).map(c => c.ms).sort((a, b) => a - b);
  const pct = (q: number) => okCalls.length ? okCalls[Math.min(okCalls.length - 1, Math.floor(q * okCalls.length))] : null;
  const rules = rows.length;
  const m = {
    label, provider: provider()?.label, model: provider()?.model,
    requests: calls.length, okRequests: okCalls.length,
    validJSON: rows.filter(r => r.valid).length, rules,
    rawCorrect: rows.filter(r => r.rawCorrect).length, pipelineCorrect: rows.filter(r => r.pipelineCorrect).length,
    bySet: Object.fromEntries((['ko', 'en', 'reject'] as const).map(k => [k, `${rows.filter(r => r.set === k && r.rawCorrect).length}/${rows.filter(r => r.set === k).length}`])),
    aiOk: ai.filter(a => a.ok).length, aiTotal: ai.length,
    p50ms: pct(0.5), p95ms: pct(0.95),
    retries: calls.filter(c => !c.ok && /retrying|structured output refused/.test(c.detail ?? '')).length,
    rateLimited: calls.filter(c => c.failure === 'rate_limited' && /HTTP 429/.test(c.detail ?? '')).length,
    timeouts: calls.filter(c => c.failure === 'timeout').length,
    emptyOrNonJSON: calls.filter(c => c.failure === 'invalid_reply' || c.failure === 'invalid_json').length,
    rateLimitWaits: counters.waits,
  };
  // Reliability score (stated up front, applied identically to every model).
  const score = 0.35 * (m.rawCorrect / rules) + 0.25 * (m.validJSON / rules) + 0.3 * (m.aiTotal ? m.aiOk / m.aiTotal : 0) + 0.1 * (1 - Math.min(1, (m.rateLimited + m.timeouts) / Math.max(1, m.requests)));
  return { ...m, score: Number(score.toFixed(3)), rows, ai, failures: calls.filter(c => !c.ok).map(c => ({ task: c.task, kind: c.failure, detail: c.detail })) };
}

const disc = await discover();
console.log(`Discovery: ${disc.note}`);
console.log(`Found: ${disc.found.map(f => `${f.want} -> ${f.id}`).join('; ') || 'none'}; missing: ${disc.missing.join(', ') || 'none'}`);
const results: any[] = [];
for (const f of disc.found) {
  process.env.LLM_PROVIDER = 'nvidia'; process.env.NVIDIA_MODEL = f.id;
  results.push({ want: f.want, ...(await runModel(f.id)) });
}
if (process.env.BENCH_INCLUDE_OPENROUTER === '1' && process.env.OPENROUTER_API_KEY) {
  process.env.LLM_PROVIDER = 'openrouter';
  results.push({ want: 'OpenRouter baseline', ...(await runModel(`openrouter:${process.env.OPENROUTER_MODEL || 'openrouter/free'}`)) });
}
results.sort((a, b) => b.score - a.score || (a.p50ms ?? 1e9) - (b.p50ms ?? 1e9));
const at = new Date().toISOString(), stamp = at.replace(/[:.]/g, '-');
await mkdir('evidence/llm-bench', { recursive: true });
const report = { at, pacingMs: Number(process.env.LLM_MIN_INTERVAL_MS), discovery: disc, scoreFormula: '0.35·raw semantic correct + 0.25·valid JSON + 0.30·AI turns answered by the model + 0.10·(1 − (429s + timeouts)/requests)', results };
await writeFile(`evidence/llm-bench/bench-${stamp}.json`, JSON.stringify(report, null, 2));
const md = [`# LLM benchmark ${at}`, '',
  `Synthetic game data only. Pacing ${report.pacingMs} ms between requests. Raw model answers are scored before policy and fallback.`, '',
  `Discovery: ${disc.note}. Missing: ${disc.missing.join(', ') || 'none'}.`, '',
  `Score = ${report.scoreFormula}`, '',
  '| Rank | Wanted | Model | Score | Valid JSON | Raw correct (ko / en / reject) | AI turns OK | p50 / p95 ms | Requests | Retries | 429s | Timeouts | Empty/non-JSON |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...results.map((r, i) => `| ${i + 1} | ${r.want} | \`${r.model}\` | ${r.score} | ${r.validJSON}/${r.rules} | ${r.rawCorrect}/${r.rules} (${r.bySet.ko} / ${r.bySet.en} / ${r.bySet.reject}) | ${r.aiOk}/${r.aiTotal} | ${r.p50ms ?? '-'} / ${r.p95ms ?? '-'} | ${r.requests} | ${r.retries} | ${r.rateLimited} | ${r.timeouts} | ${r.emptyOrNonJSON} |`),
  '', results.length ? `Most reliable by this measurement: \`${results[0].model}\`.` : 'No model could be run.', '',
  'Licensing: NVIDIA API-catalog trial endpoints are for evaluation; production use needs the appropriate NVIDIA license or a self-hosted NIM.',
].join('\n');
await writeFile(`evidence/llm-bench/bench-${stamp}.md`, md);
console.log('\n' + md);
process.exit(0);
