/**
 * Reactions and achievements. Everything here is derived from real engine events.
 * Reactions are labelled in the UI as after-the-fact commentary, never as the AI's reasoning.
 */
import { type State, type GameEvent, cellName } from './engine.ts';
import { type Player, other } from './rules.ts';

export type Reaction = { speaker: 'ai'; text: string; trigger: string };
export type Achievement = { id: string; title: string; detail: string; round: number };

const pick = (list: string[], n: number) => list[Math.abs(n) % list.length];

export function reactionsFor(events: GameEvent[], before: State, after: State): Reaction[] {
  const out: Reaction[] = [];
  const n = before.round + before.seed;
  for (const e of events) {
    if (e.t === 'trigger' && e.p === 'ai' && e.self && e.kind !== 'shield') out.push({ speaker: 'ai', trigger: 'ai-self-trap', text: pick(['That was not part of my plan.', 'I would like to file a complaint against myself.', 'In my defence, it was a very good trap.', 'Recalculating… everything.'], n) });
    else if (e.t === 'trigger' && e.p === 'human' && e.self && e.kind !== 'shield') out.push({ speaker: 'ai', trigger: 'human-self-trap', text: pick(['Bold strategy: stepping on your own trap.', 'I didn’t even have to do anything.', 'Ah yes, the classic self-sabotage.'], n) });
    else if (e.t === 'trigger' && e.p === 'human' && !e.self && e.kind !== 'shield') out.push({ speaker: 'ai', trigger: 'human-hit', text: pick(['Exactly as simulated.', 'Welcome to my square.', 'I left that there for you. You’re welcome.'], n) });
    else if (e.t === 'trigger' && e.p === 'ai' && !e.self && e.kind !== 'shield') out.push({ speaker: 'ai', trigger: 'ai-hit', text: pick(['Okay. Noted. Annoyed, but noted.', 'You planned that? …You planned that.', 'Ow. Statistically.'], n) });
    else if (e.t === 'clash') out.push({ speaker: 'ai', trigger: 'clash', text: pick(['Great minds trap alike.', 'We both wanted that square. Nobody gets it.'], n) });
    else if (e.t === 'shielded' && e.p === 'ai') out.push({ speaker: 'ai', trigger: 'ai-shield', text: 'Shield says no.' });
    else if (e.t === 'displace' && e.how === 'swap' && e.p === 'ai' && (e.from.x !== e.to.x || e.from.y !== e.to.y)) out.push({ speaker: 'ai', trigger: 'swap', text: 'Wait, why am I over here?' });
    else if (e.t === 'win') out.push({ speaker: 'ai', trigger: 'end', text: e.winner === 'ai' ? pick(['GG. I simulated this. Rematch?', 'Victory. I would gloat, but I’m above that. Mostly.'], n) : e.winner === 'human' ? pick(['You win this one. I want a rematch.', 'Impossible. Well, clearly possible. Rematch?'], n) : 'A draw. Neither of us will speak of this.' });
  }
  return out.slice(0, 2);
}

/** Achievements are computed from the recorded history at the end of the game. */
export function achievementsFor(s: State): Record<Player, Achievement[]> {
  const res: Record<Player, Achievement[]> = { human: [], ai: [] };
  const add = (p: Player, a: Achievement) => { if (!res[p].some(x => x.id === a.id)) res[p].push(a); };
  const placed = new Map<number, { owner: Player; cost: number; text: string; hitOpp: boolean; round: number }>();
  const lastSelfHit: Record<Player, number> = { human: -99, ai: -99 };
  for (const rec of s.history) {
    rec.events.forEach((e, idx) => {
      if (e.t === 'place') placed.set(e.ruleId, { owner: e.p, cost: 0, text: e.text, hitOpp: false, round: rec.round });
      if (e.t === 'trigger') {
        const r = placed.get(e.ruleId);
        if (e.self && e.kind !== 'shield') { add(e.p, { id: 'self-sabotage', title: 'Self-Sabotage', detail: `Stepped on own trap “${e.text}” at ${cellName(e.cell)}.`, round: rec.round }); lastSelfHit[e.p] = rec.round; }
        else if (r && !e.self) r.hitOpp = true;
        if (e.chain >= 2) add(e.p, { id: 'chain', title: 'Chain Reaction', detail: `Set off ${e.chain} traps in one step.`, round: rec.round });
      }
      if (e.t !== 'displace') return;
      const goal = e.p === 'human' ? 6 : 0;
      const gained = Math.abs(goal - e.from.x) - Math.abs(goal - e.to.x);
      if (gained > 0) {
        // Moved closer to goal by a trap the OTHER player owns = Uno Reverse.
        const trig = rec.events.slice(0, idx).reverse().find(x => x.t === 'trigger' && x.p === e.p);
        if (trig && trig.t === 'trigger' && trig.owner !== e.p) add(e.p, { id: 'uno-reverse', title: 'Uno Reverse', detail: `Used the opponent’s trap to jump ${gained} closer to the goal.`, round: rec.round });
      }
    });
  }
  for (const [, r] of placed) if (!r.hitOpp) {
    const rec = s.history.find(h => h.round === r.round);
    const act = rec?.actions[r.owner].rule;
    if (act && act.op === 'place' && act.cells.length >= 3) add(r.owner, { id: 'overengineered', title: 'Overengineered', detail: `“${r.text}” covered ${act.cells.length} squares and never hit the opponent.`, round: r.round });
  }
  if (s.winner === 'human' && s.round - 1 - lastSelfHit.ai <= 3) add('ai', { id: 'calculated-disaster', title: 'Calculated Disaster', detail: 'The AI lost within 3 rounds of stepping on its own trap.', round: s.round - 1 });
  if (s.winner === 'ai' && s.round - 1 - lastSelfHit.human <= 3) add('human', { id: 'calculated-disaster', title: 'Calculated Disaster', detail: 'You lost within 3 rounds of stepping on your own trap.', round: s.round - 1 });
  if (s.winner === 'draw') for (const p of ['human', 'ai'] as Player[]) add(p, { id: 'photo-finish', title: 'Photo Finish', detail: 'Both reached the goal in the same round.', round: s.round - 1 });
  void other;
  return res;
}
