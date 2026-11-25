/**
 * GW2 access journal, format `gamewatch/gw2-access@1`: one JSON object per line, append-only, written ONLY by the GW2
 * review server (gamewatch/gw2/serve.ts). Nothing an agent submits through the review form becomes a journal field: the
 * form body goes to the notes file, and the journal records only that a finding was stored (its line index and hash).
 *
 * Every line carries: schema, exp (experiment id), session (server-generated, never sent to the client), seq (0, 1, 2,
 * … per session, assigned by the server in the order events happen), at (UTC ISO time, informational only), prev
 * (sha256 of the previous line's bytes; null on seq 0) and type:
 *   session-start  { site: { files: { name: sha256 } }, notes, server }
 *   request        { method, path, kind, evidenceId, status, outcome, bytes, sha256, client }
 *   finding        { noteIndex, noteSha256, nonceValid }
 *   journal-gap    { lost, error }      lines that could not be written before this one
 *   session-end    { events, failures }
 *
 * Integrity, exactly: the seq numbers and the prev hash chain DETECT edits, deletions, insertions and reordering of
 * lines, and a missing session-end detects truncation or a crash. They do not PREVENT anything: whoever can write the
 * file can rewrite the whole chain consistently. There is no signature, no external timestamp and no OS protection.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, existsSync } from 'node:fs';

export const ACCESS_SCHEMA = 'gamewatch/gw2-access@1';
export const SERVER_ID = { name: 'gamewatch/gw2/serve.ts', version: '1' };
export type Kind = 'index' | 'report-form' | 'evidence' | 'other' | 'rejected' | 'post';
export type RequestEvent = { type: 'request'; method: string; path: string | null; kind: Kind; evidenceId: string | null; status: number; outcome: 'completed' | 'aborted'; bytes: number | null; sha256: string | null; client: string };
export type FindingEvent = { type: 'finding'; noteIndex: number; noteSha256: string; nonceValid: boolean };
export type Line = { schema: string; exp: string; session: string; seq: number; at: string; prev: string | null; type: string; [k: string]: unknown };

export const sha256 = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
/** Client attribution token: a short hash of the User-Agent, so the raw header never enters the journal. */
export const clientToken = (ua: string | undefined) => sha256(`ua:${ua ?? ''}`).slice(0, 12);

/** Appends lines for one session. Write failures are counted, never thrown at the caller, and surfaced in the journal. */
export class JournalWriter {
  file: string; exp: string; session: string;
  seq = 0; prev: string | null = null; failures = 0; lost = 0; lastError: string | null = null; closed = false;
  append: (file: string, data: string) => void;
  constructor(o: { file: string; exp: string; session: string; append?: (file: string, data: string) => void }) {
    this.file = o.file; this.exp = o.exp; this.session = o.session; this.append = o.append ?? ((f, d) => appendFileSync(f, d));
  }
  private writeLine(body: Record<string, unknown>): number | null {
    const line = JSON.stringify({ schema: ACCESS_SCHEMA, exp: this.exp, session: this.session, seq: this.seq, at: new Date().toISOString(), prev: this.prev, ...body });
    try { this.append(this.file, line + '\n'); } catch (e) {
      this.failures++; this.lost++; this.lastError = (e as NodeJS.ErrnoException).code ?? (e as Error).name;
      return null;
    }
    this.prev = sha256(line); return this.seq++;
  }
  /** Writes one event; returns its seq, or null when it could not be written (counted as lost). */
  event(body: Record<string, unknown>): number | null {
    if (this.closed) throw new Error('journal closed');
    if (this.lost) {
      const lost = this.lost;
      if (this.writeLine({ type: 'journal-gap', lost, error: this.lastError }) === null) { this.lost++; return null; }
      this.lost = 0;
    }
    return this.writeLine(body);
  }
  close(): void { if (!this.closed) { this.event({ type: 'session-end', events: this.seq + 1, failures: this.failures }); this.closed = true; } }
}

export type JournalStatus = 'valid' | 'incomplete' | 'invalid' | 'unavailable';
export type JournalRead = {
  status: JournalStatus; reasons: string[]; session: string | null; exp: string | null; lines: Line[];
  site: Record<string, string>; clients: string[]; attribution: 'single-client' | 'uncertain' | 'none';
};

