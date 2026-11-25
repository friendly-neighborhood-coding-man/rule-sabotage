/**
 * GW2 P4: deterministic extraction of SITUATIONS from recorded observations (gamewatch/evidence@1 bundles and
 * gw2-blind-observations@1 partitions). The verifier interprets hypotheses over situations, never over the live engine;
 * no new engine observation is produced here or anywhere in P4.
 *
 * Situation kinds and their fields (the only fields a gw2-hypothesis@1 clause may name):
 *   turn-start    one per turn start (case `turn-start` event, or match turn row)
 *     inputs   build, side, turn, isFirstMover, piecesOnBoard, pendingBonus
 *     outcomes actionsGranted
 *   effect-entry  one per arrival of a piece on an effect cell (`effect-fired`, `shield-absorbed`, `chain-limit`)
 *     inputs   build, effect, effectKind, pieceSide, effectOwner, ownerRelation, arrival, chainDepth, capped,
 *              pieceShieldedBefore, multiCell
 *     outcomes fired, absorbed, cellUsedUp, shieldAfter, otherCellsRemain
 * A field is null (UNKNOWN) whenever the record does not establish it. In particular match rows carry events but no
 * board states, so in matches pieceShieldedBefore, cellUsedUp, shieldAfter, otherCellsRemain and multiCell are null, and
 * a shield-absorbed event (which names no effect) has a null effect. Unknown values are reported as missing evidence.
 *
 * Derivations (each is a reading of recorded events/states, listed so it can be challenged):
 *   piecesOnBoard (cases)   own pieces on a board square in the state after the step holding the turn-start event
 *   pendingBonus            `extra-action` events with thisTurn=false for that side since its previous turn start
 *   arrival                 `move` → move; `forced-move` → forced (the last arrival of the piece on that square);
 *                           effect-fired with chainDepth 1 → move, > 1 → forced
 *   pieceShieldedBefore     the piece's shield flag in the step's before-state, updated by `status: shield` (true) and
 *                           `shield-absorbed` (false); after an entry that fired on a shielded piece without absorption,
 *                           or a capture, the flag becomes unknown for the rest of the step
 *   cellUsedUp              the entered cell's effect id is absent from that square in the step's after-state; unknown
 *                           when the same cell is entered twice in one step or the effect id is not known
 *   shieldAfter             the piece's shield flag in the after-state, only for the piece's last entry in the step
 *   otherCellsRemain        for a multi-cell effect: every other cell of the same effect id is still present afterwards;
 *                           unknown when another cell of the same effect was entered in the same step
 *   pieceSide (matches)     the `side` of the effect-fired event (in cases it is checked against the state)
 */
import type { GWEvent, GWState, GWStep, GWTurnRow } from '../evidence.ts';

export type SituationKind = 'turn-start' | 'effect-entry';
type Ty = 'number' | 'string' | 'boolean';
export const SITUATION_FIELDS: Record<SituationKind, { inputs: Record<string, Ty>; outcomes: Record<string, Ty> }> = {
  'turn-start': {
    inputs: { build: 'string', side: 'string', turn: 'number', isFirstMover: 'boolean', piecesOnBoard: 'number', pendingBonus: 'number' },
    outcomes: { actionsGranted: 'number' },
  },
  'effect-entry': {
    inputs: { build: 'string', effect: 'string', effectKind: 'string', pieceSide: 'string', effectOwner: 'string', ownerRelation: 'string', arrival: 'string', chainDepth: 'number', capped: 'boolean', pieceShieldedBefore: 'boolean', multiCell: 'boolean' },
    outcomes: { fired: 'boolean', absorbed: 'boolean', cellUsedUp: 'boolean', shieldAfter: 'boolean', otherCellsRemain: 'boolean' },
  },
};
export type V = number | string | boolean | null;
export type Situation = { id: string; kind: SituationKind; build: string; source: { type: 'case' | 'match'; id: string; pointer: string }; fields: Record<string, V> };
type Obs = { cases: { caseId: string; build: string; firstMover: string; steps: GWStep[] }[]; matches: { matchId: string; build: string; firstMover: string; rows: GWTurnRow[] }[] };

