# GameWatch blind experiment: PRIVATE ground truth

**Never show this file, `mutations.json`, `probes.ts`, `groundtruth.test.ts` or `score.ts` to Kane or to the coding agent
under evaluation.** Frozen before any Kane call; hashes in `FREEZE.json`.

## Builds

| Evidence label | What it is |
|---|---|
| `QX-41` | Clean V6.1 baseline (byte-identical copy of `server/v6/`, PR #20 head `7d2f34f`; engine unchanged since 240b2bb) |
| `QX-73` | Baseline + B1 + B2 + B3 |

Ground-truth-only builds `gt-clean`, `gt-B1`, `gt-B2`, `gt-B3` (one mutation each) are used by the reproduction tests.
All builds are generated copies under `server/v6-build-<label>/` (git-ignored); `server/v6/` is never modified.

## Planted defects (exact source changes in `mutations.json`, all in `server/v6/engine.ts`)

| Id | Class | Change | Violated rule (as shown to Kane) |
|---|---|---|---|
| B1 | asymmetric rule | in `land()`: only AI-owned shielded pieces are protected; every piece's shield is cleared | R7, R14 |
| B2 | state lifecycle | in `land()`: `if (!forced) unsetCell(s, k)`: a cell reached by a forced (chain) arrival fires but is not used up | R8 |
| B3 | balance bias | in `startTurn()`: `+ (s.turn % 2)` actions: the first mover gets +1 action on every one of its turns | R3 (and balance) |

The referee does not hide any of them (checked, not assumed): its sandbox trial enters with fresh unshielded pieces by
normal moves and sets its own action counts, so all three appear in real play under the unchanged referee.

## Independent reproduction (`groundtruth.test.ts`, 8/8 pass)

Minimal positions built directly on each build's engine (no adapter, no scripts, no recorded evidence):
clean shows none of the three; `gt-B1` / `gt-B2` / `gt-B3` each show exactly their own defect; controls (plain walk-on
consumption, freeze for both sides) and the other probes match clean on every build; the clean build is byte-identical
to the playable engine.

## Where each defect is visible in the evidence Kane will see

| Defect | Scripted cases (QX-73 shows it, matched QX-41 does not) | AI-vs-AI aggregate (QX-41 vs QX-73, 16 games each) |
|---|---|---|
| B1 | `C-27d15a` (Human shielded piece sent home by E3) vs `C-ba3871` (absorbed); controls `C-5dde50`/`C-464da7` (AI shielded: absorbed on both) | `shield-absorbed` Human/AI: 3/3 vs **0/4** |
| B2 | `C-c34a99` (E5 "+1 action" fires twice) vs `C-874a92`; `C-9fc650` vs `C-757669` (AI side, I5); control `C-a8b9dd`/`C-b805d8` (walk-on, consumed on both) | effect cells that fired more than once: 0 vs **36** (not shown as a counter; derivable from match pages and from "times fired" > "cells placed" ratios); `chain-limit` events 0 vs 7 |
| B3 | every QX-73 case: `turn-start actionsGranted=4` for Human (first mover) with 3 pieces | first-mover seat: actions granted 2.91 vs pieces 1.91 per turn (QX-41: equal); first-mover wins 8/16 vs 10/16 (**not significant**: the win-rate signal alone is weak at this sample size) |

Clean controls Kane should judge clean: freeze, shove back, teleport, adjacency refusal (both builds), and every QX-41 case.