/**
 * Read and check one session's journal. 'unavailable': file missing or logging disabled (say why). 'invalid': a line
 * that does not parse, a wrong schema/exp/session, a seq or hash-chain break, an unknown type, or a first line that is
 * not session-start; nothing in an invalid journal is used as evidence. 'incomplete': the chain is intact but lines were
 * lost (journal-gap) or there is no session-end (crash, still running or truncated); recorded events are usable as
 * evidence that something WAS served, but absence of an event proves nothing. 'valid': intact and closed.
 */
export function readJournal(file: string, o: { logging?: 'on' | 'off'; session?: string } = {}): JournalRead {
  const base = { session: o.session ?? null, exp: null, lines: [], site: {}, clients: [], attribution: 'none' as const };
  if (o.logging === 'off') return { ...base, status: 'unavailable', reasons: ['access logging was disabled for this session'] };
  if (!existsSync(file)) return { ...base, status: 'unavailable', reasons: [`no access journal at ${file}`] };
  const raw = readFileSync(file, 'utf8');
  const reasons: string[] = [], lines: Line[] = [];
  const texts = raw.split('\n');
  if (texts[texts.length - 1] !== '') reasons.push('last line is not terminated (partial write)');
  let prev: string | null = null, session: string | null = null, exp: string | null = null, gaps = 0, ended = false;
  const types = new Set(['session-start', 'request', 'finding', 'journal-gap', 'session-end']);
  for (const [i, t] of texts.filter((x, i) => !(x === '' && i === texts.length - 1)).entries()) {
    let l: Line;
    try { l = JSON.parse(t); } catch { reasons.push(`line ${i}: not JSON`); break; }
    if (l.schema !== ACCESS_SCHEMA) { reasons.push(`line ${i}: schema ${String(l.schema)}`); break; }
    if (i === 0) { session = l.session; exp = l.exp; if (l.type !== 'session-start') { reasons.push('line 0: not session-start'); break; } }
    if (o.session && l.session !== o.session) { reasons.push(`line ${i}: belongs to session ${l.session}, expected ${o.session}`); break; }
    if (l.session !== session) { reasons.push(`line ${i}: belongs to another session (${l.session})`); break; }
    if (l.exp !== exp) { reasons.push(`line ${i}: experiment id changed`); break; }
    if (l.seq !== i) { reasons.push(`line ${i}: seq ${l.seq}, expected ${i}`); break; }
    if (l.prev !== prev) { reasons.push(`line ${i}: hash chain broken`); break; }
    if (!types.has(l.type)) { reasons.push(`line ${i}: unknown type ${l.type}`); break; }
    if (ended) { reasons.push(`line ${i}: event after session-end`); break; }
    if (l.type === 'journal-gap') gaps += Number(l.lost) || 1;
    if (l.type === 'session-end') ended = true;
    prev = sha256(t); lines.push(l);
  }
  const intact = lines.length === texts.filter(Boolean).length && !reasons.length;
  const site = (lines[0]?.type === 'session-start' ? (lines[0].site as { files?: Record<string, string> })?.files : undefined) ?? {};
  const clients = [...new Set(lines.filter(l => l.type === 'request').map(l => String(l.client)))];
  const attribution = clients.length === 0 ? 'none' : clients.length === 1 ? 'single-client' : 'uncertain';
  if (!intact) return { status: 'invalid', reasons: reasons.length ? reasons : ['unreadable lines'], session, exp, lines: [], site: {}, clients: [], attribution: 'none' };
  const r2: string[] = [];
  if (gaps) r2.push(`${gaps} event(s) could not be written (journal-gap)`);
  if (!ended) r2.push('no session-end: the session was not closed cleanly, or the journal was truncated');
  return { status: r2.length ? 'incomplete' : 'valid', reasons: r2, session, exp, lines, site, clients, attribution };
}

/** A request that counts as the server having served an evidence page: GET, 200, response completed, body non-empty. */
export const isServedEvidence = (l: Line) => l.type === 'request' && l.method === 'GET' && l.kind === 'evidence' && l.status === 200 && l.outcome === 'completed' && Number(l.bytes) > 0 && typeof l.evidenceId === 'string';
