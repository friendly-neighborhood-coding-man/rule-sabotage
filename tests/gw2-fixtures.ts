/**
 * Shared fixtures for the GW2 P1 tests: a tiny synthetic evidence site and bundle in a temporary directory (a designated
 * temporary workspace outside the repository), and a deterministic HTTP test double. No Kane, no model, no network
 * beyond 127.0.0.1.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';

export const CASES = ['C-aaaaaa', 'C-bbbbbb', 'C-9fc650'], MATCHES = ['M-cccccc'], RULES = ['R1', 'R2', 'R8', 'R14'];

export function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'gw2-p1-')), site = join(root, 'site');
  mkdirSync(site);
  writeFileSync(join(site, 'index.html'), '<!doctype html><title>index</title>' + [...CASES.map(c => `<a href="case-${c}.html">${c}</a>`), ...MATCHES.map(m => `<a href="match-${m}.html">${m}</a>`)].join(''));
  writeFileSync(join(site, 'report.html'), '<!doctype html><form method="post" action="/report"><input type="hidden" name="nonce" value="__NONCE__"></form>');
  for (const c of CASES) writeFileSync(join(site, `case-${c}.html`), `<!doctype html><h1>Case ${c}</h1>`);
  for (const m of MATCHES) writeFileSync(join(site, `match-${m}.html`), `<!doctype html><h1>Match ${m}</h1>`);
  const bundle = { schema: 'gamewatch/evidence@1', game: { name: 't', version: '1', rules: RULES.map(id => ({ id, text: `rule ${id}` })) }, source: [], builds: [],
    cases: CASES.map(caseId => ({ caseId })), matches: MATCHES.map(matchId => ({ matchId })), generatedAt: '', generator: { commit: null, command: '' } };
  const bundleF = join(root, 'bundle.json');
  writeFileSync(bundleF, JSON.stringify(bundle));
  return { root, site, bundleF, bundle, out: join(root, 'out') };
}

/** One request; resolves with status and body (HEAD resolves with an empty body). */
export function req(port: number, path: string, o: { method?: string; ua?: string; body?: string } = {}): Promise<{ status: number; body: Buffer }> {
  return new Promise((res, rej) => {
    const r = request({ host: '127.0.0.1', port, path, method: o.method ?? 'GET', headers: { 'user-agent': o.ua ?? 'gw2-test-double/1', ...(o.body ? { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(o.body) } : {}) } }, resp => {
      const chunks: Buffer[] = []; resp.on('data', c => chunks.push(c)); resp.on('end', () => res({ status: resp.statusCode ?? 0, body: Buffer.concat(chunks) }));
    });
    r.on('error', rej); if (o.body) r.write(o.body); r.end();
  });
}
export const submit = (port: number, fields: Record<string, string>, ua?: string) => req(port, '/report', { method: 'POST', body: new URLSearchParams(fields).toString(), ua });
export const lines = (text: string) => text.split('\n').filter(Boolean).map(l => JSON.parse(l));
