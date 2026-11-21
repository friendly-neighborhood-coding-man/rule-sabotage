/**
 * V6.2 human-pilot readiness for the V6 / V6.1 game (EXPERIMENTAL-V6-NOT-PRODUCTION). Reuses the PR #14 consent-based
 * storage (server/playtest/telemetry.ts: consent record, separate telemetry and feedback streams, withdraw) without
 * changing any gameplay rule. V6 data goes to its own directory, playtest-data/v6/ (gitignored), never mixed with the
 * PR #14 7x7 playtest data.
 *
 *  - Gameplay FACTS (telemetry stream) are built by the server from what happened in the engine.
 *  - SUBJECTIVE answers (feedback stream) are only what the participant typed or clicked; nothing is inferred or invented.
 *  - Kane shadow CASES (kane-shadow/<session>/) are the engine referee's decisions, captured for a later, separately
 *    authorized shadow evaluation. Capturing them makes no Kane call.
 *  - Nothing is written without consent; a non-consenting session still plays. withdraw() deletes every file of the
 *    session, shadow cases included.
 */
import { join, resolve } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
process.env.PLAYTEST_DATA_DIR ??= resolve(fileURLToPath(new URL('../../playtest-data/v6/', import.meta.url)));
const T = await import('../playtest/telemetry.ts');
import { ShadowLog, shadowCase } from './kaneshadow.ts';
import { trials, type RefVerdict } from './turn.ts';
import type { Player } from '../rules.ts';

export const V6_TELEMETRY_SCHEMA = 'rule-sabotage/v6-telemetry@1' as const;
export const V6_FEEDBACK_SCHEMA = 'rule-sabotage/v6-feedback@1' as const;
export const { CONSENT_VERSION, CONSENT_STATEMENT, DATA_DIR } = T;
export const SHADOW_STATEMENT = 'If you agree, the referee decisions on effects in your games (yours and the computer opponent’s) are also kept so that they can later be compared with a second, automated reviewer. That reviewer is not run now and never changes a game.';

export type PSessionV6 = { id: string; consented: boolean; participant: string | null; createdAt: number; games: string[] };
const sessions = new Map<string, PSessionV6>();
export const getSession = (id: string | null | undefined) => (id ? sessions.get(id) ?? null : null);

export function newSession(o: { consent: unknown; participant: unknown }): PSessionV6 {
  const participant = typeof o.participant === 'string' && o.participant.trim() ? o.participant.trim().toUpperCase().slice(0, 8) : null;
  if (participant && !/^[A-Z0-9-]{1,8}$/.test(participant)) throw Object.assign(new Error('Participant code: letters and digits only (for example P03). No names.'), { status: 422 });
  const s: PSessionV6 = { id: randomUUID(), consented: o.consent === true, participant, createdAt: Date.now(), games: [] };
  sessions.set(s.id, s);
  T.saveConsent({ schema: T.CONSENT_VERSION, sessionId: s.id, participant, consented: s.consented, at: new Date().toISOString(), mode: 'free', statement: `${T.CONSENT_STATEMENT} ${SHADOW_STATEMENT}` });
  return s;
}

export const shadowLogFor = (sessionId: string) => new ShadowLog(join(T.DATA_DIR, 'kane-shadow', sessionId));
/** Captures one engine referee decision as a shadow case (consenting sessions only). Never calls Kane. */
export function captureShadow(ps: PSessionV6 | null, o: { ruleset: string; gameId: string; proposer: Player; verdict: RefVerdict; text: string }) {
  if (!ps?.consented || !o.verdict.trialId || !o.verdict.effect || !o.verdict.cellKeys) return null;
  const html = trials.get(o.verdict.trialId)?.html ?? null;
  const c = shadowCase({ ruleset: o.ruleset, gameId: o.gameId, turn: o.verdict.turn ?? 0, proposer: o.proposer, placement: { text: o.text, effect: o.verdict.effect, cells: o.verdict.cellKeys }, verdict: o.verdict, trialHtml: html, refereeMs: o.verdict.ms ?? null });
  if (c && html) shadowLogFor(ps.id).addCase(c, html);
  return c;
}

export function saveGameRecord(ps: PSessionV6 | null, rec: unknown) { if (ps?.consented) T.saveGame(ps.id, rec); }

const ITEMS = ['enjoyment', 'challenge', 'predictability', 'strategicChoice', 'playAgain'] as const;
const TAGS = ['repetitive', 'unfair', 'confusing', 'satisfying', 'too-slow', 'too-long', 'too-short'] as const;
/** Validates and stores what the participant answered. Unanswered items stay null; nothing is filled in. */
export function feedback(ps: PSessionV6, gameId: string, b: any) {
  const ratings: Record<string, number | null> = {};
  for (const k of ITEMS) { const v = b?.ratings?.[k]; ratings[k] = Number.isInteger(v) && v >= 1 && v <= 5 ? v : null; }
  const tags = Array.isArray(b?.tags) ? TAGS.filter(t => b.tags.includes(t)) : [];
  const comment = typeof b?.comment === 'string' ? b.comment.slice(0, 600) : '';
  const skipped = b?.skipped === true;
  const rec = { schema: V6_FEEDBACK_SCHEMA, kind: 'subjective', gameId, sessionId: ps.id, participant: ps.participant, at: new Date().toISOString(), skipped, ratings: skipped ? null : ratings, tags: skipped ? [] : tags, comment: skipped ? '' : comment, scale: '1 = not at all, 5 = very much; predictability: 5 = very predictable' };
  if (ps.consented) T.saveFeedback(ps.id, rec);
  return { stored: ps.consented, skipped };
}
export function withdraw(ps: PSessionV6) {
  const removed = T.withdraw(ps.id);
  const shadow = join(T.DATA_DIR, 'kane-shadow', ps.id);
  if (existsSync(shadow)) { rmSync(shadow, { recursive: true, force: true }); removed.push(shadow); }
  ps.consented = false;
  return removed;
}
export const QUESTIONNAIRE = { items: ITEMS, tags: TAGS };
