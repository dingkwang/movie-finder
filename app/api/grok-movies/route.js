const XAI_BASE = 'https://api.x.ai/v1';

function today() {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(request) {
  const q = request.nextUrl.searchParams.get('q')?.trim();
  if (!q) {
    return Response.json({ movies: [], error: 'Location required' }, { status: 400 });
  }

  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    return Response.json({ movies: [], error: 'XAI_API_KEY not configured' }, { status: 500 });
  }

  const systemPrompt = `You are a Chinese cinema search assistant with real-time web access.
Return ONLY a valid JSON object with this exact shape:
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
If no movies are found, return { "movies": [] }.
Do not include any text outside the JSON object.`;

  const userPrompt = `Today is ${today()}. Find Chinese-language movies (Mandarin, Cantonese, or other Chinese dialect as primary language) currently showing or opening this week in North American theaters near: ${q}

Include film festival screenings, specialty theaters, and limited releases — not just multiplex chains. For each movie, note where you found the showtime information in source_note.`;

  try {
    const res = await fetch(`${XAI_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'grok-4-1',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('xAI error:', err);
      return Response.json({ movies: [], error: `xAI error ${res.status}` });
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? '{}';

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      return Response.json({ movies: [], error: 'Failed to parse AI response' });
    }

    return Response.json({ movies: parsed.movies ?? [] });
  } catch (err) {
    console.error(err);
    return Response.json({ movies: [], error: err.message });
  }
}
