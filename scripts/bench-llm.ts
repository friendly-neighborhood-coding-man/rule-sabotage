/**
 * LLM provider/model benchmark (REAL API calls, synthetic game data only).
 *   npm run bench:llm
 * Runs the same 50-case suite as eval:openrouter (20 KO + 10 EN rules, 10 must-reject, 10 AI turns)
 * against NVIDIA and Groq models it can find, and optionally an OpenRouter baseline.
 *
 * Env:
 *   NVIDIA_API_KEY, NVIDIA_BASE_URL (default https://integrate.api.nvidia.com/v1)
 *   BENCH_MODELS=id1,id2       exact NVIDIA model ids (otherwise discovered from GET /models by name)
 *   GROQ_API_KEY, BENCH_GROQ_MODELS=id1,id2 (default: openai/gpt-oss-20b, openai/gpt-oss-120b, qwen/qwen3.8-27b)
 *   BENCH_INCLUDE_OPENROUTER=1 also run the current OPENROUTER_MODEL as a baseline
 *   BENCH_PROVIDERS=groq,nvidia,openrouter  limit which providers run
 *   Pacing per provider (ms between requests): BENCH_PACE_NVIDIA (1700 ≈ 35/min, under 40 RPM),
 *   BENCH_PACE_GROQ (2100 ≈ 28/min, under Groq's free 30 RPM), BENCH_PACE_OPENROUTER (1700)
 * The model's RAW answer is scored (before the deterministic policy and before any offline fallback),
 * so the numbers measure the model, not our safety net. Game logic is not changed by this script.
 * Writes evidence/llm-bench/bench-<ts>.json and .md.
 */
import { writeFile, mkdir } from 'node:fs/promises';
process.env.RULE_SABOTAGE_NO_LISTEN = '1';
process.env.KANE_REFEREE = 'off';
const { decideAI } = await import('../server/game.ts');
const { planTurn } = await import('../server/ai.ts');
const { chatJSON, stats, cooldownLeftMs, ProviderError, INTERPRET_SYSTEM, INTERPRET_SCHEMA, interpretUserPrompt, provider } = await import('../server/openrouter.ts');
const { parseModelInterpretation, offlineInterpret, sameEffect } = await import('../server/rules.ts');
const { init, applyPlacement, applyMove, endTurn, validatePlacement, validateMove } = await import('../server/engine.ts');
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
    const d = await decideAI(structuredClone(st));
    const fromModel = d.decision.source === 'openrouter';
    // Validate the returned action with the deterministic engine: placement legal, the model's own words
    // mean the planned effect (deterministic parser), and every move legal in sequence.
    let engineValid = fromModel, why = '';
    if (fromModel) {
      const sim = structuredClone(st);
      if (d.plan.placement) {
        const parsed = d.text ? offlineInterpret(d.text) : null;
        if (!parsed || parsed.status === 'reject' || !sameEffect(parsed.effect, d.plan.placement.effect)) { engineValid = false; why = `ruleText does not mean the planned effect: “${d.text}”`; }
        const c = validatePlacement(sim, 'ai', { ...d.plan.placement, text: d.text || 'x' });
        if (!c.ok) { engineValid = false; why ||= `placement: ${c.reason}`; } else applyPlacement(sim, 'ai', d.plan.placement);
      }
      for (const m of d.plan.moves) { if (sim.winner) break; const c = validateMove(sim, 'ai', m); if (!c.ok) { engineValid = false; why ||= `move: ${c.reason}`; break; } applyMove(sim, 'ai', m); }
    }
    ai.push({ seed: 5000 + i, ok: fromModel, engineValid, why, ms: d.decision.ms, chosen: d.decision.plan.chosen, ruleText: d.text, fallback: d.decision.fallbackReason });
    console.log(`${label}\tai\t${engineValid ? 'OK ' : 'BAD'}\t${d.decision.ms}ms\t${d.decision.fallbackReason ?? why ?? d.decision.plan.chosen}`);
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
    aiOk: ai.filter(a => a.ok).length, aiValid: ai.filter(a => a.engineValid).length, aiTotal: ai.length,
    aiP50ms: ai.map(a => a.ms).sort((a, b) => a - b)[Math.floor(ai.length / 2)] ?? null,
    fallbacks: rows.filter(r => !r.valid).length + ai.filter(a => !a.ok).length,
    p50ms: pct(0.5), p95ms: pct(0.95),
    retries: calls.filter(c => !c.ok && /retrying|structured output refused/.test(c.detail ?? '')).length,
    rateLimited: calls.filter(c => c.failure === 'rate_limited' && /HTTP 429/.test(c.detail ?? '')).length,
    timeouts: calls.filter(c => c.failure === 'timeout').length,
    emptyOrNonJSON: calls.filter(c => c.failure === 'invalid_reply' || c.failure === 'invalid_json').length,
    rateLimitWaits: counters.waits,
  };
  // Reliability score (stated up front, applied identically to every model).
  const score = 0.35 * (m.rawCorrect / rules) + 0.25 * (m.validJSON / rules) + 0.3 * (m.aiTotal ? m.aiValid / m.aiTotal : 0) + 0.1 * (1 - Math.min(1, (m.rateLimited + m.timeouts) / Math.max(1, m.requests)));
  return { ...m, score: Number(score.toFixed(3)), rows, ai, failures: calls.filter(c => !c.ok).map(c => ({ task: c.task, kind: c.failure, detail: c.detail })) };
}

