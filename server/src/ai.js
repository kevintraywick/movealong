const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY not set');
}

// "list ..." tasks get concrete candidate items for the list instead of action steps.
const LIST_TASK_RE = /^list\b/i;

const MODEL = 'claude-sonnet-5';

// Published rates for MODEL, used only to meter spend against a board's monthly
// budget. Nothing here reads a live price list, so these are hand-maintained:
// re-check platform.claude.com/docs/en/about-claude/pricing when changing MODEL,
// because rates are per-model and NOT stable across a family — Sonnet 5 is
// $2/$10 where Sonnet 4.6 and earlier were $3/$15.
const USD_PER_INPUT_TOKEN = 2 / 1_000_000;
const USD_PER_OUTPUT_TOKEN = 10 / 1_000_000;
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

function meterUsage(data) {
  const u = (data && data.usage) || {};
  const base = u.input_tokens || 0;
  const cacheRead = u.cache_read_input_tokens || 0;
  const cacheWrite = u.cache_creation_input_tokens || 0;
  const output = u.output_tokens || 0;
  const searches = (u.server_tool_use && u.server_tool_use.web_search_requests) || 0;
  return {
    model: MODEL,
    // Reported as one figure for the audit row; billed at their own rates below.
    input_tokens: base + cacheRead + cacheWrite,
    output_tokens: output,
    web_searches: searches,
    cost_usd: base * USD_PER_INPUT_TOKEN
            + cacheRead * USD_PER_INPUT_TOKEN * CACHE_READ_MULTIPLIER
            + cacheWrite * USD_PER_INPUT_TOKEN * CACHE_WRITE_MULTIPLIER
            + output * USD_PER_OUTPUT_TOKEN
            + searches * USD_PER_WEB_SEARCH
  };
}

function takeUsage() {
  const u = lastUsage;
  lastUsage = null;
  return u;
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
  const { count, existing } = opts;
  const prompt = buildPrompt(taskDescription) + topUpClause(count, existing);

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

  // Extract JSON from response
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('No JSON array in response');

  const parsed = JSON.parse(jsonMatch[0]);

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
// PHASE 2 — RESEARCH
// ============================================================
// Phase 1 gives the user something to think about within seconds, reasoning
// only. This pass runs behind it with real web search and rewrites those rows
// in place. It never adds, removes or reorders steps: it returns exactly one
// verdict per input row, matched by index, so a row the user completed or
// promoted while it was running is simply skipped by the caller.
function buildResearchPrompt(taskDescription, steps, location, kind = 'step') {
  const where = location && (location.city || location.region || location.country)
    ? `\n\nThe user is near ${[location.city, location.region, location.country].filter(Boolean).join(', ')} — prefer local options, stores and services where it matters.`
    : '';

  return `A task app drafted these ${kind}s for the task "${taskDescription}" using reasoning alone, with no research. Your job is to make them real.

The drafted ${kind}s:
${steps.map((d, i) => `${i}. ${d}`).join('\n')}

Search the web and return an improved version of EVERY ${kind}, in the same order.

For each step return an object with:
- "refined": the same ${kind}, same intent, rewritten with what you actually found — real prices, real product or place names, working URLs. Under 14 words before any link. No mini-labels like "Research:" or "Decision:".
- "illogical": true only if the drafted ${kind} genuinely does not make sense for this task — wrong domain, impossible ordering, assumes something false. Ordinary vagueness is NOT illogical; refine it instead.
- "confidence": 0.0-1.0, how sure you are that it is illogical. Only set this meaningfully when "illogical" is true.
- "replacement": when "illogical" is true, the ${kind} that SHOULD be there instead — same research standard as "refined".

Be conservative with "illogical". Most drafted ${kind}s are merely vague, and the user has already read them; replacing one they are looking at is disruptive, so only flag a ${kind} you would defend.${where}

Return ONLY a JSON array of exactly ${steps.length} objects, in the same order as the drafted ${kind}s. Example shape:
[{"refined": "Order 6ft cedar pickets, $4.28 each (homedepot.com/s/cedar%20picket)", "illogical": false, "confidence": 0, "replacement": null}]`;
}

async function researchSubtasks(taskDescription, steps, opts = {}) {
  const { location, maxSearches = 5, kind = 'step' } = opts;

  const messages = [{ role: 'user', content: buildResearchPrompt(taskDescription, steps, location, kind) }];
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
  const jsonMatch = textBlock.text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('No JSON array in research response');

  const parsed = JSON.parse(jsonMatch[0]);
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
      confidence
    };
  });
}

module.exports = { generateSubtasks, researchSubtasks, takeUsage };
