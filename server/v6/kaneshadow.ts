/**
 * V6.2 Kane SHADOW MODE: infrastructure only (EXPERIMENTAL-V6-NOT-PRODUCTION). PREPARED, NOT RUN.
 *
 * Purpose: later, with separate operator authorization, let Kane look at the same referee trial pages the engine-only
 * referee already produced, and record what Kane WOULD have said next to what the engine DID decide.
 *
 * Authority rules (enforced by construction and by tests/v6-2.test.ts):
 *  - The engine referee (turn.ts refereeV6) is the SOLE authority. This module never receives a game State, never imports
 *    the engine's mutating functions, and has no code path that places, removes, approves or activates an effect.
 *  - A shadow CASE is written once, at decision time, from the engine verdict as it was (approved, rejected, unverified),
 *    including decisions that later look wrong. Kane's verdict, if one is ever obtained, is appended as a SEPARATE record
 *    linked by caseId. Nothing is edited or deleted (append-only NDJSON).
 *  - Only placements that reached the engine trial are cases. A placement refused by a placement rule (A1/A2, occupancy,
 *    cell count) never had a trial page and is not sent anywhere. The effect sent is the engine's typed effect; text is
 *    never re-interpreted into a different or unsupported effect.
 *  - EXECUTION IS DISABLED IN CODE (SHADOW_EXECUTION = 'disabled'). runShadow() refuses unless a test double judge is
 *    injected; the real Kane client (server/kane.ts) is not imported by this module at all. Enabling real runs needs a
 *    code change reviewed by the operator plus the existing paid-call gate (server/balance/v4/kanebudget.ts).
 *  - No automatic promotion: nothing reads shadow results back into refereeing.
 */
import { appendFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Effect, Player } from '../rules.ts';
import type { RefVerdict } from './turn.ts';

export const SHADOW_SCHEMA = 'rule-sabotage/v6-kane-shadow@1' as const;
/** Real Kane execution from shadow mode. 'disabled' until the operator separately authorizes live evaluation. */
export const SHADOW_EXECUTION: 'disabled' = 'disabled';
/** The fixed conditions Kane would judge (identical to the 7x7 referee's KANE_CONDITIONS, see forks/trial.ts). */
export const CONDITIONS_VERSION = 'kane-conditions-v4.1';

export type EngineDecision = {
  final: RefVerdict['final']; stage: RefVerdict['stage']; code: string | null; tier: number | null; message: string; activated: boolean;
  trialId: string | null; refereeMs: number | null;
};
export type ShadowCase = {
  schema: typeof SHADOW_SCHEMA; kind: 'case'; caseId: string; createdAt: string; ruleset: string; gameId: string | null; turn: number;
  proposer: Player; placement: { text: string; effect: Effect; cells: string[] };
  /** What the engine decided, exactly as decided. Never modified afterwards. */
  engine: EngineDecision;
  /** The trial page Kane would be shown (hash only here; the page itself is stored next to the log). */
  trialPageSha256: string; conditionsVersion: string;
};
export type KaneShadowStatus = 'approved' | 'rejected' | 'unverified' | 'error';
export type KaneShadowVerdict = {
  schema: typeof SHADOW_SCHEMA; kind: 'kane'; caseId: string; at: string; status: KaneShadowStatus; reason: string;
  conditionResults: (boolean | null)[]; elapsedMs: number; kaneVersion: string | null; evidencePath: string | null; testDouble: boolean;
};
/**
 * Disagreement types. The engine side is the decision that was actually applied.
 *  agree-approved           engine approved (tier 1/2), Kane approved
 *  agree-not-approved       engine rejected or left unverified, Kane rejected
 *  engine-approved-kane-rejected     the engine let a rule go live that Kane would have refused (most important)
 *  engine-unverified-kane-approved   the engine held back a rule Kane would have allowed (missed opportunity only)
 *  engine-rejected-kane-approved     an engine safety check failed but Kane would allow it (engine check stays binding)
 *  kane-inconclusive        Kane answered unverified, or failed
 */
