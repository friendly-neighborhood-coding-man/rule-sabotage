/**
 * Append-only, hash-chained change journal (NDJSON). Each entry carries the hash of the previous
 * one, so any edit or deletion of history is detectable with verifyJournal(). Never rewritten.
 */
import { appendFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

export type JournalEntry = { seq: number; at: string; type: string; runId: string; cycle: number | null; data: unknown; prevHash: string; hash: string };
const GENESIS = '0'.repeat(16);
const h = (e: Omit<JournalEntry, 'hash'>) => createHash('sha256').update(JSON.stringify([e.seq, e.at, e.type, e.runId, e.cycle, e.data, e.prevHash])).digest('hex').slice(0, 16);

export function readJournal(file: string): JournalEntry[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
}
export function verifyJournal(file: string): { ok: boolean; entries: number; problem: string | null } {
  const es = readJournal(file);
  let prev = GENESIS;
  for (const [i, e] of es.entries()) {
    if (e.seq !== i + 1) return { ok: false, entries: es.length, problem: `entry ${i + 1}: seq ${e.seq}` };
    if (e.prevHash !== prev) return { ok: false, entries: es.length, problem: `entry ${e.seq}: chain broken` };
    const { hash, ...rest } = e;
    if (h(rest) !== hash) return { ok: false, entries: es.length, problem: `entry ${e.seq}: content altered` };
    prev = hash;
  }
  return { ok: true, entries: es.length, problem: null };
}
export function appendJournal(file: string, type: string, runId: string, cycle: number | null, data: unknown): JournalEntry {
  mkdirSync(dirname(file), { recursive: true });
  const v = verifyJournal(file);
  if (!v.ok) throw new Error(`Refusing to append: journal ${file} failed verification (${v.problem}).`);
  const es = readJournal(file);
  const last = es[es.length - 1];
  const base = { seq: es.length + 1, at: new Date().toISOString(), type, runId, cycle, data, prevHash: last ? last.hash : GENESIS };
  const e: JournalEntry = { ...base, hash: h(base) };
  appendFileSync(file, JSON.stringify(e) + '\n');
  return e;
}
