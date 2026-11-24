/**
 * The documented rules of Rule Sabotage V6.1, as shown to players (client/v6/index.html "How to play", the effect
 * descriptions in server/rules.ts, and the engine notes in server/v6/engine.ts), written out as one numbered list for QA.
 * This is the intended behaviour every build should implement.
 */
export const RULES: { id: string; text: string }[] = [
  { id: 'R1', text: 'Board: 13 columns (A–M) × 9 rows (1–9). Human pieces start on A3, A5, A7 and race east to column M; AI pieces start on M3, M5, M7 and race west to column A. A piece that reaches its goal column is scored and leaves the board.' },
  { id: 'R2', text: 'Turns alternate. Who moves first is decided at the start of the game. The game ends when a side has all 3 pieces across, or after 60 turns (30 each); at the turn limit the side with more pieces across wins, then the side with fewer squares left to go, otherwise it is a draw.' },
  { id: 'R3', text: 'Actions: at the start of each turn a player gets one move action per own piece still on the board. The only way to get more is a "+1 action" effect. An action moves one piece, or a whole stack of own pieces, one square up, down, left or right.' },
  { id: 'R4', text: 'Landing on an own piece makes a stack. Landing on an enemy piece captures it: it goes back to its start square and loses any freeze or shield.' },
  { id: 'R5', text: 'Placement: before the first move of a turn a player may put ONE effect on 1 to 3 cells that have no piece and no enemy effect, and may remove own effects. Under V6.1 a new effect may not be placed on any of the 8 squares around ANY piece (own or enemy); if one chosen cell breaks this, the whole placement is refused.' },
  { id: 'R6', text: 'Referee: every new effect, from either side, is checked by the same engine referee before it is placed (legality, a sandbox trial, checks E1–E6). Effects it cannot verify are not placed, for both sides.' },
  { id: 'R7', text: 'Fairness: an effect does exactly the same thing to whichever piece enters it, whoever owns the effect and whoever owns the piece. Directions are absolute (north, south, east, west) or relative to how the piece entered (back, forward).' },
  { id: 'R8', text: 'Burn on entry: an effect cell fires when a piece arrives on it and is then used up (the cell becomes empty). This holds however the piece arrived: by its own move, or by being moved there by another effect. Only that cell is used up; the effect\'s other cells stay.' },
  { id: 'R9', text: 'Chains: a piece moved by an effect onto another effect cell sets that one off too. At most 4 effects fire in one chain; a cell reached past that cap does not fire and stays on the board.' },
  { id: 'R10', text: 'Shove N <dir>: the piece is forced N squares (1–3) in that direction, stopping at the board edge. "Back" is opposite to the direction it entered, "forward" is the same direction.' },
  { id: 'R11', text: 'Freeze: the piece cannot move during its owner\'s next turn.' },
  { id: 'R12', text: 'Send home: the piece goes back to its start square.' },
  { id: 'R13', text: 'Teleport: the piece goes to a random empty square of the middle columns B–L.' },
  { id: 'R14', text: 'Shield: the piece gets a shield. A shielded piece ignores the next effect cell it enters (the effect does not apply to it); that uses up the shield, and the cell is used up as usual.' },
  { id: 'R15', text: '+1 action: whoever\'s piece enters the cell gets one extra move action (this turn if it is their turn, otherwise their next turn).' },
];

export const SOURCE = (seeds: number[], policy: string): string[] => [
  'All evidence on these pages was produced by actually running each build. Nothing was edited by hand after the run.',
  'Scripted playtests: both sides\' actions were fixed in advance as a short script and the same script was run on every build. The build\'s own engine and referee decided every outcome (placements accepted or refused, effects fired, moves refused). Each step shows the game state before and after it and every event the engine reported.',
  `AI-vs-AI playtests: the game's existing computer opponent "${policy}" played both seats. Seeds ${seeds.join(', ')}; each seed was played twice per build, once with Human moving first and once with AI moving first. The same seeds were used on every build. The policy is stochastic only through the game's seeded random number generator.`,
  'The opponents do not know they are being tested; nothing in the game was changed to make these runs.',
];
