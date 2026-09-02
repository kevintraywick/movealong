const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY not set');
}

// "list ..." tasks get concrete candidate items for the list instead of action steps.
const LIST_TASK_RE = /^list\b/i;

const MODEL = 'claude-sonnet-5';
// Which steps cost money is a classification, not research — it needs no search
// and no reasoning depth, so it runs on the cheapest model there is. The point
// is not the token saving (it is fractions of a cent): it is that the research
// pass then spends its `max_uses` searches on the two or three rows that
// actually buy something, and searches are the real cost lever.
const TRIAGE_MODEL = 'claude-haiku-4-5';

// Published per-MTok rates, used only to meter spend against a board's monthly
// budget. Nothing here reads a live price list, so these are hand-maintained:
// re-check platform.claude.com/docs/en/about-claude/pricing when changing either
// model, because rates are per-model and NOT stable across a family — Sonnet 5
// is $2/$10 (introductory) where Sonnet 4.6 and earlier were $3/$15.
const RATES = {
  'claude-sonnet-5': { input: 2 / 1_000_000, output: 10 / 1_000_000 },
  'claude-haiku-4-5': { input: 1 / 1_000_000, output: 5 / 1_000_000 }
};
// Cache reads bill at 0.1x base input and 5-minute writes at 1.25x. These calls
// don't use prompt caching today, so both fields come back 0 — but folding them
// into base input (as this did originally) silently overcharges by 10x on reads
// the moment anyone turns caching on.
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;
const USD_PER_WEB_SEARCH = 10 / 1000;

// The metering side-channel. Every call overwrites this and the caller reads it
// immediately afterwards; the alternative was changing both return shapes, and
// generateSubtasks' array return is consumed in several places.
let lastUsage = null;

function meterUsage(data, model = MODEL) {
  const rate = RATES[model] || RATES[MODEL];
  const u = (data && data.usage) || {};
  const base = u.input_tokens || 0;
  const cacheRead = u.cache_read_input_tokens || 0;
  const cacheWrite = u.cache_creation_input_tokens || 0;
  const output = u.output_tokens || 0;
  const searches = (u.server_tool_use && u.server_tool_use.web_search_requests) || 0;
  return {
    model,
    // Reported as one figure for the audit row; billed at their own rates below.
    input_tokens: base + cacheRead + cacheWrite,
    output_tokens: output,
    web_searches: searches,
    cost_usd: base * rate.input
            + cacheRead * rate.input * CACHE_READ_MULTIPLIER
            + cacheWrite * rate.input * CACHE_WRITE_MULTIPLIER
            + output * rate.output
            + searches * USD_PER_WEB_SEARCH
  };
}

function takeUsage() {
  const u = lastUsage;
  lastUsage = null;
  return u;
}

// ============================================================
// THE BRIEF
// ============================================================
// Standing notes about the person and the board, one line each, merged by the
// server before the call. Every prompt that gets one is asked to do two extra
// things: say which lines it actually applied (`brief_used`, so the page can
// show what has earned its place) and name ONE thing it wished it had known
// (`question`, which lands in the brief page's inbox). Both ride on calls that
// are being made anyway, so the brief curates itself for free.
let lastBriefReport = null;

function takeBriefReport() {
  const r = lastBriefReport;
  lastBriefReport = null;
  return r;
}

function briefClause(brief) {
  if (!brief || !brief.length) return '';
  return `

STANDING NOTES about this person and this board, each tagged with its section — apply the ones that matter to this task and ignore the rest. Never repeat a note back as a step; use it to make the steps fit them (their airports, their tools, the sites they already use, the people involved). Notes tagged (contact) and (medical) are private: use them to shape a step ("call your usual pharmacy", "book from your home airport") but NEVER copy a phone number, address, condition or medication into step text — steps can be seen by teammates:
${brief.map((l, i) => `${i}. ${l}`).join('\n')}`;
}

