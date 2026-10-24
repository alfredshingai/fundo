import { getSetting } from "./store.ts";

export type ProviderPreset = {
  id: string;
  label: string;
  baseUrl: string;
  defaultModel: string;
  keyUrl?: string;
  hint?: string;
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "opencode-zen",
    label: "OpenCode Zen (free models)",
    baseUrl: "https://opencode.ai/zen/v1",
    defaultModel: "deepseek-v4-flash-free",
    keyUrl: "https://opencode.ai/auth",
    hint: "Create an account at opencode.ai, then generate an API key. Free models end in '-free' (deepseek-v4-flash-free, nemotron-3-ultra-free, jev-1.13-free).",
  },
  {
    id: "openrouter",
    label: "OpenRouter (:free models)",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "google/gemini-2.0-flash-exp:free",
    keyUrl: "https://openrouter.ai/keys",
    hint: "Free key from openrouter.ai/keys — pick any model ending in ':free'.",
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    keyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-4-5",
    keyUrl: "https://console.anthropic.com/settings/keys",
    hint: "Uses the Anthropic Messages API (x-api-key header).",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.0-flash",
    keyUrl: "https://aistudio.google.com/app/apikey",
  },
  {
    id: "ollama",
    label: "Ollama (local, offline)",
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "llama3.1",
    hint: "Run 'ollama serve' locally and pull a model first. No API key needed.",
  },
  {
    id: "custom",
    label: "Custom (any OpenAI-compatible URL)",
    baseUrl: "",
    defaultModel: "",
    hint: "Point at any OpenAI-compatible /v1 endpoint (LM Studio, vLLM, Together, Groq, ...).",
  },
];

export type AiConfig = {
  providerId: string;
  baseUrl: string;
  apiKey: string;
  model: string;
};

export function getAiConfig(): AiConfig {
  return {
    providerId: getSetting("providerId") ?? "opencode-zen",
    baseUrl: getSetting("baseUrl") ?? PROVIDER_PRESETS[0].baseUrl,
    apiKey: getSetting("apiKey") ?? "",
    model: getSetting("model") ?? PROVIDER_PRESETS[0].defaultModel,
  };
}

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * Call the configured provider. All presets speak OpenAI Chat Completions,
 * except Anthropic which uses its native Messages API.
 */
export async function chat(
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  const cfg = getAiConfig();
  if (!cfg.baseUrl) throw new Error("No AI provider configured. Open Settings and pick a provider + API key.");
  if (!cfg.model) throw new Error("No model configured. Open Settings and choose a model.");

  if (cfg.providerId === "anthropic") {
    return await callAnthropic(cfg, messages, opts);
  }
  return await callOpenAiCompatible(cfg, messages, opts);
}

async function callOpenAiCompatible(
  cfg: AiConfig,
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number },
): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers["Authorization"] = `Bearer ${cfg.apiKey}`;
  if (cfg.providerId === "openrouter") {
    headers["HTTP-Referer"] = "http://localhost:3000";
    headers["X-Title"] = "Fundo";
  }

  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    max_tokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature ?? 0.4,
  };
  // OpenRouter: ask reasoning models to skip the thinking phase so the token
  // budget goes to the actual answer. Providers that don't support this ignore it.
  if (cfg.providerId === "openrouter") body["reasoning"] = { enabled: false };

  // Free-tier pools rate-limit aggressively: retry 429/5xx with backoff.
  const maxAttempts = 3;
  const delays = [4000, 10000];
  let res: Response | null = null;
  let lastError = "";

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, delays[Math.min(attempt - 1, delays.length - 1)]));
    }
    try {
      res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    } catch (e) {
      lastError = (e as Error).message;
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      lastError = `AI request failed (${res.status}): ${truncate(await res.text(), 300)}`;
      res = null;
      continue;
    }
    break;
  }

  if (!res) {
    throw new Error(
      `${lastError}\n\nIf this is a rate limit on a free model, wait a minute and press "Regenerate with AI", or pick a different free model in Settings.`,
    );
  }

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`AI request failed (${res.status}): ${truncate(errBody, 400)}`);
  }
  const data = await res.json() as {
    choices?: {
      message?: { content?: string | null; reasoning?: string | null };
      finish_reason?: string | null;
    }[];
    error?: { message?: string };
  };
  if (data.error?.message) throw new Error(`AI provider error: ${data.error.message}`);
  const choice = data.choices?.[0];
  const content = choice?.message?.content;
  if (!content || !content.trim()) {
    const reasoningSpent = !!choice?.message?.reasoning;
    const finish = choice?.finish_reason ?? "unknown";
    if (reasoningSpent && finish === "length") {
      throw new Error(
        `The model "${cfg.model}" spent its entire token budget on internal reasoning and never wrote an answer. ` +
          `Try a non-reasoning free model (e.g. google/gemini-2.0-flash-exp:free) or raise the token budget.`,
      );
    }
    throw new Error(`AI returned an empty response (finish_reason: ${finish}).`);
  }
  return content;
}

