# Submission form text and launch posts

Repository link for the form: use the branch that holds everything:
`https://github.com/friendly-neighborhood-coding-man/rule-sabotage/tree/claude/gw2-matched-results`
The default branch `main` does not yet contain GameWatch, because the work lives on stacked draft PRs.

## "About your app" (form field)

**GameWatch: Kane discovers, GameWatch verifies.**

**What it is.** GameWatch is a verification layer around Kane CLI, demonstrated on Rule Sabotage, a human-vs-AI board game we built during the hackathon.

**What Kane does.** Kane is the autonomous discovery agent. It explores an evidence site of real playtests and AI-vs-AI games, spots rule anomalies, and writes hypotheses about the hidden rules.

**What GameWatch adds.** For every Kane finding, GameWatch provides:
* checks against the recorded evidence;
* a hash-chained ledger of raw output, server sessions and freezes;
* scoring against held-out observations that stay sealed until everything is frozen;
* a split between genuine corrections and coverage narrowing, new errors and missing submissions.

**Closed loop (GW1).** One Kane call found 2 of 3 planted defects. A separate Claude Code coding agent got Kane's findings in a blind workspace, reproduced them, found the third defect itself and fixed all three. The fixes were verified independently after the output was frozen.

**What Kane proved (GW2).** A pre-registered matched comparison: 10 sessions and 20 real Kane calls, with a treatment arm that is shown contradicting observations.
* In session M08, reported accuracy rose from 31.78% to 81.25% while coverage fell from 12.32% to 1.00%, with zero genuine corrections.
* GameWatch correctly identified a hypothesis withdrawal, not self-correction.
* Both treatment sessions that received contradiction feedback revised or withdrew a hypothesis, and no control session did. That is behavioural adaptation, not improved reasoning.

**Disclosed limitations.**
* In 6 of 10 sessions Kane's structured hypotheses failed the schema.
* 8 of 10 revision calls submitted nothing.
* There were 5 sessions per arm, and we make no significance claim.

**Agents.** Kane CLI 0.10.4 (discovery). Claude Code (built GameWatch; separate instance as the repair agent). SkillFlow, our MIT runner, orchestrates the steps.

## X (post 1 of a thread)

Kane discovers. GameWatch verifies. 🔍✅

For #KaneCLIHackDay we built GameWatch, a verification layer around TestMu AI's Kane CLI. Kane explores a game and proposes its hidden rules; GameWatch checks every claim against sealed evidence.

The best result was a trap we caught 🧵

## X (post 2)

In one pre-registered session, Kane revised its theory after seeing contradictions:

Reported accuracy: 31.78% → 81.25%
Coverage: 12.32% → 1.00%
Genuine corrections: 0

It withdrew a wrong hypothesis instead of fixing it. GameWatch labels that "narrowing", not self-correction.

## X (post 3)

What we can say: both sessions that received contradiction feedback adapted, and no control session did.

What we can't say: that reasoning improved. 6 of 10 sessions wrote hypotheses that failed our schema, and n=5 per arm.

Every negative result is public, with the evidence: <repo link>

## LinkedIn

**Kane discovers. GameWatch verifies.**

For the KaneCLI hackathon I built GameWatch, a verification layer that works alongside Kane CLI rather than competing with it.

Kane does the part no script can: it explores a game autonomously, notices odd behaviour and writes hypotheses about rules it has never seen. GameWatch adds what makes those findings trustworthy:
* independent evidence checks;
* a tamper-evident ledger;
* held-out scoring that stays sealed until every answer is frozen.

Two results:
1. **Closed loop.** One Kane call found 2 of 3 planted game bugs. A coding agent reproduced them, found the third and fixed all three, verified independently.
2. **A misleading improvement caught.** In a pre-registered 20-call experiment, one session's accuracy jumped from 31.78% to 81.25%. GameWatch showed why: coverage fell from 12.32% to 1.00%, and there were zero genuine corrections. Kane had withdrawn a hypothesis, not fixed one.

We also report what didn't work: most structured hypotheses failed the schema, most revision calls submitted nothing, and the sample is small. Improving an agent's reasoning and improving the trustworthiness of the workflow around it are different goals. GameWatch targets the second.

Repo, report and evidence: <repo link> #KaneCLIHackDay

## Hacker News (Show HN)

**Title:** Show HN: GameWatch – verifying what an autonomous test agent claims about a game's rules

**Text:** GameWatch wraps Kane CLI, an autonomous browser test agent. Kane explores recorded playtests of a board game with hidden rules and proposes rules and bugs. GameWatch then:
* checks each claim against sealed held-out observations;
* records every step in a hash-chained ledger;
* separates real corrections from coverage narrowing.

In a pre-registered run of 20 Kane calls, one session's accuracy went from 32% to 81% with zero corrections, because it simply predicted less (coverage fell from 12% to 1%). We publish the negative results too: schema failures in 6 of 10 sessions, empty revision calls, and n=5 per arm. Report and redacted evidence: <repo link>
