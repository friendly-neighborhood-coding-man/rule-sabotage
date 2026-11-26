# GW2 P8 corrections (operator review PHASE_8_CONDITIONALLY_APPROVED, 2026-11-26 04:19 UTC)

This file documents corrections to P8 **separately**. These stay exactly as committed:
* `PHASE_8_REPORT.md` and `evidence/gw2/p8/REPRODUCTION.json`;
* the P7 report, the pre-registration, the published P7 evidence and all eight submissions.

The original P8 output still reproduces byte for byte (`tests/gw2-p8-reproduce.test.ts`). The corrected analyses are a new
output, `evidence/gw2/p8/REPRODUCTION-2.json`, produced by `gamewatch/gw2/p8-corrections.ts` and checked byte for byte by
`tests/gw2-p8-corrections.test.ts`. No historical number is replaced. Where the original wording was imprecise, this file
says what the corrected statement is.

## C1. The reproduction output can no longer overwrite evidence (D117)

* **Before.** `p8-reproduce.ts --out <file>` wrote to any path, including frozen evidence.
* **Now.** Both `p8-reproduce.ts` and `p8-corrections.ts` refuse before doing any work unless the target meets all of these:
  * outside the repository, or a **new** file under `evidence/gw2/p8/`;
  * not a frozen GW1 path (`assertWritableOutput`);
  * not an existing file, enforced by exclusive create (`wx`).

  So the published P7 copy, the original `REPRODUCTION.json` and every frozen path are refused.

## C2. Novel individual values vs novel combinations (D118)

* **Before.** PHASE_8_REPORT §4 called H-2's three held-out counterexamples "absent from discovery" because `pieceShieldedBefore = true` never occurs *among the discovery situations the clause applies to*, which are Freeze entries.
* **Corrected.** Novelty is reported at two scopes:

| H-2 held-out counterexample | Scope: Freeze entries in discovery (7 or 6) | Scope: all discovery effect entries of the build (471 or 362) |
|---|---|---|
| `C-0de271` s15 and s18 (QX-41), `C-b48898` s15 (QX-73) | **novel individual value** `pieceShieldedBefore=true` | **novel combination of observed values**: `{effect=Freeze, pieceShieldedBefore=true}` (equivalently `{effectKind=freeze, pieceShieldedBefore=true}`) |

* What this means:
  * Shielded pieces *are* in discovery: three *Send home* entries per build.
  * What discovery never shows is a shielded piece entering **Freeze**.
  * The corrected statement is "a combination of individually observed values that discovery never shows together". It is not "an input never seen".
* The H-1 counterexamples are unchanged. All 187 held-out ones are observed combinations at both scopes.

## C3. Delivered before vs after submission; delivery is not reading (D119)

* **Before.** PHASE_8_REPORT §3–§4 used "opened by the session" and "accessible but not opened" without regard to time.
* **Corrected.** Each counterexample's page is classed from the access journal's sequence numbers, relative to the journal entry that recorded *that* hypothesis:
  * delivered **before** submission;
  * delivered **only after** submission;
  * **never** delivered to that session.
* "Delivered" means the server returned the page with HTTP 200. It is **not** evidence that the agent read a given turn or step of it.
* Results:
  * In all three sessions, every evidence page was delivered before the first submission. No page was delivered after a submission.
  * H-1: 26 of 390 discovery counterexamples are on a page delivered before submission (`M-22e2f2`). 364 are on pages that the index listed but that were never delivered to session 3.
  * R3's discovery witness `C-0662fc` was delivered to all three sessions before their first submission.
* Read every earlier "opened" in PHASE_8_REPORT as "delivered (HTTP 200)". Read "accessible but not opened" as "listed in the served index, never delivered".

## C4. Preservation (D120)

* Nothing historical is edited: P7 evidence, its hashes, its metrics and submissions, the pre-registration, the P8 report and `REPRODUCTION.json`.
* `tests/gw2-p8-corrections.test.ts` checks the following:
  * `REPRODUCTION.json` still equals a fresh run of the original reproduction;
  * the guarded CLI refuses to touch it;
  * the published P7 copy keeps its recorded hashes. This is also checked in `tests/gw2-p8-reproduce.test.ts`.
