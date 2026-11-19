/**
 * Balance Designer V3: static HTML for the 100-game screen (no scripts anywhere, so a browser agent reads it as is).
 *
 *  - replays/<gameId>.html   one page per game, rebuilt from the engine-verified record: the board at the start of
 *                            every turn, every candidate the planner ranked (chosen one marked), every move and
 *                            the engine events it caused, the RNG value at each move.
 *  - dashboard/index.html    operator dashboard: per-condition comparison with 95% intervals, charts, findings.
 *  - dossier/*.html          Kane's research dossier: raw comparisons, trajectories, patterns, counterexamples,
 *                            limitations, V2 background (separate page), the questions, and the notebook form.
 *                            The dossier shows NO hypothesis and NO auto-written finding, so Kane is not anchored.
 */
import { type GameRec, type DetailTurn } from '../selfplay.ts';
import { cellName, SIZE } from '../../engine.ts';
import { type Analysis, type ConditionStats, type Derived, fmtRate } from './analysis.ts';
import { CATALOG, CAUSES, PROPOSAL_METRICS } from './proposals.ts';

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const cn = (k: string) => { try { return cellName(k); } catch { return k; } };
const CSS = `body{font:15px/1.45 system-ui,Segoe UI,sans-serif;margin:24px auto;max-width:1200px;padding:0 16px;color:#111;background:#fff}table{border-collapse:collapse;margin:8px 0 18px}td,th{border:1px solid #bbb;padding:3px 8px;text-align:left;font-size:14px;vertical-align:top}th{background:#eee}h2{margin-top:30px;border-bottom:2px solid #333}h3{margin-top:22px}.muted{color:#555}.box{border:2px solid #333;padding:12px;margin:14px 0}.warn{border-left:5px solid #b45309;background:#fff7ed;padding:8px 12px;margin:10px 0}.board td{width:30px;height:30px;text-align:center;padding:0;font:12px ui-monospace,monospace}.board .goalH{background:#e0f2fe}.board .goalA{background:#fee2e2}.h{color:#1d4ed8;font-weight:700}.a{color:#b91c1c;font-weight:700}.fx{background:#fef9c3}.chosen{background:#dcfce7}nav a{margin-right:14px}label{display:block;margin-top:8px;font-weight:600}textarea,select,input[type=text],input[type=number]{width:100%;max-width:900px;font:14px system-ui}code{background:#f3f3f3;padding:0 3px}`;
export const page = (title: string, body: string, nav = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>${nav}${body}</body></html>`;
export const table = (caption: string, head: string[], rows: (string | number | null | undefined)[][], raw = false) => `${caption ? `<h3>${esc(caption)}</h3>` : ''}<table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${raw ? (c ?? '—') : esc(c ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const pc = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`);
const ci = (c: [number, number]) => `${pc(c[0])}–${pc(c[1])}`;
const link = (id: string, prefix: string) => `<a href="${prefix}replays/${esc(id)}.html">${esc(id)}</a>`;

// ---------------------------------------------------------------- replay pages
function boardHtml(t: DetailTurn) {
  const at = new Map<string, string[]>(), fx = new Map<string, string>();
  for (const s of t.board.pieces) { const m = /^([ha]\d+)@(\d+),(\d+)(s?)(?:f(\d+))?(\+?)$/.exec(s); if (!m || m[4]) continue; const k = `${m[2]},${m[3]}`; at.set(k, [...(at.get(k) ?? []), `${m[1]}${m[5] ? '*' : ''}${m[6]}`]); }
  for (const c of t.board.cells) { const [k, rest] = c.split('='); fx.set(k, rest); }
  let h = '<table class="board"><tbody><tr><td></td>' + 'ABCDEFG'.split('').map(c => `<td><b>${c}</b></td>`).join('') + '</tr>';
  for (let y = 0; y < SIZE; y++) {
    h += `<tr><td><b>${y + 1}</b></td>`;
    for (let x = 0; x < SIZE; x++) {
      const k = `${x},${y}`, ps = at.get(k) ?? [], f = fx.get(k);
      const cls = [x === SIZE - 1 ? 'goalH' : x === 0 ? 'goalA' : '', f ? 'fx' : ''].filter(Boolean).join(' ');
      const title = `${cn(k)}${f ? ` effect ${f}` : ''}`;
      h += `<td class="${cls}" title="${esc(title)}">${ps.map(p => `<span class="${p[0]}">${esc(p)}</span>`).join(' ')}${!ps.length && f ? esc(f.split(':')[0].slice(0, 2) + (f.endsWith(':human') ? 'ʰ' : 'ᵃ')) : ''}</td>`;
    }
    h += '</tr>';
  }
  return h + '</tbody></table>';
}
const evText = (e: { t: string; [k: string]: unknown }) => {
  switch (e.t) {
    case 'move': return `${e.p} moves ${(e.pieces as string[]).join('+')} ${cn(e.from as string)}→${cn(e.to as string)}`;
    case 'trigger': return `${(e.pieces as string[]).join('+')} (${e.p}) triggers ${e.label} owned by ${e.owner} at ${cn(e.cell as string)}${e.self ? ' [own trap]' : ''}${(e.chain as number) > 1 ? ` chain ${e.chain}` : ''}`;
    case 'forced': return `${(e.pieces as string[]).join('+')} ${e.how} ${cn(e.from as string)}→${String(e.to).split('|').map(cn).join('|')}`;
    case 'capture': return `${e.by} captures ${(e.pieces as string[]).join('+')} at ${cn(e.cell as string)}`;
    case 'score': return `${e.p} scores ${(e.pieces as string[]).join('+')} (total ${e.total})`;
    case 'stack': return `${e.p} stacks ${(e.pieces as string[]).join('+')}`;
    case 'status': return `${(e.pieces as string[]).join('+')} ${e.status}`;
    case 'haste': return `${e.p} gains an action${e.now ? ' now' : ' next turn'}`;
    case 'shielded': return `${(e.pieces as string[]).join('+')} shield absorbs ${cn(e.cell as string)}`;
    case 'place': return `${e.p} places ${e.label} on ${(e.cells as string[]).map(cn).join(' ')}${(e.replaced as string[]).length ? ` (replacing ${(e.replaced as string[]).map(cn).join(' ')})` : ''}`;
    case 'remove': return `${e.p} removes own effects on ${(e.cells as string[]).map(cn).join(' ')}`;
    case 'win': return `GAME OVER: ${e.winner}, ${e.reason}`;
    case 'chain-limit': return `chain limit at ${cn(e.cell as string)}`;
    default: return e.t;
  }
};
export function replayPage(r: GameRec, d: Derived, verified: { ok: boolean; problems: string[] }, prefix = '../') {
  const det = r.detail!;
  const head = `<h1>Replay ${esc(d.gameId)}</h1>
<p>Seed <b>${r.seed}</b> · condition <b>${esc(d.condition)}</b> · first mover <b>${esc(r.first)}</b> with ${d.count[r.first]} pieces, second mover <b>${esc(d.second)}</b> with ${d.count[d.second]} · layout ${esc(r.start?.layout ?? 'production')} · home rows human ${esc((r.start?.rows.human ?? [1, 3, 5]).map(y => y + 1).join(','))}, AI ${esc((r.start?.rows.ai ?? [1, 3, 5]).map(y => y + 1).join(','))}</p>
<p>Result: <b>${esc(r.winner)}</b> (${esc(d.winnerRole)} mover) after ${r.turns} turns. ${esc(r.reason)}</p>
<p>Engine replay check: <b>${verified.ok ? 'PASS' : 'FAIL'}</b> (every recorded placement and move re-executed by the real engine without the planner; events, RNG and final state hash ${verified.ok ? 'identical' : `differ: ${esc(verified.problems.join('; '))}`}). Final state hash <code>${esc(det.finalHash)}</code>.</p>
<p class="muted">Board: column A (left) is the Human home and the AI goal, column G (right) the AI home and the Human goal. <span class="h">h1</span> = Human piece, <span class="a">a1</span> = AI piece, * = frozen, + = shield, yellow = live effect (hover for the effect and its owner).</p>
${table('Per-game measures', ['Measure', 'Value'], [
    ['Triggers (own trap / opponent trap)', `${d.triggers} (${d.selfTriggers} / ${d.oppTriggers})`],
    ['Conveyor moves (own trap carried the piece forward)', `${d.conveyorTriggers}, squares gained human ${d.conveyorSquares.human}, AI ${d.conveyorSquares.ai}`],
    ['Forced forward squares (all traps)', `human ${d.forcedForward.human}, AI ${d.forcedForward.ai}`],
    ['Placements, cells placed, cells never triggered', `${d.placements}, ${d.placedCells}, ${d.unusedCells}`],
    ['Lead changes · winner came back from behind', `${d.leadChanges} · ${d.comeback ? 'yes' : 'no'}`],
    ['Mean actions per turn (first / second mover)', `${d.actionsPerTurn.first} / ${d.actionsPerTurn.second}`],
    ['Planner: mean score gap rank 1 vs 2 · near-tie turns · turns not taking rank 1', `${d.decision.meanMargin ?? '—'} · ${pc(d.decision.nearTieShare)} · ${pc(d.decision.notTopShare)}`],
    ['Teleports (turn, RNG before the move, destination)', d.teleports.map(t => `t${t.turn} rng ${t.rngBefore} → ${cn(t.to)}`).join('; ') || 'none'],
  ])}`;
  const turns = det.turns.map(t => {
    const cands = table('', ['Rank', 'Candidate (placement + greedy moves)', 'Score', ''], t.candidates.slice(0, 6).map((c, i) => [i + 1, c.summary, c.score, c.id === t.chosen ? 'CHOSEN' : '']));
    const evs = [...(t.placement?.events ?? []), ...t.moves.flatMap(m => m.events), ...t.endEvents.filter(e => e.t === 'win')].map(e => `<li>${esc(evText(e as never))}</li>`).join('');
    return `<h3 id="t${t.turn}">Turn ${t.turn}: ${esc(t.p)} · ${t.actions} action(s) · rng ${t.rngStart}</h3>${boardHtml(t)}
<p>${t.considered} placement variants considered, ${t.sims} simulations. ${t.candidates.length > 6 ? `Top 6 of ${t.candidates.length} shown.` : ''}${t.chosen !== t.candidates[0]?.id ? ' The planner did NOT take rank 1 (temperature sampling among near-equal plans).' : ''}</p>${cands}
<ul>${evs || '<li>no moves</li>'}</ul>${t.unused ? `<p class="muted">${t.unused} action(s) unused.</p>` : ''}`;
  }).join('');
  return page(`Replay ${d.gameId}`, head + turns, `<nav><a href="${prefix}dossier/index.html">Dossier</a><a href="${prefix}dashboard/index.html">Dashboard</a><a href="${prefix}dossier/games.html">All games</a></nav>`);
}

// ---------------------------------------------------------------- shared comparison tables
function comparisonTables(a: Analysis, prefix: string) {
  const C = a.conditions;
  const rows = (f: (c: ConditionStats) => string | number | null) => C.map(f);
  const t1 = table('Outcome by starting condition (decisive games; 95% Wilson intervals; exact p against 50%)', ['Measure', ...C.map(c => `${c.id} ${c.pieces?.firstMover}/${c.pieces?.secondMover}`)], [
    ['Games · decisive · draws', ...rows(c => `${c.games} · ${c.decisive} · ${c.draws}`)],
    ['First mover won', ...rows(c => `${c.firstMover.k}/${c.firstMover.n} = ${pc(c.firstMover.rate)}`)],
    ['  95% interval', ...rows(c => ci(c.firstMover.ci95))],
    ['  exact p vs 50%', ...rows(c => c.firstMover.pVsHalf)],
    ['Human side won', ...rows(c => `${c.humanSide.k}/${c.humanSide.n} = ${pc(c.humanSide.rate)} (${ci(c.humanSide.ci95)})`)],
    ['Side with more pieces won', ...rows(c => (c.sideWithMorePieces ? `${c.sideWithMorePieces.k}/${c.sideWithMorePieces.n} (${ci(c.sideWithMorePieces.ci95)})` : 'equal counts'))],
    ['Completed (all pieces across) · turn limit', ...rows(c => `${pc(c.completionRate)} · ${pc(c.turnLimitRate)}`)],
    ['Turns: mean (95% CI)', ...rows(c => `${c.turns.mean} (${c.turns.ci[0]}–${c.turns.ci[1]})`)],
    ['Turns: median [p10, p90] · range', ...rows(c => `${c.turns.median} [${c.turns.p10}, ${c.turns.p90}] · ${c.turns.min}–${c.turns.max}`)],
    ['First score at turn (first / second mover)', ...rows(c => `${c.firstScoreTurn.firstMover} / ${c.firstScoreTurn.secondMover}`)],
    ['Actions per turn (first / second mover)', ...rows(c => `${c.actions.perTurnFirst} / ${c.actions.perTurnSecond}`)],
  ]);
  const t2 = table('Behaviour by starting condition (per game means)', ['Measure', ...C.map(c => c.id)], [
    ['Trap triggers (own / opponent trap)', ...rows(c => `${c.triggersPerGame} (${c.selfTriggersPerGame} / ${c.oppTriggersPerGame})`)],
    ['Share of triggers on own traps', ...rows(c => pc(c.selfTriggerShare))],
    ['Conveyor moves · squares gained', ...rows(c => `${c.conveyor.triggersPerGame} · ${c.conveyor.squaresPerGame}`)],
    ['Games with any conveyor move', ...rows(c => `${c.conveyor.gamesWithAny}/${c.games}`)],
    ['Side with more conveyor squares won', ...rows(c => `${c.conveyor.moreConveyorSideWins.k}/${c.conveyor.moreConveyorSideWins.n}`)],
    ['Forced forward / backward squares', ...rows(c => `${c.acceleration.forcedForwardPerGame} / ${c.acceleration.forcedBackPerGame}`)],
    ['  forward by shove · teleport · home', ...rows(c => `${c.acceleration.byKind.shove} · ${c.acceleration.byKind.teleport} · ${c.acceleration.byKind.home}`)],
    ['Share of journey covered by forced moves', ...rows(c => pc(c.acceleration.journeyShareCoveredByForcedMoves))],
    ['Placements per game · cells never triggered', ...rows(c => `${c.placements.perGame} · ${pc(c.placements.unusedCellRate)}`)],
    ['Turns without a placement', ...rows(c => pc(c.placements.noPlacementTurnShare))],
    ['Effect diversity (normalized entropy) · distinct openings', ...rows(c => `${c.diversity.effectEntropyNorm} · ${c.diversity.distinctOpenings}`)],
    ['Most common opening (share of sides)', ...rows(c => `${c.diversity.topOpening} (${pc(c.diversity.topOpeningShare)})`)],
    ['Lead changes per game · comeback rate', ...rows(c => `${c.counterplay.leadChangesPerGame} · ${pc(c.counterplay.comebackRate)}`)],
    ['Planner: score gap rank 1–2 · near-tie turns · not rank 1', ...rows(c => `${c.decision.meanMargin} · ${pc(c.decision.nearTieShare)} · ${pc(c.decision.notTopShare)}`)],
    ['Illegal · errors · softlocks', ...rows(c => `${c.safety.illegal} · ${c.safety.errors} · ${c.safety.softlocks}`)],
  ]);
  const t3 = table(`Paired comparison with ${C[0].id} (same seed, same first mover)`, ['Condition', 'First-mover result flipped toward / away', 'Exact sign test p', 'Same winner role as reference', 'Never diverged from reference RNG', 'Median first divergent turn'],
    C.slice(1).map(c => [c.id, `${a.paired[c.id].plus} / ${a.paired[c.id].minus}`, a.paired[c.id].p, `${a.divergence[c.id].sameWinnerRoleAsReference}/${a.divergence[c.id].of}`, `${a.divergence[c.id].neverDiverged}/${a.divergence[c.id].of}`, a.divergence[c.id].medianDivergentTurn]));
  const t4 = C.map(c => table(`${c.id}: effects (placements, share, triggers, own-trap share of triggers, cells never triggered, win rate of the side that used it)`, ['Effect', 'Placements', 'Share', 'Triggers', 'Own-trap', 'Never triggered', 'Win rate when used'], c.effects.map(e => [e.effect, e.placements, pc(e.share), e.triggers, pc(e.selfTriggerRate), pc(e.unusedRate), pc(e.winRateWhenUsed)]))).join('');
  const t5 = table('Most frequent trap combinations (same side, same game) with that side’s win rate', ['Condition', 'Combination', 'Games', 'Win rate'], C.flatMap(c => c.combos.slice(0, 4).map(x => [c.id, x.combo, x.games, pc(x.winRate)])));
  void prefix;
  return { t1, t2, t3, t4, t5 };
}
function ciChart(a: Analysis, pick: (c: ConditionStats) => { rate: number | null; ci95: [number, number] }, title: string) {
  const W = 640, H = 40 + a.conditions.length * 34, x = (v: number) => 120 + v * (W - 160);
  const bars = a.conditions.map((c, i) => { const r = pick(c), y = 30 + i * 34; return `<text x="8" y="${y + 5}" font-size="13">${esc(c.id)} ${c.pieces?.firstMover}/${c.pieces?.secondMover}</text><line x1="${x(r.ci95[0])}" x2="${x(r.ci95[1])}" y1="${y}" y2="${y}" stroke="#1d4ed8" stroke-width="4"/>${r.rate === null ? '' : `<circle cx="${x(r.rate)}" cy="${y}" r="6" fill="#111"/><text x="${x(r.ci95[1]) + 8}" y="${y + 5}" font-size="12">${pc(r.rate)}</text>`}`; }).join('');
  return `<h3>${esc(title)}</h3><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(title)}"><line x1="${x(0.5)}" x2="${x(0.5)}" y1="12" y2="${H - 10}" stroke="#b45309" stroke-dasharray="4 3"/><text x="${x(0.5) - 14}" y="10" font-size="11">50%</text><text x="${x(0) - 6}" y="${H - 2}" font-size="11">0%</text><text x="${x(1) - 16}" y="${H - 2}" font-size="11">100%</text>${bars}</svg>`;
}
function lengthChart(a: Analysis) {
  const max = Math.max(...a.games.map(g => g.turns)), W = 640, H = 40 + a.conditions.length * 34, x = (v: number) => 120 + v / max * (W - 160);
  const rows = a.conditions.map((c, i) => { const y = 30 + i * 34; const dots = a.games.filter(g => g.condition === c.id).map((g, j) => `<circle cx="${x(g.turns)}" cy="${y + ((j % 5) - 2) * 3}" r="3" fill="${g.winnerRole === 'first' ? '#1d4ed8' : g.winnerRole === 'second' ? '#b91c1c' : '#666'}" opacity="0.75"><title>${esc(g.gameId)}: ${g.turns} turns, ${g.winnerRole} mover won</title></circle>`).join(''); return `<text x="8" y="${y + 5}" font-size="13">${esc(c.id)}</text>${dots}<line x1="${x(c.turns.mean)}" x2="${x(c.turns.mean)}" y1="${y - 12}" y2="${y + 12}" stroke="#111" stroke-width="2"/>`; }).join('');
  return `<h3>Game length per game (blue = first mover won, red = second mover won, bar = mean)</h3><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Game length per condition">${rows}<text x="${x(0)}" y="${H - 2}" font-size="11">0</text><text x="${x(max) - 20}" y="${H - 2}" font-size="11">${max} turns</text></svg>`;
}

// ---------------------------------------------------------------- operator dashboard
export function dashboardPage(a: Analysis, run: { runId: string; games: number; externalCalls: number; replayOk: number; wallMs: number; datasetHash: string }, picks: Record<string, string[]>) {
  const { t1, t2, t3, t4, t5 } = comparisonTables(a, '../');
  const body = `<h1>Balance Designer V3: ${run.games}-game starting-condition screen</h1>
<div class="warn"><b>Exploratory screen.</b> ${a.conditions[0]?.games ?? 0} games per condition. Intervals are wide; a 95% interval of about ±20 points is normal here, and only a first-mover share of 75% or more would reject 50/50 for one condition. Nothing on this page is a promotion decision.</div>
<p>Run <code>${esc(run.runId)}</code> · ${run.games} games · external model/API calls during play: <b>${run.externalCalls}</b> · Kane credits: <b>0</b> · engine replay check ${run.replayOk}/${run.games} · wall time ${(run.wallMs / 60000).toFixed(1)} min · dataset hash <code>${esc(run.datasetHash)}</code></p>
${ciChart(a, c => c.firstMover, 'First-mover win rate with 95% interval')}${ciChart(a, c => c.humanSide, 'Human-side (left-to-right) win rate with 95% interval')}${lengthChart(a)}
${t1}${t3}
<h2>Findings (auto-written, cautious)</h2><ul>${a.findings.map(f => `<li><b>${f.kind}</b> ${esc(f.text)}</li>`).join('')}</ul>
<p>Permutation test across conditions: ${a.heterogeneity.firstMoverWinRateAcrossConditions ? `statistic ${a.heterogeneity.firstMoverWinRateAcrossConditions.stat}, p = ${a.heterogeneity.firstMoverWinRateAcrossConditions.p}` : 'n/a'}. Overall first mover: ${esc(fmtRate(a.overall.firstMover))}.</p>
<h2>Behaviour</h2>${t2}${t5}${t4}
<h2>Replays</h2>${table('Example and counterexample per condition', ['Condition', 'Games'], Object.entries(picks).map(([k, ids]) => [k, ids.map(id => link(id, '../')).join(' ')]), true)}
<p><a href="../dossier/games.html">All 100 games</a> · <a href="../dossier/index.html">Kane research dossier</a></p>`;
  return page('V3 screen dashboard', body);
}

// ---------------------------------------------------------------- Kane dossier
const NAV = `<nav><a href="index.html">Overview</a><a href="conditions.html">Conditions</a><a href="trajectories.html">Trajectories</a><a href="patterns.html">Patterns</a><a href="counterexamples.html">Counterexamples</a><a href="games.html">All games</a><a href="limitations.html">Limitations</a><a href="v2-background.html">V2 background</a><a href="catalog.html">Experiment catalog</a><a href="notebook.html">Notebook</a></nav>`;
export const QUESTIONS = [
  'Is the observed first-mover / second-mover imbalance reproducible, or could it be chance at this sample size?',
  'Does the initial piece count meaningfully affect fairness?',
  'Are conveyor-belt strategies (stepping on your own trap to be carried forward) legitimate play, or do they cause a measurable gameplay problem?',
  'Can an initial-rule modification improve balance without reducing strategic quality?',
  'Which competing explanation best fits the observations (the planner, the starting rules, or their interaction)?',
  'Which experiment would distinguish those explanations?',
  'What evidence might disprove your preferred explanation?',
];
export function dossierPages(a: Analysis, o: { runId: string; datasetHash: string; trajectories: { title: string; why: string; ids: string[] }[]; counterexamples: { claim: string; ids: string[] }[]; v2: string; formAction: string; nonce: string }) {
  const { t1, t2, t3, t4, t5 } = comparisonTables(a, '../');
  const pages: Record<string, string> = {};
  pages['index.html'] = page('V3 research dossier', `<h1>Research dossier: ${a.overall.games} self-play games under five starting conditions</h1>
<p>Dataset <code>${esc(o.runId)}</code>, content hash <code>${esc(o.datasetHash)}</code>. Every game was played by the real game engine with the same local planner on both sides; no model was involved in any move.</p>
<div class="box"><h2 style="margin-top:0">What you are asked</h2><ol>${QUESTIONS.map(q => `<li>${esc(q)}</li>`).join('')}</ol>
<p>You may conclude that <b>no change is justified</b>. Base every claim on specific games (use the game ids, e.g. <code>C3-62004-ai</code>). Record each explanation in the <a href="notebook.html">notebook</a>: one submission per competing hypothesis, then one final conclusion.</p></div>
<h2>The five conditions</h2>${table('', ['Condition', 'First mover pieces', 'Second mover pieces', 'Games'], a.conditions.map(c => [c.id, c.pieces?.firstMover, c.pieces?.secondMover, c.games]))}
<p>Rules that are the same everywhere: 7×7 board, actions per turn = own pieces still on the board (+ banked bonus), so <b>more pieces also means more actions and a bigger victory requirement</b>. A side wins at once when all of its own pieces are across. At the 60-turn limit the higher fraction of own pieces across wins, then the lower fraction of the remaining journey, then a draw. Each condition: seeds 62001–62010, each played with Human moving first and with AI moving first.</p>
<h2>Overall summary</h2>${table('', ['Measure', 'Value'], [['Games', a.overall.games], ['Decisive', a.overall.decisive], ['First mover won (pooled over different rules)', fmtRate(a.overall.firstMover)], ['Human side won', fmtRate(a.overall.humanSide)], ['Mean turns (95% CI)', `${a.overall.turns.mean} (${a.overall.turns.ci[0]}–${a.overall.turns.ci[1]})`], ['Turn-limit rate · draw rate', `${pc(a.overall.turnLimitRate)} · ${pc(a.overall.drawRate)}`], ['Illegal moves · engine errors · softlocks', `${a.overall.safety.illegal} · ${a.overall.safety.errors} · ${a.overall.safety.softlocks}`]])}
<p class="muted">Sample-size note: ${esc(a.power.perCondition.note)}</p>`, NAV);
  pages['conditions.html'] = page('Conditions', `<h1>Comparison across the five starting conditions</h1>${ciChart(a, c => c.firstMover, 'First-mover win rate with 95% interval')}${lengthChart(a)}${t1}${t3}<p>Permutation test of first-mover win rate across conditions: ${a.heterogeneity.firstMoverWinRateAcrossConditions ? `statistic ${a.heterogeneity.firstMoverWinRateAcrossConditions.stat}, p = ${a.heterogeneity.firstMoverWinRateAcrossConditions.p}` : 'n/a'} (${esc(a.heterogeneity.note)})</p>${t2}`, NAV);
  pages['trajectories.html'] = page('Trajectories', `<h1>Interesting and unusual game trajectories</h1><p>Selected by fixed rules (listed with each group), not by us judging what is interesting.</p>${o.trajectories.map(t => `<h3>${esc(t.title)}</h3><p class="muted">${esc(t.why)}</p><p>${t.ids.map(id => link(id, '../')).join(' ')}</p>`).join('')}`, NAV);
  pages['patterns.html'] = page('Patterns', `<h1>Repeated strategic patterns</h1>${table('Most common openings (first three trap placements of one side) per condition', ['Condition', 'Opening', 'Sides'], a.conditions.flatMap(c => c.topOpenings.map(x => [c.id, x.opening, x.sides])))}${t5}${t4}`, NAV);
  pages['counterexamples.html'] = page('Counterexamples', `<h1>Candidate counterexamples</h1><p>Games that go against the majority pattern of their condition. A single counterexample does not refute a tendency, but a hypothesis must be able to explain it.</p>${o.counterexamples.map(c => `<h3>${esc(c.claim)}</h3><p>${c.ids.length ? c.ids.map(id => link(id, '../')).join(' ') : 'none in this dataset'}</p>`).join('')}`, NAV);
  pages['games.html'] = page('All games', `<h1>All ${a.games.length} games</h1>${table('', ['Game', 'Condition', 'Seed', 'First mover', 'Winner (role)', 'Turns', 'Turn limit', 'Own / opponent triggers', 'Conveyor moves', 'Lead changes', 'Reason'], a.games.map(g => [link(g.gameId, '../'), g.condition, g.seed, g.first, `${g.winner} (${g.winnerRole})`, g.turns, g.turnLimit ? 'yes' : '', `${g.selfTriggers} / ${g.oppTriggers}`, g.conveyorTriggers, g.leadChanges, esc(g.reason)]), true)}`, NAV);
  pages['limitations.html'] = page('Limitations', `<h1>Uncertainty and limitations</h1><ul>
<li>${esc(a.power.perCondition.note)}</li>
<li>Five conditions were screened at once; at least one "significant-looking" difference is expected by chance alone now and then.</li>
<li>The same seeds are used in every condition, but the games diverge quickly (different piece counts change every plan), so pairs share a starting RNG, not a game.</li>
<li>Both sides are the same deterministic planner with the same weights. "Human side" means the side moving left to right, not a human player. Results describe this planner against itself.</li>
<li>Changing the piece count changes three things at once: pieces on the board, actions per turn and the victory requirement. These games cannot separate them.</li>
<li>Within one condition the 20 games are 10 seeds × 2 first movers; the two games of a seed are not fully independent.</li>
<li>These 100 games are exploratory. Any hypothesis formed from them must be tested on fresh seeds, and any correction judged on a separate sealed holdout.</li>
<li>The planner's look-ahead uses a copy of the engine RNG (it can foresee teleports). V2 tested whether that matters for balance and found no support, but it remains part of how these games were played.</li></ul>`, NAV);
  pages['v2-background.html'] = page('V2 background', `<h1>Background: earlier V2 findings (NOT part of this dataset)</h1><div class="warn">This page summarises a different, earlier experiment on 3-versus-3 games with other seeds. Do not mix its numbers with the 100-game dataset.</div>${o.v2}`, NAV);
  pages['catalog.html'] = page('Experiment catalog', `<h1>Allowlisted interventions you can propose</h1><p>Your proposal names one of these ids, a direction and a magnitude inside the bounds. Nothing you write is executed; a later, operator-approved run would apply the typed intervention to fresh seeds. Combined interventions are refused until each factor has its own single-factor result.</p>${table('', ['Id', 'Component', 'What it changes', 'Parameter and bounds', 'Production value'], Object.entries(CATALOG).map(([id, c]) => [id, c.component, c.description, c.bounds, c.production]))}`, NAV);
  pages['notebook.html'] = page('Notebook', notebookForm(o.formAction, o.nonce), NAV);
  return pages;
}
export function notebookForm(action: string, nonce: string) {
  const opt = (m: Record<string, string>) => Object.entries(m).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('');
  const interventions = Object.fromEntries([['none', 'No intervention (observation only, or no change justified)'], ...Object.entries(CATALOG).map(([id, c]) => [id, `${id}: ${c.description}`])]);
  return `<h1>Investigation notebook</h1><div class="box"><p>Submit <b>one form per competing hypothesis</b> (up to 4), then one with <b>Entry type = final conclusion</b>. Your text is stored verbatim as your own work and is never executed. Fields marked * are needed for a hypothesis to be testable.</p>
<form method="post" action="${esc(action)}"><input type="hidden" name="nonce" value="${esc(nonce)}">
<label for="entry">Entry type</label><select id="entry" name="entry"><option value="hypothesis">hypothesis</option><option value="conclusion">final conclusion</option></select>
<label for="title">Short title *</label><input type="text" id="title" name="title">
<label for="cause">Where is the cause? *</label><select id="cause" name="cause">${opt(CAUSES)}</select>
<label for="explanation">Explanation: what mechanism produces the pattern? *</label><textarea id="explanation" name="explanation" rows="4"></textarea>
<label for="evidence">Games that show it (ids, space separated) *</label><input type="text" id="evidence" name="evidence">
<label for="p1metric">Prediction 1: measurement *</label><select id="p1metric" name="p1metric">${opt(PROPOSAL_METRICS)}</select>
<label for="p1dir">Prediction 1: it should</label><select id="p1dir" name="p1dir"><option value="decrease">decrease</option><option value="increase">increase</option><option value="no-change">not change</option></select>
<label for="p1size">Prediction 1: by at least (absolute, e.g. 0.15 for 15 points or 3 for 3 turns) *</label><input type="number" step="any" id="p1size" name="p1size">
<label for="p2metric">Prediction 2 (optional): measurement</label><select id="p2metric" name="p2metric"><option value="">(none)</option>${opt(PROPOSAL_METRICS)}</select>
<label for="p2dir">Prediction 2: it should</label><select id="p2dir" name="p2dir"><option value="decrease">decrease</option><option value="increase">increase</option><option value="no-change">not change</option></select>
<label for="p2size">Prediction 2: by at least</label><input type="number" step="any" id="p2size" name="p2size">
<label for="intervention">Intervention to test it (from the catalog)</label><select id="intervention" name="intervention">${opt(interventions)}</select>
<label for="value">Intervention value (inside the catalog bounds; for piece counts write first/second, e.g. 3/2)</label><input type="text" id="value" name="value">
<label for="sideEffects">Expected side effects</label><textarea id="sideEffects" name="sideEffects" rows="2"></textarea>
<label for="competing">A competing explanation, and why yours fits better</label><textarea id="competing" name="competing" rows="2"></textarea>
<label for="counterexample">A game that could contradict your explanation (id)</label><input type="text" id="counterexample" name="counterexample">
<label for="acceptance">Acceptance test: what result on fresh seeds would make you accept the change?</label><textarea id="acceptance" name="acceptance" rows="2"></textarea>
<label for="disproof">What evidence would disprove your explanation?</label><textarea id="disproof" name="disproof" rows="2"></textarea>
<label for="verdict">For a final conclusion: is any change justified?</label><select id="verdict" name="verdict"><option value="">(hypothesis entry)</option><option value="change-justified">a change is justified (name the best hypothesis)</option><option value="no-change-justified">no change is justified</option><option value="more-evidence-needed">more evidence is needed first</option></select>
<p><button type="submit">Submit entry</button></p></form></div>`;
}
