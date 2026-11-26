# GW2 Phase 8 report: offline reproducibility and scientific reporting of the P7 pilot

**Status: PHASE_8_READY_FOR_REVIEW.** P8 was offline only. No Kane call or paid call was made, and none is prepared to run. The paid gate stays `'disabled'`. Nothing under `evidence/gw2/p7-pilot/` changed, and no other frozen evidence changed either. The P7 report, the pre-registration, the limitations and all eight submissions are kept as committed. This report adds to them and does not replace them.

The operator accepted P7 on 2026-11-26 01:04 UTC (PHASE_7_APPROVED, exploratory pilot). P8 has three parts:
* an offline reproduction from the published evidence (§1);
* the conceptual clarifications the operator asked for (§2–§4);
* a design proposal for a separately authorized extension, which is not implemented ([`P8_EXTENSION_DESIGN_PROPOSAL.md`](P8_EXTENSION_DESIGN_PROPOSAL.md)).

## 1. Offline reproduction from the published copy (D114)

```sh
npm run gw2:reproduce-p7            # prints every check; exit 0 = reproduced
node --experimental-strip-types --no-warnings gamewatch/gw2/p8-reproduce.ts --out evidence/gw2/p8/REPRODUCTION.json
```

`gamewatch/gw2/p8-reproduce.ts` needs only the repository. It needs no network, no originals and no Kane, and it does not open the evaluation gate, because opening the gate appends to the evaluation ledger. The output has no timestamps. `tests/gw2-p8-reproduce.test.ts` re-runs it and checks that the result equals the committed `evidence/gw2/p8/REPRODUCTION.json` byte for byte. All **40 checks pass**:

| Group | What is checked |
|---|---|
| Anchors (27) | The external execution ledger verifies as a hash chain with the 7 expected events. FREEZE.json, REPRESENTATIONS.json and the graph prefixes at freeze (8), seal (11) and integrity (51) equal their external anchors. The graph structure and hash chain verify. Every published file matches REDACTION_RECORD. Each raw seal equals its external anchor, and the *original* hashes in the redaction record equal the seal. Every Kane node's provenance hash equals the original stdout hash |
| Inputs (1) | Partition files are read only if they match the manifests that the freeze bound |
| Re-evaluation (6) | The unchanged library cores (`heldoutCore`, `discriminateCore`, `threeWay`) are re-run on the frozen hypotheses and the representations sealed before the first opening. Each result equals `heldout-2.json`, `discrimination-3.json` and `three-way-1.json` field by field |
| Independent re-count (7) | A separate per-situation evaluator (`lawCounts`, built on `evalExpr`) re-counts each represented law clause per build. It agrees with the evaluator on every number: 390 discovery counterexamples, and 194 / 190 held out |

* **What this does not cover.** The published copy cannot re-hash the raw Kane output, because it is redacted. That link rests on the redaction record and the operator's originals (PHASE_7_REPORT §9).
* **The full check.** The full 20/20 integrity check, including that link, still needs the originals in a `c066db2` checkout. That check was done in P7.

## 2. Four things that are easy to conflate (operator item 1)

| Concept | What it requires | Inputs needed | Did P7 measure it? |
|---|---|---|---|
| **A. Specification–observation discrepancy detection** | Saying that a build's behaviour differs from a *stated intended rule* | The specification and observations | **No, not by the agent.** Kane was not given the specification: the served index says "The game's documented rules are not shown" (`partitions/discovery/site/index.html`). Only the verifier compared observations with the spec (O↔S, encoding-2, provisional) |
| **B. Independent discovery of actual system behaviour** | Inferring, from observations alone, the rules a build actually follows, including where builds differ | Observations | **Yes. This is what P7 asked for** (OBJECTIVE_P7: "Infer which rules the game appears to follow, and where builds behave differently") |
| **C. Machine-verifiable defect description** | A *structured* claim about actual behaviour whose predictions match the recorded outcome wherever that outcome differs from the spec | A structured representation, observations, and the spec (verifier side only) | **Partly.** The verifier derives it (`accurate-description-of-a-defect`, verify.ts). The agent needs no spec for it, only a correct structured description of the build's behaviour on the deviating situations. Free text can never meet it (U3) |
| **D. Root-cause investigation and defect classification** | Explaining *why* a build deviates (which code or mechanism) and classifying the deviation (bug, intended change, balance) | Code, history or intent, beyond observations | **No.** Neither the agent nor the verifier had code or intent. A C-reading "describes the build's behaviour, not the intended rule" (verify.ts) and does not classify anything as a bug |

Each concept yields different evidence:
* A positive **B** result is a behavioural law.
* A **C** result is a behavioural law that differs from the spec on situations where the outcome confirms it.
* Only **D** would say that the difference is a defect, and what kind.
* GW2's "detection" column is **C**. It is not A, and it is not D.

## 3. How to read the 0/4 detection figure (operator item 2)

* **What 0/4 is.** For each P7 session, none of the four held-out (rule, build) deviations on build-3caf (R3, R7, R8 and R14, encoding-2, provisional) received an `accurate-description-of-a-defect` reading.
* **What 0/4 is not.** It is **not** a Kane defect-detection failure rate in general, and it must not be read as one:
  1. **No specification.** Kane was not given the rules (§2A), so it could not claim a spec–observation discrepancy, and it was not asked to.
  2. **Five of eight hypotheses had no representation.** The verifier never reads free text, so these could not enter C at all. Sessions 1 and 2 have coverage 0/914. Their 0/4 means "nothing machine-evaluable was submitted", not "deviations were missed".
  3. **Three case studies with public defects (T25).** These are not samples from a population of tasks. The estimate is a descriptive count, so no failure rate follows (Wilson 95% 0–0.49 on 4 per session, with correlated deviations).
