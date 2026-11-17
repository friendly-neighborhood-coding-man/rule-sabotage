/** Deliberately finite game DSL. Never execute LLM-authored TypeScript/JS. */
export type EffectKind = 'back' | 'freeze' | 'forward' | 'shield';
export type Effect = { kind: EffectKind; power: 1 };
export type RuleDSL = { trigger: 'on_enter'; target: 'entering_player'; effect: Effect; consume: 'per_cell_once' };
export type CompilerReply = { supported: boolean; kind: EffectKind | 'none'; explanation: string };
export type AIReply = { type: 'move' | 'deploy' | 'remove' | 'wait'; dir: 'up'|'down'|'left'|'right'|'none'; text: string; slot: number; rationale: string };
export const EFFECT_KINDS: readonly EffectKind[] = ['back','freeze','forward','shield'];
export function isEffectKind(value: unknown): value is EffectKind {
  return typeof value === 'string' && EFFECT_KINDS.includes(value as EffectKind);
}
export function parseCompilerReply(value: unknown): CompilerReply {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Compiler JSON is not an object');
  const x = value as Record<string, unknown>;
  if (typeof x.supported !== 'boolean' || typeof x.explanation !== 'string' || x.explanation.length > 400)
    throw Error('Invalid compiler fields');
  if (x.supported ? !isEffectKind(x.kind) : x.kind !== 'none') throw Error('Unrecognized effect');
  return { supported:x.supported, kind:x.kind as CompilerReply['kind'], explanation:x.explanation };
}
export function parseAIReply(value: unknown): AIReply {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('AI JSON is not an object');
  const x = value as Record<string, unknown>;
  if (!['move','deploy','remove','wait'].includes(String(x.type))) throw Error('Invalid action type');
  if (!['up','down','left','right','none'].includes(String(x.dir))) throw Error('Invalid direction');
  if (typeof x.text !== 'string' || x.text.length > 180) throw Error('Invalid proposal text');
  if (!Number.isInteger(x.slot) || (x.slot as number) < -1 || (x.slot as number) > 4) throw Error('Invalid slot');
  if (typeof x.rationale !== 'string' || x.rationale.length > 400) throw Error('Invalid rationale');
  return {type:x.type as AIReply['type'], dir:x.dir as AIReply['dir'], text:x.text, slot:x.slot as number, rationale:x.rationale};
}
export const COMPILER_SCHEMA = {
  type:'object', additionalProperties:false,
  properties:{supported:{type:'boolean'},kind:{type:'string',enum:['back','freeze','forward','shield','none']},explanation:{type:'string'}},
  required:['supported','kind','explanation']
} as const;
export const AI_SCHEMA = {
  type:'object', additionalProperties:false,
  properties:{type:{type:'string',enum:['move','deploy','remove','wait']},dir:{type:'string',enum:['up','down','left','right','none']},text:{type:'string'},slot:{type:'integer',minimum:-1,maximum:4},rationale:{type:'string'}},
  required:['type','dir','text','slot','rationale']
} as const;
