/** V3 batch worker thread: installs the offline guard FIRST, then plays fully recorded self-play games on request. */
import { installOfflineGuard, guardReport } from './offline.ts';
installOfflineGuard();
const { parentPort } = await import('node:worker_threads');
const { playGame, jobOpts } = await import('../selfplay.ts');
const { freezeWeights } = await import('../../weights.ts');
type Job = import('../selfplay.ts').Job;

parentPort!.on('message', (m: { i: number; job: Job; maxMs?: number }) => {
  const t0 = process.threadCpuUsage();
  try {
    const rec = playGame(m.job.seed, m.job.first, { human: freezeWeights(m.job.weights.human), ai: freezeWeights(m.job.weights.ai) }, jobOpts(m.job, m.maxMs));
    const cpu = process.threadCpuUsage(t0);
    parentPort!.postMessage({ i: m.i, rec, guard: guardReport(), cpuMs: Math.round((cpu.user + cpu.system) / 1000) });
  } catch (e) { parentPort!.postMessage({ i: m.i, error: `seed ${m.job.seed}/${m.job.first}: ${(e as Error).stack ?? e}`, guard: guardReport() }); }
});
