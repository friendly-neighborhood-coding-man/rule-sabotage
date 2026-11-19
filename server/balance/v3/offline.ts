/**
 * Balance Designer V3: the offline guard for batch self-play.
 *
 * The 100-game screen must make ZERO external calls: no Kane, no Groq / OpenRouter / NVIDIA, no remote referee.
 * Self-play never imports game.ts (the only place that routes to an LLM), and tests check the import graph. This
 * guard is the second, runtime layer: it removes every model/API key from the environment, sets the referee off,
 * and replaces every outbound channel Node offers (fetch, http/https requests, raw sockets, TLS, DNS lookups,
 * UDP and child processes such as kane-cli) with a stub that COUNTS the attempt and throws. The batch runner
 * installs it in the main thread and in every worker, collects the counters and refuses to accept a dataset
 * unless the total is exactly 0.
 *
 * Loopback servers are not affected (listening is not an outbound call), but the batch never starts one.
 */
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import dgram from 'node:dgram';
import child from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

export type GuardReport = { installed: boolean; attempts: number; blocked: { channel: string; detail: string }[]; strippedEnv: string[] };
const report: GuardReport = { installed: false, attempts: 0, blocked: [], strippedEnv: [] };

/** Environment variables that could route anything to a model, an API or Kane. Removed, never read. */
export const SECRET_ENV = /^(GROQ|OPENROUTER|NVIDIA|NIM|OPENAI|ANTHROPIC|GEMINI|GOOGLE|MISTRAL|TOGETHER|FIREWORKS|DEEPSEEK|XAI|HF|HUGGINGFACE|KANE|LAMBDATEST|LT)_/i;

export function installOfflineGuard(): GuardReport {
  if (report.installed) return report;
  for (const k of Object.keys(process.env)) if (SECRET_ENV.test(k) && k !== 'KANE_REFEREE') { report.strippedEnv.push(k); delete process.env[k]; }
  process.env.KANE_REFEREE = 'off';
  process.env.BALANCE_OFFLINE = '1';
  const block = (channel: string) => (...args: unknown[]): never => {
    report.attempts++;
    const detail = String(typeof args[0] === 'string' ? args[0] : (args[0] as { href?: string; host?: string; hostname?: string } | undefined)?.href ?? (args[0] as { host?: string })?.host ?? (args[0] as { hostname?: string })?.hostname ?? '').slice(0, 200);
    report.blocked.push({ channel, detail });
    throw new Error(`OFFLINE GUARD: external call blocked (${channel} ${detail}). The V3 batch runner never calls a model, an API or Kane.`);
  };
  (globalThis as { fetch: unknown }).fetch = block('fetch');
  if ('WebSocket' in globalThis) (globalThis as { WebSocket: unknown }).WebSocket = block('WebSocket');
  for (const [mod, name] of [[http, 'http'], [https, 'https']] as const) { (mod as unknown as Record<string, unknown>).request = block(`${name}.request`); (mod as unknown as Record<string, unknown>).get = block(`${name}.get`); }
  (net as unknown as Record<string, unknown>).connect = block('net.connect');
  (net as unknown as Record<string, unknown>).createConnection = block('net.createConnection');
  (tls as unknown as Record<string, unknown>).connect = block('tls.connect');
  (dns as unknown as Record<string, unknown>).lookup = block('dns.lookup');
  (dns as unknown as Record<string, unknown>).resolve = block('dns.resolve');
  (dgram as unknown as Record<string, unknown>).createSocket = block('dgram.createSocket');
  for (const f of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) (child as unknown as Record<string, unknown>)[f] = block(`child_process.${f}`);
  syncBuiltinESMExports();
  report.installed = true;
  return report;
}
export const guardReport = (): GuardReport => structuredClone(report);
