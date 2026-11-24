/** Summarise evidence-before.json vs evidence.json for the closed-loop report. Read-only. */
import { readFileSync } from 'node:fs';
const load = (f: string) => JSON.parse(readFileSync(f, 'utf8'));
const [bf, af] = [process.argv[2] ?? 'evidence/gamewatch/evidence-before.json', process.argv[3] ?? 'evidence/gamewatch/evidence.json'];
type Ev = { type: string; [k: string]: unknown };

function cases(b: any) {
  const out: Record<string, string> = {};
  for (const c of b.cases) {
    const ev: Ev[] = c.steps.flatMap((s: any) => s.events);
    const grants = ev.filter(e => e.type === 'turn-start').map(e => `${e.side === 'Human' ? 'H' : 'A'}${e.actionsGranted}`).join(' ');
    const fired = ev.filter(e => e.type === 'effect-fired').map(e => `${e.square}:${e.effect}`).join(', ');
    const shield = ev.filter(e => e.type === 'shield-absorbed').map(e => e.square).join(',');
    const refused = c.steps.filter((s: any) => s.outcome === 'refused').map((s: any) => `${s.actor} ${s.action}`).join('; ');
    out[c.title] = `grants[${grants}] fired[${fired}] shield[${shield}] refused[${refused}]`;
  }
  return out;
}
function matches(b: any) {
  const r = { Human: 0, AI: 0, draw: 0 } as Record<string, number>;
  let turns = 0, extra = 0, rows = 0, fires = 0, refires = 0, absorbedH = 0, absorbedA = 0;
  const lines: string[] = [];
  for (const m of b.matches) {
    r[m.winner]++; turns += m.turns;
    for (const row of m.rows) {
      rows++; if (row.actionsGranted > row.piecesOnBoard) extra++;
      const ev: Ev[] = row.events;
      fires += ev.filter(e => e.type === 'effect-fired').length;
      for (const e of ev.filter(e => e.type === 'shield-absorbed')) for (const p of e.pieces as string[]) p.startsWith('h') ? absorbedH++ : absorbedA++;
    }
    lines.push(`${m.seed} ${m.firstMover.padEnd(5)} first: winner ${m.winner.padEnd(5)} turns ${m.turns} scored H${m.scored.Human}-A${m.scored.AI}`);
  }
  return { wins: r, avgTurns: (turns / b.matches.length).toFixed(1), rowsWithActionsAbovePieces: `${extra}/${rows}`, effectsFired: fires, shieldAbsorbed: { human: absorbedH, ai: absorbedA }, lines: lines.sort() };
}
for (const [name, f] of [['BEFORE', bf], ['AFTER', af]]) {
  const b = load(f);
  console.log(`\n=== ${name} (${f}, generated ${b.generatedAt}) ===`);
  for (const [t, v] of Object.entries(cases(b)).sort()) console.log(`- ${t}\n    ${v}`);
  const m = matches(b);
  console.log(JSON.stringify({ ...m, lines: undefined }));
  for (const l of m.lines) console.log('  ' + l);
}