async function callAnthropic(
  cfg: AiConfig,
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number },
): Promise<string> {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest = messages.filter((m) => m.role !== "system");

  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature ?? 0.4,
      system: system || undefined,
      messages: rest.map((m) => ({ role: m.role, content: m.content })),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`AI request failed (${res.status}): ${truncate(body, 400)}`);
  }
  const data = await res.json() as { content?: { type: string; text?: string }[]; error?: { message?: string } };
  if (data.error?.message) throw new Error(`AI provider error: ${data.error.message}`);
  const text = (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  if (!text) throw new Error("AI returned an empty response.");
  return text;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// --- study material generation ------------------------------------------

export type GeneratedStudySet = {
  notes: string;
  flashcards: { front: string; back: string }[];
  quiz: { question: string; options: string[]; correctIndex: number; explanation?: string }[];
};

const SYSTEM_PROMPT = `You are Fundo, an expert study-material generator. You read source text extracted from a document and produce study material. You must be accurate and NEVER invent facts that are not supported by the source. Always respond with a single valid JSON object and nothing else — no markdown fences, no commentary.`;

const FORMAT_RULES = `FORMATTING (important — the app renders markdown and LaTeX):
- Write ALL mathematics in LaTeX. Inline math: \\( ... \\). Display equations on their own line: \\[ ... \\]. Example: \\( \\hat{y} = \\hat{\\beta}_0 + \\hat{\\beta}_1 x \\)
- Do NOT write formulas as plain text or unicode lookalikes when LaTeX is available. Use \\beta, \\varepsilon, \\times, \\frac{}{}, \\sum, \\bar{x}, subscripts like x_i, superscripts like R^2.
- Use markdown pipe tables (header row, then |---|---| separator) for any comparison, summary of model types, or structured facts. Keep tables to 2-4 columns and short cells.
- Use > blockquotes sparingly for key definitions or key takeaways.
- The renderer supports these LaTeX packages: amsmath (aligned, cases, matrices), mhchem for chemical equations (\\ce{6CO2 + 6H2O -> C6H12O6 + 6O2} inside math delimiters), siunitx-style \\SI{9.81}{m/s^2}, and \\bm{v} for bold vectors.
- Do NOT use TikZ, picture environments, or \\includegraphics — no diagrams. Describe figures in words or a table instead.
- REMEMBER: inside JSON strings every LaTeX backslash must be doubled — write \\( and \\beta (as \\\\( and \\\\beta in the raw JSON), never \\(`;

const STUDY_PROMPT = (title: string, source: string) => `Read the following study material from the document "${title}" and generate study material.

SOURCE MATERIAL:
"""
${source}
"""

TASK — respond with ONLY a JSON object in exactly this shape:
{
  "notes": "Well-structured markdown study notes. Use ## headings for topics, bullet points, markdown tables, > blockquotes, bold **key terms**, and include any formulas, definitions, and worked examples found in the source — formulas in LaTeX per the formatting rules. Cover ALL major topics. Do not add information not present in the source.",
  "flashcards": [
    { "front": "A clear question or prompt (e.g. a definition prompt, 'What does X mean?', or a formula recall prompt)", "back": "A precise, self-contained answer" }
  ],
  "quiz": [
    {
      "question": "A multiple-choice question testing real understanding",
      "options": ["Option A text", "Option B text", "Option C text", "Option D text"],
      "correctIndex": 0,
      "explanation": "One or two sentences explaining why the answer is correct"
    }
  ]
}

${FORMAT_RULES}

REQUIREMENTS:
- 8 to 16 flashcards covering the most important concepts, definitions, formulas and relationships. Formula-recall cards should put the LaTeX formula on the back.
- 8 to 12 quiz questions. Distractors (wrong options) must be plausible but unambiguously wrong. Vary which index is correct.
- Quiz questions must be answerable purely from the source. No trick questions about trivia.
- Keep technical notation exactly as in the source (subscripts, symbols, formulas).
- Output raw JSON only.`;

function parseJsonLoose(raw: string): unknown {
  let s = raw.trim();
  // strip markdown fences if the model added them anyway
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  // find the outermost JSON object
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("AI response did not contain JSON.");
  s = s.slice(start, end + 1);
  try {
    return JSON.parse(s);
  } catch {
    // Models sometimes emit raw newlines/tabs inside string values, which is
    // invalid JSON. Escape any control characters that are inside strings.
    let out = "";
    let inString = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      const code = s.charCodeAt(i);
      if (inString && ch === "\\") {
        const nxt = s[i + 1] ?? "";
        // valid JSON escapes pass through; anything else (e.g. LaTeX \( or \beta)
        // gets its backslash doubled so the JSON parses AND the LaTeX survives
        if ([...'"\\/bfnrtu'].includes(nxt)) { out += ch + nxt; i++; continue; }
        out += "\\\\";
        continue;
      }
      if (ch === '"') inString = !inString;
      if (inString && code < 32) {
        // raw control char inside a string: emit a safe escape
        if (ch === "\n") out += "\\n";
        else if (ch === "\r") out += "\\r";
        else if (ch === "\t") out += "\\t";
        else out += `\\u${code.toString(16).padStart(4, "0")}`;
        continue;
      }
      out += ch;
    }
    return JSON.parse(out);
  }
}

