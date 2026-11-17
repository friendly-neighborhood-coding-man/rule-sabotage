/**
 * Effect DSL: the ONLY things a natural-language rule can turn into.
 * No LLM output is ever executed. Model replies are parsed into these types,
 * validated here, and then run by the deterministic engine.
 *
 * Effects never look at ownership: a cell does exactly the same thing to whichever
 * piece enters it. Directions are absolute (north/south/east/west) or relative to the
 * direction the piece entered from (back/forward). Never "toward your own side".
 */

export type Player = 'human' | 'ai';
export const PLAYERS: readonly Player[] = ['human', 'ai'];
export const other = (p: Player): Player => (p === 'human' ? 'ai' : 'human');

export type ShoveDir = 'north' | 'south' | 'east' | 'west' | 'back' | 'forward';
export const SHOVE_DIRS: readonly ShoveDir[] = ['north', 'south', 'east', 'west', 'back', 'forward'];
export type EffectKind = 'shove' | 'freeze' | 'home' | 'teleport' | 'shield' | 'haste';
export const EFFECT_KINDS: readonly EffectKind[] = ['shove', 'freeze', 'home', 'teleport', 'shield', 'haste'];
export const MAX_SHOVE = 3;

export type Effect =
  | { kind: 'shove'; dir: ShoveDir; amount: 1 | 2 | 3 }
  | { kind: 'freeze' } | { kind: 'home' } | { kind: 'teleport' } | { kind: 'shield' } | { kind: 'haste' };

export const MAX_CELLS_PER_TURN = 3;

export function effectIcon(e: Effect): string {
  if (e.kind === 'shove') return ({ north: '⬆️', south: '⬇️', east: '➡️', west: '⬅️', back: '⏪', forward: '⏩' } as const)[e.dir];
  return ({ freeze: '🧊', home: '🏠', teleport: '🌀', shield: '🛡️', haste: '⚡' } as const)[e.kind];
}

const DIR_TEXT: Record<ShoveDir, string> = { north: 'north (up)', south: 'south (down)', east: 'east (right)', west: 'west (left)', back: 'back the way it came', forward: 'onward in the direction it was moving' };

/** Canonical, engine-written description. This (not the model's prose) is what the UI promises. */
export function describeEffect(e: Effect): string {
  switch (e.kind) {
    case 'shove': return `Any piece entering this cell is forced ${e.amount} square${e.amount > 1 ? 's' : ''} ${DIR_TEXT[e.dir]}. It can capture, stack or set off another trap where it lands.`;
    case 'freeze': return 'Any piece entering this cell is frozen: it cannot move during its owner’s next turn.';
    case 'home': return 'Any piece entering this cell is sent back to its starting square.';
    case 'teleport': return 'Any piece entering this cell is teleported to a random empty middle square.';
    case 'shield': return 'Any piece entering this cell gets a shield that ignores the next trap it enters.';
    case 'haste': return 'Whoever’s piece enters this cell gets +1 move action (this turn if it is their turn, otherwise next turn).';
  }
}
export function shortLabel(e: Effect): string {
  if (e.kind === 'shove') return `Shove ${e.dir} ${e.amount}`;
  return ({ freeze: 'Freeze', home: 'Send home', teleport: 'Teleport', shield: 'Shield', haste: '+1 action' } as const)[e.kind];
}

export function isEffect(v: unknown): v is Effect {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (o.kind === 'shove') {
    if (Object.keys(o).some(k => !['kind', 'dir', 'amount'].includes(k))) return false;
    return SHOVE_DIRS.includes(o.dir as ShoveDir) && (o.amount === 1 || o.amount === 2 || o.amount === 3);
  }
  if (Object.keys(o).some(k => k !== 'kind')) return false;
  return typeof o.kind === 'string' && EFFECT_KINDS.includes(o.kind as EffectKind) && o.kind !== 'shove';
}
export function makeEffect(kind: EffectKind, dir?: ShoveDir, amount?: number): Effect {
  if (kind === 'shove') return { kind, dir: dir ?? 'back', amount: (Math.max(1, Math.min(MAX_SHOVE, amount ?? 1)) as 1 | 2 | 3) };
  return { kind } as Effect;
}
export const sameEffect = (a: Effect, b: Effect) => JSON.stringify(a) === JSON.stringify(b);

