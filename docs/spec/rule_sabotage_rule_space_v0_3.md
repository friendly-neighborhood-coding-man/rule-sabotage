# Rule Sabotage — Rule Space V0.3

**Status:** V0.2 vocabulary and scenario catalogue + V0.3 experimental scores and balance-loop protocol; **not** a claim that features are implemented.  
**Baseline:** public repository `friendly-neighborhood-coding-man/rule-sabotage`, branch `claude/project-thread-2cwg9i`, inspected 2026-11-18.  
**Goal:** maximize deterministic TypeScript coverage; reserve LLM interpretation and real Kane review for cases the engine cannot already resolve; preserve gameplay, hidden information, and true verification provenance. **V0.2 decision:** ALL on-trigger effects, targets, benefits and sacrifices are relative to the **side whose piece stepped onto the trap**, never its installer; installation configuration/ownership remain installer-side.

## 0. Established engine behavior vs. proposed extensions

| Area | Established in inspected engine | Proposed; not implemented |
|---|---|---|
| Board | 7×7; 3 pieces per side; goal opposite column | Alternate board sizes / new pieces |
| Turns | Alternating; actions count equals unscored pieces plus existing bonus; stack or single movement | Skip-turn contractual debt; action escrow |
| Placement | One effect definition on up to 3 eligible cells; can replace own rules; opponent's rule cannot be overwritten | Random bonus placement of same effect on one additional eligible square at install time, capped by total slots; duration/charges by rule, special contracts |
| Trigger | Entering an effect cell; each triggered cell consumed | On-leave, on-capture, turn-start/end, proximity, delayed triggers |
| Effects | `shove`, `freeze`, `home`, `teleport`, `shield`, `haste` | Activator-side mass home reset, multi-target reset, swap, mine, decoy, sacrifice, reflection, domino, conditional composite |
| Movement | Capture sends opponent's pieces home; friendly stacks; forced chain capped at 4 | Additional targeting/collision semantics |
| Verification | Engine checks; separate real Kane review; approval cache for trial signature | Tiered referee; negotiated counteroffer and contract validation |
| Hidden information | No mine primitive yet; existing AI planner consumes engine `State` | Separate public-player observation contract with secret mines/decoys |