export function effectKind(name: string | null): string | null {
  if (name === null) return null;
  if (/^shove\b/i.test(name)) return 'shove';
  return ({ 'Freeze': 'freeze', 'Send home': 'send-home', 'Teleport': 'teleport', 'Shield': 'shield', '+1 action': 'extra-action' } as Record<string, string>)[name] ?? 'other';
}
const onBoard = (sq: unknown) => typeof sq === 'string' && /^[A-M][1-9]$/.test(sq);
const strs = (x: unknown) => Array.isArray(x) ? x.filter((y): y is string => typeof y === 'string') : [];

type Entry = { pieces: string[]; square: string; effect: string | null; effectId: number | null; owner: string | null; chainDepth: number | null; arrival: string | null; capped: boolean; fired: boolean; absorbed: boolean; pieceSide: string | null; shielded: boolean | null; ptr: string };

/** Effect entries of one event list (one case step or one match row). States are optional (absent for matches). */
function entries(events: GWEvent[], ptr: string, before?: GWState) {
  const shield = new Map<string, boolean | null>(before?.pieces.map(p => [p.id, p.shield]) ?? []);
  const sideOf = new Map(before?.pieces.map(p => [p.id, p.side]) ?? []);
  const fx = new Map((before?.effects ?? []).map(e => [e.square, e]));
  const last = new Map<string, { square: string; arrival: string }>(), out: Entry[] = [];
  const known = (p: string) => before ? (shield.has(p) ? shield.get(p)! : null) : null;
  events.forEach((ev, k) => {
    const pieces = strs(ev.pieces), at = `${ptr}/${k}`;
    if (ev.type === 'move' || ev.type === 'forced-move') for (const p of pieces) last.set(p, { square: String(ev.to), arrival: ev.type === 'move' ? 'move' : 'forced' });
    else if (ev.type === 'effect-placed') for (const sq of strs(ev.squares)) fx.set(sq, { square: sq, owner: String(ev.side), effect: String(ev.effect), effectId: Number(ev.effectId) });
    else if (ev.type === 'status' && ev.status === 'shield') for (const p of pieces) shield.set(p, true);
    else if (ev.type === 'capture') for (const p of pieces) shield.set(p, null);
    else if (ev.type === 'effect-fired' || ev.type === 'shield-absorbed' || ev.type === 'chain-limit') {
      const square = String(ev.square);
      const ps = pieces.length ? pieces : [...last.entries()].filter(([, a]) => a.square === square).map(([p]) => p);
      const cell = fx.get(square), depth = typeof ev.chainDepth === 'number' ? ev.chainDepth : null;
      const arrival = ev.type === 'effect-fired' && depth !== null ? (depth > 1 ? 'forced' : 'move') : (ps.length ? last.get(ps[0])?.arrival ?? null : null);
      const shielded = ps.length ? known(ps[0]) : null;
      const pieceSide = before ? (ps.length ? sideOf.get(ps[0]) ?? null : null) : (ev.type === 'effect-fired' && typeof ev.side === 'string' ? ev.side : null);
      out.push({
        pieces: ps, square, ptr: at, capped: ev.type === 'chain-limit', fired: ev.type === 'effect-fired', absorbed: ev.type === 'shield-absorbed', arrival, pieceSide, shielded,
        effect: typeof ev.effect === 'string' ? ev.effect : cell?.effect ?? null,
        effectId: typeof ev.effectId === 'number' ? ev.effectId : cell?.effectId ?? null,
        owner: typeof ev.effectOwner === 'string' ? ev.effectOwner : cell?.owner ?? null,
        chainDepth: depth ?? (arrival === 'move' ? 1 : null),
      });
      for (const p of ps) shield.set(p, ev.type === 'shield-absorbed' ? false : shielded === true && ev.type === 'effect-fired' ? null : known(p));
    }
  });
  return out;
}

