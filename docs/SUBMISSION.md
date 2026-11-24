# GameWatch: hackathon submission description

**One line:** GameWatch turns a game's existing playtests into evidence that Kane can review blind, then hands Kane's
findings to a coding agent that must reproduce, fix and re-verify them. It runs as an executable SkillBook on SkillFlow,
our small open-source runner.

## The problem

Rule bugs in games are often only visible in play. A shield that works for one side only, an effect that should be
used up but fires again, or a quiet first-mover advantage can each pass every unit test. Finding them takes someone
who reads playtests the way a QA tester does.

## What we built

* **GameWatch**: a portable QA harness. It has three parts:
  1. **Evidence collection** from the playtests the game already has (scripted cases and matched AI-vs-AI games, both
     run through the game's own engine and referee).
  2. **Adapters with a documented input contract** (`gamewatch/evidence@1`), so another game needs only an adapter.
  3. **A Kane QA harness**: an anonymous evidence site, a findings form with a nonce, a gated single paid call, a
     coverage audit, a blind repair loop and a regression review.
* **SkillFlow** (https://github.com/friendly-neighborhood-coding-man/skillflow, MIT): a one-file, standard-library
  runner for SkillBooks. It runs one task at a time with that task's skill and spec only, checks inputs and outputs,
  branches on results, backtracks within bounds, stops at authorization gates, and keeps checkpoints and a log. GameWatch
  vendors an unmodified, checksummed copy.
* **Rule Sabotage V6.1** is the demonstration game. Its playable version is unchanged.

## The experiment (GW1)

* **Setup:** three defects were planted in one build. The ground truth was frozen before Kane ran.
* **Kane:** one objective-mode call, 72.398 credits, 267 s. It returned three findings. Two are **true detections**:
  the life-cycle bug, and the extra action for the first mover (which Kane attributed to the human side). The third is
  an inconsistent "clean" report. **Kane missed the asymmetric shield.**
* **Repair:** one coding-agent attempt in a blind workspace. The agent reproduced both of Kane's findings and widened
  the action bug to its real cause. It **found the shield defect itself** in the same playtest evidence. It made three
  one-line fixes and added seven regression tests, which fail on the old build and pass on the new one.
* **Verification:** the output was frozen on exit. Only then did the independent probes run: all three defects are
  fixed and the controls are unchanged. The existing tests pass 42/42, and the fresh re-run matches the clean
  reference on all 11 scripted playtests.

What this shows: Kane can find real rule bugs in unlabelled playtest evidence, and a gated SkillBook can carry its
findings through a blind repair loop to a verified fix. It does not show detection rates: this is one run with three
planted defects. Kane did not find all three, and it did not do statistical balance analysis.

## Honesty and safety measures

* The paid call runs behind two gates: an authorization file and a code gate that is disabled in every commit. It
  needs a single-use approval and is limited to one call per run id. Balances are measured before and after, then
  redacted before publishing.
* The ground truth is frozen, hashed and kept out of every blind input. Kane's findings are labelled only after the
  repair output was frozen.
* Limitations are stated in full in `docs/GW1_FINAL_REPORT.md` §7. They include the agent's workspace isolation, which
  is not a sandbox, and Kane's low page coverage.

## Try it

* `gamewatch/README.md`: quick start (free run up to the paid gate).
* `docs/DEMO.md`: verify the freeze and recompute the evaluation, without any paid call.
* `docs/GW1_FINAL_REPORT.md`: full results and limitations.
* `docs/DEMO_VIDEO_SCRIPT.md`: the demo video script.

Built by the Rule Sabotage author with Claude Code during the hackathon. The game, GameWatch and SkillFlow are all
team-written; Kane is the reviewer, and the repair agent was a separate Claude Code instance.
