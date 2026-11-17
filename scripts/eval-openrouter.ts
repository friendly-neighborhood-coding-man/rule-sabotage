/**
 * Live OpenRouter evaluation (REAL API calls; needs OPENROUTER_API_KEY in .env).
 *   npm run eval:openrouter
 * Sealed set: 20 Korean + 10 English supported rules, 10 must-reject rules, 10 AI turns.
 * Writes evidence/openrouter/eval-<ts>.json and .md. Without a key it prints NOT_RUN and exits.
 */
import { writeFile, mkdir } from 'node:fs/promises';
process.env.RULE_SABOTAGE_NO_LISTEN = '1';
process.env.KANE_REFEREE = 'off';
const { interpretRule, decideAI } = await import('../server/game.ts');
const { planTurn } = await import('../server/ai.ts');
const { modelConfigured, modelName, providerLabel, stats } = await import('../server/openrouter.ts');
const { init, applyPlacement, applyMove, endTurn } = await import('../server/engine.ts');

if (!modelConfigured()) { console.log('NOT_RUN: no LLM provider key set (OPENROUTER_API_KEY or NVIDIA_API_KEY)'); process.exit(0); }
const { KO, EN, BAD } = await import('./llm-cases.ts');
const label = (i: any) => i.status === 'reject' ? 'reject' : `${i.effect.kind === 'shove' ? `shove-${i.effect.dir}-${i.effect.amount}` : i.effect.kind}${i.status === 'approximate' ? '~' : ''}`;
const rows: any[] = [];
for (const [set, cases] of [['ko', KO], ['en', EN], ['reject', BAD]] as const) {
  for (const c of cases) {
    const t0 = Date.now();
    const r = await interpretRule(c.text);
    const got = label(r.interpretation);
    const live = r.interpretation.source === 'openrouter';
    const inputGuard = r.interpretation.source === 'input-guard';
    rows.push({ set, text: c.text, expect: c.expect, got, source: r.interpretation.source, live, pass: got === c.expect, fallback: r.fallback, ms: Date.now() - t0, note: r.interpretation.status === 'reject' ? r.interpretation.reason : r.interpretation.note });
    console.log(`${set}\t${got === c.expect ? 'PASS' : 'FAIL'}\t${live ? 'model' : inputGuard ? 'guard' : 'FALLBACK'}\t${Date.now() - t0}ms\t${c.text} -> ${got} (want ${c.expect})`);
    await new Promise(res => setTimeout(res, 1200)); // stay gentle on free-tier limits
  }
}
// AI decisions on 10 different positions
const ai: any[] = [];
for (let i = 0; i < 10; i++) {
  // Reach varied positions by letting the planner play a few turns for both sides.
  const st = init(5000 + i);
  for (let k = 0; k < (i % 4) * 2 && !st.winner; k++) {
    const p = planTurn(st, { me: st.current }).chosen;
    if (p.placement) applyPlacement(st, st.current, p.placement);
    for (const m of p.moves) { if (st.winner) break; try { applyMove(st, st.current, m); } catch { break; } }
    if (!st.winner) endTurn(st);
  }
  if (st.winner) continue;
  if (st.current !== 'ai') { endTurn(st); }
  const d = await decideAI(st);
  const dd = d.decision;
  ai.push({ seed: 5000 + i, source: dd.source, model: dd.model, fallback: dd.fallbackReason, chosen: dd.plan.chosen, score: dd.plan.score, taunt: dd.taunt, rationale: dd.rationale, ruleText: d.text, ms: dd.ms });
  console.log(`ai\t${dd.source}\t${dd.ms}ms\t${dd.plan.chosen}\t${dd.fallbackReason ?? ''}`);
  await new Promise(res => setTimeout(res, 1500));
}
void init;
const sum = (set: string) => { const r = rows.filter(x => x.set === set); return { n: r.length, pass: r.filter(x => x.pass).length, live: r.filter(x => x.live).length, fallback: r.filter(x => x.fallback).length, medianMs: r.map(x => x.ms).sort((a, b) => a - b)[Math.floor(r.length / 2)] }; };
const calls = stats.length, failures = stats.filter(s => !s.ok);
const report = { at: new Date().toISOString(), provider: providerLabel(), model: modelName(), summary: { ko: sum('ko'), en: sum('en'), reject: sum('reject'), ai: { n: ai.length, openrouter: ai.filter(a => a.source === 'openrouter').length, medianMs: ai.map(a => a.ms).sort((a, b) => a - b)[Math.floor(ai.length / 2)] } }, calls, failures: failures.map(f => ({ task: f.task, kind: f.failure, detail: f.detail })), rows, ai };
await mkdir('evidence/openrouter', { recursive: true });
const stamp = report.at.replace(/[:.]/g, '-');
await writeFile(`evidence/openrouter/eval-${stamp}.json`, JSON.stringify(report, null, 2));
const md = [`# Live LLM evaluation ${report.at}`, '', `Provider: ${report.provider} · Model: \`${report.model}\` · API calls: ${calls} · failed calls: ${failures.length}`, '',
  '| Set | Cases | Correct | Answered by model | Fell back | Median latency |', '|---|---|---|---|---|---|',
  ...(['ko', 'en', 'reject'] as const).map(k => { const s = report.summary[k]; return `| ${k} | ${s.n} | ${s.pass} | ${s.live} | ${s.fallback} | ${s.medianMs} ms |`; }),
  `| AI turns | ${ai.length} | n/a | ${report.summary.ai.openrouter} | ${ai.length - report.summary.ai.openrouter} | ${report.summary.ai.medianMs} ms |`, '',
  '## Rows', '', '| Set | Input | Expected | Got | Source | ms |', '|---|---|---|---|---|---|',
  ...rows.map(r => `| ${r.set} | ${r.text.replace(/\|/g, '/')} | ${r.expect} | ${r.got}${r.pass ? '' : ' ❌'} | ${r.source}${r.fallback ? ' (fallback)' : ''} | ${r.ms} |`),
  '', '## AI turns', '', '| Seed | Source | Chose | ms | Fallback |', '|---|---|---|---|---|',
  ...ai.map(a => `| ${a.seed} | ${a.source} | ${a.chosen} | ${a.ms} | ${a.fallback ?? ''} |`)].join('\n');
await writeFile(`evidence/openrouter/eval-${stamp}.md`, md);
console.log('\n' + md.split('## Rows')[0]);
process.exit(0);