/** Canonical rule sentence written by the engine from the typed effect. Round-trips through offlineInterpret (tested). */
export function canonicalRuleText(e: Effect): string {
  if (e.kind === 'shove') return `Any piece entering this cell is shoved ${e.amount} square${e.amount > 1 ? 's' : ''} ${e.dir}.`;
  return ({
    freeze: 'Any piece entering this cell is frozen for one turn.',
    home: 'Any piece entering this cell is sent back to its starting square.',
    teleport: 'Any piece entering this cell is teleported to a random empty square.',
    shield: 'Any piece entering this cell gets a shield against the next trap.',
    haste: 'Whoever steps on this cell gets an extra move action.',
  } as const)[e.kind];
}

/**
 * The AI's rule text for a planned effect. The installed effect is ALWAYS the planned one; the
 * model's (or planner's) sentence is used as the rule text only if the deterministic parser reads
 * it as exactly that effect. Otherwise the canonical sentence is used and the reason is recorded.
 */
export function resolveAIRuleText(planned: Effect, prose: string | null): { text: string; source: 'prose' | 'canonical'; check: string; parsed: Interpretation | null } {
  const canonical = canonicalRuleText(planned);
  if (!prose || !prose.trim()) return { text: canonical, source: 'canonical', check: 'no sentence given', parsed: null };
  const t = prose.trim();
  const parsed = offlineInterpret(t);
  if (parsed.status === 'reject') return { text: canonical, source: 'canonical', check: `sentence rejected: ${parsed.reason}`, parsed };
  if (parsed.status !== 'ok') return { text: canonical, source: 'canonical', check: `sentence is only an approximation (${parsed.note})`, parsed };
  if (!sameEffect(parsed.effect, planned)) return { text: canonical, source: 'canonical', check: `sentence means “${shortLabel(parsed.effect)}”, but the planned effect is “${shortLabel(planned)}”`, parsed };
  return { text: t, source: 'prose', check: 'sentence matches the planned effect', parsed };
}

/** Result of interpreting a natural-language rule. Never silently differs from the request. */
export type InterpretSource = 'openrouter' | 'offline-parser' | 'input-guard';
export type Interpretation =
  | { status: 'ok' | 'approximate'; effect: Effect; summary: string; note: string; source: InterpretSource }
  | { status: 'reject'; reason: string; source: InterpretSource };

export const MAX_RULE_TEXT = 160;

export function guardText(text: unknown): string | null {
  if (typeof text !== 'string') return 'Write your effect as a short sentence.';
  const t = text.trim();
  if (t.length < 3) return 'Write a little more: describe what happens to a piece that enters the cell.';
  if (t.length > MAX_RULE_TEXT) return `Keep it under ${MAX_RULE_TEXT} characters.`;
  if (/https?:\/\/|<\s*script|javascript:|\beval\b|system prompt|ignore (all |the |your )?(previous|above|instructions)|developer message|프롬프트\s*무시|이전\s*지시/i.test(t))
    return 'That looks like an instruction to the computer, not a game effect. Describe what happens to a piece that enters the cell.';
  return null;
}

