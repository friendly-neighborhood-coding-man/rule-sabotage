/** The clean V6 / V6.1 gameplay implementation is frozen (evidence/v6/gameplay-freeze.json); the coverage check stays separate. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const F = await import('../scripts/gameplay-freeze.ts');

test('gameplay files match the freeze manifest', () => {
  const m = JSON.parse(readFileSync(new URL('../evidence/v6/gameplay-freeze.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(m.files), F.frozenFiles(), 'the set of gameplay files changed');
  for (const [f, h] of Object.entries(m.files as Record<string, string>)) assert.equal(F.hashFile(f), h, `${f} changed after the gameplay freeze`);
});

test('the experimental coverage module is not used by any gameplay or referee code', () => {
  for (const f of F.frozenFiles().filter(x => x.endsWith('.ts'))) assert.doesNotMatch(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'), /coverage\.ts/, f);
});