export async function generateStudySet(title: string, source: string): Promise<GeneratedStudySet> {
  const raw = await chat(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: STUDY_PROMPT(title, source) },
    ],
    { maxTokens: 16000, temperature: 0.3 },
  );

  const obj = parseJsonLoose(raw) as {
    notes?: unknown;
    flashcards?: unknown;
    quiz?: unknown;
  };

  const notes = typeof obj.notes === "string" && obj.notes.trim() ? obj.notes.trim() : null;
  if (!notes) throw new Error("AI response was missing study notes.");

  const flashcards = Array.isArray(obj.flashcards)
    ? obj.flashcards
      .map((c) => c as { front?: unknown; back?: unknown })
      .filter((c) => typeof c.front === "string" && typeof c.back === "string" && c.front.trim() && c.back.trim())
      .map((c) => ({ front: (c.front as string).trim(), back: (c.back as string).trim() }))
    : [];

  const quiz = Array.isArray(obj.quiz)
    ? obj.quiz
      .map((q) => q as { question?: unknown; options?: unknown; correctIndex?: unknown; explanation?: unknown })
      .filter((q) =>
        typeof q.question === "string" &&
        Array.isArray(q.options) &&
        q.options.length >= 2 &&
        q.options.every((o) => typeof o === "string") &&
        typeof q.correctIndex === "number" &&
        q.correctIndex >= 0 &&
        q.correctIndex < q.options.length
      )
      .map((q) => ({
        question: (q.question as string).trim(),
        options: (q.options as string[]).map((o) => o.trim()),
        correctIndex: q.correctIndex as number,
        explanation: typeof q.explanation === "string" ? q.explanation.trim() : undefined,
      }))
    : [];

  return { notes, flashcards, quiz };
}

