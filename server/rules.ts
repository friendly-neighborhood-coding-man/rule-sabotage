/**
 * Rule DSL: the ONLY things a natural-language rule can turn into.
 * No LLM output is ever executed. Model replies are parsed into these
 * types, validated here, and then run by the deterministic engine.
 */

export type Player = 'human' | 'ai';
export const PLAYERS: readonly Player[] = ['human', 'ai'];
export const other = (p: Player): Player => (p === 'human' ? 'ai' : 'human');

export type EffectKind = 'push' | 'skip' | 'reverse' | 'teleport' | 'swap' | 'shield';
export const EFFECT_KINDS: readonly EffectKind[] = ['push', 'skip', 'reverse', 'teleport', 'swap', 'shield'];
/** Boosts were cut after self-play: placing a booster in front of yourself dominated every other strategy. */
export const BOOST_REJECT = 'Boosts aren’t allowed: a trap that speeds people up just becomes a private shortcut for whoever places it. Try push back, lose a turn, reverse, teleport or swap.';

/** amount is only meaningful for push (1 or 2 squares). Everything else uses 1. */
export type Effect = { kind: EffectKind; amount: 1 | 2 };

/** Power budget: cost per trapped cell x number of cells must be <= RULE_BUDGET. */
export const RULE_BUDGET = 4;

export function effectCost(e: Effect): number {
  switch (e.kind) {
    case 'push': return e.amount === 2 ? 2 : 1;
    case 'skip': return 2;
    case 'reverse': return 1;
    case 'teleport': return 2;
    case 'swap': return 4;
    case 'shield': return 2;
  }
}
export const maxCells = (e: Effect): number => Math.floor(RULE_BUDGET / effectCost(e));

export const EFFECT_ICON: Record<EffectKind, string> = {
  push: '⏪', skip: '💤', reverse: '🔄', teleport: '🌀', swap: '🔀', shield: '🛡️',
};

/** Canonical, engine-written description. This (not the model's prose) is what the UI promises. */
export function describeEffect(e: Effect): string {
  switch (e.kind) {
    case 'push': return `Whoever steps here is pushed ${e.amount} square${e.amount === 2 ? 's' : ''} back toward their own start.`;
    case 'skip': return 'Whoever steps here loses their next turn (no move, no rule change).';
    case 'reverse': return "Whoever steps here has their next move flipped (left↔right, up↔down).";
    case 'teleport': return 'Whoever steps here is teleported to a random empty square in the middle of the board.';
    case 'swap': return 'Whoever steps here swaps places with the other player.';
    case 'shield': return 'Whoever steps here gains a shield that cancels the next trap they trigger.';
  }
}
export function shortLabel(e: Effect): string {
  switch (e.kind) {
    case 'push': return `Push back ${e.amount}`;
    case 'skip': return 'Lose next turn';
    case 'reverse': return 'Reverse next move';
    case 'teleport': return 'Random teleport';
    case 'swap': return 'Swap places';
    case 'shield': return 'Shield';
  }
}

export function isEffect(v: unknown): v is Effect {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (Object.keys(o).some(k => k !== 'kind' && k !== 'amount')) return false;
  if (typeof o.kind !== 'string' || !EFFECT_KINDS.includes(o.kind as EffectKind)) return false;
  if (o.amount !== 1 && o.amount !== 2) return false;
  if (o.amount === 2 && o.kind !== 'push') return false;
  return true;
}
export function normalizeEffect(kind: EffectKind, amount?: number): Effect {
  const a: 1 | 2 = kind === 'push' && amount === 2 ? 2 : 1;
  return { kind, amount: a };
}

/** Result of interpreting a natural-language rule. Never silently differs from the request: */
export type Interpretation =
  | { status: 'ok'; effect: Effect; summary: string; note: string; source: InterpretSource }
  | { status: 'approximate'; effect: Effect; summary: string; note: string; source: InterpretSource }
  | { status: 'reject'; reason: string; source: InterpretSource };
export type InterpretSource = 'openrouter' | 'offline-parser' | 'input-guard';

export const MAX_RULE_TEXT = 160;

/**
 * Hard input guard, applied before any model sees the text and again to AI-authored text.
 * Returns a helpful rejection reason or null.
 */
export function guardText(text: unknown): string | null {
  if (typeof text !== 'string') return 'Write your trap as a short sentence.';
  const t = text.trim();
  if (t.length < 3) return 'Write a little more: describe what happens to whoever steps on the trap.';
  if (t.length > MAX_RULE_TEXT) return `Keep it under ${MAX_RULE_TEXT} characters.`;
  if (/https?:\/\/|<\s*script|javascript:|\beval\b|system prompt|ignore (all |the )?(previous|above)|developer message|프롬프트\s*무시|이전\s*지시/i.test(t))
    return 'That looks like an instruction to the computer, not a trap. Describe what happens to the player who steps on it.';
  return null;
}

