/**
 * KS1 coverage evaluation (no Kane call; originals in evidence/v6/kane-preflight/ are read, never modified).
 * Rebuilds the KS1 trial from the saved position, checks it reproduces the recorded engine decision, measures coverage,
 * generates the missing scenario with the proposed pre-burn rule, and writes the separated evaluation record to
 * evidence/v6/ks1-evaluation/ks1-evaluation-record.json. Run: npm run ks1:coverage
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './v6-fork.ts';
import { buildTrial } from '../server/v6/forks/trial.ts';
import { selectTier } from '../server/v6/forks/tiers.ts';
import { trialCoverage, supplementaryScenarios, evaluationRecord } from '../server/v6/coverage.ts';
import type { State, Placement } from '../server/v6/engine.ts';

const D = join(ROOT, 'evidence/v6/kane-preflight');
const state = JSON.parse(readFileSync(join(D, 'state-before.json'), 'utf8')) as State;
const kase = JSON.parse(readFileSync(join(D, 'case.json'), 'utf8'));
const engine = JSON.parse(readFileSync(join(D, 'engine-verdict.json'), 'utf8'));
const kane = readFileSync(join(D, 'shadow/kane.ndjson'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter((v: { testDouble: boolean }) => !v.testDouble);
if (kane.length !== 1) throw new Error(`expected exactly one real Kane verdict, found ${kane.length}`);
const pl: Placement = { text: kase.placement.text, effect: kase.placement.effect, cells: kase.placement.cells, interpretedBy: 'ks1 fixture' };
const trial = buildTrial(state, kase.proposer, pl, 8001);
const tier = selectTier(state, kase.proposer, pl, trial);
if (tier.tier !== engine.tier || !tier.reasons.join('; ').includes('a new cell could not be entered in the trial')) throw new Error('the rebuilt trial does not reproduce the recorded engine decision');
const coverage = trialCoverage(trial, pl);
const supplementary = supplementaryScenarios(state, kase.proposer, pl, coverage);
const record = evaluationRecord({ protocol: 'kane-conditions-v4.1 (six fixed conditions, unchanged)', results: kane[0].conditionResults, source: 'Kane KS1 call 2026-11-24 (evidence/v6/kane-preflight/shadow/kane.ndjson)', coverage, referee: { final: engine.final, tier: engine.tier, activated: engine.activated }, supplementary });
mkdirSync(join(ROOT, 'evidence/v6/ks1-evaluation'), { recursive: true });
writeFileSync(join(ROOT, 'evidence/v6/ks1-evaluation/ks1-evaluation-record.json'), JSON.stringify({ schema: 'rule-sabotage/ks1-evaluation-record@1', caseId: kase.caseId, createdAt: new Date().toISOString(), rebuiltTrialMatchesRecordedDecision: true, symmetryRows: trial.symmetry.map(r => ({ scenario: r.scenarioId, cell: r.cell, from: r.enteredFrom, dir: r.dir, identical: r.identical })), ...record }, null, 1) + '\n');
console.log(JSON.stringify({ coverage: coverage.status, missing: coverage.missing, supplementary: supplementary.map(s => ({ cell: s.cell, from: s.enteredFrom, preBurned: s.preBurned, identical: s.identical, fired: s.fired, human: s.human.endSquare, ai: s.ai.endSquare })), overall: record.overall }, null, 1));
