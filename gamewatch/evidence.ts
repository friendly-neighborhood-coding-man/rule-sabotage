/**
 * GameWatch evidence format (game-independent). An adapter turns a game's real executions into these records; the
 * dashboard (gamewatch/dashboard.ts) reads only these records and never imports any game engine.
 */
export type GWSide = string;
export type GWState = {
  turn: number; toMove: GWSide; actionsLeft: number; phase: string; winner: GWSide | 'draw' | null;
  pieces: { id: string; side: GWSide; square: string; frozenTurns: number; shield: boolean }[];
  effects: { square: string; owner: GWSide; effect: string; effectId: number }[];
};
export type GWEvent = { type: string; [k: string]: unknown };
export type GWStep = { n: number; actor: GWSide | 'system'; action: string; outcome: 'ok' | 'refused'; note?: string; before: GWState; after: GWState; events: GWEvent[] };
export type GWCase = { caseId: string; kind: 'scripted'; build: string; title: string; seed: number; firstMover: GWSide; steps: GWStep[] };
export type GWTurnRow = { turn: number; side: GWSide; piecesOnBoard: number; actionsGranted: number; movesMade: number; placement: { effect: string; squares: string[]; result: string } | null; events: GWEvent[] };
export type GWMatch = { matchId: string; build: string; seed: number; policy: Record<GWSide, string>; firstMover: GWSide; winner: GWSide | 'draw'; reason: string; turns: number; scored: Record<GWSide, number>; ms: number; rows: GWTurnRow[] };
export type GWBundle = {
  schema: 'gamewatch/evidence@1';
  game: { name: string; version: string; rules: { id: string; text: string }[] };
  source: string[];
  builds: { label: string; note: string }[];
  cases: GWCase[]; matches: GWMatch[];
  generatedAt: string; generator: { commit: string | null; command: string };
};