// When a brief is present the answer is wrapped in an envelope object instead
// of the bare array, carrying the two extra fields. `key` names the array.
function envelopeClause(brief, key) {
  if (!brief || !brief.length) return '';
  return `

Because standing notes were given, return ONLY a JSON object of this shape instead of a bare array:
{"${key}": <the array described above>, "brief_used": [<indexes of the notes you actually applied, or []>], "question": <one short question (under 15 words) whose answer would have made these ${key} better — a fact about the person or board you lacked — or null if nothing comes to mind>}
Ask a question only when a real gap cost you; most of the time null is the right answer.`;
}

// Accepts either the envelope or the bare array, so a model that ignores the
// envelope instruction still yields steps. Records the report as a side effect.
function unwrap(text, key) {
  const objStart = text.indexOf('{');
  const arrStart = text.indexOf('[');
  if (objStart !== -1 && (arrStart === -1 || objStart < arrStart)) {
    const objMatch = text.slice(objStart).match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        const obj = JSON.parse(objMatch[0]);
        if (obj && Array.isArray(obj[key])) {
          lastBriefReport = {
            used: Array.isArray(obj.brief_used) ? obj.brief_used.filter(n => Number.isInteger(n) && n >= 0) : [],
            question: typeof obj.question === 'string' && obj.question.trim() ? obj.question.trim().slice(0, 200) : null
          };
          return obj[key];
        }
      } catch (e) { /* fall through to the array form */ }
    }
  }
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('No JSON array in response');
  return JSON.parse(jsonMatch[0]);
}

function buildPrompt(taskDescription) {
  if (LIST_TASK_RE.test(taskDescription)) {
    return `You are the AI assistant in a task app. The user created a list task: "${taskDescription}".

Suggest the 7 best concrete items they might want on that list, doing the research for them.

RULES:
1. Each suggestion must be a real, specific candidate — real movie titles, real places, real products, real names — never categories or filler like "something fun" or "a classic option".
2. Include a URL in parentheses when it helps the user verify or act (e.g. fandango.com, yelp.com/search?find_desc=..., imdb.com, tripadvisor.com).
3. Keep each suggestion short — under 12 words before the link.
4. Order from most to least likely to make the list.

Return ONLY a JSON array of 7 strings. Example for "list movies to go see":
["Check what's playing this week (fandango.com/movies-in-theaters)", "The current #1 at the box office", "The new sci-fi everyone's talking about (imdb.com/chart/moviemeter)"]
— but with real, current, specific titles and places, not placeholders like these.`;
  }

  return `You are a task breakdown assistant. Given a task, generate 5-7 specific, actionable subtasks that a real person can immediately act on.

Task: "${taskDescription}"

CRITICAL RULES:
1. Every subtask must be SPECIFIC and ACTIONABLE — never vague project-management filler like "Define requirements" or "Research options".
2. Do NOT prefix subtasks with mini-labels like "Decision:", "Research:", "Project plan:". Just write the action directly.
3. Include real, working URLs in parentheses when helpful — link to relevant retailers, guides, comparison sites, or location-aware tools. Examples:
   - amazon.com/s?k=cedar+boards
   - audubon.org/bird-guide
   - google.com/travel/flights
   - yelp.com/search?find_desc=caterers
   - youtube.com/results?search_query=how+to+build+X
4. Surface actual decisions the user needs to make — e.g., "Buy plans online ($5-15 on Etsy) or design your own" instead of "Create a plan".
5. Be domain-specific — mention real materials, species, tools, brands, or techniques relevant to the task.
6. AI-assigned subtasks (assignee_type: "ai") should be research tasks that return concrete options, prices, links, and comparisons.
7. Human-assigned subtasks (assignee_type: "human") should be physical actions or personal decisions only the person can make.
8. Use depends_on (0-based index) only when a subtask truly can't start before another finishes.

Return ONLY a JSON array. Example:
[
  {"description": "Pick a spot — sunny, 5-10 ft high, near trees (audubon.org/news/how-build-birdhouse)", "assignee_type": "ai", "depends_on": null},
  {"description": "Buy plans online ($5-15 on etsy.com/search?q=birdhouse+plans) or design your own", "assignee_type": "human", "depends_on": null},
  {"description": "Get materials — cedar boards, screws, waterproof glue (homedepot.com/s/cedar%20boards)", "assignee_type": "human", "depends_on": 1}
]`;
}

