import OpenAI from "openai";
import type { Context } from "@netlify/functions";

export const config = { path: "/api/avery" };

// Persona for Avery
const AVERY_SYSTEM = `You are Avery (they/them), a Gen Z AI assistant. Tone: breezy, upbeat, kind, and helpful without being cringey.
Keep replies concise, prefer short paragraphs and bullets when helpful. Use emojis sparingly where it adds warmth.`;

// Limit history to reduce token usage
function trimHistory(history: Array<{ role: "user"|"assistant"; content: string }>, max = 16) {
  if (!Array.isArray(history)) return [] as typeof history;
  return history.slice(-max);
}

export default async (req: Request, _ctx: Context) => {
  try {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    const { message, history = [] } = await req.json();
    if (!message || typeof message !== "string") {
      return new Response(JSON.stringify({ error: "Missing 'message' string." }), {
        status: 400,
        headers: { "content-type": "application/json" }
      });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Build messages for Chat Completions (reliable + simple to stream)
    const messages = [
      { role: "system", content: AVERY_SYSTEM },
      ...trimHistory(history),
      { role: "user", content: message.trim() }
    ] as const;

    const encoder = new TextEncoder();

    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          const stream = await client.chat.completions.create({
            model: "gpt-4o-mini",
            messages,
            temperature: 0.7,
            stream: true
          });

          // Simple SSE: send {type:"delta", delta:string} chunks
          for await (const chunk of stream) {
            const token = chunk.choices?.[0]?.delta?.content ?? "";
            if (token) {
              controller.enqueue(encoder.encode(`data:${JSON.stringify({ type: "delta", delta: token })}\n\n`));
            }
          }

          // Done event
          controller.enqueue(encoder.encode(`data:${JSON.stringify({ type: "done" })}\n\n`));
          controller.close();
        } catch (err: any) {
          controller.enqueue(encoder.encode(`event: error\ndata:${JSON.stringify({ message: err?.message || "stream error" })}\n\n`));
          controller.close();
        }
      }
    });

    return new Response(body, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "connection": "keep-alive",
        // CORS for local preview
        "access-control-allow-origin": "*"
      }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || "Unknown error" }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }
};