* **What was in reach.** Every one of the four deviations was present in **accessible discovery evidence** (REPRODUCTION.json `specDeviations`):

| Deviation (build-3caf) | Discovery units with it | Opened by a session |
|---|---|---|
| R3: actions granted at turn start | 30 (222 outcome checks) | `C-0662fc`, opened by **all three** sessions |
| R7 | 2 | none |
| R8 | 1 | none |
| R14: shield | 1 | none |

* **R3 was observed.** Sessions 1 and 2 *did* observe the R3 behaviour (Human's first turn: 4 actions on 3caf vs 3 on 06b9) and wrote it down in free text (session 1 H-1, session 2 H-2). That is a B result.
  * It could not become a C result, because neither had a representation.
  * Session 3, the only one with representations, wrote its turn-start law for build-06b9 only, so it made no prediction on 3caf.
* **R7, R8 and R14 were in pages no session opened.**
* **Session 3's H-2 nearly earned a C reading.** On 3caf held-out, it predicted the R14-deviating outcome in one of the two situations that separate it from R14 (`C-b48898` s18). It failed in the other (s15).
  * A C reading requires *every* distinguishing pair to follow the hypothesis, so it was not credited. That is correct.

## 4. Counterexamples already in accessible discovery evidence vs exceptions absent from it (operator item 3)

Each counterexample to a represented clause is placed in one of the following classes. The classes and their definitions are in REPRODUCTION.json `counterexamples` and `definitions`.
* **In discovery:**
  * the counterexample is in a page the submitting session **opened**, according to the access journal; or
  * it was **accessible** (served to every session) but not opened.
* **In held-out:**
  * **already exemplified**: every behavioural input value occurs in the applicable discovery situations, and discovery already had counterexamples to the same clause; or
  * **absent from discovery**: at least one behavioural input value never occurs among the discovery situations the clause applies to, on the same build. Build and turn number are not compared.

| Hypothesis (session 3) | Build | Discovery counterexamples: opened / accessible, not opened | Held-out counterexamples: already exemplified / absent from discovery |
|---|---|---|---|
| H-1 turn start ⇒ 3 | QX-41 | **26** (all in `M-22e2f2`, which it cited) / **364** (15 further matches) | **187** / 0 |
| H-2 Freeze ⇒ fired | QX-41 | 0 / 0 | 0 / **2** (`pieceShieldedBefore = true`) |
| H-2 Freeze ⇒ fired | QX-73 | 0 / 0 | 0 / **1** (`pieceShieldedBefore = true`) |
| H-3 Teleport ⇒ fired | both | 0 / 0 | 0 / 0 |

What the two kinds of error mean:
* **H-1** is an error that the available evidence already refuted.
  * Every held-out counterexample is of a kind present in discovery: a mover with fewer than 3 pieces.
  * 26 counterexamples were on a page the session opened and cited.
  * Held-out evidence added no new kind of exception. It only repeated the one discovery already showed.
* **H-2** is an error that discovery could not reveal.
  * Discovery has shielded pieces, but only entering *Send home* (3 per build). There are **no** shielded Freeze entries.
  * Every held-out contradiction is a shielded Freeze entry, an input combination that discovery never contained.
  * This is a limitation of the coverage of the discovery evidence, not of the session's reading of it.

The first kind of error would show up in a check against the evidence the agent saw. The second needs evidence the agent did not have. The proposal's "unmatched action notifications" treat the two differently.

## 5. Decisions

| ID | Decision |
|---|---|
| D114 | Offline reproduction `gamewatch/gw2/p8-reproduce.ts`, committed output `evidence/gw2/p8/REPRODUCTION.json`, test `tests/gw2-p8-reproduce.test.ts`. It reads only the published copy, does not open the gate, writes nothing to P7 evidence, and its output is deterministic |
| D115 | Reporting vocabulary: A spec–observation discrepancy, B behavioural discovery, C machine-verifiable defect description, D root cause and classification. GW2's "detection" is C. 0/4 is reported with its three qualifications and is never a general failure rate |
| D116 | The future extension is a design proposal only (P8_EXTENSION_DESIGN_PROPOSAL.md). Nothing is implemented or executed, and the gate stays disabled |

## 6. Tests

* `tests/gw2-p8-reproduce.test.ts`: 4 tests. They cover the reproduction checks, byte equality and unchanged P7 evidence; the counterexample classes; the location of spec deviations; and the evaluator and novelty rule on synthetic situations.
* `test:gw2`: 131 of 131 pass. `gw2:verify` and `vendor/verify.py`: OK. The paid gate is `'disabled'` (`server/balance/v4/kanebudget.ts`).

## 7. Limitations (in addition to PHASE_7_REPORT §11, all of which still apply)

* **"Absent from discovery" is a mechanical criterion over the recorded input fields.** It does not prove that no human could have anticipated the exception. A field the situation extractor does not record could hide further structure.
* **"Opened" means HTTP 200 for the page.** Whether Kane read a given turn on that page is not observable.
* **Encoding-2 is provisional.** The spec-deviation locations in §3 depend on it.
* **Sample size.** Three sessions and three representations. Every statement here describes these cases.