/**
 * Policy checks that apply to the MEANING of a rule regardless of who interprets it.
 * These are deterministic and run on both human and AI text.
 */
export function policyReject(text: string): string | null {
  const t = text.toLowerCase();
  if (/(win|lose|victory|defeat)s?\s*(the game|instantly|immediately|automatically)|instant(ly)?\s*(win|lose)|game over|즉시\s*(승리|패배)|바로\s*(이긴|진다|승리|패배)|게임\s*(종료|끝)|자동\s*(승리|패배)/i.test(t))
    return 'Traps can’t decide the game directly. Try something that slows someone down, like “pushed back 2 squares”.';
  if (/\bonly (the )?(ai|human|robot|computer|player 1|player 2|opponent|enemy|me|you)\b|(ai|human|opponent|enemy|robot)\s*only|(ai|인간|상대|적|로봇|컴퓨터)(만|에게만)|나만|너만|내\s*상대만/i.test(t))
    return 'Every trap hits whoever steps on it, including you. You can’t aim a trap at just one player.';
  if (/forever|permanent|for (the )?rest of the game|every turn|infinite|until the end|영원|영구|무한|끝까지|매\s*턴|계속/i.test(t))
    return 'No permanent effects. Each trap fires once and is gone. Try “loses their next turn” instead.';
  if (/(destroy|delete|remove|erase|wipe|clear)s?\s*(the )?(whole |entire )?(board|map|all traps|every)|whole board|entire board|every (square|cell|tile)|all (squares|cells|tiles)|보드\s*(전체|파괴|삭제)|모든\s*(칸|함정)|전체\s*맵/i.test(t))
    return 'Traps can’t change the whole board. They only affect the player who steps on that square.';
  if (/(back|return|send|go)\s*(\w+\s*){0,3}(to\s*)?(the\s*)?(start|beginning|home|spawn)|처음\s*(으로|자리)|출발\s*(점|지점|칸)\s*으로|시작\s*(점|지점|칸)\s*으로/i.test(t))
    return 'Sending someone all the way back to the start is too strong for one square. Try “pushed back 2 squares” or “teleported to a random square”.';
  return null;
}

const NUM: Record<string, number> = {
  one: 1, a: 1, an: 1, single: 1, two: 2, three: 3, four: 4, five: 5, six: 6, ten: 10, twice: 2,
  '한': 1, '하나': 1, '두': 2, '둘': 2, '세': 3, '셋': 3, '네': 4, '넷': 4, '다섯': 5, '열': 10,
};
function firstAmount(t: string): number | null {
  const m = t.match(/(\d+)\s*(?:squares?|spaces?|cells?|tiles?|steps?|turns?|rounds?|칸|턴|번|회|차례)/i)
    || t.match(/\b(one|a|an|single|two|three|four|five|six|ten|twice)\s+(?:squares?|spaces?|cells?|tiles?|steps?|turns?|rounds?)/i)
    || t.match(/(한|하나|두|둘|세|셋|네|넷|다섯|열)\s*(?:칸|턴|번|회|차례)/);
  if (!m) return null;
  const raw = m[1].toLowerCase();
  return /^\d+$/.test(raw) ? Number(raw) : (NUM[raw] ?? null);
}

/**
 * Deterministic offline interpreter (English + Korean). Used when OpenRouter is
 * unavailable, and as the test oracle for the input guard. Clearly labelled in the UI.
 */
