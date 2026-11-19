/** Small, dependency-free statistics for the V3 screen. Everything is exact or seeded, so analyses are reproducible. */

export const r3 = (x: number) => Math.round(x * 1000) / 1000;
export const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
export const sd = (a: number[]) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
export const quant = (a: number[], q: number) => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); const i = (b.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return b[lo] + (b[hi] - b[lo]) * (i - lo); };

/** Wilson 95% interval for k successes out of n. */
export function wilson(k: number, n: number, z = 1.959964): [number, number] {
  if (!n) return [0, 1];
  const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [r3(Math.max(0, (c - h) / d)), r3(Math.min(1, (c + h) / d))];
}
const lchoose = (n: number, k: number) => lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);
function lgamma(x: number): number {
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1; let a = c[0]; const t = x + g + 0.5; for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
/** Exact two-sided binomial test against p = 0.5 (sum of outcomes no more likely than the observed one). */
export function binomTwoSided(k: number, n: number): number {
  if (!n) return 1;
  const pk = (i: number) => Math.exp(lchoose(n, i) - n * Math.LN2);
  const obs = pk(k); let p = 0;
  for (let i = 0; i <= n; i++) if (pk(i) <= obs * (1 + 1e-9)) p += pk(i);
  return r3(Math.min(1, p));
}
/** Smallest k (of n) whose exact two-sided p is below alpha: the observed share needed before a 50/50 split can be rejected. */
export function minSignificantK(n: number, alpha = 0.05): number | null { for (let k = Math.ceil(n / 2); k <= n; k++) if (binomTwoSided(k, n) < alpha) return k; return null; }
const T975: Record<number, number> = { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228, 12: 2.179, 15: 2.131, 19: 2.093, 20: 2.086, 25: 2.06, 30: 2.042, 40: 2.021, 60: 2, 99: 1.984 };
const t975 = (df: number) => { if (df <= 0) return NaN; const ks = Object.keys(T975).map(Number).sort((a, b) => a - b); let best = ks[ks.length - 1]; for (const k of ks) if (k >= df) { best = k; break; } return df > 99 ? 1.96 : T975[best]; };
/** Mean with a 95% t interval (conservative: df rounded down to the next table entry). */
export function meanCI(a: number[], floor = 0) { const m = mean(a), s = sd(a), h = a.length > 1 ? t975(a.length - 1) * s / Math.sqrt(a.length) : NaN; return { n: a.length, mean: r3(m), sd: r3(s), ci: [r3(Math.max(floor, m - h)), r3(m + h)] as [number, number] }; }

export function xorshift(seed: number) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 0x100000000; }; }
/**
 * Permutation test for heterogeneity of a binary outcome across groups (statistic: chi-square of the group x outcome
 * table). Seeded, so the p-value is reproducible. Returns null when there is nothing to test.
 */
export function permutationHeterogeneity(groups: number[][], iters = 20000, seed = 62000): { stat: number; p: number; iters: number } | null {
  const all = groups.flat(); const N = all.length; if (!N || groups.length < 2) return null;
  const tot = all.reduce((a, b) => a + b, 0); if (tot === 0 || tot === N) return { stat: 0, p: 1, iters: 0 };
  const sizes = groups.map(g => g.length), P = tot / N;
  const chi = (ks: number[]) => ks.reduce((s, k, i) => { const e1 = sizes[i] * P, e0 = sizes[i] * (1 - P); return s + (k - e1) ** 2 / e1 + ((sizes[i] - k) - e0) ** 2 / e0; }, 0);
  const obs = chi(groups.map(g => g.reduce((a, b) => a + b, 0)));
  const rnd = xorshift(seed), arr = [...all]; let ge = 0;
  for (let it = 0; it < iters; it++) {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    let o = 0; const ks = sizes.map(sz => { let k = 0; for (let i = 0; i < sz; i++) k += arr[o + i]; o += sz; return k; });
    if (chi(ks) >= obs - 1e-12) ge++;
  }
  return { stat: r3(obs), p: r3((ge + 1) / (iters + 1)), iters };
}
/** Exact sign test on discordant pairs (McNemar-style). */
export function signTest(plus: number, minus: number) { return { plus, minus, p: binomTwoSided(plus, plus + minus) }; }
/** Shannon entropy in bits. */
export const entropy = (counts: number[]) => { const t = counts.reduce((a, b) => a + b, 0); return t ? -counts.filter(Boolean).reduce((a, c) => a + (c / t) * Math.log2(c / t), 0) : 0; };