function entrySituations(es: Entry[], build: string, src: { type: 'case' | 'match'; id: string }, base: string, before?: GWState, after?: GWState): Situation[] {
  return es.map((e, i) => {
    const sameCell = es.filter(x => x.square === e.square).length > 1;
    const lastForPiece = e.pieces.length > 0 && !es.slice(i + 1).some(x => x.pieces.includes(e.pieces[0]));
    const cells = before && e.effectId !== null ? before.effects.filter(x => x.effectId === e.effectId) : null;
    const others = cells ? cells.filter(x => x.square !== e.square) : null;
    const otherHit = es.some(x => x !== e && x.effectId === e.effectId && x.square !== e.square);
    const pAfter = after && e.pieces.length ? after.pieces.find(p => p.id === e.pieces[0]) : undefined;
    const f: Record<string, V> = {
      build, effect: e.effect, effectKind: effectKind(e.effect), pieceSide: e.pieceSide, effectOwner: e.owner,
      ownerRelation: e.owner && e.pieceSide ? (e.owner === e.pieceSide ? 'own' : 'enemy') : null,
      arrival: e.arrival, chainDepth: e.chainDepth, capped: e.capped, pieceShieldedBefore: e.shielded,
      multiCell: cells && cells.length ? cells.length > 1 : null,
      fired: e.fired, absorbed: e.absorbed,
      cellUsedUp: after && e.effectId !== null && !sameCell ? !after.effects.some(x => x.square === e.square && x.effectId === e.effectId) : null,
      shieldAfter: after && lastForPiece && pAfter && onBoard(pAfter.square) ? pAfter.shield : null,
      otherCellsRemain: after && others && others.length && !otherHit ? others.every(o => after.effects.some(x => x.square === o.square && x.effectId === e.effectId)) : null,
    };
    return { id: `${base}/e${i + 1}`, kind: 'effect-entry' as const, build, source: { ...src, pointer: e.ptr }, fields: f };
  });
}

/** All situations of one observation set, in a deterministic order (cases then matches, in recorded order). */
export function extractSituations(obs: Obs): Situation[] {
  const out: Situation[] = [];
  obs.cases.forEach((c, ci) => {
    const pending: Record<string, number> = {}, src = { type: 'case' as const, id: c.caseId };
    c.steps.forEach((s, si) => {
      const ptr = `/cases/${ci}/steps/${si}/events`;
      s.events.forEach((ev, k) => {
        if (ev.type === 'extra-action' && ev.thisTurn === false && typeof ev.side === 'string') pending[ev.side] = (pending[ev.side] ?? 0) + 1;
        if (ev.type === 'turn-start' && typeof ev.side === 'string') {
          const side = ev.side;
          out.push({ id: `${c.caseId}/s${s.n}/turn-start`, kind: 'turn-start', build: c.build, source: { ...src, pointer: `${ptr}/${k}` }, fields: {
            build: c.build, side, turn: typeof ev.turn === 'number' ? ev.turn : null, isFirstMover: side === c.firstMover,
            piecesOnBoard: s.after.pieces.filter(p => p.side === side && onBoard(p.square)).length, pendingBonus: pending[side] ?? 0,
            actionsGranted: typeof ev.actionsGranted === 'number' ? ev.actionsGranted : null,
          } });
          pending[side] = 0;
        }
      });
      out.push(...entrySituations(entries(s.events, ptr, s.before), c.build, src, `${c.caseId}/s${s.n}`, s.before, s.after));
    });
  });
  obs.matches.forEach((m, mi) => {
    const pending: Record<string, number> = {}, src = { type: 'match' as const, id: m.matchId };
    m.rows.forEach((r, ri) => {
      out.push({ id: `${m.matchId}/t${r.turn}/turn-start`, kind: 'turn-start', build: m.build, source: { ...src, pointer: `/matches/${mi}/rows/${ri}` }, fields: {
        build: m.build, side: r.side, turn: r.turn, isFirstMover: r.side === m.firstMover, piecesOnBoard: r.piecesOnBoard, pendingBonus: pending[r.side] ?? 0, actionsGranted: r.actionsGranted,
      } });
      pending[r.side] = 0;
      for (const ev of r.events) if (ev.type === 'extra-action' && ev.thisTurn === false && typeof ev.side === 'string') pending[ev.side] = (pending[ev.side] ?? 0) + 1;
      out.push(...entrySituations(entries(r.events, `/matches/${mi}/rows/${ri}/events`), m.build, src, `${m.matchId}/t${r.turn}`));
    });
  });
  return out;
}
