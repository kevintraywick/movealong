# "One Minute In" — MoveAlong :60

**Premise:** the film runs in real time as your literal first minute with MoveAlong.
At 0:00 you have a vague intention. At 1:00 you have a plan, a deadline you can't
wriggle out of, and a board that won't let go. Nothing is compressed, so watching
it *is* learning to use the product.

**The one idea:** every other task app lets you lie to yourself. This one keeps
count. The climbing grey number — red past ten — is the emotional peak, and the
whole film exists to reframe it from nag to loyalty.

---

## Format

| | |
|---|---|
| Duration | 60s exactly (1800 frames @ 30fps) |
| Ratio | 16:9, 1920×1080 |
| Home | Top of `/help`, autoplay, **muted**, looping |
| Audio | ElevenLabs VO + sparse sound design. **No music.** Unmute is a reward, never a requirement |
| Deliverables | `movealong-60.webm` (VP9) + `.mp4` (H.264 fallback) + `poster.png` |

### Two constraints that drive every decision

1. **It plays silent by default.** Every narration line is paired with an
   on-screen line that carries the same meaning. The kinetic type *is* the script
   when muted; the VO is the reward for turning sound on. Neither is a caption of
   the other — they say the same thing in different words.
2. **It loops.** We open on black and close to black, so the seam is invisible
   and a second viewing starts clean.

---

## The through-line: the fence draws itself

A hand-drawn backyard fence lives in the right margin — same ink-sketch,
handwritten vocabulary as the help page's margin notes (`Bradley Hand` stack,
`#059669` green, 2px round-cap strokes), not photoreal, not rendered.

It gains one plank per beat, in sync with the board filling in, and the last
plank lands at 0:57 as the wordmark arrives. The board and the fence complete
together. That's the entire "ideas into action" thesis said without a word.

It is background, never subject — it never crosses the centre third and never
competes with the UI.

---

## Script

Timecodes are the **start** of each beat. VO lines sit inside their beat with air
on both sides; total narration is ~78 words across 60 seconds, which is
deliberately sparse.

### 0:00 — Black
**Picture.** Full black. One cursor blinking in an empty add-task field, centre
frame, at real board scale. Nothing else. Hold 3 seconds — longer than feels
comfortable.
**Type.** *(none — the blinking cursor is the type)*
**VO.** "There's something you've been meaning to do."
**Fence.** Two posts sketch in, faint.

### 0:07 — The intention
**Picture.** Text types itself: **build a fence in the backyard**. Return. The
board fades up around it and the task lands on today's card — blue header, the
only card lit.
**Type.** `Just put it down.`
**VO.** "Just put it down. That's the only step you have to think of."
**Fence.** First rail.

### 0:15 — It plans itself
**Picture.** The subtask pane unfolds beneath the day column. Five steps write in
one at a time, ~0.6s apart — each with its 🧠 or 👩 emoji and a real link:
*Pick a location — sunny, 5–10 ft from the property line* · *Get materials —
cedar pickets, post mix (Home Depot list)* · *Check permit rules for your city* ·
*Book the fence inspection* · *Rent a post-hole auger*.
**Type.** `It writes the rest.`
**VO.** "MoveAlong writes the rest — and it marks the parts it can take off your
hands."
**Fence.** Two planks.

### 0:26 — Order
**Picture.** Pane collapses. Cursor drags *set the posts* onto *dig post holes*.
It splices in and hops to the next day. Countdown circles number themselves
**4 · 3 · 2 · 1** across four day cards; the violet thread lights between them.
**Type.** `Some things only work in order.`
**VO.** "Some things only work in order. Drag one onto another — now they know
it."
**Fence.** Two planks.

### 0:34 — The deadline
**Picture.** Cursor clicks 📅 on *fence inspection*. Popup, pick the date, done:
🔒 appears, amber left edge, and on its own day the text goes red. The tasks
around it keep drifting; this one doesn't move.
**Type.** `Lock a real deadline.`
**VO.** "One of them is a real deadline. Lock it. Nothing moves it."
**Fence.** Two planks. Gate posts appear.

### 0:42 — **The turn**
**Picture.** Pull back to three day cards. Clock in the corner: `11:58 PM` →
`11:59` → `12:00 AM` in blue. Unfinished tasks slide bodily onto today and settle
with a small bounce. The grey day-counter numbers tick up — **2 → 3 → 7 → 11** —
and at 11 the number snaps **red**. Hold on the red.
**Type.** `It keeps count.`
**VO.** "Everything else follows you. Every day. It keeps count."
**Fence.** No new plank — the fence pauses here too. Nothing gets built on the
day you don't work.

