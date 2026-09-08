# Subtasks v2 — model choice, decision points, agent activity

Brainstorm + recommendation, 2026-09-06. Nothing here is built yet.

The goal restated (Kevin): a subtask pane exists to get a person **off the starting block** — the first
step, fast — and then, with a few discrete decisions from the user, let Move Along carry as much of the
task as it can, presenting human-only steps the person can act on immediately.

---

## 1. Which model drafts the steps

### Where things actually stand

Phase 1 (the 5-7 draft steps) **already runs on Sonnet 5**, not Haiku. Haiku 4.5 only does the cost
triage (`material | labor | service | none`) and the brief-line filter. So the question is not
"Haiku → Sonnet" but "Sonnet 5 → Opus 5 (or Fable 5.1)".

Current phase-1 call (`generateSubtasks()` in `ai.js`): raw `fetch`, `max_tokens: 2048`, no thinking
or effort settings, 20s abort. Prompt is ~700-1,000 input tokens (more with a long brief), answer
~400-600 output tokens.

### Cost per drafted task (first-party API rates, checked 2026-09-06)

| Model | Input $/M | Output $/M | Est. per draft | Notes |
|---|---|---|---|---|
| Sonnet 5 (today) | $2 | $10 | **~$0.007** | adaptive thinking is on by default when omitted |
| Opus 5, effort `medium` | $5 | $25 | **~$0.02-0.03** | thinking on by default; effort caps how much |
| Fable 5.1 | $10 | $50 | ~$0.10+ | thinking always on, slower turns, `refusal` stop reason, 30-day retention required |

For scale: a **researched** step costs ~$0.03 (2 searches) and the old whole-task pass ~$0.10. Moving
phase 1 to Opus 5 makes the draft cost a quarter of a research pass instead of a fifteenth. On a $5
board that's ~200 Opus drafts a month versus ~700 on Sonnet. Phase 1 isn't budget-gated (a typed task
always gets steps), so the budget only matters as a monthly reality check.

### Recommendation: Opus 5 for phase 1, keep Haiku for triage, don't touch Fable — confidence 80%

Why Opus and not "keep Sonnet":
- The thing the pane is judged on is **the first step being the right first step**, and (with §2)
  **spotting the one fork that actually matters**. Both are judgment, not recall. That is the
  Opus/Sonnet gap, and it's worth 2 cents.
- Prices moved: Opus 5 is $5/$25 where Opus 4.x was the same and Sonnet 4.6 was $3/$15. Opus is now
  under 2× the *previous* Sonnet, for a call that costs pennies either way.

Why not Fable 5.1:
- 5× Opus, thinking can't be turned down below its floor, turns run long — wrong tool for a
  "seconds, not right yet" draft. It also needs `refusal` handling and a 30-day retention org setting.
  Revisit for the *agent-dispatch* pass (§3), where a long, careful turn is the product.

What changes in `ai.js` (small):
1. `MODEL = 'claude-opus-5'` for phase 1 only; research stays on Sonnet 5 until measured (the
   research pass is search-bound, not reasoning-bound — Sonnet + `web_search` is the cheap config).
2. `output_config: { effort: 'medium' }` on the phase-1 call. Default is `high`, which would think
   longer than a 20s draft can afford. Try `low` first if latency creeps.
3. Raise the abort from 20s to 30s and measure p50/p95 on real tasks for a day before deciding.
4. Add the `RATES` row for `claude-opus-5` ($5/$25) so `ai_usage` stays honest.
5. Optional: `output_config.format` (structured outputs) to replace the regex `unwrap()` — worth it
   once the decision-point envelope in §2 makes the shape richer.

Latency is the risk (confidence the p95 stays under ~8s at `medium`: 65%). If it doesn't, `low` on
Opus 5 is still expected to beat Sonnet at default effort on judgment tasks.

---

## 2. Decision points

### The rule of the pane

A decision point is **the assistant's question to you**. The board already has a vocabulary for that:
amber = *their* unanswered question (awaiting rows), blue = *your* move (review rows), and the brief
page has an inbox called "The assistant wishes it knew". A decision row should be amber, and there
should be **at most one open decision per pane** — asking three questions at once is the decision
fatigue the app exists to remove. The model asks the biggest fork first; later forks appear after it's
answered.

Second rule, from the "starting block" goal: **the pane must always contain at least one step you can
do right now that doesn't depend on the decision.** A pane that is only a question hasn't moved anyone.

### Presentation — chips in the row, not a flowchart (recommended)

The research (links in §4) converges hard: every product that branches shows the *respondent* one
question with 2-3 buttons and keeps the tree in the author's head (Typeform, Tally, Slack Block Kit,
RCS chip lists). The 178px pane can't afford a flowchart, and a flowchart shows the user the branches
they are about to discard.

