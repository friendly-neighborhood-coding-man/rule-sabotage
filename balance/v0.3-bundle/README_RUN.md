# Rule Sabotage V0.3 — baseline scores, self-play, Kane review ledger

This bundle preserves Rule Space V0.2 and adds provisional score weights, an **engine-backed** TypeScript AI-vs-AI harness, and a **real-Kane-only** review ledger.

## Files

- `rule_sabotage_rule_space_v0_3.md`: entire source spec plus versioned score and review protocol.
- `balance.weights.json`: initial human-prior scores + candidate perturbation. Candidate is **NOT** Kane-authored.
- `balance-selfplay.ts`: runs both sides via the actual engine in your existing GitHub checkout; not run here.
- `kane-balance-events.jsonl`: append-only review record. **No real Kane execution yet.**
- `run_32/summary.json`: completed standalone *surrogate* 96-game smoke **FAILED SANITY GATE**, not evidence of game balance.
- `run_32_ban8/summary.json`: another 96-game surrogate smoke with the proposed 8-neighbor placement filter; baseline win sides are 16:16 but **first mover lost 32/32**, so it ALSO failed sanity.
- `sandbox_sim.py`: non-authoritative exploratory simulator, retained only to reproduce these failed sanity gates.

## Windows PowerShell operator path

From the real repository (not this downloaded package):

```powershell
cd 'D:\Rule_Sabotage\rule-sabotage-live'
# Copy balance-selfplay.ts into .\scripts\ and balance.weights.json into the repository root.
# Do not overwrite an existing file without review.
node --experimental-strip-types scripts/balance-selfplay.ts 20
# After verifying no runtime errors, rerun with 100 paired seeds:
node --experimental-strip-types scripts/balance-selfplay.ts 100
# Experimental placement filter only (NOT yet an engine rule):
node --experimental-strip-types scripts/balance-selfplay.ts 100 --ban8
```

This script writes one `evidence/balance/<run-id>/` with match records, summary, a weight snapshot, and a `PENDING_REAL_KANE` record. Run `npm test` and `npm run test:browser` before changing engine behavior. Confirm git commit hash, weights hash, parity, and no rejections/timeout errors. Add CI if promoting to a production experiment.

## Kane's actual next step

Kane must be invoked **from a machine where Kane CLI is installed/authenticated** and inspect a frozen browser-visible report. Log exact Kane version, input conditions, real `run_end`, results, and evidence path. A rules engine passing its own simulation is not itself a Kane verdict. A Kane browser check alone does not justify arbitrary numeric score updates. Candidate changes are promoted only after paired held-out self-play and explicit approval, and only for **new games**.

## Limitations

This bundle was generated in an environment that could read the current repository through the GitHub connector but could **not check out that repository or run `kane-cli` locally**. The TypeScript harness passed `node --check --experimental-strip-types`, but its imports/behavior still need to be tested on the real checkout. No PR changes, merges, server deployments, real Kane reviews, or automatic score patches have been made.

## Optional single real Kane review (after a valid 100-seed run)

Copy `balance-kane-review.ts` into the repository's `scripts/` folder. First generate a static report **without consuming Kane credits**:

```powershell
node --experimental-strip-types scripts/balance-kane-review.ts "evidence/balance/YOUR_RUN_ID"
```

Then, **only when intentionally authorizing a real review**, on the operator's PC with logged-in `kane-cli` and Chrome:

```powershell
node --experimental-strip-types scripts/balance-kane-review.ts "evidence/balance/YOUR_RUN_ID" --run-kane
```

The optional script launches the actual Kane adapter against a loopback-hosted HTML report and appends the returned Kane evidence/status to that experiment's ledger. The conditions are *factual browser audit conditions*, including a conservative side-bias sanity check. A Kane `approved` result means **those explicit conditions passed**, not that the weights are universally fair or automatically suitable for deployment. No score is promoted without an independent comparison and operator decision. If the CLI stalls, fail-closed behavior remains intact. Limit real calls to one chosen run rather than every match.
