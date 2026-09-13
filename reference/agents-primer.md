# Agents — a primer for the board (2026-09-12)

Kevin's framing: agents that *inform* the board (check email, pull bank and
card balances into a daily financial dashboard, read the phone's health app
into a health dashboard), agents that *track recurring appointments*, and
agents that *react to a completion* — ticking "find a dermatologist" should
prompt a review of recent communications, record the doctor in contacts, and
confirm the appointment made it onto the calendar.

## 1. What an agent is, operationally

Strip the word down and an agent is four things: **a trigger** (what starts
it), **tools** (what it may read and do), **a loop** (model calls a tool, reads
the result, decides the next call) and **a stop condition** (done, out of
budget, or stuck). Everything else is presentation. The model is the least
interesting part and the most replaceable; the tools are the product.

Two consequences worth internalising:

- **An agent is only as good as what it can reach.** "Find a dermatologist"
  with web search is a list of names. With the calendar, insurance card and
  home address from the brief, it is a booked appointment. Every real gain in
  this app comes from a new tool, not a better prompt.
- **An agent that can act needs a leash.** Reading is cheap and safe; sending,
  spending and booking are not. The delegation ladder in the feedback-loop
  brainstorm (draft → one-click → do-and-tell → silent) is how the leash
  lengthens, one rung at a time, by evidence.

## 2. The five shapes the board needs

| shape | trigger | tools | writes | examples |
|---|---|---|---|---|
| **Drafter** | a task is typed | none (reasoning only) | steps | phase 1, today |
| **Researcher** | 🔎 on a step | web search | rewrites a step, prices | today |
| **Informer** | a schedule | read-only feeds | a dashboard pane, or rows on the board | mail digest, balances, health, weather |
| **Actor** | a step, on the ladder | write tools | the world, then the step | email, book, buy |
| **Hook** | a board event (tick, arrival, date) | read tools, then a few writes | brief, contacts, calendar, follow-up tasks | the dermatologist |

The dermatologist example is a **hook** with an **informer**'s tools: ticking
the task fires "read mail and messages since the task was created, find the
appointment, write the doctor to People, check the calendar, add the event if
missing, put a *confirm insurance* step three days before". Nothing in that
chain needs the user, and everything in it is checkable on the task page.

Informers are the cheapest win and the biggest privacy step at once: they run
on a schedule so cost is predictable, but they are exactly the ones that need
a mailbox, a bank login, a health export.

## 3. The shape of one agent, as data

Build agents as **rows in a registry**, not as code paths — the same move as
`PERSONAL_SECTIONS` for the brief. One row says everything the runtime needs:

```
agents
  key            'derm_followup'
  kind           hook | informer | actor | researcher
  trigger        { on: 'task_completed', match: /dermatolog|doctor|appointment/i }
                 { cron: '07:00' }
  reads          ['mail.search', 'calendar.list', 'brief']
  writes         ['people.upsert', 'calendar.create', 'tasks.create', 'task.results']
  rung           1..4   (the ladder — how far it may go without asking)
  budget_usd     per run
  prompt         the instructions, with the brief merged in
```

`agent_runs` (already sketched for subtasks v2) is the audit trail: which
agent, on which task, when, what it read, what it wrote, what it cost, and the
result text that lands in the task page's **Results** pane. The dot strip on
the row shows it running. A run that wants to act past its rung writes a
**decision row** instead of acting — the amber row from subtasks v2 — and the
user's click is the consent.

## 4. Where the data comes from — the honest inventory

| source | how | catch |
|---|---|---|
| **Gmail, Google Calendar** | MCP connectors (Kevin already has both attached to Claude); Google APIs with OAuth | tokens must live somewhere — see §5 |
| **Proton mail / calendar** | no API; IMAP via Proton Bridge on a Mac | Mac-only, bridge must be running |
| **Bank / card balances** | Plaid Link (OAuth-style, per-institution), or SimpleFIN Bridge (cheaper, read-only, built for exactly this) | never a username/password in the app; Plaid pricing is per-item per month |
| **Apple Health** | no API. Export via the Health app (XML, manual) or **Health Auto Export** (iOS app, pushes JSON to a webhook on a schedule) | the phone pushes to *you*; you never pull |
| **iMessage / SMS** | only on a Mac: `~/Library/Messages/chat.db` with Full Disk Access; Android via a sync app | not reachable from a server at all |
| **Weather, prices, places** | web search (today), or Open-Meteo / Google Places APIs | already the cheap configuration |
| **Contacts** | macOS Contacts via AppleScript/JXA; Google People API | or the People section fed by asks (§ brainstorm) |

