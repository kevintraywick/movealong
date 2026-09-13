# The feedback loop — how the board improves itself (brainstorm, 2026-09-12)

Kevin's brief: build a loop so the agent, the research and the app as a whole
recursively self-improve, without direct user input. Candidate signals he named:
steps promoted to the board, steps deleted right after generation, regenerate
count. He also wants the agent to gather what it needs (contacts, mail) in-line
and non-intrusively, and to think about what this looks like in three or four
years. The goal: completing a task should be as easy as typing it.

## 1. What actually improves

Be precise about what "self-improvement" means here, because it is not the model.
Nothing in this app can touch weights. Three things can change from evidence:

1. **The instructions** — the drafting prompt, the research prompt, and the brief
   (pinned + inferred lines). This is the cheapest lever and already has a
   surface: `brief_learned`, keep/drop, the task monitor.
2. **The delegation ladder** — how much the agent is allowed to do on its own for
   a given kind of step (draft / draft-and-ask / do-and-tell / do silently).
3. **The agent's toolset** — what it can reach (a contact, a mailbox, a card).
   Each new tool moves a class of steps from "you" to "the agent".

So the loop is: *observe what the user does with the steps → rewrite the
instructions and the ladder → draft the next task under the new rules → observe
again.* The user is the ground truth through behaviour, not questionnaires.

## 2. Signals — and why single events lie

Every proposed metric is right as a *signal* and wrong as a *score*:

| event | reads as | but also |
|---|---|---|
| step promoted ↑ to the board | the step was good | the step was too big and needed its own slot |
| step ticked seconds after generation | rejected | there is no delete, so a tick is the only way to free a slot — this *is* the delete |
| step ticked a day later | done | swept the pane to make room |
| ↺ regenerate | the list was bad | they did four and want the rest |
| 🔎 research on a step | this step was worth money | the *topic* was worth it; the text may still be wrong |
| link click in a step | strongest cheap positive: they acted on it | — |
| edited a step's text | the text was wrong but the step was right | — |

Two things make these separable:

- **Time since generation.** A tick at 4 seconds and a tick at 26 hours are
  different verbs. Log `ms_since_generated` on every event and the verb is
  recoverable. Same for ↺: regenerate at 10 seconds (rejection) vs after three
  ticks (top-up).
- **Trajectories, not events.** Score the *pane*, not the row: "7 drafted, 2
  promoted, 3 done over four days, 2 ticked within a minute" is a story. A
  model can read a story; a counter can't.

Which is the design: **don't build a scoring function, build an event log and
let the monitor read it.** `step_events (subtask_id, task_id, event, ms_since_generated,
at)` — tick, untick, promote, link_click, research, regenerate, edit, page_open,
decision_answered. Cheap, no UI, and the same `learnBrief()` pattern that already
turns task descriptions into inferred lines can turn events into inferred
*working-style* lines:

> (personal, inferred) Ticks off "call to confirm" steps untouched — never does
> phone calls. Draft those as agent steps or drop them.
> (personal, inferred) Promotes the buying step every time — draft it as its own
> task, not a step.
> (this board, inferred) Four steps, not seven, for errands.

These go through the existing keep / ✕ surface on the brief page, so the user
never has to look, but can.

## 3. The recursive part — rules must earn their keep

An inferred rule that is wrong compounds silently: "never propose phone-call
steps" hides steps the user wanted, and nothing in the log will ever show the
step that wasn't drafted. Two guards:

- **Rules decay.** An inferred line carries `last_supported_at`; if no fresh
  event supports it in N tasks it drops out of the prompt (stays on the page,
  greyed, "no longer seeing this"). Pinned lines never decay.
