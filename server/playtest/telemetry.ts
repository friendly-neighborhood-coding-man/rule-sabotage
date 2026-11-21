/**
 * Playtest data storage (local files only, gitignored). Two separate streams, never mixed:
 *
 *   playtest-data/telemetry/<session>.ndjson   FACTUAL gameplay records written by the server (one line per game)
 *   playtest-data/feedback/<session>.ndjson    SUBJECTIVE answers typed by the participant (one line per questionnaire)
 *   playtest-data/sessions/<session>.json      the consent record of the session
 *
 * The two are linked only by gameId. Nothing is written unless the participant consented to recording; a session without
 * consent can still play, and its games exist only in memory for the match review. A participant can withdraw at any time:
 * withdraw() deletes every file of the session. No names are collected; the participant code is whatever the facilitator
 * types (e.g. P03) and is optional.
 */
import { mkdirSync, appendFileSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONSENT_VERSION = 'playtest-consent@1';
export const DATA_DIR = process.env.PLAYTEST_DATA_DIR ? resolve(process.env.PLAYTEST_DATA_DIR) : resolve(fileURLToPath(new URL('../../playtest-data/', import.meta.url)));
const dir = (kind: 'telemetry' | 'feedback' | 'sessions') => { const d = join(DATA_DIR, kind); mkdirSync(d, { recursive: true }); return d; };
const safe = (id: string) => { if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('bad session id'); return id; };

export type ConsentRecord = { schema: typeof CONSENT_VERSION; sessionId: string; participant: string | null; consented: boolean; at: string; mode: 'pilot' | 'free'; statement: string };

export const CONSENT_STATEMENT = [
  'This is a local playtest of an unfinished game. If you agree, the game records on this computer:',
  'which experimental opponent you played, the random seed, who moved first, the result and length of each game,',
  'every effect you wrote and where you placed it, every move you made, how long the computer opponent took to answer,',
  'and how effects interacted. After each game you may answer five short questions about how it felt.',
  'No name, email or account is recorded. Gameplay records and your answers are stored in separate files.',
  'You can play without recording, skip any question, stop at any time, and delete everything recorded in this session.',
].join(' ');

export function saveConsent(c: ConsentRecord) { if (c.consented) writeFileSync(join(dir('sessions'), `${safe(c.sessionId)}.json`), JSON.stringify(c, null, 2)); }
export function saveGame(sessionId: string, rec: unknown) { appendFileSync(join(dir('telemetry'), `${safe(sessionId)}.ndjson`), JSON.stringify(rec) + '\n'); }
export function saveFeedback(sessionId: string, rec: unknown) { appendFileSync(join(dir('feedback'), `${safe(sessionId)}.ndjson`), JSON.stringify(rec) + '\n'); }
/** Deletes every file of one session. Returns the paths removed. */
export function withdraw(sessionId: string): string[] {
  const out: string[] = [];
  for (const [k, ext] of [['telemetry', '.ndjson'], ['feedback', '.ndjson'], ['sessions', '.json']] as const) {
    const f = join(DATA_DIR, k, `${safe(sessionId)}${ext}`);
    if (existsSync(f)) { rmSync(f); out.push(f); }
  }
  return out;
}
export function readAll(kind: 'telemetry' | 'feedback'): unknown[] {
  const d = join(DATA_DIR, kind);
  if (!existsSync(d)) return [];
  return readdirSync(d).filter(f => f.endsWith('.ndjson')).sort().flatMap(f => readFileSync(join(d, f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)));
}
