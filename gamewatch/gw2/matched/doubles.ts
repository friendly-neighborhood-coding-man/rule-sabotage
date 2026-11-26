/**
 * GW2 matched comparison: TEST DOUBLES for the pipeline (D143). A double is a scripted investigator that drives the real
 * review server over HTTP exactly as an agent would (reads index.html, takes the nonce from hypothesis.html, reads
 * revision.html in phase 2, posts forms) and returns a synthetic kane-cli stdout and synthetic balances. It never calls
 * kane-cli and never carries the Kane label (author kind test-double).
 *
 * Profiles (phase-1 forms; phase-2 forms):
 *   reviser      wrong law H-1, free-text H-2, abstention H-3; revises H-1 to a better law, withdraws H-2
 *   keeper       one law H-1; submits nothing in phase 2
 *   conflicted   wrong law H-1; two different revisions of H-1
 *   freetext     free text only (no structured representation) in both phases
 *   early        phase 1 times out without run_end after one form; phase 2 as reviser
 *   overspend    phase 1 reports a balance delta above the ceiling (CEILING_EXCEEDED)
 *   unknown      phase 1 balance unreadable afterwards (SPEND_UNKNOWN)
 *   harmful      good law H-1; revises it to a worse one and drops the representation of H-2's revision
 */
import { HYPOTHESIS_SCHEMA } from '../hypothesis.ts';
import { spendOf, type Runner, type CallRequest, type CallResult } from './pipeline.ts';

export type Profile = 'reviser' | 'keeper' | 'conflicted' | 'freetext' | 'early' | 'overspend' | 'unknown' | 'harmful';
const law = (equals: unknown, when?: unknown) => JSON.stringify({ schema: HYPOTHESIS_SCHEMA, clauses: [{ form: 'law', situation: 'turn-start', ...(when ? { when } : {}), expect: [{ field: 'actionsGranted', equals }] }] });
export const LAWS = { three: law({ op: 'const', value: 3 }), pieces: law({ op: 'field', name: 'piecesOnBoard' }), two: law({ op: 'const', value: 2 }) };

type Form = Record<string, string>;
const H = (statement: string, representation?: string, extra: Form = {}): Form => ({ statement, confidence: 'medium', evidence: 'C-000000', ...(representation ? { representation } : {}), ...extra });
const A = (scope: string, extra: Form = {}): Form => ({ abstain: 'yes', abstainScope: scope, statement: '', ...extra });

export function formsFor(profile: Profile, phase: 1 | 2): Form[] {
  if (phase === 1) switch (profile) {
    case 'keeper': return [H('A player gets one action per piece on the board.', LAWS.pieces)];
    case 'freetext': return [H('Moves seem limited each turn.'), H('Effects fire when entered.')];
    case 'early': return [H('Every turn grants three actions.', LAWS.three)];
    case 'harmful': return [H('A player gets one action per piece on the board.', LAWS.pieces), H('Effects fire when entered.')];
    default: return [H('Every turn grants three actions.', LAWS.three), H('Effects fire when entered.'), A('shield behaviour')];
  }
  switch (profile) {
    case 'reviser': case 'early': return [H('A player gets one action per piece on the board.', LAWS.pieces, { revises: 'H-1' }), A('withdrawn', { revises: 'H-2' })];
    case 'conflicted': return [H('Two actions per turn.', LAWS.two, { revises: 'H-1' }), H('One action per piece.', LAWS.pieces, { revises: 'H-1' })];
    case 'freetext': return [H('Moves are limited by the number of pieces.', undefined, { revises: 'H-1' })];
    case 'harmful': return [H('Every turn grants three actions.', LAWS.three, { revises: 'H-1' })];
    default: return [];
  }
}

async function http(url: string, body?: string) {
  const r = await fetch(url, body === undefined ? {} : { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  return { status: r.status, text: await r.text() };
}

/** A runner whose sessions follow `profileOf(session)`. `seen` records the pages each call read (for tests). */
export function doubleRunner(profileOf: (session: string) => Profile, o: { balance?: number; usedPerCall?: number } = {}) {
  let balance = o.balance ?? 2000;
  const seen: Record<string, { revision: string | null; pages: string[] }> = {};
  const runner: Runner = {
    kind: 'test-double',
    async run(r: CallRequest): Promise<CallResult> {
      const profile = profileOf(r.session), base = `http://127.0.0.1:${r.port}`, pages: string[] = [];
      const index = await http(`${base}/index.html`); pages.push('index.html');
      const form = await http(`${base}/hypothesis.html`); pages.push('hypothesis.html');
      const nonce = /name="nonce" value="([0-9a-f]+)"/.exec(form.text)?.[1] ?? '';
      let revision: string | null = null;
      if (r.phase === 2) { revision = (await http(`${base}/revision.html`)).text; pages.push('revision.html'); }
      seen[r.runId] = { revision, pages };
      let forms = formsFor(profile, r.phase);
      const early = profile === 'early' && r.phase === 1;
      if (early) forms = forms.slice(0, 1);
      for (const f of forms.slice(0, 8)) await http(`${base}/hypothesis`, new URLSearchParams({ ...f, nonce }).toString());
      const before = balance;
      const used = profile === 'overspend' && r.phase === 1 ? r.ceilingCredits + 100 : (o.usedPerCall ?? 40);
      balance = Math.round((balance - used) * 1000) / 1000;
      const after = profile === 'unknown' && r.phase === 1 ? null : balance;
      const lines = [JSON.stringify({ type: 'stream_start', cli_version: 'test-double' }), JSON.stringify({ type: 'step', step: 1 })];
      if (!early) lines.push(JSON.stringify({ type: 'run_end', status: 'passed', steps: forms.length + 3, credits_consumed: used }));
      if (index.status !== 200) throw new Error('index.html not served');
      return { exitCode: early ? null : 0, timedOut: early, stdout: lines.join('\n') + '\n', stderr: '', spend: spendOf(before, after, r.ceilingCredits), args: { double: profile } };
    },
  };
  return { runner, seen };
}
