/**
 * GW2 P4: the declarative hypothesis representation `gamewatch/gw2-hypothesis@1` and its hand-written validator and
 * interpreter. No code is generated or evaluated from strings: an expression is a JSON tree over a CLOSED operator set,
 * walked by `evalExpr`. Anything outside the set is reported as not representable, never repaired or approximated.
 *
 * A representation is a list of clauses. Each clause is about one SITUATION KIND (gamewatch/gw2/situations.ts):
 *   law         { form: 'law', situation, when?, expect: [{ field, equals }] }
 *               "in every situation of this kind where `when` holds, outcome `field` equals the expression `equals`".
 *               `when` and `equals` may only use INPUT fields; `field` must be an OUTCOME field. A law therefore
 *               predicts outcome values from inputs, which is what lets H↔S compare two laws on the same situations.
 *   invariance  { form: 'invariance', situation, when?, groupBy: [inputs], vary: [inputs], outcomes: [outcomes] }
 *               "situations that agree on `groupBy` and differ only in `vary` have the same `outcomes`".
 * Operators (closed set): const, field, eq, ne, lt, le, gt, ge, and, or, not, in, add, sub.
 * Values: numbers, strings, booleans. A field the evidence does not record is UNKNOWN; unknown propagates (three-valued
 * logic), so a situation with unknown inputs is excluded as missing evidence, never counted as a counter-example.
 */
import { SITUATION_FIELDS, type SituationKind } from './situations.ts';

