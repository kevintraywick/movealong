const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY not set');
}

// "list ..." tasks get Family Feud survey answers instead of action steps.
const LIST_TASK_RE = /^list\b/i;

function buildPrompt(taskDescription) {
  if (LIST_TASK_RE.test(taskDescription)) {
    return `You are the survey board in a Family Feud-style game inside a task app. The user is starting a list: "${taskDescription}".

We surveyed 100 people. Return the top 7 answers they would put on that list, ranked most popular first.

RULES:
1. Each answer is SHORT — 2 to 6 words, like a Family Feud board answer.
2. Be concrete and specific to the topic: real places, real items, real names where relevant.
3. No URLs, no explanations, no numbering inside the answer text.
4. #1 is the answer the most people would give; #7 is the least common of the seven.

Return ONLY a JSON array of 7 strings, most popular first. Example for "list stuff for a beach trip":
["Sunscreen", "Towels", "Swimsuits", "Snacks and water", "Sunglasses", "Beach chairs", "A good book"]`;
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

async function generateSubtasks(taskDescription) {
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
      model: 'claude-sonnet-5',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: buildPrompt(taskDescription)
      }]
    })
  });

  if (!response.ok) {
    throw new Error(`Claude API error: ${response.status}`);
  }

  const data = await response.json();
  const textBlock = data.content.find(block => block.type === 'text');
  if (!textBlock) throw new Error('No text block in response');
  const text = textBlock.text;

  // Extract JSON from response
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('No JSON array in response');

  const parsed = JSON.parse(jsonMatch[0]);

  // List tasks return bare answer strings; every answer belongs to the AI (feud board).
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

module.exports = { generateSubtasks };
