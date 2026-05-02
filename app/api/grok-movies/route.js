import { xai } from '@ai-sdk/xai';
import { streamText } from 'ai';

export const maxDuration = 60;

function today() {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(request) {
  const q = request.nextUrl.searchParams.get('q')?.trim();
  if (!q) {
    return Response.json({ error: 'Location required' }, { status: 400 });
  }

  if (!process.env.XAI_API_KEY) {
    return Response.json({ error: 'XAI_API_KEY not configured' }, { status: 500 });
  }

  const result = streamText({
    model: xai.responses('grok-4.3'),
    tools: { webSearch: xai.tools.webSearch() },
    maxSteps: 5,
    system: `You are a Chinese cinema search assistant with real-time web search access.
After searching, return ONLY a valid JSON object — no markdown, no code fences, no extra text.
Schema:
{
  "movies": [
    {
      "title_zh": string | null,
      "title_en": string | null,
      "description": string | null,
      "theaters": [{ "name": string, "times": string[] }],
      "source_note": string
    }
  ]
}
If nothing found, return {"movies":[]}.`,
    messages: [{
      role: 'user',
      content: `Today is ${today()}. Search the web for Chinese-language movies (Mandarin, Cantonese, or other Chinese dialect) currently showing or opening this week in North American theaters near: ${q}. Include film festivals, specialty theaters, and limited releases — not just multiplex chains.`,
    }],
  });

  return result.toTextStreamResponse();
}