```
 ○  Book the community-center room by Fri (parks.nashville.gov)
 ○  Text the six couples the date                                <- doable now
 ?  Food: [ cook ] [ cater ] [ potluck ]                          <- amber row, one open question
 ·  (steps for the food plan appear here once you pick)
```

After a click:

```
 ○  Book the community-center room by Fri
 ○  Text the six couples the date
 ✓  Food: cater   (cook · potluck)                                <- settled, other options faded, click to reopen
    ○  Get 3 quotes — Thumbtack caterers near you (thumbtack.com/…)
    ○  Decide headcount + dietary needs before quoting
    🧠 Compare per-head price vs a Costco tray run
```

- Chips ≤ 25 chars each (the RCS cap; it's a good rule for 178px), 2-3 of them, plus a typed
  "other…" so the model's list is never a cage (Google PAIR: the user must be able to adjust).
- Follow-on steps render as **dependents of the decision row** — `parent_subtask_id` already exists,
  already indents, already cascade-deletes. Changing your mind deletes the old branch by the FK we
  already have.
- A settled decision stays visible as a row (NN/g on wizards: keep the answered steps in view) — it
  is now a *fact* the later steps rely on, and the brief monitor can learn from it.
- The seven-cap: a decision row counts as one; its branch steps fill the freed slots. The pane's
  arithmetic doesn't change, and the ↑ promote escape hatch still applies.

### Where the tree *does* get drawn: the task page

`/task/:id` has width. Once decisions exist as data, a small SVG "path so far" on the task page
(d3-hierarchy is 5 KB, or hand-drawn like the existing `#chainOverlay` threads) is cheap and reads
well there: "Food → cater → Thumbtack quotes". That is the flowchart Kevin pictured, in the place it
fits. Not in the pane.

### Generation: on click, not all branches up front (recommended, 75%)

Two options:
- **Pre-generate every branch** in phase 1: instant click, but 3× the output tokens for steps the
  user will never see, and the draft gets slower (the one thing phase 1 must not be).
- **Generate the branch on click**: one small Opus call (~$0.02, 3-5s) with the task, the kept
  steps, and the answer. The 3-5s wait is where the §3 activity indicator earns its place, on day one.

The phase-1 envelope grows one field:
```json
{"steps": [...], "decision": {"question": "Food", "options": ["cook","cater","potluck"], "after_step": 2} | null, ...}
```
`POST /api/subtasks/:id/decide { choice }` records the choice, calls the model for the branch, inserts
the rows as dependents, returns the full pane. Re-deciding deletes the branch and reruns.

Schema: `subtasks.kind` (`'step' | 'decision'`), `subtasks.options` (JSON text), `subtasks.chosen`
(text, NULL until answered). Three `ensureColumn`s.

Prompting the fork honestly (OpenAI model spec + Anthropic's "pause rather than assume"): *draft with a
stated default, and surface a decision only where the branches genuinely diverge.* Most tasks have zero
or one real fork. The prompt should say so, or every pane will grow a question.

---

## 3. Showing the agent at work

### What exists today

"Delegate to AI" is a single research call per step (`POST /api/subtasks/:id/research`, ≤ 2 searches,
15-60s), the row's ↻ spins, and `pollResearch()` checks every 3s. There is no fan-out, no queue, no
agent that does anything but search and rewrite the row. Tessa auto-accepts handovers but nothing runs.

So "20 agents on one step" is a future; the visualization should be designed for it but must read
right at **N = 1**, which is every case today.

### Recommendation: a Houdini-style dot strip on the row, expanding to a named list — 80%

The TOPs pattern is the right reference and it scales exactly as far as the pane needs:

| Agents | Render | Why |
|---|---|---|
| 1 | the existing spinning ↻ plus a single pulsing dot | one dot alone is invisible (research agent's finding) |
| 2-7 | one 7px dot per agent after the step text: grey outline queued · sky pulse running · sky fill done · red failed | ~67px, fits beside text, each dot a click target |
| 8-20 | dots wrap to a second line, plus a count `12/20 · 1 failed` | still readable, still one row |
| > 20 | count + thin bar strip (Statuspage style), dots only in the expanded view | this is Houdini's own pagination rule |

Click a dot (or the strip) and the row expands into a **named list** — one line per agent, what it's
doing in ≤ 5 words, elapsed time, and when done, what it found. That's the Perplexity/Deep Research
pattern, and it's where "show your work" lives. Keep the step text live throughout; don't skeleton it
(the Viget study: skeletons tested worst).

Colors: the sky ramp for running/done, red only for failed. **No green** — Houdini's palette is green-
heavy and the app's isn't. `prefers-reduced-motion` pins the running dot to a static half-fill.

### What has to exist underneath

A visualization of work needs work to visualize. Minimum backend:
- `agent_runs` table: `subtask_id`, `label`, `status` (`queued|running|done|failed`), `started_at`,
  `finished_at`, `result` (text), `ai_usage_id`. One row per agent.
- The existing per-step research becomes the first `agent_run` kind. Fan-out (a coordinator that
  spawns N runs — "get quotes from 5 caterers" → 5 runs) is the second, and is where Opus/Fable and
  the Anthropic multiagent/Managed Agents surface become relevant. Not this pass.
- `pollResearch()` generalizes to poll `agent_runs` for open rows in the open pane. Still no
  websockets; 3s is fine for work that takes 15-60s.
- Results land in `tasks.results` / the task page (the "come home for review" idiom already exists
  for human work; AI work should use the same door).

### On "another pane pops up"

I'd argue against a second floating pane. The board already has a single-pane rule because same-day
panes occlude each other, and a second one will fight the first for the 200px column. The row strip +
expand-in-place covers "is it working", and the task page covers "what did it find". If Kevin wants a
dedicated *place* for watching agents, the task page's Results pane growing a live "Working" section
is the cheaper version of a popup.

---

## 4. Links to look at

### Decision points
1. Typeform Logic Jumps — https://www.typeform.com/developers/create/logic-jumps/ — one question, N choices, the tree is invisible to the respondent.
2. Zapier Paths — https://help.zapier.com/hc/en-us/articles/8496288555917-Add-branching-logic-to-Zaps-with-Paths — steps hanging under a branch label; render only the chosen column.
3. Make.com Router — https://help.make.com/router — the side-by-side version; shows why it needs width the pane lacks.
4. Tally conditional logic — https://tally.so/help/conditional-form-logic — show/hide subsequent blocks in place.
5. Slack Block Kit — https://docs.slack.dev/block-kit/ — 2-3 buttons inline in a narrow card.
6. Google RCS suggested replies — https://developers.google.com/business-communications/rcs-business-messaging/guides/build/messages/send — 25-char chips that vanish once answered.
7. NN/g Wizards — https://www.nngroup.com/articles/wizards/ — keep answered steps visible.
8. NN/g Progressive disclosure — https://www.nngroup.com/articles/progressive-disclosure/ — hide the branch until asked.
9. NN/g AI chatbot guidelines — https://www.nngroup.com/articles/ai-chatbots-design-guidelines/ — buttons over free text; never re-ask an answered question.
10. NN/g Prompt structure — https://www.nngroup.com/articles/ai-prompt-structure/ — ask framing questions early.
11. Capicua, decision trees in product design — https://www.capicua.com/blog/decision-trees-in-product-design — the flowchart framing, and how fast trees get wide.
12. OpenAI Model Spec — https://model-spec.openai.com/2025-04-11.html — guess with stated assumptions; ask only when markedly unclear.
13. Anthropic, trustworthy agents — https://www.anthropic.com/research/trustworthy-agents — pause rather than assume; interruptions have a cost.
14. Anthropic, measuring agent autonomy — https://www.anthropic.com/research/measuring-agent-autonomy — models do ask more on complex tasks.
15. Google PAIR, errors + graceful failure — https://pair.withgoogle.com/chapter/errors-failing/ — "I can't plan the food until you pick".
16. Google PAIR, feedback + control — https://pair.withgoogle.com/chapter/feedback-controls/ — the user must be able to un-choose.
17. d3-hierarchy tree (5 KB gz) — https://d3js.org/d3-hierarchy/tree — if a tree is ever drawn, on the task page.
18. Mermaid flowchart — https://mermaid.js.org/config/usage.html — ~1 MB gz; too heavy for a 3-node fork.

### Agent activity
19. Houdini TOPs UI (the dot grid + state colors) — https://www.sidefx.com/docs/houdini/tops/ui.html
20. Houdini `pdg.workItemState` — https://www.sidefx.com/docs/houdini/tops/pdg/workItemState.html — the ten states; we need four.
21. Tokeru cgwiki, TOPs — https://www.tokeru.com/cgwiki/HoudiniTops.html — screenshots of 100-dot nodes.
22. GitHub Actions visualization graph — https://docs.github.com/en/actions/how-tos/monitor-workflows/use-the-visualization-graph — icon + name per job.
23. GitHub status checks — https://docs.github.com/en/pull-requests/reference/status-checks — the minimal queued → running → concluded vocabulary; many checks compressed to one summary row.
24. Buildkite build page — https://buildkite.com/docs/pipelines/build-page — collapse parallel jobs by default; failures float up.
25. pytest progress output — https://docs.pytest.org/en/stable/how-to/output.html — one glyph per unit + percent; `-v` for names.
26. Atlassian Statuspage uptime bar — https://support.atlassian.com/statuspage/docs/display-historical-uptime-of-components/ — 90 units in a narrow row when they're bars.
27. Perplexity's step-by-step plan UI — https://www.langchain.com/breakoutagents/perplexity — named steps, expandable.
28. Claude Code subagent progress issue — https://github.com/anthropics/claude-code/issues/48246 — users asking for exactly a glyph-per-agent list.
29. Cursor Agents window — https://cursor.com/docs/agent/agents-window — one row per agent; fine at 3, wrong at 20.
30. NN/g progress indicators — https://www.nngroup.com/articles/progress-indicators/ — spinner only under 10s; "3 of 7" past that.
31. Apple HIG progress indicators — https://developer.apple.com/design/human-interface-guidelines/progress-indicators — keep the running one moving.
32. Viget, skeleton screens tested worst — https://www.viget.com/articles/a-bone-to-pick-with-skeleton-screens
33. UX Magazine, agentic UX patterns — https://uxmag.com/articles/secrets-of-agentic-ux-emerging-design-patterns-for-human-interaction-with-ai-agents
34. three-dots CSS loaders — https://github.com/nzbin/three-dots — the pulse keyframes, ~10 lines.
35. Pulsing status dot snippet — https://snippflow.com/snippet/css-status-indicators-with-pulsing-animation/

---

## 5. Suggested order of work

1. **Model swap** — Opus 5 + `effort: medium` on phase 1, rates row, 30s abort; measure a day. (90%)
2. **Decision envelope + schema** — `kind/options/chosen`, prompt asks for ≤ 1 real fork with a default. (85%)
3. **Decision row + chips in the pane**, branch generated on click as dependents, reopen by clicking the chosen chip. Mockups in `archive/dp-v1..v4.html` first. (75%)
4. **`agent_runs` table + dot strip on the row**, with the existing per-step research as the first run kind and the decision-branch call as the second — so N = 1 ships with something real behind it. (75%)
5. **Task page: path-so-far tree + live "Working" section.** (65%)
6. **Fan-out** (a coordinator that spawns N runs) — the point at which "20 dots" becomes true, and the point at which Fable/Managed Agents gets evaluated. Not in this pass. (—)

## 6. Decisions taken (Kevin, 2026-09-06)

- Model changes as recommended → **done in `ai.js`**: `DRAFT_MODEL = 'claude-opus-5'`, `effort: 'medium'`,
  `max_tokens: 4096`, 30s abort, `RATES` row added. Research stays on `MODEL` (Sonnet 5). Not yet
  measured for latency — no local key; run
  `railway run --service movealong node <scratch script>` to time two real drafts.
- **Q1: branch on click.** Q2: one open decision, biggest first — yes. Q3: mock both the pane chips
  and the task-page tree. Q4: dot strip that expands in the row. Q5: fan-out is in scope soon, so
  `agent_runs` is designed for N from the start. Q6: Opus cost accepted.
- **How "biggest" is decided (Q2).** Not a heuristic in code — the model is told what biggest means
  and picks: *the fork whose answer changes the most of the remaining steps; ties go to the one that
  comes earliest in the sequence.* Concretely the envelope asks for `decision.after_step` and the
  prompt says: draft every step with a stated default; if one choice would rewrite three or more of
  the steps, surface it as the decision instead of guessing; if two forks qualify, ask the one that
  comes first, and let the second surface after the branch is generated. The `why` line in the pane
  ("3 of 7 steps depend on this") is the same number said out loud, so a bad pick is visible.
- Mockups: `archive/sv2-*.html` (built by `archive/sv2-build.js`). DP1 chips / DP2 stacked rows /
  DP3 banner above the list; `sv2-tree` for the task page; AG1 inline dots / AG2 own-line + count /
  AG3 expanded named list / AG4 scaling 1 → 60.

## 7. Open questions

- **Q1.** Branch on click (3-5s wait, cheap) versus pre-generate every branch (instant, 3× tokens, slower first draft)? I recommend on click.
- **Q2.** One open decision per pane, biggest fork first — agreed? Or do you want every fork visible up front?
- **Q3.** The flowchart: is the task page the right home for it, with the pane staying chips-only?
- **Q4.** Agent activity: dot strip on the row that expands in place, with results on the task page — or do you really want a separate pane? If separate, where does it live in a 200px column?
- **Q5.** Is real fan-out (many runs per step) in scope soon, or should step 4 ship with N = 1 and the strip designed for more?
- **Q6.** Comfortable with ~4× phase-1 cost (still ~2-3¢ a task) for Opus 5?
