/**
 * Reactions and achievements. Everything here is derived from real engine events.
 * Reactions are labelled in the UI as after-the-fact commentary, never as the AI's reasoning.
 */
import { type State, type GameEvent, cellName, GOAL_X, parseKey } from './engine.ts';
import { type Player, PLAYERS } from './rules.ts';

export type Reaction = { speaker: 'ai'; text: string; trigger: string };
export type Achievement = { id: string; title: string; detail: string; turn: number };
export type TurnRecord = { turn: number; p: Player; events: GameEvent[] };

let n = 0;
const pick = (list: string[]) => list[(n++) % list.length];
const harmful = (k: string) => k !== 'shield' && k !== 'haste';

export function reactionsFor(events: GameEvent[]): Reaction[] {
  const out: Reaction[] = [];
  for (const e of events) {
    if (e.t === 'trigger' && harmful(e.kind)) {
      if (e.p === 'ai' && e.self) out.push({ speaker: 'ai', trigger: 'ai-self-trap', text: pick(['That was not part of my plan.', 'I would like to file a complaint against myself.', 'In my defence, it was a very good trap.', 'Recalculating… everything.']) });
      else if (e.p === 'human' && e.self) out.push({ speaker: 'ai', trigger: 'human-self-trap', text: pick(['Bold strategy: stepping on your own trap.', 'I didn’t even have to do anything.', 'Ah yes, the classic self-sabotage.']) });
      else if (e.p === 'human') out.push({ speaker: 'ai', trigger: 'human-hit', text: pick(['Exactly as simulated.', 'Welcome to my square.', 'I left that there for you. You’re welcome.']) });
      else out.push({ speaker: 'ai', trigger: 'ai-hit', text: pick(['Okay. Noted. Annoyed, but noted.', 'You planned that? …You planned that.', 'Ow. Statistically.']) });
    } else if (e.t === 'trigger' && !e.self && e.p === 'human') out.push({ speaker: 'ai', trigger: 'human-borrowed', text: pick(['Hey, that was MY boost.', 'Please stop using my furniture.']) });
    else if (e.t === 'capture' && e.by === 'ai') out.push({ speaker: 'ai', trigger: 'ai-capture', text: pick(['Back to the start with you.', 'Sorry, that square was taken. By me.']) });
    else if (e.t === 'capture' && e.by === 'human') out.push({ speaker: 'ai', trigger: 'human-capture', text: pick(['Rude.', 'I will remember this. I remember everything.']) });
    else if (e.t === 'shielded' ) out.push({ speaker: 'ai', trigger: 'shield', text: 'Shield says no.' });
    else if (e.t === 'trigger' && e.chain >= 2) out.push({ speaker: 'ai', trigger: 'chain', text: 'Chain reaction! Beautiful. Terrible, but beautiful.' });
    else if (e.t === 'win') out.push({ speaker: 'ai', trigger: 'end', text: e.winner === 'ai' ? pick(['GG. I simulated this. Rematch?', 'Victory. I would gloat, but I’m above that. Mostly.']) : e.winner === 'human' ? pick(['You win this one. I want a rematch.', 'Impossible. Well, clearly possible. Rematch?']) : 'A draw. Neither of us will speak of this.' });
  }
  return out.slice(0, 2);
}

/** Achievements are computed from the recorded turns at the end of the game. */
export function achievementsFor(s: State, history: TurnRecord[]): Record<Player, Achievement[]> {
  const res: Record<Player, Achievement[]> = { human: [], ai: [] };
  const add = (p: Player, a: Achievement) => { if (!res[p].some(x => x.id === a.id)) res[p].push(a); };
  const lastSelfHit: Record<Player, number> = { human: -99, ai: -99 };
  const placedCells: Record<Player, number> = { human: 0, ai: 0 };
  for (const rec of history) {
    rec.events.forEach((e, idx) => {
      if (e.t === 'place') placedCells[e.p] += e.cells.length;
      if (e.t === 'trigger') {
        if (e.self && harmful(e.kind)) { add(e.p, { id: 'self-sabotage', title: 'Self-Sabotage', detail: `Walked into your own “${e.label}” at ${cellName(e.cell)}.`, turn: rec.turn }); lastSelfHit[e.p] = rec.turn; }
        if (e.chain >= 3) add(e.p, { id: 'chain', title: 'Chain Reaction', detail: `Set off ${e.chain} effects in one step.`, turn: rec.turn });
        if (!e.self && !harmful(e.kind)) add(e.p, { id: 'borrowed', title: 'Borrowed Goods', detail: `Used the opponent’s “${e.label}” at ${cellName(e.cell)}.`, turn: rec.turn });
      }
      if (e.t === 'forced' && e.how === 'shove') {
        const trig = rec.events.slice(0, idx).reverse().find(x => x.t === 'trigger');
        if (trig && trig.t === 'trigger' && !trig.self) {
          const goal = GOAL_X[trig.p], gain = Math.abs(goal - parseKey(e.from).x) - Math.abs(goal - parseKey(e.to).x);
          if (gain >= 2) add(trig.p, { id: 'uno-reverse', title: 'Uno Reverse', detail: `The opponent’s shove pushed you ${gain} squares toward your goal.`, turn: rec.turn });
        }
      }
      if (e.t === 'capture' && e.pieces.length >= 2) add(e.by, { id: 'double-capture', title: 'Bowling Ball', detail: `Captured ${e.pieces.length} pieces at once.`, turn: rec.turn });
      if (e.t === 'capture' && e.forced) add(e.by, { id: 'trick-shot', title: 'Trick Shot', detail: 'Captured a piece while being shoved around.', turn: rec.turn });
    });
  }
  for (const p of PLAYERS) if (placedCells[p] >= 15) add(p, { id: 'architect', title: 'Architect', detail: `Built ${placedCells[p]} effect cells this game.`, turn: s.turn });
  for (const p of PLAYERS) if (s.winner && s.winner !== p && s.winner !== 'draw' && s.turn - lastSelfHit[p] <= 4) add(p, { id: 'calculated-disaster', title: 'Calculated Disaster', detail: 'Lost shortly after walking into your own effect.', turn: s.turn });
  return res;
}