export type Disagreement = 'agree-approved' | 'agree-not-approved' | 'engine-approved-kane-rejected' | 'engine-unverified-kane-approved' | 'engine-rejected-kane-approved' | 'kane-inconclusive';
export function classify(engine: Pick<EngineDecision, 'final'>, kane: Pick<KaneShadowVerdict, 'status'>): Disagreement {
  if (kane.status === 'unverified' || kane.status === 'error') return 'kane-inconclusive';
  if (engine.final === 'engine-approved') return kane.status === 'approved' ? 'agree-approved' : 'engine-approved-kane-rejected';
  if (kane.status === 'rejected') return 'agree-not-approved';
  return engine.final === 'unverified' ? 'engine-unverified-kane-approved' : 'engine-rejected-kane-approved';
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
/**
 * Builds the shadow case for one referee decision, or null when there is nothing Kane could review (a placement that a
 * placement rule refused before any trial). Pure: reads the verdict and the trial page, changes nothing.
 */
export function shadowCase(o: { ruleset: string; gameId: string | null; turn: number; proposer: Player; placement: { text: string; effect: Effect; cells: string[] }; verdict: RefVerdict; trialHtml: string | null; refereeMs?: number | null }): ShadowCase | null {
  if (o.verdict.stage !== 'engine' || !o.verdict.trialId || !o.trialHtml) return null;
  const v = o.verdict;
  const engine: EngineDecision = { final: v.final, stage: v.stage, code: v.code, tier: v.tier, message: v.message, activated: v.activated, trialId: v.trialId, refereeMs: o.refereeMs ?? null };
  const body = { ruleset: o.ruleset, gameId: o.gameId, turn: o.turn, proposer: o.proposer, placement: structuredClone(o.placement), engine };
  return { schema: SHADOW_SCHEMA, kind: 'case', caseId: sha(JSON.stringify(body) + sha(o.trialHtml)).slice(0, 20), createdAt: new Date().toISOString(), ...structuredClone(body), trialPageSha256: sha(o.trialHtml), conditionsVersion: CONDITIONS_VERSION };
}

/** Append-only shadow log: <dir>/cases.ndjson, <dir>/kane.ndjson, <dir>/pages/<caseId>.html. Never edits a line. */
export class ShadowLog {
  readonly dir: string;
  constructor(dir: string) { this.dir = dir; }
  private ensure() { mkdirSync(join(this.dir, 'pages'), { recursive: true }); }
  addCase(c: ShadowCase, trialHtml: string) {
    this.ensure();
    if (sha(trialHtml) !== c.trialPageSha256) throw new Error('trial page does not match the case');
    appendFileSync(join(this.dir, 'cases.ndjson'), JSON.stringify(c) + '\n');
    const page = join(this.dir, 'pages', `${c.caseId}.html`);
    if (!existsSync(page)) appendFileSync(page, trialHtml);
  }
  addVerdict(v: KaneShadowVerdict) { this.ensure(); appendFileSync(join(this.dir, 'kane.ndjson'), JSON.stringify(v) + '\n'); }
  read(): { cases: ShadowCase[]; verdicts: KaneShadowVerdict[] } {
    const rd = <T>(f: string): T[] => (existsSync(join(this.dir, f)) ? readFileSync(join(this.dir, f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as T) : []);
    return { cases: rd<ShadowCase>('cases.ndjson'), verdicts: rd<KaneShadowVerdict>('kane.ndjson') };
  }
  /** Engine and Kane side by side, every case kept, with the disagreement type and both latencies. */
  report() {
    const { cases, verdicts } = this.read();
    const rows = cases.map(c => {
      const ks = verdicts.filter(v => v.caseId === c.caseId);
      const k = ks.at(-1) ?? null;
      return { caseId: c.caseId, proposer: c.proposer, effect: c.placement.effect, engine: c.engine.final, tier: c.engine.tier, engineMs: c.engine.refereeMs, kane: k?.status ?? 'not-run', kaneMs: k?.elapsedMs ?? null, kaneAttempts: ks.length, testDouble: k?.testDouble ?? null, disagreement: k ? classify(c.engine, k) : null };
    });
    const count = (f: (r: typeof rows[number]) => boolean) => rows.filter(f).length;
    return { cases: rows.length, notRun: count(r => r.kane === 'not-run'), byDisagreement: Object.fromEntries((['agree-approved', 'agree-not-approved', 'engine-approved-kane-rejected', 'engine-unverified-kane-approved', 'engine-rejected-kane-approved', 'kane-inconclusive'] as Disagreement[]).map(d => [d, count(r => r.disagreement === d)])), rows };
  }
  /** What a run WOULD send: no call is made. */
  plan() {
    const { cases, verdicts } = this.read();
    const pending = cases.filter(c => !verdicts.some(v => v.caseId === c.caseId));
    return { execution: SHADOW_EXECUTION, pending: pending.length, byEngineDecision: Object.fromEntries(['engine-approved', 'rejected', 'unverified'].map(f => [f, pending.filter(c => c.engine.final === f).length])), caseIds: pending.map(c => c.caseId) };
  }
  listPages() { return existsSync(join(this.dir, 'pages')) ? readdirSync(join(this.dir, 'pages')) : []; }
}

export class ShadowExecutionDisabled extends Error { constructor() { super('Kane shadow execution is disabled (SHADOW_EXECUTION = disabled). Live evaluation needs separate operator authorization.'); } }
export type Judge = { testDouble: true; judge: (c: ShadowCase, trialHtml: string) => Promise<Omit<KaneShadowVerdict, 'schema' | 'kind' | 'caseId' | 'at' | 'testDouble'>> };
/**
 * Runs pending cases through a judge and appends the verdicts. Only a TEST DOUBLE judge is accepted while
 * SHADOW_EXECUTION is 'disabled'; there is no code path to the real Kane client here. Results are only appended to the
 * shadow log: no return value or side effect reaches a game.
 */
export async function runShadow(log: ShadowLog, judge?: Judge): Promise<number> {
  if (!judge || judge.testDouble !== true) throw new ShadowExecutionDisabled();
  let n = 0;
  for (const id of log.plan().caseIds) {
    const c = log.read().cases.find(x => x.caseId === id)!;
    const html = readFileSync(join(log.dir, 'pages', `${id}.html`), 'utf8');
    const t0 = performance.now();
    let r: Awaited<ReturnType<Judge['judge']>>;
    try { r = await judge.judge(structuredClone(c), html); }
    catch (e) { r = { status: 'error', reason: (e as Error).message.slice(0, 300), conditionResults: [], elapsedMs: Math.round(performance.now() - t0), kaneVersion: null, evidencePath: null }; }
    log.addVerdict({ schema: SHADOW_SCHEMA, kind: 'kane', caseId: id, at: new Date().toISOString(), testDouble: true, ...r });
    n++;
  }
  return n;
}