// Regenerating a pane tops it back up to 7 rather than wiping it, so the model
// has to be told what is already there or it just re-proposes the same steps.
function topUpClause(count, existing) {
  if (!existing || !existing.length) return '';
  return `

The user has KEPT these steps — do not repeat, rephrase, or overlap with them:
${existing.map(d => `- ${d}`).join('\n')}

Return exactly ${count} NEW step(s) that fit alongside those, not a fresh list.`;
}

async function generateSubtasks(taskDescription, opts = {}) {
  const { count, existing, brief } = opts;
  const prompt = buildPrompt(taskDescription) + topUpClause(count, existing)
    + briefClause(brief) + envelopeClause(brief, 'steps');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    // A hung API call would otherwise hold the HTTP request open forever.
    signal: AbortSignal.timeout(20000),
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    throw new Error(`Claude API error: ${response.status}`);
  }

  const data = await response.json();
  lastUsage = meterUsage(data);
  const textBlock = data.content.find(block => block.type === 'text');
  if (!textBlock) throw new Error('No text block in response');
  const text = textBlock.text;

  const parsed = unwrap(text, 'steps');
  if (!Array.isArray(parsed)) throw new Error('Steps were not an array');

  // List tasks return bare suggestion strings; they all render as AI rows.
  if (LIST_TASK_RE.test(taskDescription)) {
    return parsed.map(st => ({
      description: typeof st === 'string' ? st : st.description,
      assignee_type: 'ai'
    }));
  }

  // Convert depends_on indices to parent_subtask_id (will be resolved after insert)
  return parsed.map(st => ({
    description: st.description,
    assignee_type: st.assignee_type === 'ai' ? 'ai' : 'human',
    _depends_on: st.depends_on
  }));
}


// ============================================================
// COST TRIAGE
// ============================================================
// Most steps cost nothing — "Decide: cook vs cater", "Pick a location", "Choose
// target birds" buy nothing and hire nobody. Labelling them first is what lets
// the research pass concentrate its searches on the rows that do, and lets a
// 'none' row get its answer without spending a search at all.
//
// Failure here is deliberately non-fatal: a null return just means the research
// pass decides for itself, which is the behaviour before this existed.
const COST_KINDS = new Set(['material', 'labor', 'service', 'none']);

