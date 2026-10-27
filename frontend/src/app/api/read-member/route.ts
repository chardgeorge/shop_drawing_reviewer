/**
 * Reads one member size label from a small shop-drawing crop with a Claude vision model.
 *
 * The API key stays on the server (ANTHROPIC_API_KEY in frontend/.env.local); the browser
 * only sends the crop it wants read. The expected engineer value is deliberately NOT sent,
 * so the model transcribes what is drawn rather than confirming a guess.
 *
 * GET  -> { configured: boolean, model: string }
 * POST { image: "data:image/png;base64,..." }
 *      -> { designation: string | null, confidence: "high" | "medium" | "low", other_labels: string[] }
 */
export const runtime = "nodejs";

const API_URL = `${process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com"}/v1/messages`;
const MODEL = process.env.CLAUDE_VISION_MODEL ?? "claude-sonnet-5-5";
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const PROMPT = `This image is a crop from a structural steel shop (erection) drawing.
One steel member runs left to right through the vertical middle of the image. Text may be
upside down or partly cut off at the edges.

Transcribe the member size label that belongs to that middle member, exactly as drawn,
for example: W460x52, W200x27*, 700 Deep OWSJ, HSS203x203x9.5, C150x12, L102x102x6.4.
Ignore dimensions, grid labels, piece marks, elevations, notes, and labels of members that
cross the image at an angle.

Reply with JSON only, no other text:
{"designation": string or null, "confidence": "high" | "medium" | "low", "other_labels": [string]}
Use null when no size label for the middle member is visible. Use "low" when the text is
too unclear to read with confidence.`;

export async function GET() {
  return Response.json({ configured: Boolean(process.env.ANTHROPIC_API_KEY), model: MODEL });
}

export async function POST(request: Request) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return Response.json(
      { error: "Vision reading is not configured. Add ANTHROPIC_API_KEY to frontend/.env.local and restart." },
      { status: 503 },
    );
  }

  let image: unknown;
  try {
    ({ image } = (await request.json()) as { image?: unknown });
  } catch {
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const match = typeof image === "string" ? /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(image) : null;
  if (!match) {
    return Response.json({ error: "Expected a PNG or JPEG data URL in `image`." }, { status: 422 });
  }
  if ((match[2].length * 3) / 4 > MAX_IMAGE_BYTES) {
    return Response.json({ error: "Image crop is too large." }, { status: 413 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 200,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: `image/${match[1]}`, data: match[2] },
              },
              { type: "text", text: PROMPT },
            ],
          },
        ],
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return Response.json(
        { error: `Vision model request failed (${response.status}). ${detail.slice(0, 200)}` },
        { status: 502 },
      );
    }
    const body = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = (body.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");
    const json = /\{[\s\S]*\}/.exec(text)?.[0];
    if (!json) {
      return Response.json({ error: "The vision model did not return JSON." }, { status: 502 });
    }
    const parsed = JSON.parse(json) as {
      designation?: unknown;
      confidence?: unknown;
      other_labels?: unknown;
    };
    const designation =
      typeof parsed.designation === "string" && parsed.designation.trim()
        ? parsed.designation.trim().slice(0, 40)
        : null;
    const confidence =
      parsed.confidence === "high" || parsed.confidence === "medium" ? parsed.confidence : "low";
    const otherLabels = Array.isArray(parsed.other_labels)
      ? parsed.other_labels.filter((value): value is string => typeof value === "string").slice(0, 10)
      : [];
    return Response.json({ designation, confidence, other_labels: otherLabels, model: MODEL });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "The vision model timed out."
        : "Could not reach the vision model.";
    return Response.json({ error: message }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
