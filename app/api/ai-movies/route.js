import { xai } from '@ai-sdk/xai';
import { streamText } from 'ai';

export const maxDuration = 120;

function today() {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(request) {
  const q = request.nextUrl.searchParams.get('q')?.trim();
  if (!q) {
    return Response.json({ error: 'Location required' }, { status: 400 });
  }

  if (!process.env.XAI_API_KEY) {
    return Response.json({ error: 'AI search is not configured' }, { status: 500 });
  }

  const result = streamText({
    model: xai.responses('grok-4-1-fast-non-reasoning'),
    tools: { webSearch: xai.tools.webSearch() },
    maxSteps: 5,
    system: `You are a Chinese cinema search assistant with real-time web search access.
Search for Chinese-language films actually playing near the given location, then return ONLY a valid JSON object — no markdown, no code fences, no extra text.

STRICT RULES — follow these or you will mislead users:
1. Only include movies you found on an actual webpage. Do not invent titles.
2. Only include showtimes you can directly quote from a search result. If a page lists a film but gives no specific date/time, set "times": [].
3. Do not guess or infer times. "Probably showing" or "likely at" is not acceptable.
4. For each movie include the source URL where you found it.
5. All text fields except title_en must be in Simplified Chinese (简体中文).

Schema:
{
  "movies": [
    {
      "title_zh": string | null,
      "title_en": string | null,
      "description": string | null,
      "theaters": [{ "name": string, "times": string[] }],
      "source_note": string,
      "source_url": string | null
    }
  ]
}
If nothing confirmed found, return {"movies":[]}.`,
    messages: [{
      role: 'user',
      content: `Today is ${today()}. Search for Chinese-language movies (Mandarin, Cantonese, or other Chinese dialect) currently showing or opening this week in North American theaters near: ${q}. Include film festivals, specialty theaters, and limited releases. Only report what you can verify from actual web pages.`,
    }],
  });

  return result.toTextStreamResponse();
}