### 0:51 — Release
**Picture.** Cursor clicks circles, fast and rhythmic. Check, strike-through,
drop below the divider. Each completion kills one red number. The board goes
quiet and white.
**Type.** `Until you do it.`
**VO.** "Until you do it."
**Fence.** Final three planks land in a run, one per completed task.

### 0:57 — Sign-off
**Picture.** Clean board, held. The finished fence sketch sits complete in the
margin. Wordmark resolves centre: **Move**<span style="color:#0ea5e9">Along</span>.
Fade to black by 1:00.
**Type.** `MoveAlong — it keeps count.`
**VO.** "MoveAlong. It keeps count."
**Fence.** Complete, then fades with everything else.

---

## Narration — clean read for ElevenLabs

> There's something you've been meaning to do.
>
> Just put it down. That's the only step you have to think of.
>
> MoveAlong writes the rest — and it marks the parts it can take off your hands.
>
> Some things only work in order. Drag one onto another — now they know it.
>
> One of them is a real deadline. Lock it. Nothing moves it.
>
> Everything else follows you. Every day. It keeps count.
>
> Until you do it.
>
> MoveAlong. It keeps count.

**Casting.** Dry, unhurried, slightly amused — a competent friend explaining
something obvious, not an announcer. Low-mid register, minimal uptalk. The line
"It keeps count" must land flat and certain both times; it is not a punchline.

**Direction.** Record each line as a separate take so picture can be cut to VO
rather than the reverse. Long pauses between lines are correct — roughly 78 words
across 60 seconds means more silence than speech, and the silence is doing work.
"Until you do it" wants a full beat of air in front of it.

**Settings to start from:** stability ~0.45 (some life), similarity ~0.8,
style/exaggeration low, speaker boost on. Render each line to its own WAV at 48k
so the edit can nudge them frame-accurately.

---

## Assets

**Built in HTML** (reusing the existing vignette vocabulary from `help.html`):
every board element — day cards, task rows, subtask pane, countdown circles,
chain threads, lock states, day counters, clock, wordmark.

**Generated (Nano Banana Pro), texture only:**

1. `fence-sketch.png` — hand-drawn backyard picket fence, single-weight ink line
   art, no fill, no shading, no perspective tricks, transparent background,
   drawn as if with a felt pen in a notebook margin. Delivered as separable
   layers (posts / rails / planks / gate) so the build-on can be animated, or as
   one SVG path set if the trace comes out clean.
2. `paper-grain.png` — very subtle warm paper texture, used at ≤4% opacity over
   the whole frame so the sketch and the UI share one surface.

Nothing else is generated. No people, no offices, no laptops, no b-roll.

---

## Production plan

1. **Build the animatic** — one self-contained `docs/commercial/one-minute-in.html`,
   1920×1080, driven by a single master timeline so every beat is retimeable from
   one place. *Confidence: 90%* — this is assembly over a vocabulary we've already
   proven.
2. **Generate the fence and grain plates**, trace the fence to SVG paths, and
   animate the draw-on with `stroke-dashoffset` — the same technique as the help
   page's attention rings. *Confidence: 75%* — depends on how clean the generated
   line art traces.
3. **Capture** 1800 frames headlessly at fixed timestep (deterministic, no
   real-time recording jitter), encode with ffmpeg to VP9 + H.264.
   *Confidence: 85%.*
4. **Narration** — send the eight lines to ElevenLabs, pick a read, lay it under
   picture, nudge cut points to the VO. *Confidence: 60%* — no ElevenLabs
   credential is configured in this environment yet.
5. **Sound design** — a soft tick under the clock flip, a dry click per
   completion. **No music bed** (decided 2026-08-10): a score would make this
   sound like every other SaaS ad and would step on the silences that make
   "Until you do it" land. The sparseness is the tone. *Confidence: 70%.*
6. **Embed** at the top of `/help` — muted autoplay, `loop`, `playsinline`,
   poster frame, and a visible unmute control. *Confidence: 90%.*

## Open items

- **ElevenLabs access.** Key lives at `~/.config/elevenlabs/.env` (chmod 600,
  outside the repo) — read it only at call time and mask it in output.
- **The vertical recut.** Not scoped here. It would be a separate edit, not a
  crop: harder first three seconds, far bigger type.