Two things stand out. Half these sources are **Mac-only or phone-push**, and
every one of them is a credential the board would have to hold.

## 5. The architecture question — who holds the keys

Today the app has no auth and an unencrypted SQLite file on a Railway volume.
A Gmail token or a Plaid item in that file is the worst thing on the server.
There are two ways to get agents without that:

**A. Server-hosted agents.** The board runs them (a scheduler — which the
server deliberately doesn't have — plus a vault for tokens plus real auth on
the board). This is the "proper" shape and it is three features away.

**B. The board becomes an MCP server; the agents run as the user's own
Claude.** Expose the board — tasks, steps, brief, people, results, events — as
MCP tools. Then Claude Code on Kevin's Mac, which *already* has Gmail,
Calendar and Drive connectors authorised, plus Messages and Contacts on disk,
runs the dermatologist hook with zero credentials on the server. The board
publishes "jobs" (an `agent_runs` row in `queued`); the local agent polls,
runs, writes the result back through the same MCP tools. A scheduled routine
does the informers (Claude Code's `/schedule` exists for exactly this).

B is the honest first step, for three reasons: the sources that matter most
are on the Mac anyway; it needs no vault; and it makes the board *the thing
every agent talks to*, which is the four-years-out picture from the brainstorm
("the board doesn't hold the mailbox; it delegates"). When real auth arrives,
A can be added for the cloud-friendly agents without changing the tool surface.

Cost: MCP server = one file with ~10 tools over the existing routes. Claude
Code SDK / Agent SDK can also run the loop headlessly if a Mac-side daemon is
wanted later.

## 6. The dermatologist, end to end, under B

1. Kevin types *find a dermatologist*. Phase 1 drafts; the brief says home
   address and insurer, so step 1 is "Pick from three in-network derms within
   2 h of 37201 (links)" — the researcher fills the links on 🔎.
2. He books one by phone or email, then ticks the task.
3. The tick logs `tick` (step event) and, because the task matches the hook's
   trigger, writes an `agent_runs` row: `derm_followup`, queued.
4. His local agent picks it up: searches mail and Messages since the task was
   created for the practice name, finds "Dr. Okafor, Oct 3 2:30", checks
   Calendar, adds the event if missing, upserts *Dr. Okafor — dermatology —
   (615)…* into People, writes a two-line result to the task page, and creates
   *confirm insurance for Dr. Okafor* locked to Sep 30.
5. The board shows the dot on the row turn solid; the task page's Results pane
   has the trail. Nothing was sent, spent or booked — rung 1 — so nothing
   asked.

Everything the agent wrote is visible and reversible. The first time it
guesses wrong (a different doctor's confirmation email), the reclaim/undo
path is the same one review rows already have.

## 7. Build order

| # | step | confidence |
|---|---|---|
| 1 | `agents` registry + `agent_runs` table + the dot strip (subtasks v2 already needs both) | 85% |
| 2 | **MoveAlong MCP server** — read/write tasks, steps, brief, people, results, events; ~10 tools over existing routes | 80% |
| 3 | First hook: `task_completed` → queue a run; run it from Claude Code with the Gmail + Calendar connectors; results to the task page | 70% |
| 4 | First informer: a daily routine that reads mail + calendar and writes a *Today* pane (the morning briefing) | 70% |
| 5 | People section fed by hooks and asks | 75% |
| 6 | Financial and health informers — SimpleFIN and Health Auto Export webhook — only after auth, since both are standing credentials | 50% |

Open questions:

- **Q1** — Architecture B (board as MCP server, agents run as your Claude on the Mac) as the first step, or go straight to server-hosted agents with a vault and auth?
- **Q2** — For the morning briefing, a pane on the board or a row per item (a calendar-row-style "3 emails need a reply" that can be ticked)?
- **Q3** — Which first hook: the dermatologist (appointment → contacts + calendar) or something you'd hit weekly?
