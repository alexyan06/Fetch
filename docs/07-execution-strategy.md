# Execution Strategy

## Context
Solo hackathon (no team). Resources: Claude Pro subscription, $100 in Claude Code credits, 2,000 Codex tokens, willing to spend more if needed. 12-hour window (7:30pm–7:30am).

## Claude Code parallelism toolkit (verified against current docs, July 2026 — re-verify if anything seems off during the event, this stuff moves fast)

| Primitive                                                                          | What it gives you                                                                                                         | When to use                                                                                                                                                                                |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Subagents**                                                                      | In-session delegated focused task, reports back, doesn't talk to other agents. Cheapest, lowest coordination overhead.    | Bounded research/investigation ("go figure out the Accounting Common Model shape") while main thread keeps building.                                                                       |
| **Git worktrees** (`claude --worktree <name>`)                                     | Separate isolated checkout + branch, own terminal, no file collisions.                                                    | **Default choice for solo multi-lane work.** One worktree per independent module.                                                                                                          |
| **Agent Teams** (experimental — `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`)          | Multiple full Claude Code instances, own context windows, message each other directly, self-claim off a shared task list. | Once architecture/interfaces are locked and pieces are genuinely independent. 3-5 teammates is the sweet spot. Higher token cost — reserve for real parallel building, not routine typing. |
| **Headless mode** (`claude -p`, `--allowedTools`, `--permission-mode acceptEdits`) | Scripted, autonomous one-shot background jobs.                                                                            | "Generate seed data for 20 mock companies," "write tests for the trigger-detection module" — fire and forget.                                                                              |

## Recommended operating rhythm
1. **Lock architecture first, in plan mode** (~15-20 min) — interfaces between modules, data shape coming back from Merge, the API contract between pieces. This is cheap insurance against merge-hell later; parallel agents guessing independently on an undefined architecture is the single biggest time-waster risk.
2. Fan out via worktrees (and/or Agent Teams once independence is confirmed) once interfaces are defined.
3. Every agent gets a verification loop (a build/test script) so it self-corrects instead of requiring constant manual review — this is what actually lets solo-you run multiple things in parallel without becoming the bottleneck.
4. Periodic sync/merge windows (~every 60-90 min): pull branches, resolve conflicts, re-verify.
5. Reserve the last ~90 minutes for demo polish, seed data quality, and a **backup recorded demo video** in case the live demo breaks.

## Pre-hackathon prep checklist (do this before 7:30pm — doesn't cost hackathon clock)
- [ ] Merge account + API key + test Linked Account set up (confirmed: public API + free credits available for this event).
- [ ] Install the `merge-unified-skills` Claude Code plugin.
- [ ] Scaffold base repo + write a solid `CLAUDE.md` (tech stack, conventions, Merge integration details, Corgi taxonomy reference).
- [ ] If planning to use Agent Teams: test once tonight on a toy task so you're not debugging the meta-tooling live at 8pm.
- [ ] Decide the final idea/scope and stack ahead of time — don't burn hackathon hours deciding what to build.

## Codex's role
Treat as an independent lane, not integrated into the same orchestration as Claude Code — own worktree/branch, clear interface boundary, same verification-loop discipline before handing work back. Good candidate for frontend polish or a second-opinion review pass on Claude Code's output.
