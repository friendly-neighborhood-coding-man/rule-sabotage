/**
 * Load one GW2 review session written by gamewatch/gw2/serve.ts: session.json, notes.ndjson and the access journal,
 * joined into one ordered view. Read-only.
 *
 * A finding is joined to the journal's `finding` event by noteIndex AND noteSha256, so its server sequence number comes
 * from the server's ordering, never from the note. A note whose hash does not match its journal event is reported as
 * `note-changed`, and a note without a journal event as `not-in-journal`; their text is still reported verbatim.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readJournal, sha256, isServedEvidence, type JournalRead, type Line } from './journal.ts';
import { readNdjson } from './inventory.ts';

export type SessionFinding = {
  noteIndex: number; line: string; note: Record<string, unknown>; seq: number | null;
  join: 'joined' | 'note-changed' | 'not-in-journal' | 'journal-unavailable';
  /** journal-verified: joined to an intact journal event. unverified-session-note: no usable journal (the note is
   *  kept and usable as an observation, but nothing server-side confirms when it was submitted). journal-mismatch: a
   *  usable journal exists and the note does not match it (not counted; text still reported). */
  verification: 'journal-verified' | 'unverified-session-note' | 'journal-mismatch';
  counts: boolean; // nonce valid, this session, and not a journal mismatch
};
/** findings: notes.ndjson; hypotheses (P3): hypotheses.ndjson, same join rules (noteIndex = hypIndex). */
export type Session = { dir: string; meta: Record<string, unknown>; journal: JournalRead; findings: SessionFinding[]; hypotheses: SessionFinding[] };

export function loadSession(dir: string): Session {
  const metaF = join(dir, 'session.json');
  if (!existsSync(metaF)) throw new Error(`not a GW2 session directory (no session.json): ${dir}`);
  const meta = JSON.parse(readFileSync(metaF, 'utf8'));
  const journal = readJournal(join(dir, String(meta.journal ?? 'access.ndjson')), { logging: meta.logging, session: meta.session });
  const usable = journal.status === 'valid' || journal.status === 'incomplete';
  const joinFile = (file: string, type: 'finding' | 'hypothesis') => {
    const events = new Map<number, Line>();
    if (usable) for (const l of journal.lines) if (l.type === type) events.set(Number(type === 'finding' ? l.noteIndex : l.hypIndex), l);
    const { lines, records } = readNdjson(join(dir, file));
    return records.map((note, i): SessionFinding => {
      const ev = events.get(i), line = lines[i];
      const hash = ev ? (type === 'finding' ? ev.noteSha256 : ev.lineSha256) : null;
      const join = !usable ? 'journal-unavailable' : !ev ? 'not-in-journal' : hash !== sha256(line) ? 'note-changed' : 'joined';
      const own = note.nonceValid === true && note.session === meta.session;
      const verification = join === 'joined' ? 'journal-verified' : join === 'journal-unavailable' ? 'unverified-session-note' : 'journal-mismatch';
      return { noteIndex: i, line, note, seq: join === 'joined' ? Number(ev!.seq) : null, join, verification, counts: own && verification !== 'journal-mismatch' };
    });
  };
  const findings = joinFile(String(meta.notes ?? 'notes.ndjson'), 'finding');
  const hypotheses = joinFile(String(meta.hypotheses ?? 'hypotheses.ndjson'), 'hypothesis');
  return { dir, meta, journal, findings, hypotheses };
}

/**
 * First served-evidence seq per evidence id, and the number of served requests (duplicates kept, counted once for
 * coverage). A response whose content hash differs from the page hash recorded at session start is not counted as
 * serving that evidence page; it is listed in `mismatched`.
 */
export function servedIndex(j: JournalRead): { served: Map<string, { firstSeq: number; requests: number }>; mismatched: number[] } {
  const served = new Map<string, { firstSeq: number; requests: number }>(), mismatched: number[] = [];
  if (j.status !== 'valid' && j.status !== 'incomplete') return { served, mismatched };
  for (const l of j.lines) if (isServedEvidence(l)) {
    if (j.site[String(l.path)] !== l.sha256) { mismatched.push(l.seq); continue; }
    const id = String(l.evidenceId), e = served.get(id);
    if (e) e.requests++; else served.set(id, { firstSeq: l.seq, requests: 1 });
  }
  return { served, mismatched };
}

export type Validity = { status: 'verified' | 'unsuitable-for-primary-analysis' | 'logging-disabled-condition'; primaryAnalysis: boolean; reasons: string[] };
/**
 * Experimental validity of a session, separate from completeness, access coverage and the findings (operator decision
 * 2026-11-25, Q13). Only a "verified" session may enter the primary verified analysis. Every other session is kept and
 * reported separately with its reasons; nothing is deleted, excluded silently or rewritten.
 *   verified                         logging on; journal valid (intact chain, closed, no lost events); one client;
 *                                    every served page matches its start-of-session hash; every own finding journal-verified
 *   logging-disabled-condition       logging explicitly disabled with a stated reason (an authorized condition)
 *   unsuitable-for-primary-analysis  anything else (journal incomplete, invalid or missing; write failures; uncertain
 *                                    attribution; content mismatch; a note that does not match its journal event)
 */
export function experimentalValidity(s: Session): Validity {
  const j = s.journal, reasons: string[] = [];
  if (s.meta.logging === 'off') return { status: 'logging-disabled-condition', primaryAnalysis: false, reasons: [`access logging disabled for this session: ${String(s.meta.loggingDisabledReason ?? '(no reason recorded)')}`] };
  if (j.status !== 'valid') reasons.push(`access journal ${j.status}${j.reasons.length ? `: ${j.reasons.join('; ')}` : ''}`);
  if (j.attribution === 'uncertain') reasons.push(`access attribution uncertain (${j.clients.length} clients)`);
  const { mismatched } = servedIndex(j);
  if (mismatched.length) reasons.push(`served content differs from the session-start page hash at seq ${mismatched.join(', ')}`);
  const own = s.findings.filter(f => f.note.nonceValid === true && f.note.session === s.meta.session);
  const bad = own.filter(f => f.verification !== 'journal-verified');
  if (bad.length) reasons.push(`${bad.length} finding(s) not journal-verified (${bad.map(f => `note ${f.noteIndex}: ${f.verification}`).join(', ')})`);
  const badH = (s.hypotheses ?? []).filter(f => f.note.nonceValid === true && f.note.session === s.meta.session && f.verification !== 'journal-verified');
  if (badH.length) reasons.push(`${badH.length} hypothesis submission(s) not journal-verified (${badH.map(f => `hypothesis ${f.noteIndex}: ${f.verification}`).join(', ')})`);
  return reasons.length ? { status: 'unsuitable-for-primary-analysis', primaryAnalysis: false, reasons } : { status: 'verified', primaryAnalysis: true, reasons: [] };
}
