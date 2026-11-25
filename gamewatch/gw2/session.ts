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
  counts: boolean; // nonce valid, this session, and (when a usable journal exists) joined to it
};
export type Session = { dir: string; meta: Record<string, unknown>; journal: JournalRead; findings: SessionFinding[] };

export function loadSession(dir: string): Session {
  const metaF = join(dir, 'session.json');
  if (!existsSync(metaF)) throw new Error(`not a GW2 session directory (no session.json): ${dir}`);
  const meta = JSON.parse(readFileSync(metaF, 'utf8'));
  const journal = readJournal(join(dir, String(meta.journal ?? 'access.ndjson')), { logging: meta.logging, session: meta.session });
  const usable = journal.status === 'valid' || journal.status === 'incomplete';
  const events = new Map<number, Line>();
  if (usable) for (const l of journal.lines) if (l.type === 'finding') events.set(Number(l.noteIndex), l);
  const { lines, records } = readNdjson(join(dir, String(meta.notes ?? 'notes.ndjson')));
  const findings = records.map((note, i): SessionFinding => {
    const ev = events.get(i), line = lines[i];
    const join = !usable ? 'journal-unavailable' : !ev ? 'not-in-journal' : ev.noteSha256 !== sha256(line) ? 'note-changed' : 'joined';
    const own = note.nonceValid === true && note.session === meta.session;
    return { noteIndex: i, line, note, seq: join === 'joined' ? Number(ev!.seq) : null, join, counts: own && (join === 'joined' || join === 'journal-unavailable') };
  });
  return { dir, meta, journal, findings };
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