async function triageCosts(taskDescription, steps, brief = null) {
  const hasBrief = brief && brief.length;
  const briefPart = hasBrief ? `

Also: these are the user's STANDING NOTES. Pick out the ones that bear on this task at all — the research pass will only be shown those, so err toward including a note if it could plausibly change a step:
${brief.map((l, i) => `${i}. ${l}`).join('\n')}` : '';
  const shape = hasBrief
    ? `Return ONLY a JSON object: {"costs": [exactly ${steps.length} strings, in order], "brief": [indexes of the relevant notes, or []]}. Example: {"costs":["none","material","none","service"],"brief":[0,2]}`
    : `Return ONLY a JSON array of exactly ${steps.length} strings, in order. Example: ["none","material","none","service"]`;

  const prompt = `For the task "${taskDescription}", classify what each step COSTS to carry out.

Steps:
${steps.map((d, i) => `${i}. ${d}`).join('\n')}

For each step return exactly one of:
- "material" — the step buys physical goods (lumber, ingredients, a gift, a part)
- "labor" — the step pays a person for their time (a contractor, a sitter, a mover)
- "service" — the step pays for a booking, ticket, subscription, permit or fee
- "none" — the step spends no money: deciding, choosing, planning, measuring, asking, looking something up, or doing it yourself with what you already have

Most steps are "none". Only classify a step as costing money when carrying it out plainly requires spending some.${briefPart}

${shape}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: AbortSignal.timeout(20000),
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: TRIAGE_MODEL,
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) throw new Error(`Claude API error: ${response.status}`);
  const data = await response.json();
  lastUsage = meterUsage(data, TRIAGE_MODEL);

  const textBlock = data.content.find(block => block.type === 'text');
  if (!textBlock) throw new Error('No text block in triage response');
  let parsed;
  if (hasBrief) {
    const objMatch = textBlock.text.match(/\{[\s\S]*\}/);
    const obj = objMatch ? JSON.parse(objMatch[0]) : null;
    if (!obj || !Array.isArray(obj.costs)) throw new Error('No costs in triage response');
    parsed = obj.costs;
    // The selection, not a usage report: which notes the research pass gets.
    lastBriefReport = {
      used: Array.isArray(obj.brief) ? obj.brief.filter(n => Number.isInteger(n) && n >= 0 && n < brief.length) : [],
      question: null
    };
  } else {
    const jsonMatch = textBlock.text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON array in triage response');
    parsed = JSON.parse(jsonMatch[0]);
  }
  if (!Array.isArray(parsed)) throw new Error('Triage response was not an array');

  // Index-matched like the research pass: a short answer must not shift every
  // later step onto the wrong row. Anything unrecognised falls back to 'none'.
  return steps.map((_, i) => {
    const k = typeof parsed[i] === 'string' ? parsed[i].trim().toLowerCase() : '';
    return COST_KINDS.has(k) ? k : 'none';
  });
}

// ============================================================
// PHASE 2 — RESEARCH
// ============================================================
// A cost range shown to the user is a claim the app is making, so a shaky one is
// worse than none: below this the estimate is dropped and the row simply shows
// no price. Lower than RESEARCH_REPLACE_CONFIDENCE (0.8) on purpose — that gate
// guards *replacing text the user is reading*, this one only guards adding a
// figure the user can take or leave, and a range already carries its own
// uncertainty. Enforced server-side in runResearch(), where it is auditable.
const COST_MIN_CONFIDENCE = 0.5;
// Phase 1 gives the user something to think about within seconds, reasoning
// only. This pass runs behind it with real web search and rewrites those rows
// in place. It never adds, removes or reorders steps: it returns exactly one
// verdict per input row, matched by index, so a row the user completed or
// promoted while it was running is simply skipped by the caller.
function buildResearchPrompt(taskDescription, steps, location, kind = 'step', costKinds = null, brief = null) {
  const where = location && (location.city || location.region || location.country)
    ? `\n\nThe user is near ${[location.city, location.region, location.country].filter(Boolean).join(', ')} — prefer local options, stores and services where it matters.`
    : '';

  return `A task app drafted these ${kind}s for the task "${taskDescription}" using reasoning alone, with no research. Your job is to make them real.

The drafted ${kind}s:
${steps.map((d, i) => `${i}. ${d}${costKinds && costKinds[i] && costKinds[i] !== 'none' ? `   [costs money: ${costKinds[i]}]` : ''}`).join('\n')}

Search the web and return an improved version of EVERY ${kind}, in the same order.

For each step return an object with:
- "refined": the same ${kind}, same intent, rewritten with what you actually found — real prices, real product or place names, working URLs. Under 14 words before any link. No mini-labels like "Research:" or "Decision:".
- "illogical": true only if the drafted ${kind} genuinely does not make sense for this task — wrong domain, impossible ordering, assumes something false. Ordinary vagueness is NOT illogical; refine it instead.
- "confidence": 0.0-1.0, how sure you are that it is illogical. Only set this meaningfully when "illogical" is true.
- "replacement": when "illogical" is true, the ${kind} that SHOULD be there instead — same research standard as "refined".

Also price each ${kind}, because what the user most wants to know is what this is going to cost them. Add to the same object:
- "cost_kind": "material" (buys goods), "labor" (pays a person for their time), "service" (a booking, ticket, fee or subscription), or "none".
- "cost_low" and "cost_high": a range in whole US dollars for THIS ${kind} only. Never a single figure — if you would return the same number twice, widen it until it is honest.
- "cost_unit": what the range covers, e.g. "total", "per hour", "each", "per person".
- "cost_basis": the specific thing you priced — "8x 1x6 cedar picket, 6ft" or "handyman, 2-3 hrs at local rate". Without this the number cannot be checked, so it is required.
- "cost_source_url": where the price came from, if a search found one.
- "cost_as_of": the date of that price, YYYY-MM-DD, if you know it.
- "cost_confidence": 0.0-1.0 in the range itself.

Rules for pricing:
- ${kind}s marked [costs money] above are the ones worth spending searches on. Price the rest from what you already know, or return "none".
- Use "none" for anything that only decides, chooses, plans, measures, asks or looks something up. Most ${kind}s are "none" and that is the right answer.
- Never guess to fill the field. A low "cost_confidence" is far better than a confident wrong number — anything under ${COST_MIN_CONFIDENCE} is discarded rather than shown.
- Price only what this one ${kind} costs. Do not roll in the rest of the task.

Be conservative with "illogical". Most drafted ${kind}s are merely vague, and the user has already read them; replacing one they are looking at is disruptive, so only flag a ${kind} you would defend.${where}

Return ONLY a JSON array of exactly ${steps.length} objects, in the same order as the drafted ${kind}s. Example shape:
[{"refined": "Order 6ft cedar pickets, $4.28 each (homedepot.com/s/cedar%20picket)", "illogical": false, "confidence": 0, "replacement": null, "cost_kind": "material", "cost_low": 90, "cost_high": 130, "cost_unit": "total", "cost_basis": "24x 6ft cedar picket at $4.28", "cost_source_url": "https://homedepot.com/s/cedar%20picket", "cost_as_of": "2026-08-16", "cost_confidence": 0.8}]${briefClause(brief)}${envelopeClause(brief, 'steps')}`;
}

// Normalise the cost half of a research verdict. Returns null for anything that
// isn't a usable range: a missing kind, 'none', a non-numeric or negative bound,
// or a basis the user could not check the figure against. The confidence gate
// itself is applied by the caller (server-side, where it is auditable).
function parseCost(r) {
  const kind = typeof r.cost_kind === 'string' ? r.cost_kind.trim().toLowerCase() : '';
  if (!COST_KINDS.has(kind) || kind === 'none') return null;

  const low = Number(r.cost_low);
  const high = Number(r.cost_high);
  if (!Number.isFinite(low) || !Number.isFinite(high) || low < 0 || high < 0) return null;

  const basis = typeof r.cost_basis === 'string' ? r.cost_basis.trim() : '';
  if (!basis) return null;

  const url = typeof r.cost_source_url === 'string' ? r.cost_source_url.trim() : '';
  const asOf = typeof r.cost_as_of === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.cost_as_of.trim())
    ? r.cost_as_of.trim()
    : null;

  return {
    kind,
    // A model that returns the bounds backwards is otherwise rendered as "$90-$40".
    low: Math.min(low, high),
    high: Math.max(low, high),
    unit: (typeof r.cost_unit === 'string' && r.cost_unit.trim()) || 'total',
    basis,
    source_url: /^https?:\/\//i.test(url) ? url : null,
    as_of: asOf,
    confidence: typeof r.cost_confidence === 'number' ? r.cost_confidence : 0
  };
}

async function researchSubtasks(taskDescription, steps, opts = {}) {
  const { location, maxSearches = 5, kind = 'step', costKinds = null, brief = null } = opts;

  const messages = [{ role: 'user', content: buildResearchPrompt(taskDescription, steps, location, kind, costKinds, brief) }];
  const totals = { model: MODEL, input_tokens: 0, output_tokens: 0, web_searches: 0, cost_usd: 0 };
  let data = null;

  // A long search turn can come back as stop_reason "pause_turn"; the documented
  // continuation is to send the assistant message back unchanged. Bounded, so a
  // pathological turn cannot bill forever.
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: AbortSignal.timeout(120000),
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        messages,
        tools: [{
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: maxSearches,
          ...(location ? { user_location: { type: 'approximate', ...location } } : {})
        }]
      })
    });

    if (!response.ok) throw new Error(`Claude API error: ${response.status}`);
    data = await response.json();

    const used = meterUsage(data);
    totals.input_tokens += used.input_tokens;
    totals.output_tokens += used.output_tokens;
    totals.web_searches += used.web_searches;
    totals.cost_usd += used.cost_usd;

    if (data.stop_reason !== 'pause_turn') break;
    // Send the paused assistant message back verbatim — encrypted_content in the
    // search results must survive untouched or the next call 400s.
    messages.push({ role: 'assistant', content: data.content });
  }

  lastUsage = totals;

  const textBlock = [...data.content].reverse().find(block => block.type === 'text');
  if (!textBlock) throw new Error('No text block in research response');
  const parsed = unwrap(textBlock.text, 'steps');
  if (!Array.isArray(parsed)) throw new Error('Research response was not an array');

  // Pad/truncate to the input length so index matching is total — a short
  // response must not silently shift every later step onto the wrong row.
  return steps.map((original, i) => {
    const r = parsed[i] || {};
    const refined = typeof r.refined === 'string' ? r.refined.trim() : '';
    const replacement = typeof r.replacement === 'string' ? r.replacement.trim() : '';
    const confidence = typeof r.confidence === 'number' ? r.confidence : 0;
    return {
      original,
      refined: refined || original,
      replacement: replacement || null,
      illogical: r.illogical === true,
      confidence,
      cost: parseCost(r)
    };
  });
}

// ============================================================
// DRAFT A BRIEF FROM THE WORK
// ============================================================
// A blank page is the worst place to ask someone what an assistant should know
// about them. This reads their recent tasks back to them as a handful of
// standing notes they can react to — evidenced only, never invented.
async function draftBrief(scope, name, taskDescriptions) {
  const who = scope === 'board'
    ? `the board "${name}"`
    : `${name} across all their boards`;
  const prompt = `Below are recent tasks from ${who} in a task app. An AI assistant drafts the steps for each new task, and before it does it reads a short BRIEF of standing notes.

Write that brief from the evidence: 4-10 lines, each starting with "- ", each a single fact or preference the assistant should carry into future tasks — places they go, tools and sites they use, people who recur, constraints, recurring kinds of work. Phrase each as the person would ("I fly out of Nashville", "I edit video in Resolve"). Only what the tasks actually show or strongly imply; never guess at anything personal. If the tasks show nothing worth noting, return an empty string.

Tasks:
${taskDescriptions.map(d => `- ${d}`).join('\n')}

Return ONLY the lines, no heading, no commentary.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: AbortSignal.timeout(30000),
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!response.ok) throw new Error(`Claude API error: ${response.status}`);
  const data = await response.json();
  lastUsage = meterUsage(data);
  const textBlock = data.content.find(block => block.type === 'text');
  const text = textBlock ? textBlock.text.trim() : '';
  // Keep only bullet lines — a chatty model's preamble must not land in the brief.
  return text.split('\n').map(l => l.trim()).filter(l => /^[-*•]\s+\S/.test(l)).join('\n');
}

module.exports = { generateSubtasks, researchSubtasks, triageCosts, draftBrief, takeUsage, takeBriefReport, COST_MIN_CONFIDENCE };