// ============================================================================
// COURSE MODE — Turbo-style structured lessons
// ============================================================================

export type CourseOutline = {
  title: string;
  intro: string;
  coverage: string[];
  sections: { title: string; summary: string }[];
  warmup: GeneratedMCQ[];
  final: GeneratedMCQ[];
};

export type GeneratedMCQ = {
  question: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
};

const OUTLINE_SYSTEM = `You are Fundo, an expert course designer. You transform source material into a structured, multi-section interactive course. You must be accurate and NEVER invent facts not supported by the source — though you MAY add standard introductory framing, motivation, and transitions that help a learner understand why the material matters. Always respond with a single valid JSON object and nothing else — no markdown fences, no commentary.`;

const OUTLINE_PROMPT = (sourceTitle: string, source: string) => `Read the study material below and design a complete course outline in the style of a well-structured interactive lecture course (like a great online course: motivating intro, logical progression from foundations to advanced material, one section per coherent topic).

SOURCE MATERIAL (document: "${sourceTitle}"):
"""
${source}
"""

Respond with ONLY a JSON object in exactly this shape:
{
  "title": "An engaging course title. If the document has no clear title, invent an appropriate descriptive one based on its content.",
  "intro": "A 3-6 sentence welcoming introduction: what the learner will be able to do after this course, why the topic matters, and how the course is organized. Written directly to the learner ('you').",
  "coverage": ["Short bullet phrases: what the course covers (5-8 items)"],
  "sections": [
    { "title": "Section title", "summary": "1-2 sentences: what this section teaches and why it matters here" }
  ],
  "warmup": [
    {
      "question": "A multiple-choice question that probes prior knowledge of the topic — friendly, no pressure, testing general understanding of the field or basic prerequisites",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctIndex": 0,
      "explanation": "Brief friendly explanation of the correct answer"
    }
  ],
  "final": [
    {
      "question": "A multiple-choice question testing cumulative understanding of the whole course",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctIndex": 0,
      "explanation": "Why the answer is correct"
    }
  ]
}

${FORMAT_RULES}

REQUIREMENTS:
- 6 to 10 sections, in a deliberate pedagogical order: foundations first, advanced material later, each section a coherent teachable unit. IMPORTANT: put the single most fundamental, foundational section first (e.g. 'Getting Started' style: core concepts and definitions).
- Each section title is short (2-8 words) and concrete.
- 3 warmup questions (prior knowledge, approachable). 8-10 final quiz questions (cumulative, mixed difficulty).
- All questions have exactly 4 options, exactly one correct, plausible distractors, and vary which index is correct.
- Questions must be answerable from the source material.
- Output raw JSON only.`;

export async function generateCourseOutline(sourceTitle: string, source: string): Promise<CourseOutline> {
  const raw = await chat(
    [
      { role: "system", content: OUTLINE_SYSTEM },
      { role: "user", content: OUTLINE_PROMPT(sourceTitle, source) },
    ],
    { maxTokens: 8000, temperature: 0.4 },
  );
  const obj = parseJsonLoose(raw) as Record<string, unknown>;

  const title = typeof obj.title === "string" && obj.title.trim() ? obj.title.trim() : sourceTitle;
  const intro = typeof obj.intro === "string" && obj.intro.trim()
    ? obj.intro.trim()
    : `This course covers the material in "${sourceTitle}".`;

  const coverage = Array.isArray(obj.coverage)
    ? (obj.coverage as unknown[]).filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim())
    : [];

  const sections = Array.isArray(obj.sections)
    ? (obj.sections as Record<string, unknown>[])
      .map((s) => ({ title: String(s.title ?? "").trim(), summary: String(s.summary ?? "").trim() }))
      .filter((s) => s.title.length > 0)
    : [];
  if (sections.length === 0) throw new Error("AI returned no course sections.");

  const mcq = (arr: unknown): GeneratedMCQ[] =>
    Array.isArray(arr)
      ? (arr as Record<string, unknown>[])
        .map((q) => ({
          question: String(q.question ?? "").trim(),
          options: Array.isArray(q.options) ? (q.options as unknown[]).map((o) => String(o).trim()) : [],
          correctIndex: typeof q.correctIndex === "number" ? q.correctIndex : 0,
          explanation: typeof q.explanation === "string" ? String(q.explanation).trim() : undefined,
        }))
        .filter((q) => q.question && q.options.length >= 2 && q.correctIndex >= 0 && q.correctIndex < q.options.length)
      : [];

  return { title, intro, coverage, sections, warmup: mcq(obj.warmup), final: mcq(obj.final) };
}