const only = (process.env.BENCH_PROVIDERS || 'nvidia,groq,openrouter').split(',').map(x => x.trim());
const disc = only.includes('nvidia') ? await discover() : { found: [], missing: [], catalog: 0, note: 'NVIDIA skipped' };
console.log(`NVIDIA discovery: ${disc.note}`);
console.log(`NVIDIA found: ${disc.found.map(f => `${f.want} -> ${f.id}`).join('; ') || 'none'}; missing: ${disc.missing.join(', ') || 'none'}`);
const GROQ_WANTED = (process.env.BENCH_GROQ_MODELS || 'openai/gpt-oss-20b,openai/gpt-oss-120b,qwen/qwen3.8-27b').split(',').map(x => x.trim()).filter(Boolean);
const groq = { found: [] as string[], missing: [] as string[], note: '' };
if (only.includes('groq')) {
  if (!process.env.GROQ_API_KEY) { groq.missing = GROQ_WANTED; groq.note = 'GROQ_API_KEY not set'; }
  else try {
    const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` } });
    const ids: string[] = ((await r.json()) as { data?: { id: string }[] }).data?.map(m => m.id) ?? [];
    groq.found = GROQ_WANTED.filter(w => ids.includes(w)); groq.missing = GROQ_WANTED.filter(w => !ids.includes(w));
    groq.note = `catalog ${ids.length} models; related ids: ${ids.filter(i => /gpt-oss|qwen/i.test(i)).join(', ') || 'none'}`;
  } catch (e) { groq.missing = GROQ_WANTED; groq.note = `model list failed: ${(e as Error).message}`; }
}
console.log(`Groq discovery: ${groq.note || 'skipped'}`);
console.log(`Groq found: ${groq.found.join(', ') || 'none'}; missing: ${groq.missing.join(', ') || 'none'}`);
const pace = (p: string, d: number) => { process.env.LLM_MIN_INTERVAL_MS = process.env[`BENCH_PACE_${p.toUpperCase()}`] || String(d); };
const results: any[] = [];
for (const f of disc.found) {
  process.env.LLM_PROVIDER = 'nvidia'; process.env.NVIDIA_MODEL = f.id; pace('nvidia', 1700);
  results.push({ want: f.want, pacingMs: Number(process.env.LLM_MIN_INTERVAL_MS), ...(await runModel(f.id)) });
}
for (const id of groq.found) {
  process.env.LLM_PROVIDER = 'groq'; process.env.GROQ_MODEL = id; pace('groq', 2100);
  results.push({ want: id, pacingMs: Number(process.env.LLM_MIN_INTERVAL_MS), ...(await runModel(`groq:${id}`)) });
}
if (only.includes('openrouter') && process.env.BENCH_INCLUDE_OPENROUTER === '1' && process.env.OPENROUTER_API_KEY) {
  process.env.LLM_PROVIDER = 'openrouter'; pace('openrouter', 1700);
  results.push({ want: 'OpenRouter baseline', pacingMs: Number(process.env.LLM_MIN_INTERVAL_MS), ...(await runModel(`openrouter:${process.env.OPENROUTER_MODEL || 'openrouter/free'}`)) });
}
results.sort((a, b) => b.score - a.score || b.aiValid - a.aiValid || (a.p50ms ?? 1e9) - (b.p50ms ?? 1e9));
const at = new Date().toISOString(), stamp = at.replace(/[:.]/g, '-');
await mkdir('evidence/llm-bench', { recursive: true });
const report = { at, discovery: { nvidia: disc, groq }, scoreFormula: '0.35·raw semantic correct + 0.25·valid JSON + 0.30·AI turns answered by the model AND engine-valid + 0.10·(1 − (429s + timeouts)/requests)', results };
await writeFile(`evidence/llm-bench/bench-${stamp}.json`, JSON.stringify(report, null, 2));
const md = [`# LLM benchmark ${at}`, '',
  'Synthetic game data only. Raw model answers are scored before policy and fallback. AI turns count only if the model answered AND the engine accepted the action.', '',
  `NVIDIA discovery: ${disc.note}. Missing: ${disc.missing.join(', ') || 'none'}.`, '',
  `Groq discovery: ${groq.note || 'skipped'}. Missing: ${groq.missing.join(', ') || 'none'}.`, '',
  `Score = ${report.scoreFormula}`, '',
  '| Rank | Provider | Model | Score | AI turns valid (answered) | AI p50 ms | Valid JSON | Raw correct (ko / en / reject) | p50 / p95 ms | Requests | Retries | 429s | Timeouts | Empty/non-JSON | Fallbacks /50 | Pacing |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...results.map((r, i) => `| ${i + 1} | ${r.provider} | \`${r.model}\` | ${r.score} | ${r.aiValid}/${r.aiTotal} (${r.aiOk}) | ${r.aiP50ms ?? '-'} | ${r.validJSON}/${r.rules} | ${r.rawCorrect}/${r.rules} (${r.bySet.ko} / ${r.bySet.en} / ${r.bySet.reject}) | ${r.p50ms ?? '-'} / ${r.p95ms ?? '-'} | ${r.requests} | ${r.retries} | ${r.rateLimited} | ${r.timeouts} | ${r.emptyOrNonJSON} | ${r.fallbacks} | ${r.pacingMs} ms |`),
  '', results.length ? `Most reliable by this measurement: \`${results[0].model}\`.` : 'No model could be run.', '',
  'Licensing: NVIDIA API-catalog trial endpoints are for evaluation; production use needs the appropriate NVIDIA license or a self-hosted NIM. Free-tier limits on any provider are not a production guarantee.',
].join('\n');
await writeFile(`evidence/llm-bench/bench-${stamp}.md`, md);
console.log('\n' + md);
process.exit(0);