export function offlineInterpret(text: string): Interpretation {
  const g = guardText(text);
  if (g) return { status: 'reject', reason: g, source: 'input-guard' };
  const p = policyReject(text);
  if (p) return { status: 'reject', reason: p, source: 'input-guard' };
  const t = text.toLowerCase();
  const found: EffectKind[] = [];
  if (/swap|switch places|trade places|change places|자리를?\s*(바꾸|바꾼|바꿉|바뀐|교환)|위치를?\s*(바꾸|교환)|맞바꾸/.test(t)) found.push('swap');
  if (/teleport|warp|random (square|spot|place|cell)|blink|순간\s*이동|텔레포트|워프|무작위\s*(칸|위치)|랜덤/.test(t)) found.push('teleport');
  if (/revers|invert|opposite direction|mirror(ed)? controls|flip(ped)? controls|controls? (are )?flipped|반대\s*(로|방향)|거꾸로|뒤바뀐다|뒤집/.test(t)) found.push('reverse');
  if (/shield|protect|immun|invulnerab|보호막|방패|쉴드|면역|무효화/.test(t)) found.push('shield');
  if (/skip|los(e|es|ing) (\w+ ){0,2}turns?|loses? (their|your|a|the|his|her)?\s*(next )?turn|miss(es)? (their|a|the|next)? ?turn|stun|freez|frozen|fall asleep|falls asleep|sleep|nap|can'?t move|cannot move|paraly|쉰다|쉬어|쉬게|쉬고|턴을?\s*(잃|날|쉬)|차례를?\s*(잃|쉬|건너)|기절|얼어|얼음|멈춘다|멈춰|못\s*움직|잠든|잠이/.test(t)) found.push('skip');
  const pushWord = /push|knock|shove|bounce|repel|retreat|(go|goes|move|moves|sent|send|sends|fall|falls|slide|slides|step|steps|thrown|kicked)\s+(\w+\s+){0,2}back|back(ward)?s?\s+(\d|one|two|three|four|five|a |an )|뒤로|밀려|밀어|밀린|후퇴|물러|튕겨/.test(t);
  const fwdWord = /forward|ahead|boost|launch|advance|speed up|catapult|앞으로|전진|날아|부스트|가속/.test(t);
  const backWord = /back|뒤로|후퇴|물러/.test(t);
  if (fwdWord && (!pushWord || !backWord)) return { status: 'reject', source: 'offline-parser', reason: BOOST_REJECT };
  if (pushWord) found.push('push');
  const uniq = [...new Set(found)];
  if (uniq.length === 0)
    return { status: 'reject', source: 'offline-parser', reason: 'I couldn’t match that to a trap I can run. Supported effects: push back 1–2, lose next turn, reverse next move, random teleport, swap places, shield.' };
  if (uniq.length > 1)
    return { status: 'reject', source: 'offline-parser', reason: `One effect per trap, please. I read: ${uniq.map(k => shortLabel(normalizeEffect(k, 1))).join(' + ')}. Pick one.` };

  const kind = uniq[0];
  const n = firstAmount(t);
  let note = '';
  let status: 'ok' | 'approximate' = 'ok';
  let amount = 1;
  if (kind === 'push') {
    amount = n ?? 1;
    if (amount > 2) { status = 'approximate'; note = `You asked for ${amount} squares; the maximum is 2, so this would be pushed back 2.`; amount = 2; }
    if (amount < 1) amount = 1;
  } else if (kind === 'skip' && n !== null && n > 1) {
    status = 'approximate'; note = `You asked for ${n} turns; the maximum is 1 turn, so nobody gets locked out of the game.`;
  }
  const effect = normalizeEffect(kind, amount);
  return { status, effect, summary: describeEffect(effect), note, source: 'offline-parser' };
}

/** Validates a model's structured reply into an Interpretation. Throws on anything malformed. */
export function parseModelInterpretation(value: unknown, originalText: string): Interpretation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('model reply is not an object');
  const v = value as Record<string, unknown>;
  const allowed = ['status', 'kind', 'amount', 'note'];
  if (Object.keys(v).some(k => !allowed.includes(k))) throw new Error('unexpected fields in model reply');
  if (v.status !== 'ok' && v.status !== 'approximate' && v.status !== 'reject') throw new Error('bad status');
  const note = typeof v.note === 'string' ? v.note.slice(0, 240) : '';
  if (v.status === 'reject') return { status: 'reject', reason: note || 'The interpreter declined this rule.', source: 'openrouter' };
  if (v.kind === 'forward' || v.kind === 'boost') return { status: 'reject', reason: BOOST_REJECT, source: 'openrouter' };
  if (typeof v.kind !== 'string' || !EFFECT_KINDS.includes(v.kind as EffectKind)) throw new Error('unknown effect kind');
  const amt = v.amount === 2 ? 2 : v.amount === 1 || v.amount === undefined || v.amount === null ? 1 : NaN;
  if (Number.isNaN(amt)) throw new Error('bad amount');
  const effect = normalizeEffect(v.kind as EffectKind, amt);
  if (!isEffect(effect)) throw new Error('invalid effect');
  // Deterministic policy applies regardless of what the model said.
  const p = policyReject(originalText);
  if (p) return { status: 'reject', reason: p, source: 'input-guard' };
  if (v.status === 'approximate' && !note) throw new Error('approximation without disclosure');
  return { status: v.status, effect, summary: describeEffect(effect), note: v.status === 'approximate' ? note : '', source: 'openrouter' };
}

export const INTERPRET_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['ok', 'approximate', 'reject'] },
    kind: { type: 'string', enum: [...EFFECT_KINDS, 'forward', 'none'] },
    amount: { type: 'integer', enum: [1, 2] },
    note: { type: 'string' },
  },
  required: ['status', 'kind', 'amount', 'note'],
} as const;
