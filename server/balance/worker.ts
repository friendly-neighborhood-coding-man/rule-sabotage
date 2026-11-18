/** Worker thread: plays self-play games on request (see runJobs in selfplay.ts). */
import { parentPort } from 'node:worker_threads';
import { playGame, type Job } from './selfplay.ts';
import { freezeWeights } from '../weights.ts';

parentPort!.on('message', (m: { i: number; job: Job; maxMs?: number }) => {
  try {
    const rec = playGame(m.job.seed, m.job.first, { human: freezeWeights(m.job.weights.human), ai: freezeWeights(m.job.weights.ai) }, { maxMs: m.maxMs });
    parentPort!.postMessage({ i: m.i, rec });
  } catch (e) { parentPort!.postMessage({ i: m.i, error: `seed ${m.job.seed}/${m.job.first}: ${(e as Error).stack ?? e}` }); }
});