const SECTION_SYSTEM = `You are Fundo, an expert lecturer writing one section of a structured course. Write clear, engaging, textbook-quality teaching prose directly to the learner ('you'). Stay faithful to the source material — explain, motivate, and connect ideas, but never invent facts, formulas, or claims not supported by the source. Respond with a single valid JSON object and nothing else.`;

const SECTION_PROMPT = (courseTitle: string, sectionTitle: string, sectionSummary: string, source: string, prevTitle?: string) => `You are writing ONE section of the course "${courseTitle}".${prevTitle ? ` The previous section was "${prevTitle}" — build on it without repeating it.` : " This is the opening section — start by orienting the learner."}

SECTION TO WRITE: "${sectionTitle}"
Section summary: ${sectionSummary}

SOURCE MATERIAL:
"""
${source}
"""

Respond with ONLY a JSON object in exactly this shape:
{
  "content": "The lesson text for this section, in markdown. 400-900 words. Style: engaging teaching prose with ## sub-headings, short paragraphs, bullet lists where helpful, **bold key terms**. Start with a hook or motivation, teach the concepts step by step, use concrete examples from the source, and end with a brief bridge to what comes next. Cover ALL parts of the source relevant to this section.",
  "checkpoint": [
    {
      "question": "A comprehension-check multiple-choice question on THIS section's material",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctIndex": 0,
      "explanation": "Why the answer is correct, referencing the lesson"
    }
  ]
}

${FORMAT_RULES}

REQUIREMENTS:
- The lesson content is teaching prose: use markdown tables for comparisons, display equations (\\[ ... \\]) for important formulas, and LaTeX inline math for any symbol or expression.
- 3 to 5 checkpoint questions per section, strictly about this section's material. Questions, options and explanations may all contain LaTeX.
- Exactly 4 options each, exactly one correct, plausible distractors, vary the correct index.
- Output raw JSON only.`;

export async function generateSection(
  courseTitle: string,
  sectionTitle: string,
  sectionSummary: string,
  source: string,
  prevTitle?: string,
): Promise<{ content: string; checkpoint: GeneratedMCQ[] }> {
  const raw = await chat(
    [
      { role: "system", content: SECTION_SYSTEM },
      { role: "user", content: SECTION_PROMPT(courseTitle, sectionTitle, sectionSummary, source, prevTitle) },
    ],
    { maxTokens: 12000, temperature: 0.4 },
  );
  const obj = parseJsonLoose(raw) as Record<string, unknown>;
  const content = typeof obj.content === "string" && obj.content.trim() ? obj.content.trim() : "";
  if (!content) throw new Error("AI returned no section content.");
  const checkpoint = (() => {
    if (!Array.isArray(obj.checkpoint)) return [];
    return (obj.checkpoint as Record<string, unknown>[])
      .map((q) => ({
        question: String(q.question ?? "").trim(),
        options: Array.isArray(q.options) ? (q.options as unknown[]).map((o) => String(o).trim()) : [],
        correctIndex: typeof q.correctIndex === "number" ? q.correctIndex : 0,
        explanation: typeof q.explanation === "string" ? String(q.explanation).trim() : undefined,
      }))
      .filter((q) => q.question && q.options.length >= 2 && q.correctIndex >= 0 && q.correctIndex < q.options.length);
  })();
  return { content, checkpoint };
}
