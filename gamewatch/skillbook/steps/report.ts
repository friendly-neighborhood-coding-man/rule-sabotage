/**
 * Analyzer: actionable QA report. Assembles what the run produced (missing parts are stated as missing, never filled in)
 * into out/QA_REPORT.md. Kane findings are quoted verbatim and labelled as Kane's; GameWatch's own statistics are labelled
 * as engine statistics.
 *   node gamewatch/skillbook/steps/report.ts <outDir> <notes.ndjson>
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [out, nf] = process.argv.slice(2);
const j = (f: string) => (existsSync(join(out, f)) ? JSON.parse(readFileSync(join(out, f), 'utf8')) : null);
const d = j('discovery.json'), g = j('gaps.json'), p = j('porter.json'), bal = j('balance.json'), au = j('audit.json'), rg = j('regression.json');
const notes = existsSync(nf) ? readFileSync(nf, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(n => n.source === 'kane' && n.nonceValid) : [];
const L: string[] = ['# GameWatch QA report', '', `Generated ${new Date().toISOString()}. Sections marked NOT RUN were not executed in this run.`, ''];
L.push('## Collector', d ? `- ${d.game}: ${d.rules.length} documented rules; sources: ${d.playtestSources.aiOpponents.length} AI opponents, ${d.playtestSources.scriptedPlaytests.length} scripted playtests, human playtest entries: ${d.playtestSources.humanPlaytestData.entries}. kane-cli: ${d.kaneCli.found ? d.kaneCli.version : 'not found'}.` : '- discovery NOT RUN',
  g ? `- Evidence coverage: ${g.gaps.length ? `${g.gaps.length} gaps: ${g.gaps.join('; ')}` : `every one of ${g.rules} rules exercised on every build`}.` : '- coverage NOT RUN', '');
L.push('## Porter', p ? `- ${p.pages} evidence pages, leak check ${p.hits.length ? `FAILED (${p.hits.length})` : 'clean'} (${p.termsChecked} terms).` : '- NOT RUN', '');
L.push('## Analyzer: Kane review (verbatim findings)');
if (!notes.length) L.push('- NOT RUN or no valid Kane finding. Nothing is reported on Kane\'s behalf.');
for (const n of notes) L.push(`- **[${n.category}]** (${n.confidence ?? '?'}) rules ${n.rules || '-'}, builds ${n.builds || '-'}: ${n.claim}`, `  - evidence: ${n.evidence}`, `  - reproduce: ${n.reproduce || '-'}`, `  - suggestion: ${n.suggestion || '-'}`);
L.push('', '## Analyzer: coverage audit of the review', au ? `- ${au.findings} findings; rules cited ${au.rulesCited.join(', ') || 'none'}; not cited ${au.rulesNotCited.join(', ')}; ${au.casesCited.length} cases and ${au.matchesCited.length} matches cited; ${au.findingsWithoutEvidenceIds} findings without evidence ids.` : '- NOT RUN', '');
L.push('## Analyzer: balance (GameWatch engine statistics, not Kane)');
if (bal) for (const [b, x] of Object.entries(bal.builds as Record<string, any>)) L.push(`- ${b}: first mover won ${x.firstMoverWins}/${x.decided} (sign test p=${x.signTestP}); matched pairs ${x.matchedPairs.firstMoverWonBoth}-${x.matchedPairs.secondMoverWonBoth} (split ${x.matchedPairs.split}); actions minus pieces per turn: first mover ${x.actionsMinusPieces.firstMover.meanExtraActions}, second mover ${x.actionsMinusPieces.secondMover.meanExtraActions}; median ${x.medianTurns} turns.`);
else L.push('- NOT RUN');
L.push('', '## Analyzer: regression review', rg ? `- vs reference ${rg.reference}: ${rg.nowMatchingReference.length} scripts now match, ${rg.stillDifferent.length} still differ, ${rg.regressions.length} regressions.` : '- NOT RUN (needs a corrected build)', '');
writeFileSync(join(out, 'QA_REPORT.md'), L.join('\n') + '\n');
console.log(L.join('\n'));