Code basis: [rules.ts](https://github.com/friendly-neighborhood-coding-man/rule-sabotage/blob/claude/project-thread-2cwg9i/server/rules.ts), [engine.ts](https://github.com/friendly-neighborhood-coding-man/rule-sabotage/blob/claude/project-thread-2cwg9i/server/engine.ts), [game.ts](https://github.com/friendly-neighborhood-coding-man/rule-sabotage/blob/claude/project-thread-2cwg9i/server/game.ts), [trial.ts](https://github.com/friendly-neighborhood-coding-man/rule-sabotage/blob/claude/project-thread-2cwg9i/server/trial.ts), [ai.ts](https://github.com/friendly-neighborhood-coding-man/rule-sabotage/blob/claude/project-thread-2cwg9i/server/ai.ts).

## 1. Core rule grammar

A future normalized rule should be data, **not executable LLM-generated code**:

```
Rule := WHEN Trigger
        [IF Predicate AND ...]
        WHO TargetSelector
        DO OrderedEffect[]
        [PAY OrderedCost[]]
        [SPAWN PlacementModifier[]]
        [WITH Limits]
```

| Axis | Proposed enumerated vocabulary | Status |
|---|---|---|
| WHEN | `enter_cell`, `leave_cell`, `move_complete`, `turn_start`, `turn_end`, `capture`, `scored`, `nth_activation`, `nearby_piece`, `timer_expired` | Only `enter_cell` exists |
| IF | `always`, `stack_size`, `distance_to_goal`, `active_piece_count`, `scored_count`, `actions_left`, `shielded`, `frozen`, `entry_direction`, `previous_square`, `last_action`, `rule_hit_count`, `turn_number`, `own_rule_count`, `visible_mine_count`, `random_roll` | Need finite typed predicates |
| WHO | `entering_piece`, `entering_stack`, `activator_side`, `activator_opponents`, `nearest_opponent`, `farthest_ahead_own`, `farthest_behind_own`, `piece_at_square`, `one_random_eligible`, `all_unscored_of_side`, `rules_in_radius` | Single triggering group is current baseline |
| DO | `shove`, `freeze`, `reset_home`, `reset_all_activator_unscored`, `teleport`, `shield`, `extra_action`, `swap_positions`, `split_stack`, `move_rule`, `shuffle_rules`, `reflect_next_effect`, `remove_shield`, `reset_selected_piece`, `reset_all_opposing_pieces`, `create_wall`, `create_decoy`, `delay_effect` | First six only |
| PAY | `reduce_next_turn_actions`, `skip_next_turn`, `reset_activator_leading_piece`, `reset_activator_random_piece`, `consume_activator_shield`, `no_bonus_until_next_turn`, `forfeit_target_choice`; installation slot/range/charge limits belong under WITH, not a cost charged to the installer | Negotiated costs not implemented |
| SPAWN | `random_extra_same_effect_cell`: select one legal unoccupied/empty extra location when the rule is installed, not when triggered; no recursion | Not implemented |
| WITH | `max_cells`, `max_activations`, `duration_turns`, `max_chain_depth`, `max_move_distance`, `allowed_targets`, `cooldown_turns`, `randomness_scope`, `verification_scope` | Existing hard bounds only |

**Actor semantics (FIXED V0.2):** `installer` only chooses eligible placement, owns/removes/replaces the tiles, and may receive private coordinates of their own hidden tiles. `activator` is the side owning the piece or stack that *steps on* and triggers the tile. **Every game effect, relative target, benefit and on-trigger sacrifice is interpreted exclusively relative to `activator`, including next-turn debts.** No installer-paid or installer-benefiting trigger-time exception. `my/all our pieces` means `activator`'s pieces, `opponent` means opponent of `activator`, and `my next turn` means `activator`'s next turn. Absolute north/east/south/west remains board-absolute; `back/forward` remains entry-direction-relative. The installer may choose the rule during placement but cannot change whom it affects once stepped on. Current `policyReject` may forbid some opponent-targeting requests; V0.2 is a future DSL proposal, not current engine behavior.

**Deterministic tie-breaking:** sort by remaining distance to own goal, then piece ID; random target uses engine-seeded RNG and records seed/state. Exclude already-scored pieces unless a new mechanic explicitly specifies otherwise. Never expose hidden placements to a player's observation.

## 2. Hard invariants (non-negotiable)

| ID | Invariant |
|---|---|
| INV-01 | The engine is sole authoritative writer of game state. |
| INV-02 | No raw text, model output, or trial-page content executes as code. |
| INV-03 | Valid effects belong to an explicitly versioned, finite DSL. |
| INV-04 | Existing board bounds, turn limits, action counts, and winner rules hold unless a separately approved engine migration changes them. |
| INV-05 | Swapping human and AI labels while transforming board/entry direction appropriately preserves actor-relative effect and sacrifice semantics; compass directions remain absolute relative to the board. |
| INV-06 | An effect can fire no more than permitted charges and never re-fire an already consumed cell. |
| INV-07 | All forced effect chains terminate within a finite engine cap; an over-cap branch terminates safely. |
| INV-08 | Illegal placement cannot overwrite enemy-owned rules or occupied cells. |
| INV-09 | No rule can bypass engine validations, change secrets or approval status, or declare instant victory by text. |
| INV-10 | A payment obligation is atomic: either every mandatory cost is charged or the effect does not execute. |
| INV-11 | No proposed payment may become a free after-the-fact cost because the game ends before it is charged. |
| INV-12 | Victory is evaluated after all immediate effects and immediate costs, in a deterministic documented order. |
| INV-13 | Pending Kane reviews cannot activate effects; late approvals require an applicability check on the current board. |
| INV-14 | `engine-checked`, `Kane-verified`, `cached Kane`, and `unverified` are distinct UI/evidence statuses. |
| INV-15 | Same public observation + same allowed choices + same policy seed must not reveal hidden enemy mines through AI decision logic. |
| INV-16 | Human and AI rules share the same interpreter, normalization, contract validator, and executor. |
| INV-17 | Any ambiguity about ability semantics or target/cost payer means clarify, reject, or request higher-tier review; never silently approximate a powerful effect. |
| INV-18 | Caches may never widen the applicability of a previous verdict and must fail closed on mismatches. |
| INV-19 | A turn with zero legal actions must advance or terminate deterministically, not stall a game. |
| INV-20 | Updates must preserve canonical replays: same schema/engine versions, seed, and valid actions reproduce the same result. |
| INV-21 | **All on-trigger benefits, harms, sacrifices and future debts are relative to the triggering piece owner, never the installer; no owner-biased exception.** |
| INV-22 | Random extra trap tiles are generated exactly once at initial installation, with server RNG, eligible empty cells and bounded placement count; never self-replicate on trigger. |
| INV-23 | Random bonus placement uses no privileged enemy-hidden information to bias locations; the actual location is not disclosed to the opposing player through views, logs, cache or LLM input. |

## 3. Deterministic referee-routing contract

| Outcome | Requirements | UI / execution |
|---|---|---|
| `REJECT_HARD` | Attempt to override engine authority, direct instant victory, impossible state, forbidden operation | Reject immediately, explain game constraint; never send to Kane as an executable proposal |
| `UNSUPPORTED` | Safe concept, but no matching DSL opcode or defined semantics | Explain unsupported, optionally suggest nearest explicitly labeled alternative; never pretend Kane makes it executable |
| `T1_ENGINE` | Exact known primitive, validated parameters, no unverified new interactions; all required invariant checks pass | Apply immediately, label **Engine-verified** |
| `T2_SIM` | All opcodes known; bounded interactions or composite with deterministic semantics; fixed scenario generator passes | Apply after finite simulation, label **Simulation-verified** |
| `T3_KANE` | New interaction/ambiguous fairness/complex cross-effect where engine semantics exist but policy cannot decide validity autonomously | Pending, submit evidence to genuine Kane, apply only on real approval and post-approval state check |
| `CONTRACT_OFFER` | Excessively strong yet technically supported effect; proposed prices require engine-supported cost opcodes | Simulate candidate contracts; show offer/reason and require acceptance; execute only after paid, validated and reviewed |
| `UNVERIFIED` | Timeouts, malformed Kane output, absent binary, stale review, no final verdict | Do not silently activate; show exact provenance |

**Not a loophole:** Kane may review a proposal, but it cannot execute an effect that the TypeScript engine does not implement. Initial tier routing policy must be behind a feature flag while original all-Kane E2E stays intact.

## 4. Enumerated test catalogue

The IDs below are **requirements/test scenarios to implement**, not passing test claims. `EXIST` means primarily existing-game regression; `EXT` requires a new feature; `SEC` hardening. Each has an expected observable outcome.

### 4A. Input and interpretation (INT)

| ID | Scope | Scenario and expected behavior |
|---|---|---|
| INT-01 | EXIST | Exact English canonical phrase yields exact typed existing effect. |
| INT-02 | EXIST | Equivalent Korean phrase yields same typed effect. |
| INT-03 | EXIST | Capitalization, spacing and punctuation variants do not change the meaning. |
| INT-04 | EXIST | Absolute north/east/south/west is not relative to which player triggered. |
| INT-05 | EXIST | `back/forward` uses incoming move direction, not owner alignment. |
| INT-06 | EXIST | Ambiguous `left` with no agreed frame is rejected or explicitly normalized by contract. |
| INT-07 | EXIST | Requested shove above cap is never silently used as requested; approximations disclosed. |
| INT-08 | EXIST | Conflicting effects in one sentence cannot become an arbitrary one-effect choice. |
| INT-09 | EXIST | Direct victory or unrestricted whole-board mutation rejects under current policy. |
| INT-10 | EXIST | Bad JSON, extra fields, unknown action/option IDs and tool-style injection fail safely. |
| INT-11 | EXIST | AI's canonical text parses into the exact planned effect, else no placement. |
| INT-12 | EXT | Distinguish `UNSUPPORTED` (understandable new ability) from `REJECT_HARD` (forbidden). |
| INT-13 | EXT | User explicitly declines a near-match; no automatic substitute is installed. |
| INT-14 | EXT | Korean/English paraphrases deduplicate only when their typed semantics match. |

### 4B. Placement and spatial rules (PLC)

| ID | Scope | Scenario and expected behavior |
|---|---|---|
| PLC-01 | EXIST | Place on 1 eligible tile; succeeds. |
| PLC-02 | EXIST | Place same definition on 2 eligible tiles; succeeds. |
| PLC-03 | EXIST | Place same definition on 3 eligible tiles; succeeds. |
| PLC-04 | EXIST | More than allowed cells rejected or explicitly bounded before review. |
| PLC-05 | EXIST | Tile occupied by either player's piece cannot receive a new rule. |
| PLC-06 | EXIST | Tile with enemy-owned rule cannot be overwritten. |
| PLC-07 | EXIST | Replace a tile containing own previous rule with valid new rule; resulting ownership correct. |
| PLC-08 | EXIST | Remove own existing effect without harming enemy-owned rules. |
| PLC-09 | EXIST | Selected tiles are nonadjacent; no invented shape restriction. |
| PLC-10 | EXIST | Duplicate coordinates and out-of-bounds coordinates cannot create duplicate charge. |
| PLC-11 | EXIST | After a late verdict, newly occupied/forbidden cells are skipped or whole contract invalidated per policy, with explanation. |
| PLC-12 | EXT | Contract specifies only one installation slot; placing on 2 or 3 tiles rejected. |
| PLC-13 | EXT | Replacing an owned tile must not erase unpaid costs or resurrect a consumed effect. |
| PLC-14 | EXT | No legal placement tile exists; actor may pass without a deadlock. |
| PLC-15 | EXT | With one chosen cell and `random_extra_same_effect_cell`, the server installs one extra identical rule cell at initial placement. |
| PLC-16 | EXT | The random extra cell must be vacant, within bounds, not selected already, not occupied by any piece, and not owned by opponent or installer; no overwrites. |
| PLC-17 | EXT | With zero eligible extra cells, install the selected cell only and explicitly report no bonus; seed replay identical. |
| PLC-18 | EXT | Current engine has max 3 placed cells total: chosen + random must fit the limit; chosen 3 + bonus 1 is invalid unless a separately versioned cap is explicitly implemented. |
| PLC-19 | EXT | Placement is a single atomic, seeded transaction: retries/timeouts do not add second bonus cell, and rollback leaves no partial installation. |

### 4C. Movement, stacks, and collision (MOV)

| ID | Scope | Scenario and expected behavior |
|---|---|---|
| MOV-01 | EXIST | Orthogonal move within bounds changes correct piece position and actions. |
| MOV-02 | EXIST | Move off any board edge rejected without spending action. |
| MOV-03 | EXIST | Single piece moved out of friendly stack leaves others in place. |
| MOV-04 | EXIST | Whole friendly stack moves together and consumes the defined number of actions. |
| MOV-05 | EXIST | Moving into enemy piece resets only captured enemy piece(s) to own start. |
| MOV-06 | EXIST | Moving into friendly piece creates stack, no capture. |
| MOV-07 | EXIST | Moving a frozen piece is rejected; other movable piece may move. |
| MOV-08 | EXIST | Triggering a directional shove at board edge stops at valid tile. |
| MOV-09 | EXIST | Forced shove into another rule obeys bounded chain and consumes each triggered tile. |
| MOV-10 | EXIST | Forced movement capture/reset results match ordinary movement rules. |
| MOV-11 | EXIST | Shield prevents next applicable trap effect and consumes shield exactly once. |
| MOV-12 | EXIST | Speed bonus changes action accounting according to whose turn is current. |
| MOV-13 | EXIST | Teleport chooses only eligible supported destinations using deterministic seed. |
| MOV-14 | EXT | Teleport with no legal destinations resolves to documented no-op or reject, never infinite loop. |
| MOV-15 | EXT | Composite effect acts on a stack: contract must specify whole stack vs one member. |
| MOV-16 | EXT | Multiple targets occupy same square; no double-reset/double-cost from duplicates. |

### 4D. Timing and triggers (TIM)

| ID | Scope | Scenario and expected behavior |
|---|---|---|
| TIM-01 | EXIST | Entry triggers once; no entry means no trigger. |
| TIM-02 | EXIST | Second entry to same consumed square does not re-trigger. |
| TIM-03 | EXIST | Two active effect cells chain in a single move; order is deterministic. |
| TIM-04 | EXIST | Maximum chain depth is enforced with visible stop event. |
| TIM-05 | EXIST | Score removes a piece from action/target pool. |
| TIM-06 | EXIST | Finishing third piece yields victory according to documented order. |
| TIM-07 | EXT | On-leave trigger is not accidentally treated as on-enter. |
| TIM-08 | EXT | Start-turn and end-turn triggers run at exact phase boundaries. |
| TIM-09 | EXT | Two simultaneous triggers have stable priority and no nondeterministic ordering. |
| TIM-10 | EXT | Nth-use ability counts only successful activations, not rejected/blocked attempts. |
| TIM-11 | EXT | Timed ability expiration is deterministic even when player skips a turn. |
| TIM-12 | EXT | Zero movement actions still advances turn and clears appropriate timing obligations. |
| TIM-13 | EXT | Game ends before future-turn debt is paid: proposed balance contract must not rely on that debt as the sole price. |
| TIM-14 | EXT | If an effect causes victory and immediate sacrifice, sacrifice resolves before win check. |

### 4E. Targeting and symmetry (TGT)

| ID | Scope | Scenario and expected behavior |
|---|---|---|
| TGT-01 | EXIST | Human and AI entering same tile from equivalent states have equivalent effect outcome. |
| TGT-02 | EXIST | Tile owner never changes direction of an absolute shove. |
| TGT-03 | EXT | `activator_opponents` refers to opponent of the *triggering piece*, not the installer. |
| TGT-04 | EXT | `all_unscored_of_side` excludes pieces that have already scored. |
| TGT-05 | EXT | `leading_own_piece` means nearest own goal; stable piece-ID tiebreak. |
| TGT-06 | EXT | `nearest_opponent` uses deterministic distance metric and tie resolution. |
| TGT-07 | EXT | Target selector with no valid piece yields declared no-op or a non-payable contract rejection. |
| TGT-08 | EXT | Target selection on stacked pieces cannot target invisible sub-piece by accident. |
| TGT-09 | EXT | Transform human↔AI and mirror goal directions: outcomes and costs remain equivalent. |
| TGT-10 | EXT | Installer and activator on opposing teams: ONLY the activator side receives effects and pays on-trigger costs, never the installer. |
| TGT-11 | EXT | Self-triggered tile uses exactly same relative actor rules as enemy-triggered tile. |
| TGT-12 | EXT | A cost that targets the lead own piece never targets scored or missing pieces. |
| TGT-13 | EXT | `all_opponents` effect resets exactly eligible units once each. |
| TGT-14 | EXT | Multiple target selectors have explicit priority, never arbitrary LLM choice during execution. |
| TGT-15 | EXT | `all my pieces home` resets all unscored pieces of the activator, whether the tile was placed by that same side or the opponent. |
| TGT-16 | EXT | Swapping which side installed the tile while keeping the stepping-piece owner fixed must not change the affected side or who pays a sacrifice. |
| TGT-17 | EXT | `my next turn`, `my frontmost piece`, and `my opponent` resolve to the activator side under both human and AI installations. |

### 4F. New effect and composite semantics (EFF)

| ID | Scope | Scenario and expected behavior |
|---|---|---|
| EFF-01 | EXIST | Shove: 1, 2, 3; six directions; edge clipping. |
| EFF-02 | EXIST | Freeze: precise start/end duration under current game timing. |
| EFF-03 | EXIST | Home: triggering piece returns to own home; no permanent death. |
| EFF-04 | EXIST | Teleport: deterministic seeded randomness and valid destination. |
| EFF-05 | EXIST | Shield: obtain, consume, do not stack undefined shield charges. |
| EFF-06 | EXIST | Haste: immediate/banked action never creates unbounded actions. |
| EFF-07 | EXT | Shove→teleport sequence uses output of first stage as input of second. |
| EFF-08 | EXT | Freeze→shove effect order produces stated frozen position and duration. |
| EFF-09 | EXT | Home→shove semantics: direction and trigger must be explicitly defined. |
| EFF-10 | EXT | Swap two legal pieces with atomic collision and score handling. |
| EFF-11 | EXT | Split stack into defined legal destinations; cannot duplicate pieces. |
| EFF-12 | EXT | Move a rule's tile without violating ownership or occupied-cell restrictions. |
| EFF-13 | EXT | Shuffle tiles preserving rules, ownership, charges and pairing. |
| EFF-14 | EXT | Reflect an effect to initiator, at most bounded number of reflections. |
| EFF-15 | EXT | Reset all opponent unscored pieces: scope is activator-relative. |
| EFF-16 | EXT | Reveal decoy without damage; reveal semantics consistent to both players. |
| EFF-17 | EXT | Secret mine causes only the explicitly defined on-trigger penalty; no position leak. |
| EFF-18 | EXT | Delayed effect activates once at a defined turn boundary or expires. |
| EFF-19 | EXT | Conditional rule only triggers when predicate true; false branch leaves tile behavior specified. |
| EFF-20 | EXT | A composite containing unsupported opcode returns `UNSUPPORTED`, never partially executes silently. |
| EFF-21 | EXT | `reset_all_activator_unscored`: reset every not-yet-scored piece on the side that enters the trap, exactly once per eligible piece. |
| EFF-22 | EXT | Activator mass reset on a stacked trigger only fires one tile activation; no extra reset or duplicate charge per stacked piece. |
| EFF-23 | EXT | Reset of all activator pieces includes the triggering piece as specified, including cross-cell pieces, but never undoes already-scored pieces. |
| EFF-24 | EXT | Two independently placed copies of the same global-reset trap burn separately, each only when entered; the random extra copy does not recursively spawn further copies. |
| EFF-25 | EXT | Shield interaction with a multi-piece reset must have explicit typed semantics before activation; no silent partial interpretation. |

### 4G. Contract prices and negotiation (BAL)

| ID | Scope | Scenario and expected behavior |
|---|---|---|
| BAL-01 | EXT | Powerful effect without a valid price is offered for negotiation, never silently approved. |
| BAL-02 | EXT | One-cell installation limit is enforced at creation and activation. |
| BAL-03 | EXT | Reduce next-turn moves by 1, with nonnegative action count and debt accounting. |
| BAL-04 | EXT | Skip next turn (0 moves) advances game and cannot be escaped by a phase loophole. |
| BAL-05 | EXT | Reset lead own piece as **immediate** price, with stable tie-break and home semantics. |
| BAL-06 | EXT | If required lead own piece doesn't exist, contract is non-payable and must not activate. |
| BAL-07 | EXT | Two costs in one offer are charged atomically or no effect occurs. |
| BAL-08 | EXT | Cancel a contract before activation; no partial cost and no effect. |
| BAL-09 | EXT | Player counteroffer may change only bounded DSL fields; no arbitrary new code. |
| BAL-10 | EXT | Same contract offered to AI and human, with identical relative actor semantics. |
| BAL-11 | EXT | Immediate sacrifice charged before victory; delayed skip alone cannot buy instant win. |
| BAL-12 | EXT | A price is too strong and makes ability dominated/useless; negotiation should have reject/alternative. |
| BAL-13 | EXT | Price is too weak across many seeds; counteroffer escalates cost or reduces range. |
| BAL-14 | EXT | Contract configuration limits installation slots and use count; both restrictions apply, but neither is charged to the installer as an on-trigger sacrifice. |
| BAL-15 | EXT | Contract proposal includes provenance: engine-suggested, LLM-suggested, Kane-verified status. |
| BAL-16 | EXT | Kane saying “approved” does not create a new executable price opcode. |
| BAL-17 | EXT | Cancel/retry leaves no unpaid debt or effect artifacts. |
| BAL-18 | EXT | Duplicate accepted offer cannot execute twice on the same contract ID. |
| BAL-19 | EXT | Different game phases and scored counts change measured value of same price; do not declare globally balanced from one board. |
| BAL-20 | EXT | A contract can have 2–3 Pareto-distinct options: lower power/lower cost, full power/high cost, or refusal. |
| BAL-21 | EXT | A trigger-time sacrifice may never be charged to the tile installer; all such costs follow activator. |
| BAL-22 | EXT | Installation limits and free random bonus tiles are placement modifiers, not activator sacrifice and not claimed as a balancing cost. |
| BAL-23 | EXT | Kane/simulator must evaluate an extra random global-reset tile as increased trap reach, not a compensating price, over multiple RNG seeds. |

### 4H. Kane, tiering, and provenance (REF)

| ID | Scope | Scenario and expected behavior |
|---|---|---|
| REF-01 | EXIST | Actual Kane approval can activate only after complete trustworthy `run_end`. |
| REF-02 | EXIST | Actual Kane rejection does not activate rule. |
| REF-03 | EXIST | Timeout/crash/malformed result yields `unverified`, not approval. |
| REF-04 | EXIST | Pending review remains non-executable while play continues. |
| REF-05 | EXT | T1 supported primitive gets engine-only provenance, never Kane label. |
| REF-06 | EXT | T2 known composite gets bounded simulation evidence with seed/count. |
| REF-07 | EXT | T3 review includes realistic counterexample scenarios and all required conditions. |
| REF-08 | EXT | Unknown opcode is `UNSUPPORTED`, not “Kane can do it.” |
| REF-09 | EXT | Trial page quotes untrusted rule text as data; injected instructions have no authority. |
| REF-10 | EXT | Human/AI request paths use same tier classifier and criteria. |
| REF-11 | EXT | Late approval rechecks current board, changed effect interactions and contract applicability. |
| REF-12 | EXT | Tier routing feature flag OFF reproduces original Kane-E2E flow. |
| REF-13 | EXT | Kane slowdown never blocks the authoritative game event loop indefinitely. |
| REF-14 | EXT | Test doubles cannot be labeled as live Kane evidence. |

### 4I. Caching, versioning, concurrency (CAC)

| ID | Scope | Scenario and expected behavior |
|---|---|---|
| CAC-01 | EXIST | Exact previously verified identical trial can return cached verdict. |
| CAC-02 | EXT | Change effect parameter, target or cost → no stale cache hit. |
| CAC-03 | EXT | Change placement or relevant piece positions → invalidate or prove equivalence. |
| CAC-04 | EXT | Change existing rule configuration, charges, ownership or hidden interaction → invalidate. |
| CAC-05 | EXT | Change engine/DSL version, policy or Kane condition set → invalidate. |
| CAC-06 | EXT | Change RNG seed/state where randomness impacts outcome → invalidate or mathematically justify equivalence. |
| CAC-07 | EXT | Two concurrent identical pending reviews share one in-flight Kane invocation where safe. |
| CAC-08 | EXT | Cached rejection does not turn into approval; unverified result never becomes cached approval. |
| CAC-09 | EXT | Late cached verdict still checks current placement eligibility and game lifecycle. |
| CAC-10 | EXT | Cache entries have a source, verification scope, expiry/version and replayable trial evidence. |
| CAC-11 | EXT | Cancelled or superseded contract approval cannot activate an abandoned offer. |
| CAC-12 | EXT | No cross-user/secret-state data leak through cache hit timing or error messages. |
| CAC-13 | EXT | Same canonical contract with different committed random bonus location or RNG state must not reuse a board-specific approval. |
| CAC-14 | EXT | Replay exactly reconstructs random bonus placement from recorded engine/policy versions, prior RNG state and action. |

### 4J. Hidden information and opponent AI (INF)

| ID | Scope | Scenario and expected behavior |
|---|---|---|
| INF-01 | EXT | Mine existence/count public only if rules of game explicitly say so; location secret. |
| INF-02 | EXT | AI's decision payload never contains enemy secret mine coordinates or nonpublic contents. |
| INF-03 | EXT | Two states with identical public observation but different hidden mine layouts yield identical deterministic-policy decisions with same policy seed. |
| INF-04 | EXT | AI may use public count and accessible past events to estimate risk, not ground-truth mine positions. |
| INF-05 | EXT | AI may zigzag/reroute as risk strategy, but not always magically avoid a secret mine. |
| INF-06 | EXT | Triggered mine becomes revealed according to common rules and is removed/consumed. |
| INF-07 | EXT | Fake mine and real mine produce same public appearance until specified reveal. |
| INF-08 | EXT | Enemy cannot remove secret trap solely by identifying it through an internal ID. |
| INF-09 | EXT | Replay/audit may store full engine state separately from public opponent observation. |
| INF-10 | EXT | Training features reflect **decision-time visible information**; revealed future mine locations do not leak back into inputs. |
| INF-11 | EXIST | Planner-generated legal move never needs LLM authority to execute. |
| INF-12 | EXT | Greedy/Jev/BYOK select among valid choices only; text or prose cannot replace chosen effect ID. |
| INF-13 | EXT | Different model/provider cannot see hidden data via prompts or error messages. |
| INF-14 | EXT | Risk-aware routing may lose to optimal hidden-mine placement without being classified as cheating. |
| INF-15 | EXT | The installer may see the actual randomly added mine square after commit; the opponent sees only publicly allowed count/existence, never coordinates. |
| INF-16 | EXT | A hidden random mine must not appear in opponent AI candidate generation, evaluation features, prompts or response provenance. |
| INF-17 | EXT | Bonus-cell randomness uses server-seeded sampling from legal eligible squares, without choosing a favorable square by peeking at concealed opponent plans. |
| INF-18 | EXT | An opponent can legitimately change risk policy on publicly announced mine count but cannot learn the exact random tile from error, cache or UI timing. |

### 4K. Security, safety, and UX (SEC/UX)

| ID | Scope | Scenario and expected behavior |
|---|---|---|
| SEC-01 | EXIST | Reject attempted system/developer instruction override as game rule. |
| SEC-02 | EXIST | Escaped trial page cannot execute user-supplied HTML/script. |
| SEC-03 | EXT | Do not send API credentials in gameplay prompts, client payloads or evidence files. |
| SEC-04 | EXT | Hard limit string length, nesting depth, step count, target count, and simulation runtime. |
| SEC-05 | EXT | Malformed rule AST, extra fields, NaN, fractions/out-of-range values rejected. |
| SEC-06 | EXT | Player cannot learn opponent private rule details from tier label, cache hit or log. |
| SEC-07 | EXT | Rate-limit expensive Kane review per session and bound concurrency without changing verdict logic. |
| SEC-08 | EXT | Failed or cancelled reviews leave no orphaned live browser processes. |
| SEC-09 | EXT | If persistent accounts are added, don't trust client-side achievement claims for ranked play. |
| SEC-10 | EXT | Record minimal analytics with consent, retention and redaction; no raw secret API keys. |
| UX-01 | EXIST | Pending Kane review is visually distinct from active effect. |
| UX-02 | EXT | Explain `Engine checked` versus `Simulation checked` versus `Kane reviewed`. |
| UX-03 | EXT | User sees exact normalized semantics before accepting an approximate interpretation. |
| UX-04 | EXT | Counteroffer displays power, immediate costs, delayed costs, and installation limit. |
| UX-05 | EXT | User may accept, decline, or negotiate; no silent auto-accept. |
| UX-06 | EXT | Accepted contract stays immutable; changed terms require new proposal/review. |
| UX-07 | EXT | Late approval explains skipped cells and costs not charged if nothing activates. |
| UX-08 | EXT | Timed-out review leaves a usable game and transparent failure state. |
| UX-09 | EXT | Game remains playable offline with explicit local AI/parser limitations. |
| UX-10 | EXT | E2E includes full game completion, one basic rule, one complex contract, one rejected rule, one delayed Kane response. |

## 5. Rule contracts and application order

A prospective **new**, versioned data contract — not the current `Effect` type:

```ts
// Illustrative proposal, NOT currently implemented.
type RuleContract = {
  schemaVersion: 1;
  when: { type: 'enter_cell' };
  condition: { type: 'always' };
  actor: 'activator';
  target: { type: 'all_unscored_opponents_of_activator' };
  effect: [{ type: 'reset_home' }];
  costs: [
    { type: 'reset_leading_unscored_piece_of_activator'; timing: 'before_effect' },
    { type: 'skip_next_turn_of_activator'; timing: 'reserved_before_effect' }
  ];
  limits: { maxCells: 1; chargesPerCell: 1; maxChainDepth: 4 };
};
```

**Recommended transaction order for future multi-target contracts:**

1. Resolve the triggering event and freeze a **read-only triggering snapshot**.
2. Resolve actor/beneficiary/target/payer deterministically from the snapshot.
3. Verify all target selectors and every mandatory price are payable; preflight hard invariants.
4. Reserve future-turn obligations and charge immediate costs atomically. If any payment fails, none applies.
5. Execute bounded positive effects on remaining eligible targets, using a documented collision order.
6. Resolve secondary triggers within caps; apply charges/consumption once only.
7. Recompute win and turn progression; publish provenance and signed/immutable contract outcome.

**Design decision still open:** Should costs be charged `before_effect` or `after_effect` for each opcode? We recommend `before_effect` for powerful global effects to prevent terminal-state cost evasion. Make all exceptions explicit and tested.

**Design decision still open:** Should `reset leading activator piece` choose only unscored pieces? Recommended: yes. If none exist, contract cannot be triggered. If the lead piece is the triggering piece, it may reset first and then other targets are affected; clarify whether trigger requires it to remain on the cell (recommended: snapshot trigger remains valid for this atomic transaction).

## 6. Balancing and counteroffer search

Do **not** assign one global fairness number from a single board. For each fully implemented candidate contract, sample multiple representative board families and RNG seeds; estimate:

- `Δwin`: change in win probability for the activator side versus an agreed baseline.
- `Δprogress`: expected total distance-to-goal change for both sides.
- `Δagency`: change in number/quality of meaningful legal choices.
- `softlockRate`: fraction of rollouts in which play cannot progress.
- `exploitRate`: illegal state, cost evasion, double-charge, or chain-limit breach (must be zero on safety suite).
- `latency`: p50/p95 engine time and Kane-review wall time separately.
- `uptake`: human users' choice to accept a counteroffer (future opt-in, aggregated metric).

Generate **bounded counteroffer candidates** with a declarative catalog, e.g. `(maxCells 3→2→1) × (nextActionPenalty 0→1→all) × (sacrifice none→lead own piece) × (target choice any→random) × (activation charges 3→2→1)`; prune impossible/dominated offers. Human-facing offers should be diverse and actionable: low-power/low-price, full-power/high-price, reject. **Simulation estimates are not proof of fairness; no threshold is claimed to be validated yet.**

### Illustrative negotiation

User: “When stepped on, send all of the triggering side's opponent pieces home.”

- **Hard check:** opcode exists? **No, currently unsupported.** Implementation comes before any live Kane review can make this playable.
- **Candidate offer A:** effect reduced to one deterministic legal opponent target, up to 2 installation squares.
- **Candidate offer B:** all opponent unscored pieces reset; one installation square; own leading unscored piece reset **immediately**; next own turn skipped, reserved at activation.
- **Candidate offer C:** decline.
- **Review path:** engine simulates all supported options; Kane can validate evidence for novel interactions; the player explicitly accepts; final rule is canonical and immutable.

**Symmetry nuance (V0.2 fixed rule):** `reset all opponents of activator` helps the side that steps on the tile, **even if its enemy installed that tile**; `reset all activator pieces` harms the side that steps on it, including if the installer steps on their own trap. No installer-relative effects or trigger-time payments are allowed. The powerful all-opponent reset example above is therefore a boon-to-stepper contract, while the mass self-reset plus random bonus cell example below is a trap.

## 6A. V0.2 example: triggering side's whole unscored team returns home + one random extra trap

**User design decision (proposed new mechanic; NOT implemented):** “When someone steps on my trap, **all unscored pieces of the side that stepped on it** return to their respective starting squares. At initial placement, **one more copy** of this same trap is placed at a random eligible square.”

**Fixed actor rule:** `installer` only sets placement/ownership. `activator = owner of stepping piece`; `target = all unscored pieces of activator`. There is **no trigger-time effect on the installer** merely because they installed it. If the installer trips their own trap, their own side returns home. Already-scored pieces remain scored; this ability is not allowed to reverse completed scores. Call this `reset_all_activator_unscored`, not `reset_all_opponents`.

**Placement rule, initial proposal:** installer selects **one** legal square; engine samples **one** additional legal *unoccupied, unruled* square uniformly from remaining eligible squares using its committed RNG state; both tiles contain the same immutable effect, and each consumes once. Total placed cells is two, within the current 3-cell hard cap. `random_extra_same_effect_cell` is applied only at installation, never at trigger: **no recursive spawning**. A later variant may allow two chosen + one random (three total), but three chosen + one random must be rejected unless the engine placement cap is explicitly versioned and changed. If no bonus cell is legal, the engine creates no bonus and clearly indicates it (no fake success). Installation should be atomic, with a canonical seed/state transaction and idempotent request ID.

**Visibility rule:** for a hidden-mine variant, the installer can see both owned tile locations; the opponent is shown only the publicly defined count/existence and may reason about risk. The authoritative engine and impartial verifier know both coordinates. Never give opponent AI hidden coordinates or leak them through candidate scores or retries. For visible traps, both cells follow the ordinary visibility rules. The random bonus cannot select based on hidden information about the opponent's plans or future actions.

**Balancing note:** the extra tile is a **power increase** (larger area threatened) rather than a sacrifice price. Kane should evaluate its increased danger separately and propose bounded, engine-executable costs if appropriate. Any on-trigger cost must be paid by the activator, **not by the installer**; restrictions on placement count are rule parameters rather than actor costs. Consider that a universal own-side reset is much stronger when few pieces have already scored and depends on placement probability; evaluate over multiple game states and seeds.

**Illustrative typed contract (future AST):**

```ts
// Proposed. Current engine does not recognize these opcodes.
const contract = {
  schemaVersion: 2,
  when: { type: 'enter_cell' },
  target: { type: 'all_unscored_pieces_of_activator' },
  effects: [{ type: 'reset_home' }],
  placement: {
    chosenCells: 1,
    randomExtraSameEffectCells: 1,
    totalMaxCells: 3,
    timing: 'at_installation',
    recursion: false
  },
  triggerLimit: { chargesPerCell: 1 },
  relativeActor: 'activator'
} as const;
```

**Unresolved implementation questions (do not silently decide):** (a) whether a shield on the stepping piece blocks only that piece's reset or the whole mass effect; (b) whether a hidden trap's existence/count should always be public; (c) how to handle the optional random bonus when no legal extra tile is available (no bonus and disclose vs reject whole install); (d) whether a future balance contract charges immediate costs before or after triggering the mass reset. Proposed defaults above cover (b) via explicit per-mode visibility and (c) via disclosed omission.

## 7. Coverage generation: define families, not every sentence

Rather than enumerate all English/Korean wordings or all combinatorial board states, construct **deterministic generators** for the state-space axes:

| Axis | Representative partitions / boundaries |
|---|---|
| Board coordinates | corner, edge, center, same column, mirrored coordinate, occupied versus free |
| Progress | start, middle, one step from goal, one already scored, two already scored |
| Stack size | 1, 2, 3 on same square |
| Action count | 0, 1, 2, 3, bonus +1, penalty −1, skip-next-turn |
| Effect count | 0, 1, 2, 3 selected squares; 0–4 chained triggers |
| Owner/actor | human-installed/human-triggered; human-installed/AI-triggered; inverse two pairs; all effects/costs activator-relative |
| Shield/frozen | none, shielded, frozen, both if permitted, status about to expire |
| Hidden information | no mine, public-count-only, 1 real mine, decoy, 1 selected+1 random hidden mine, identical public view differing hidden map |
| Pending review | idle, approved before turn end, approved after move, approved after winner, expired, cancelled |
| Randomness | distinct seeds, same seed replay, no destinations, target tie, one random bonus-cell spawn, no eligible bonus-cell case |
| Contract prices | no cost, one immediate, one delayed, multiple costs, unaffordable cost, terminal turn |
| Cache identity | same exact state+policy, altered rule, altered policy, altered engine, concurrent same request |

Use pairwise coverage for axis intersections **plus** handpicked three/four-way high-risk cases: `(stack + forced chain + capture + victory)`, `(hidden mine + AI planning + mirror)`, `(global effect + immediate sacrifice + instant victory)`, `(late Kane approval + occupied tile + game over)`, `(cached verdict + engine upgrade + renegotiated price)`, `(mass activator reset + random extra hidden trap + opponent AI observation + seeded replay)`.

For model-generated wording, retain explicit **semantic fidelity oracles** written independently of the current interpreter. Do not use model self-evaluation as the only correctness signal.

## 8. Release/implementation gates

| Gate | Acceptance evidence |
|---|---|
| G0: baseline freeze | Existing 37 unit tests + current browser E2E re-run on a pinned commit, results recorded; actual counts may change with code revisions. |
| G1: typed canonical AI decisions | Planned effect == interpreted effect == installed effect; no freeform model paraphrase drift. |
| G2: deterministic T1 | Same seed/actions replay and all applicable existing invariants; provenance engine-only. |
| G3: bounded T2 | Exhaustive primitive edge cases, targeted interaction tests, finite time/chain bounds; no unknown opcode accepted. |
| G4: Kane T3 | Live Kane trial with clearly identified real evidence; fail-closed timeouts; comparisons to test-double baseline. |
| G5: contracts | Atomic payment, winner-order tests, actor role symmetry, immutable player acceptance, counteroffer simulation. |
| G6: hidden mines | Public-view noninterference and no-leak AI prompt/policy tests before feature launch. |
| G7: product | End-to-end play, no UI softlock, honest tier labels, controlled review concurrency, rate-limit guard. |

### Do **not** silently implement these from this spec

- A new effect or new game mechanic without explicit approval of game-design semantics.
- A “Kane-approved” label for engine-only or mocked results.
- A hidden mine that is visible to the AI via internal `State`.
- A global reset with an unenforceable future-only price.
- A cache that reuses approval outside its proven state/version scope.

## 9. Immediate engineering order

1. Freeze current E2E and fix AI `sameEffect()` drift (existing `game.ts` currently computes `placedOk` after referee but discards it).
2. Implement rule normalization and typed actor/target/cost/placement-spawn schema **as an optional proposal layer**, with a hard invariant that ALL on-trigger effects/costs belong to the stepping side; retain current six-effects execution.
3. Implement table-driven tests for current `EXIST` rows; isolate unimplemented `EXT` as specifications/skip-marked future tests, not silently passing tests.
4. Add T1/T2 dispatch and evidence provenance behind feature flag; confirm old Kane E2E still works.
5. Introduce one completely specified composite-contract pilot (global reset + immediate self-reset + next-turn debt + max 1 cell), after explicit design review.
6. Evaluate AI opponent and hidden-information architecture before adding secret mines, especially the installation-time random bonus tile; ensure no hidden-state leaks.

**Priority:** correctness and auditability first; performance second; new features only behind the working baseline. Kane runtime (observed 109–175 seconds uncached in the user's prior measurements) should be treated as a separate optimization problem, not hidden by relabeling engine checks as Kane.


---

## 10. V0.3 — Initial scoring priors for self-play (2026-11-18)

**Source:** V0.2 enumerated rule-space document above. This section is an *additional provisional experimental overlay*, not a change to the v0.2 hard invariants or a declaration of new features implemented in the repository. All scores are explicitly **human/assistant heuristic assumptions, not measured effects or Kane scores**.

### 10A. Score sign and perspective

For any triggered effect:

- `activator = owner of the piece that STEPS ON the trap`, regardless of who installed the trap.
- **Positive score** means expected benefit to the **activator**; **negative score** means expected harm to the activator. It is not the installer's point budget and does not change the official game result.
- `installer` may place or remove owned tiles, but has no trigger-time effect or cost merely because they installed them.
- The value of an effect is conditional on board state. Global scores are initial **prior weights for candidate ranking only**. The real engine remains authoritative; these weights cannot be used to authorize an unsupported ability.
- If an effect has a “cost,” the score is signed from the activator's point of view. An installation limit (`maxCells`) or additional random tile (`random_extra_same_effect_cell`) is **not an activator-paid cost**. It changes spatial exposure.

### 10B. Implemented-effect initial scores

| Existing opcode / family | Provisional signed activator utility | Why this is a prior rather than a verdict |
|---|---:|---|
| `shove.back`, per square entered | −0.9 | Often harmful, but exact direction depends on approach, boundaries, and chains |
| `shove.forward`, per square entered | +0.9 | Often helpful along approach; can push onto another trap |
| `shove.east/west`, per square toward OWN goal | +0.9 | Signed by activator orientation; moving away from OWN goal is −0.9 |
| `shove.north/south`, per square | −0.15 | Minor provisional lateral disruption, can be positive for escape |
| `freeze` (one activation) | −2.2 | Temporary lost options; actual lost actions depend on turn and stack |
| `home` (single triggering piece/group per engine) | −3.8 | Greater harm at advanced columns; near home may be near-zero |
| `teleport` | −0.8 | Highly state-/RNG-dependent; do not collapse destination distribution |
| `shield` | +1.4 | Only valuable if future hazard can be encountered |
| `haste` | +1.8 | Extra move opportunity; value drops at turn/goal boundaries |

**Raw `shove` combinations:** existing engine permits six directions × three distances, giving 18 variants, plus five other effect kinds = 23 syntactic typed effects. The weights above *share parameters* rather than assigning 23 unrelated values. The source remains `rules.ts`; score weights are a new policy overlay and not an implemented engine mechanic. These are **not balanced values proven by Kane**.

### 10C. Unimplemented extension hypotheses — do NOT execute in current engine

| Future contract element | Provisional activator utility | Implementation / uncertainty |
|---|---:|---|
| `reset_all_activator_unscored` | −7.5 | **UNSUPPORTED**; moves all own unscored pieces home; needs stack/shield contract |
| `reset_all_opposing_unscored` | +7.5 | **UNSUPPORTED**; huge benefit to stepping side, even if opponent installed tile |
| `reduce_next_turn_actions(1)` | −1.25 | **UNSUPPORTED**; must reserve real future action debt |
| `skip_next_turn` | −3.5 | **UNSUPPORTED**; unacceptable as sole price if activation can immediately end game |
| `reset_activator_leading_piece` | −3.0 | **UNSUPPORTED**; immediately due, deterministic tie-break |
| `consume_activator_shield` | −0.8 | **UNSUPPORTED** as a contract payment; conditional if none held |
| `random_extra_same_effect_cell` | **No additive scalar** | **UNSUPPORTED**; increases exposure/spatial coverage; must respect max 3 total placements, no recursive generation |
| No installation within Chebyshev distance 1 (8 adjacent squares) of any live piece | **No additive scalar** | **UNSUPPORTED**; changes legal candidate locations and counterplay time; study as paired ablation |

**Illustrative composite only (not executable):** `reset_all_opposing_unscored(+7.5) + reset_activator_leading_piece(−3.0) + skip_next_turn(−3.5)` has a naive sum of **+1.0**. This is *not a finding of balance*: the future payment may be bypassed by victory, target counts vary, and nonlinear interactions are omitted. The mass-self-reset example in §6A is **−7.5 before** any random-extra placement's exposure multiplier; extra traps are an increased threat, not a sacrifice.

### 10D. Scoring evaluation beyond a scalar

Collect at least these independent measurements for each contract family and board bucket: `conditional_actor_win_delta`, `self_trigger_rate`, `trigger_probability`, `effect_uptake`, `mean_progress_change`, `turns_to_finish`, `no_legal_moves`, `failed_payment`, `illegal_state`, and `mean/p95 decision latency`. Record uncertainty, paired seeds, and sample sizes. A single numeric score may only help *generate and rank candidates*; it never replaces safety constraints or empirical comparison. **Do not tune to 50% aggregate win rate alone**: symmetrical bots can hide first-player, side, and strategy-specific biases.

## 11. Engine-backed AI-vs-AI experimental contract

**Deliverables:** `balance.weights.json` and `balance-selfplay.ts` alongside this document. The TypeScript script is intended to be installed as `scripts/balance-selfplay.ts` in the **actual** `friendly-neighborhood-coding-man/rule-sabotage` repository. It uses the repository's existing `server/engine.ts`, `server/ai.ts`, and `server/rules.ts`; both sides are AI via the deterministic local planner, without LLM cost, and each generated action is executed by that engine. **This script has syntax-tested locally but has NOT been executed against a checked-out copy of the current GitHub branch in this environment.** Its results must not be claimed until run on the operator's actual checkout.

Three paired arms, each using the same list of seeds:

1. `baseline-v-baseline`: human-prior bot vs human-prior bot (sanity and side-bias detection).
2. `candidate-human`: candidate-score bot as human vs baseline bot as AI.
3. `candidate-ai`: baseline bot as human vs candidate-score bot as AI.

Only **score-affected placement selection** changes between arms; all movement, scoring and state transitions remain the real TypeScript engine. The **candidate** is a proposed heuristic adjustment, **not a Kane-authored patch**: `freeze −2.2→−1.7`, `home −3.8→−3.1`, `haste +1.8→+2.2`, `shoveBackPerSquare −0.9→−0.8`.

**Proposed future 8-neighbor ban:** optional `--ban8` prunes candidate placements in the experimental AI policy; it does **not** modify engine placement validation. Therefore it is **not yet full end-to-end validation of the proposed game rule**. To test enforcement, first implement the ban in the actual engine with tests for human, AI, and random bonus installation. Never infer equivalence from this filtering-only ablation.

**Minimum gates before using results to tune a score:**

- Confirm exact git commit hash, engine hash, scoring JSON SHA-256, seeds, CLI and settings. Reproduce the same results twice.
- Confirm no `unknown`, silent rejected placements, softlock, hidden-state read, or mismatched effects. Because new composite opcodes are not implemented, they **cannot** appear in the results.
- Run 20 games per arm for smoke; increase to ≥100 **paired seeds per arm** for any initial comparative claim, then use a distinct held-out seed set. Do not treat 100 as a guarantee of statistical power.
- Report side-win ratio, first-player win rate, draws, mean game length, trigger counts (including installer/self-trigger distinction), active-effect crowding and failure counts. Compare both swapped sides; if first/side bias is large, block tuning and investigate.
- A Kane verdict on a **test page** is a verification of its specified browser conditions, not a numerical causal estimate of balance. Use paired simulator metrics for numerical updates.

**Reference command from the real repository checkout (not executed here):**

```powershell
node --experimental-strip-types scripts/balance-selfplay.ts 20
node --experimental-strip-types scripts/balance-selfplay.ts 100 --ban8
```

Move the supplied files to the repository paths described in `README_RUN.md` before running these commands. Each run emits `matches.jsonl`, `summary.json`, a weight snapshot, and `kane-ledger.jsonl` under `evidence/balance/<experiment>/`.

### 11A. Executed exploratory smoke — deliberately **REJECTED** as balance evidence

I also executed a **standalone Python approximation** (`sandbox_sim.py`, a deliberately simplified game model with no complete stack mechanics, no production referee, and no hidden information) for **32 seeds × 3 arms = 96 AI-vs-AI matches**. Its baseline sanity check failed: side 1 won **32/32** baseline games, regardless of which player moved first. This is severe side bias. **All 96 match results are excluded from weight tuning, no Kane scored them, and no score promotion occurred.** A second 96-game smoke run with the proposed 8-neighbor placement filter yielded 16/16 wins by each side in baseline self-play but **0/32 wins by the first player**. Its side-level result looks balanced while its first-player bias is extreme; this second batch also **FAILED SANITY GATE**. Total exploratory games run: **192**, none admissible as score calibration evidence. The raw records are preserved as a *failure diagnosis only*. This failure is why the engine-backed TypeScript harness is the appropriate next step.

## 12. Kane balance-review loop and append-only ledger

**Goal:** TypeScript runs games immediately. A *separately managed* Kane review worker periodically inspects **selected anomalies** (not every turn) against an actual browser-visible, immutable evidence page. The current Kane analyzer returns condition-level booleans/reasons; it does **not** autonomously train numeric weights. A bounded proposal generator suggests score changes; Kane can independently verify stated conditions and potential runtime anomalies. Any eventual numeric update remains a distinct, versioned optimizer action with evidence and evaluation. Do not claim the Kane CLI itself automatically emits learned scores.

**Review triggers (examples):** persistent side advantage in mirrored games; exploit where future debt avoids payment; high self-trigger frequency; unexpected aggregate teleports; parity/symmetry violation; winner determined before immediate sacrifice; suspiciously strong ability with no meaningful counterplay. Coalesce near-identical samples; limit queue and concurrency to avoid 100–374s per run and unnecessary credit burn.

**Review record contract:** `reviewId`, `time`, `sourceExperiment`, `gitSHA`, `weightSHA`, `hypothesis`, `candidatePatch`, `candidateGenerator`, `kaneCliVersion`, `kaneRunId`, `kaneConditionResults`, `kaneEvidencePath`, `kaneResult`, `holdoutSeeds`, `observedBaseline`, `observedCandidate`, `decision`, `approvedBy`, `effectiveFromGameVersion`. `kaneResult` may be `APPROVED`, `REJECTED`, `UNVERIFIED`, or `NOT_RUN`; `APPROVED` may mean only the explicit conditions passed. Never mislabel an `NOT_RUN` or engine-only result as Kane.

**Promotion path:** `DETECTED → PROPOSED → KANE_REVIEW_QUEUED → KANE_VERIFIED_OR_UNVERIFIED → HOLDOUT_EVALUATED → APPROVED_BY_OPERATOR → ACTIVE_NEXT_GAME`. Each event is append-only. No in-progress game changes its balance snapshot. If Kane times out, mark `UNVERIFIED`, do not update weights; keep its evidence and stop retrying under the configured budget. Every promoted version must support rollback to the previous score table.

**Initial ledger:** `kane-balance-events.jsonl` contains an `INITIAL_HUMAN_PRIOR` event and an unreviewed `PENDING_REAL_KANE` candidate. Neither is an actual Kane action. The TypeScript script also generates a per-run ledger with `PENDING_REAL_KANE`. Once a real Kane run exists, append its `run_end` details and evidence path as a new event rather than overwriting historical entries.

## 13. V0.3 release status

| Component | Status | What counts as success |
|---|---|---|
| Rule-space V0.2 grammar | **Source preserved** | Hard actor semantics + existing/proposed distinction retained |
| Initial scoring priors | **SPECIFIED / UNVERIFIED** | Actual matches needed before calibration |
| TypeScript dual-AI experiment script | **AUTHORED + SYNTAX-CHECKED / NOT RUN AGAINST CURRENT ENGINE HERE** | Run in real checkout and collect exact evidence |
| 96-game Python sandbox | **RUN / FAILED SANITY GATE** | Not usable for balance tuning |
| Real Kane balance review | **NOT RUN** | Reproducible CLI evidence, reviewer conditions and outcome |
| Kane-driven score revision | **NONE YET** | Verified findings, held-out comparison, versioned proposal and explicit promotion |
| Full extensions (mass reset, random bonus, skip/debt, 8-cell install ban) | **NOT IMPLEMENTED** | Engine code, unit/E2E tests, and explicit design decisions |

**Operator decision requested after the real engine-backed run:** whether the measured evidence supports any initial weight revision. This document does not silently change live production game balance, inject new DSL features, or merge PR #2.

### 12A. Optional real Kane audit adapter

`balance-kane-review.ts` generates a browser-readable summary and can call the repository’s **actual** `kaneJudge()` with `--run-kane`, only after ≥100 seeds per arm. It appends the actual verdict to `kane-ledger.jsonl`. Conditions check evidence completeness and conservative 35–65% baseline side-win and first-player-win sanity ranges; **an approval does not mean that the weights are objectively balanced**. Without `--run-kane` it only generates HTML and invokes no Kane CLI. This script has passed syntax check only, not a real CLI test here.