- **Holdout drafts.** One task in ten is drafted *without* the inferred rules
  (the user doesn't know which). Compare reject rate (ticks < 60s, ↺ < 60s) and
  act rate (promote, link click, done) between the two arms per rule. A rule
  whose presence doesn't move the numbers is dropped automatically. This is the
  one genuinely self-correcting mechanism in the design — a control arm the app
  runs on itself, at zero cost, forever.

The scoreboard the loop is trying to move (put it on the dashboard):

- **asks per task** — questions the agent had to put to the user (↓)
- **agent share** — steps completed by an agent run, not a person (↑)
- **human-minutes per task** — proxied by events; crude but directional (↓)
- reject rate of drafts (↓)

Show the curve. A self-improving system with no visible curve is a claim.

## 4. When is the human necessary — the tall pole

Label every drafted step by *what blocks it*:

| needs | example | who |
|---|---|---|
| **information only you have** | which Josh? what budget? | you, once — then it's in the brief |
| **your authority** | send, spend, sign, book | you, per instance — or a standing policy |
| **your body** | measure the fence, drop off the car | you |
| **your taste** | pick the stain colour | you, unless the brief says "you choose" |
| **nothing** | find three cedar prices | the agent |

This generalises the subtasks v2 `decision` row: a decision is one kind of
blocker. The tall pole is **the blocked step with the longest chain of
dependents** — ask that first. Today's rule ("the fork whose answer rewrites the
most steps") is the same idea; the refinement is that the question should be
the one that *unblocks the most agent work*, not the most user work. A question
the agent can't act on the answer to isn't worth the interruption.

## 5. Asking without intruding — the ask lives in the step

Never a modal, never a setup wizard, never "connect your contacts". The ask is
a row in the pane, tied to a step the user already wanted, answered once,
remembered:

> 📧 Email Josh about the Mac Studio — *I can draft this if I know which Josh:*
> [paste email] [it's Josh Meyer, josh@…]

Answering writes `Josh Meyer <josh@…>` into a **People** section of the brief
(back-burnered on 2026-09-02 for privacy reasons; this is the non-creepy
version — one person at a time, only those who come up, visible and deletable
on the page). Next time the step just says "Email Josh (josh@…)".

The email step itself, first time: agent drafts subject + body onto the task
page; the step reads **"Draft ready — [Open in Mail] [Send]"**. *Open in Mail*
is a `mailto:` with subject and body prefilled — zero access, zero storage,
works today, opens the user's own mail app with their own identity. *Send*
needs a mailbox and doesn't exist yet.

**The delegation ladder** is how "Send" becomes safe: each rung is earned by
behaviour on the rung below, is visible on the brief page, and is revocable:

1. draft, show it — user opens and sends themselves
2. draft, one-click send — user pressed Send N times without editing the draft
3. send and tell — "Emailed Josh, here's what I said" with an undo window
4. send silently — only by a pinned policy line ("send to Josh without asking")

The step's wording shows the rung ("Draft ready" / "Sent — undo" / "Sent"),
and the user moving *down* a rung (editing a draft heavily, hitting undo) is a
signal too. Money uses the same ladder with the policy-in-the-brief +
money-elsewhere shape already recorded in CLAUDE.md.

## 6. Three or four years out

The user has an assistant with their mail, contacts, calendar, files and a
card, plus a fleet of task agents and standing loops. Two consequences for the
board:

- **The board doesn't hold the mailbox; it delegates.** It becomes the task
  ledger and the *approval surface*, and hands execution to whatever agent the
  user has — via MCP / A2A-shaped protocols rather than its own integrations.
  Building a mail integration into an unauthenticated SQLite app is the wrong
  decade. Build the ask/ladder/undo vocabulary; plug agents in underneath.
- **The board inverts.** Today it lists what the human must do. Then it lists
  *what only the human can do* — decisions, consents, physical acts — and shows
  everything else as agent activity (the dot strip from subtasks v2). The 7/day
  cap becomes a cap on human items. The morning view is "3 decisions, 1
  signature, 2 errands" — and typing a task becomes optional: a stated goal
  ("fence done by October") produces the tasks, and the human's job is to say
  no to the ones that are wrong.

The scoreboard from §3 is exactly the curve that story needs: agent share
rising, asks per task falling, month over month, on one board.

## 7. What to build, in order

| # | step | why first | confidence |
|---|---|---|---|
| 1 | `step_events` log with `ms_since_generated` (tick, promote, link click, research, ↺, edit, page open, decision) | foundation; no UI; every later step reads it | 90% |
| 2 | extend `learnBrief()` to read events → working-style inferred lines, through the existing keep/✕ page | reuses a shipped surface; first visible "it learned me" | 80% |
| 3 | blocker labels on drafted steps (`needs: you / your ok / agent / nobody`) + the in-line ask row that writes to the brief | unifies subtasks v2 decisions and info asks in one row kind | 70% |
| 4 | agent dispatch v1: the email step — draft on the task page, `mailto:` Open button, one-person People section fed by asks | the first real "the agent did it", with zero access | 75% |
| 5 | rule decay + holdout drafts + auto-drop | the actual recursive mechanism; needs 1 and 2 for data | 65% |
| 6 | dashboard: agent share · asks per task · reject rate, per month | the curve; makes the loop a thing you can see | 80% |

Open questions:

- **Q1** — Holdout drafts mean one task in ten is deliberately drafted worse.
  Acceptable, or should the control arm only run on boards past some volume?
- **Q2** — Should inferred *working-style* lines be shown on the brief page
  beside the factual ones, or in their own "How you work" pane? (My pick: own
  pane — they're a different kind of claim and a wrong one is more annoying.)
- **Q3** — People section: opt-in lazily via asks only, or also allow paste of
  a vCard? (My pick: asks only, until the app has auth.)
- **Q4** — Is `mailto:` acceptable as "Open it" for v1, or is anything short of
  in-app send not worth shipping?
