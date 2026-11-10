// One place for every AI call (server only).
// Order: Google Gemini (current Flash models, free key) -> Groq (free, optional backup).
// Model names are env-overridable so you never have to touch code when Google/Groq rename models:
//   GEMINI_MODEL=gemini-3.8-flash   GROQ_MODEL=openai/gpt-oss-120b   GROQ_API_KEY=...
// Google Search grounding is NOT on Google's free tier, so it is off unless GEMINI_SEARCH=1 (paid key).

export interface AiOpts { maxTokens?: number; temperature?: number; timeoutMs?: number; search?: boolean }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dead = new Set<string>(); // models the API said do not exist (404): skipped until restart

export function aiAvailable(): boolean { return !!(process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY); }
export function aiCanSearch(): boolean { return !!process.env.GEMINI_API_KEY && process.env.GEMINI_SEARCH === "1"; }

function geminiModels(): string[] {
  return [process.env.GEMINI_MODEL, "gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.1-flash-lite"].filter(
    (m, i, a): m is string => !!m && a.indexOf(m) === i,
  );
}

async function gemini(prompt: string, o: AiOpts): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  for (const model of geminiModels()) {
    if (dead.has(model)) continue;
    let useSearch = !!o.search && aiCanSearch();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            ...(useSearch ? { tools: [{ googleSearch: {} }] } : {}),
            // Newer Gemini models "think" before answering and that counts against the output budget, so give headroom.
            generationConfig: { temperature: o.temperature ?? 0.2, maxOutputTokens: (o.maxTokens ?? 1000) * 3 },
          }),
          signal: AbortSignal.timeout(o.timeoutMs ?? 30000),
        });
        if (res.status === 404) { dead.add(model); break; }
        if (res.status === 429) { if (attempt === 0) { await sleep(2500); continue; } return null; } // quota: let Groq try
        if (!res.ok) {
          console.warn("[ai] gemini", model, res.status, (await res.text().catch(() => "")).slice(0, 160));
          if (useSearch) { useSearch = false; continue; }
          break;
        }
        const data = await res.json();
        const parts: { text?: string; thought?: boolean }[] = data?.candidates?.[0]?.content?.parts ?? [];
        const text = parts.filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("").trim();
        if (text) return text;
        break;
      } catch (e) {
        console.warn("[ai] gemini", model, e instanceof Error ? e.message : e);
        if (attempt === 0) await sleep(1500);
      }
    }
  }
  return null;
}

async function groq(prompt: string, o: AiOpts): Promise<string | null> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  const model = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: o.temperature ?? 0.2,
        max_completion_tokens: (o.maxTokens ?? 1000) * 2,
        ...(model.includes("gpt-oss") ? { reasoning_effort: "low" } : {}),
      }),
      signal: AbortSignal.timeout(o.timeoutMs ?? 30000),
    });
    if (!res.ok) { console.warn("[ai] groq", model, res.status, (await res.text().catch(() => "")).slice(0, 160)); return null; }
    const data = await res.json();
    const text = String(data?.choices?.[0]?.message?.content ?? "").trim();
    return text || null;
  } catch (e) {
    console.warn("[ai] groq", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Plain-text completion. Returns null if no provider answered. */
export async function aiText(prompt: string, o: AiOpts = {}): Promise<string | null> {
  return (await gemini(prompt, o)) ?? (await groq(prompt, o));
}