export const HYPOTHESIS_SCHEMA = 'gamewatch/gw2-hypothesis@1';
export const OPERATORS = ['const', 'field', 'eq', 'ne', 'lt', 'le', 'gt', 'ge', 'and', 'or', 'not', 'in', 'add', 'sub'] as const;
export type Value = number | string | boolean;
export type Expr =
  | { op: 'const'; value: Value }
  | { op: 'field'; name: string }
  | { op: 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge' | 'add' | 'sub'; args: [Expr, Expr] }
  | { op: 'and' | 'or'; args: Expr[] }
  | { op: 'not'; args: [Expr] }
  | { op: 'in'; args: [Expr]; values: Value[] };
export type LawClause = { form: 'law'; situation: SituationKind; when?: Expr; expect: { field: string; equals: Expr }[] };
export type InvarianceClause = { form: 'invariance'; situation: SituationKind; when?: Expr; groupBy: string[]; vary: string[]; outcomes: string[] };
export type Clause = LawClause | InvarianceClause;
export type Representation = { schema: typeof HYPOTHESIS_SCHEMA; clauses: unknown[] };
export type ClauseCheck = { index: number; ok: true; clause: Clause } | { index: number; ok: false; problems: string[]; raw: unknown };
export type RepresentationCheck = { status: 'represented' | 'partially-represented' | 'not-representable'; clauses: ClauseCheck[]; problems: string[] };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isValue = (x: unknown): x is Value => typeof x === 'number' ? Number.isFinite(x) : typeof x === 'string' || typeof x === 'boolean';
const MAX_DEPTH = 12, MAX_NODES = 200;

function checkExpr(e: unknown, kind: SituationKind, allowed: 'input' | 'any', bad: string[], path: string, depth = 0, count = { n: 0 }): void {
  if (++count.n > MAX_NODES) { bad.push(`${path}: expression too large (more than ${MAX_NODES} nodes)`); return; }
  if (depth > MAX_DEPTH) { bad.push(`${path}: expression nested deeper than ${MAX_DEPTH}`); return; }
  if (!isObj(e)) { bad.push(`${path}: not an expression object`); return; }
  const op = e.op;
  if (!(OPERATORS as readonly unknown[]).includes(op)) { bad.push(`${path}: operator ${JSON.stringify(op)} is not in the closed set (${OPERATORS.join(', ')})`); return; }
  const keys = Object.keys(e), want = op === 'const' ? ['op', 'value'] : op === 'field' ? ['op', 'name'] : op === 'in' ? ['op', 'args', 'values'] : ['op', 'args'];
  for (const k of keys) if (!want.includes(k)) bad.push(`${path}: unknown key "${k}" for operator ${op}`);
  if (op === 'const') { if (!isValue(e.value)) bad.push(`${path}: const value must be a finite number, a string or a boolean`); return; }
  if (op === 'field') {
    const f = SITUATION_FIELDS[kind], name = e.name;
    if (typeof name !== 'string' || !(name in f.inputs || name in f.outcomes)) { bad.push(`${path}: field ${JSON.stringify(name)} is not a recorded field of ${kind} situations`); return; }
    if (allowed === 'input' && !(name in f.inputs)) bad.push(`${path}: field "${name}" is an outcome; only input fields may be used here`);
    return;
  }
  const args = e.args;
  if (!Array.isArray(args)) { bad.push(`${path}: args must be a list`); return; }
  const arity = ['not', 'in'].includes(op as string) ? 1 : ['and', 'or'].includes(op as string) ? -1 : 2;
  if (arity > 0 && args.length !== arity) bad.push(`${path}: ${op} takes ${arity} argument(s)`);
  if (arity < 0 && args.length < 2) bad.push(`${path}: ${op} takes at least 2 arguments`);
  if (op === 'in' && (!Array.isArray(e.values) || !e.values.length || !e.values.every(isValue))) bad.push(`${path}: in needs a non-empty list of constant values`);
  args.forEach((a, i) => checkExpr(a, kind, allowed, bad, `${path}.args[${i}]`, depth + 1, count));
}

function checkClause(c: unknown, i: number): ClauseCheck {
  const bad: string[] = [], p = `clauses[${i}]`;
  if (!isObj(c)) return { index: i, ok: false, problems: [`${p}: not an object`], raw: c };
  const kind = c.situation as SituationKind;
  if (!(typeof kind === 'string' && kind in SITUATION_FIELDS)) return { index: i, ok: false, problems: [`${p}: situation ${JSON.stringify(c.situation)} is not a supported situation kind (${Object.keys(SITUATION_FIELDS).join(', ')})`], raw: c };
  const F = SITUATION_FIELDS[kind];
  if (c.when !== undefined) checkExpr(c.when, kind, 'input', bad, `${p}.when`);
  if (c.form === 'law') {
    for (const k of Object.keys(c)) if (!['form', 'situation', 'when', 'expect'].includes(k)) bad.push(`${p}: unknown key "${k}" for a law`);
    if (!Array.isArray(c.expect) || !c.expect.length) bad.push(`${p}.expect must be a non-empty list`);
    else c.expect.forEach((x, j) => {
      if (!isObj(x) || Object.keys(x).some(k => !['field', 'equals'].includes(k))) { bad.push(`${p}.expect[${j}] must be {field, equals}`); return; }
      if (typeof x.field !== 'string' || !(x.field in F.outcomes)) bad.push(`${p}.expect[${j}]: ${JSON.stringify(x.field)} is not an outcome field of ${kind} situations`);
      checkExpr(x.equals, kind, 'input', bad, `${p}.expect[${j}].equals`);
    });
  } else if (c.form === 'invariance') {
    for (const k of Object.keys(c)) if (!['form', 'situation', 'when', 'groupBy', 'vary', 'outcomes'].includes(k)) bad.push(`${p}: unknown key "${k}" for an invariance`);
    for (const [k, set] of [['groupBy', F.inputs], ['vary', F.inputs], ['outcomes', F.outcomes]] as const) {
      const v = c[k];
      if (!Array.isArray(v) || (k !== 'groupBy' && !v.length) || v.some(x => typeof x !== 'string' || !(x in set))) bad.push(`${p}.${k} must list ${k === 'outcomes' ? 'outcome' : 'input'} fields of ${kind} situations`);
    }
    if (Array.isArray(c.groupBy) && Array.isArray(c.vary) && c.vary.some(x => (c.groupBy as unknown[]).includes(x))) bad.push(`${p}: a field cannot be both grouped and varied`);
  } else bad.push(`${p}: form ${JSON.stringify(c.form)} is not supported (law, invariance)`);
  return bad.length ? { index: i, ok: false, problems: bad, raw: c } : { index: i, ok: true, clause: c as unknown as Clause };
}

/** Validate a representation. Never throws on bad input; reports per clause. */
export function checkRepresentation(r: unknown): RepresentationCheck {
  if (!isObj(r) || r.schema !== HYPOTHESIS_SCHEMA || !Array.isArray(r.clauses) || !r.clauses.length)
    return { status: 'not-representable', clauses: [], problems: [`a representation must be {schema: "${HYPOTHESIS_SCHEMA}", clauses: [...]} with at least one clause`] };
  const extra = Object.keys(r).filter(k => !['schema', 'clauses'].includes(k));
  const clauses = r.clauses.map(checkClause), ok = clauses.filter(c => c.ok).length;
  const problems = [...extra.map(k => `unknown key "${k}"`), ...clauses.flatMap(c => c.ok ? [] : c.problems)];
  return { status: extra.length || ok === 0 ? 'not-representable' : ok === clauses.length ? 'represented' : 'partially-represented', clauses, problems };
}

export type Unknown = { unknown: string[] };
export const isUnknown = (v: unknown): v is Unknown => isObj(v) && Array.isArray((v as Unknown).unknown);
const unk = (...xs: unknown[]): Unknown => ({ unknown: [...new Set(xs.flatMap(x => isUnknown(x) ? x.unknown : []))].sort() });

/** Interpret a validated expression on one situation's fields (a plain table lookup; no string is ever executed). */
export function evalExpr(e: Expr, fields: Record<string, Value | null>): Value | Unknown {
  switch (e.op) {
    case 'const': return e.value;
    case 'field': { const v = fields[e.name]; return v === null || v === undefined ? { unknown: [e.name] } : v; }
    case 'not': { const a = evalExpr(e.args[0], fields); return isUnknown(a) ? a : !a; }
    case 'in': { const a = evalExpr(e.args[0], fields); return isUnknown(a) ? a : e.values.includes(a); }
    case 'and': case 'or': {
      const vs = e.args.map(a => evalExpr(a, fields)), known = vs.filter(v => !isUnknown(v));
      if (e.op === 'and' && known.some(v => v === false)) return false;
      if (e.op === 'or' && known.some(v => v === true)) return true;
      return known.length === vs.length ? (e.op === 'and') : unk(...vs);
    }
    default: {
      const [a, b] = e.args.map(x => evalExpr(x, fields));
      if (isUnknown(a) || isUnknown(b)) return unk(a, b);
      switch (e.op) {
        case 'eq': return a === b; case 'ne': return a !== b;
        case 'lt': return typeof a === 'number' && typeof b === 'number' ? a < b : unk({ unknown: ['type mismatch'] });
        case 'le': return typeof a === 'number' && typeof b === 'number' ? a <= b : unk({ unknown: ['type mismatch'] });
        case 'gt': return typeof a === 'number' && typeof b === 'number' ? a > b : unk({ unknown: ['type mismatch'] });
        case 'ge': return typeof a === 'number' && typeof b === 'number' ? a >= b : unk({ unknown: ['type mismatch'] });
        case 'add': return typeof a === 'number' && typeof b === 'number' ? a + b : unk({ unknown: ['type mismatch'] });
        case 'sub': return typeof a === 'number' && typeof b === 'number' ? a - b : unk({ unknown: ['type mismatch'] });
      }
    }
  }
}

/** Small constructors, used by the spec encodings and tests (they build the same JSON a submitter would write). */
export const E = {
  c: (value: Value): Expr => ({ op: 'const', value }),
  f: (name: string): Expr => ({ op: 'field', name }),
  eq: (a: Expr, b: Expr): Expr => ({ op: 'eq', args: [a, b] }),
  ne: (a: Expr, b: Expr): Expr => ({ op: 'ne', args: [a, b] }),
  le: (a: Expr, b: Expr): Expr => ({ op: 'le', args: [a, b] }),
  add: (a: Expr, b: Expr): Expr => ({ op: 'add', args: [a, b] }),
  and: (...args: Expr[]): Expr => ({ op: 'and', args }),
  not: (a: Expr): Expr => ({ op: 'not', args: [a] }),
  in: (a: Expr, values: Value[]): Expr => ({ op: 'in', args: [a], values }),
};