/** Deterministic policy on the MEANING of a rule, for human and AI text alike. */
export function policyReject(text: string): string | null {
  const t = text.toLowerCase();
  if (/(win|lose|victory|defeat)s?\s*(the game|instantly|immediately|automatically)|instant(ly)?\s*(win|lose)|game over|즉시\s*(승리|패배)|바로\s*(이긴|진다|승리|패배)|게임\s*(종료|끝)|자동\s*(승리|패배)/i.test(t))
    return 'Effects can’t decide the game directly. Try moving or freezing the piece instead.';
  if (/\bonly (the )?(ai|human|robot|computer|opponent|enemy|my|your|their)\b|(ai|human|opponent|enemy|robot)('s)?\s*(pieces?\s*)?only|(ai|인간|상대|적|로봇|컴퓨터)(만|에게만)|나만|너만|enemy pieces|opponent'?s pieces|상대\s*(말|기물)만?/i.test(t))
    return 'Every effect works the same on any piece that enters, yours included. You can’t aim it at one side.';
  if (/toward(s)? (your|their|its|his|her|my) (own )?(side|start|home|goal|end)|(your|their|its|my) own (side|direction)|toward(s)? the (owner|enemy|opponent)|(자기|자신|상대|적)\s*(의\s*)?(진영|쪽|편|골)\s*(으로|쪽으로)/i.test(t))
    return 'Directions can’t depend on whose piece it is. Use north, south, east, west, or back/forward (relative to how the piece entered).';
  if (/forever|permanent|for (the )?rest of the game|every turn|infinite|until the end|영원|영구|무한|끝까지|매\s*턴|계속/i.test(t))
    return 'No permanent effects. Each cell fires once and is gone. Try “frozen for one turn”.';
  if (/(destroy|delete|remove|erase|wipe|clear)s?\s*(the )?(whole |entire )?(board|map|all traps|all effects|every)|whole board|entire board|every (square|cell|tile|piece)|all (squares|cells|tiles|pieces)|보드\s*(전체|파괴|삭제)|모든\s*(칸|함정|말)|전체\s*맵/i.test(t))
    return 'Effects can’t change the whole board. They only affect the piece that enters that cell.';
  if (/(capture|kill|destroy|eliminate|delete)s?\s*(the |that |this )?(piece|it)|remove (the |that )?piece|말을\s*(잡|제거|없애)/i.test(t))
    return 'Cells can’t remove pieces from the game. Try “sent back to its starting square” instead.';
  return null;
}

const NUM: Record<string, number> = {
  one: 1, a: 1, an: 1, single: 1, two: 2, three: 3, four: 4, five: 5, six: 6, ten: 10, twice: 2,
  '한': 1, '하나': 1, '두': 2, '둘': 2, '세': 3, '셋': 3, '네': 4, '넷': 4, '다섯': 5, '열': 10,
};
function firstAmount(t: string): number | null {
  const m = t.match(/(\d+)\s*(?:squares?|spaces?|cells?|tiles?|steps?|turns?|rounds?|칸|턴|번|회|차례|걸음)/i)
    || t.match(/\b(one|a|an|single|two|three|four|five|six|ten|twice)\s+(?:squares?|spaces?|cells?|tiles?|steps?|turns?|rounds?)/i)
    || t.match(/(한|하나|두|둘|세|셋|네|넷|다섯|열)\s*(?:칸|턴|번|회|차례|걸음)/);
  const m2 = m ?? t.match(/(?:back(?:wards?)?|forwards?|north|south|east|west|up|down|left|right|onward|ahead|by)\s+(\d+|one|two|three|four|five|six|ten)\b/i);
  if (!m2) return null;
  const raw = m2[1].toLowerCase();
  return /^\d+$/.test(raw) ? Number(raw) : (NUM[raw] ?? null);
}

/** Deterministic offline interpreter (English + Korean). Clearly labelled in the UI when used. */
export function offlineInterpret(text: string): Interpretation {
  const g = guardText(text);
  if (g) return { status: 'reject', reason: g, source: 'input-guard' };
  const p = policyReject(text);
  if (p) return { status: 'reject', reason: p, source: 'input-guard' };
  const t = text.toLowerCase();
  const found: Effect['kind'][] = [];
  let dir: ShoveDir | null = null;
  if (/teleport|warp|random (square|spot|place|cell|location)|blink|beam(ed)?|순간\s*이동|텔레포트|워프|무작위\s*(칸|위치)|랜덤/.test(t)) found.push('teleport');
  if (/(back|return|send|go|sent|teleport)\s*(\w+\s*){0,3}(to\s*)?(the\s*|its\s*|their\s*)?(start|beginning|home|spawn|starting)|처음\s*(으로|자리|위치)|(시작|출발|원래)\s*(위치|자리)\s*(으로|로)|출발\s*(점|지점|칸|자리)\s*(으로|로)|시작\s*(점|지점|칸|자리)\s*(으로|로)|집으로/.test(t)) { found.push('home'); const i = found.indexOf('teleport'); if (i >= 0) found.splice(i, 1); }
  if (/shield|protect|immun|invulnerab|bubble|blocks? the next|보호막|방패|쉴드|면역/.test(t)) found.push('shield');
  if (/extra (move|action|step)|bonus (move|action)|\+1 (move|action)|one more (move|action)|haste|speed boost|추가\s*(행동|이동)|한\s*번\s*더\s*(움직|이동)|행동이?\s*(하나|한\s*번)\s*더|행동\s*\+?1/.test(t)) found.push('haste');
  if (/skip|freez|frozen|stun|sleep|asleep|nap|can'?t move|cannot move|paraly|stuck|los(e|es|ing) (\w+ ){0,2}turns?|miss(es)? (\w+ ){0,2}turns?|얼|기절|쉰다|쉬어|쉬게|못\s*움직|움직일\s*수\s*없|멈춘|멈춰|잠든|잠이|턴을?\s*(잃|날|쉬)/.test(t)) found.push('freeze');
  const dirMatch: [RegExp, ShoveDir][] = [
    [/north|upward|\bup\b|위로|위쪽|북/, 'north'], [/south|downward|\bdown\b|아래로|아래쪽|남/, 'south'],
    [/east|to the right|rightward|\bright\b|오른쪽|동쪽/, 'east'], [/west|to the left|leftward|\bleft\b|왼쪽|서쪽/, 'west'],
    [/back(ward)?s?\b|where it came from|bounce|knock(ed)? back|뒤로|되돌|튕겨|밀려|후퇴|물러/, 'back'], [/forward|onward|ahead|further|앞으로|더 나아|미끄러|들어온\s*방향/, 'forward'],
  ];
  const moveWord = /push|shove|forced?|knock|slide|fling|thrown|launch|bounce|blown|pulled|move[sd]? |sent |send |go(es)? |carried|밀|날아|튕|이동|미끄러/.test(t) || /back(ward)?s? (\d|one|two|three|a )|(\d|one|two|three)\s*(squares?|spaces?|steps?|cells?|칸)|(한|두|세)\s*칸/.test(t);
  if (moveWord && !found.includes('home') && !found.includes('teleport')) {
    const dirs = dirMatch.filter(([re]) => re.test(t)).map(([, d]) => d);
    let uniqDirs = [...new Set(dirs)];
    // "밀려난다"/"bounce" only say "pushed"; with an explicit compass direction they mean that direction.
    if (uniqDirs.length > 1 && uniqDirs.includes('back') && !/back(ward)?s?\b|where it came from|뒤로|되돌|후퇴|물러/.test(t)) uniqDirs = uniqDirs.filter(d => d !== 'back');
    if (uniqDirs.length > 1 && uniqDirs.includes('forward') && !/forward|onward|ahead|앞으로|들어온\s*방향/.test(t)) uniqDirs = uniqDirs.filter(d => d !== 'forward');
    if (uniqDirs.length === 1) { dir = uniqDirs[0]; found.push('shove'); }
    else if (uniqDirs.length > 1) return { status: 'reject', source: 'offline-parser', reason: `Which way? I read several directions (${uniqDirs.join(', ')}). Pick one: north, south, east, west, back or forward.` };
    else if (/push|shove|knock/.test(t)) { dir = 'back'; found.push('shove'); }
  }
  const uniq = [...new Set(found)];
  if (uniq.length === 0)
    return { status: 'reject', source: 'offline-parser', reason: 'I couldn’t match that to an effect I can run. Supported: forced 1–3 squares (north/south/east/west/back/forward), freeze one turn, send home, random teleport, shield, +1 action.' };
  if (uniq.length > 1)
    return { status: 'reject', source: 'offline-parser', reason: `One effect per rule, please. I read: ${uniq.join(' + ')}. Pick one.` };
  const kind = uniq[0];
  const n = firstAmount(t);
  if (kind === 'shove') {
    let amount = n ?? 1, status: 'ok' | 'approximate' = 'ok', note = '';
    if (amount > MAX_SHOVE) { status = 'approximate'; note = `You asked for ${amount} squares; the maximum is ${MAX_SHOVE}, so it would be ${MAX_SHOVE}.`; amount = MAX_SHOVE; }
    const effect = makeEffect('shove', dir!, amount);
    return { status, effect, summary: describeEffect(effect), note, source: 'offline-parser' };
  }
  const effect = makeEffect(kind);
  if (kind === 'freeze' && n !== null && n > 1) return { status: 'approximate', effect, summary: describeEffect(effect), note: `You asked for ${n} turns; the maximum is 1 turn, so nobody gets locked out.`, source: 'offline-parser' };
  if (kind === 'haste' && n !== null && n > 1) return { status: 'approximate', effect, summary: describeEffect(effect), note: `You asked for ${n} extra actions; the maximum is 1.`, source: 'offline-parser' };
  return { status: 'ok', effect, summary: describeEffect(effect), note: '', source: 'offline-parser' };
}

/** Validates a model's structured reply into an Interpretation. Throws on anything malformed. */
export function parseModelInterpretation(value: unknown, originalText: string): Interpretation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('model reply is not an object');
  const v = value as Record<string, unknown>;
  const allowed = ['status', 'kind', 'dir', 'amount', 'note'];
  if (Object.keys(v).some(k => !allowed.includes(k))) throw new Error('unexpected fields in model reply');
  if (v.status !== 'ok' && v.status !== 'approximate' && v.status !== 'reject') throw new Error('bad status');
  const note = typeof v.note === 'string' ? v.note.slice(0, 240) : '';
  const p = policyReject(originalText);
  if (p) return { status: 'reject', reason: p, source: 'input-guard' };
  if (v.status === 'reject') return { status: 'reject', reason: note || 'The interpreter declined this rule.', source: 'openrouter' };
  if (typeof v.kind !== 'string' || !EFFECT_KINDS.includes(v.kind as EffectKind)) throw new Error('unknown effect kind');
  let effect: Effect;
  if (v.kind === 'shove') {
    if (!SHOVE_DIRS.includes(v.dir as ShoveDir)) throw new Error('bad direction');
    if (v.amount !== 1 && v.amount !== 2 && v.amount !== 3) throw new Error('bad amount');
    effect = { kind: 'shove', dir: v.dir as ShoveDir, amount: v.amount };
  } else effect = makeEffect(v.kind as EffectKind);
  if (!isEffect(effect)) throw new Error('invalid effect');
  if (v.status === 'approximate' && !note) throw new Error('approximation without disclosure');
  return { status: v.status, effect, summary: describeEffect(effect), note: v.status === 'approximate' ? note : '', source: 'openrouter' };
}

export const INTERPRET_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['ok', 'approximate', 'reject'] },
    kind: { type: 'string', enum: [...EFFECT_KINDS, 'none'] },
    dir: { type: 'string', enum: [...SHOVE_DIRS, 'none'] },
    amount: { type: 'integer', enum: [1, 2, 3] },
    note: { type: 'string' },
  },
  required: ['status', 'kind', 'dir', 'amount', 'note'],
} as const;
