
import OpenAI from "openai";
import type { Context } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  try {
    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    const { text, threadId, assistantId } = await req.json();
    if (!text || typeof text !== "string") {
      return new Response(JSON.stringify({ error: "Missing 'text'." }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const apiKey = Netlify.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY not set" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }

    const client = new OpenAI({ apiKey });
    const asstId = (assistantId && String(assistantId)) || Netlify.env.get("OPENAI_ASSISTANT_ID") || undefined;

    let tId = threadId;
    if (!tId) {
      const t = await client.beta.threads.create();
      tId = t.id;
    }

    await client.beta.threads.messages.create(tId, {
      role: "user",
      content: text,
    });

    if (!asstId) {
      return new Response(JSON.stringify({ error: "Assistant ID missing. Provide OPENAI_ASSISTANT_ID env var or pass assistantId in the request." }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }

    const run = await client.beta.threads.runs.create(tId, { assistant_id: asstId });

    let status = await client.beta.threads.runs.retrieve(tId, run.id);
    const start = Date.now();
    while (status.status !== "completed") {
      if (["failed", "expired", "cancelled"].includes(status.status)) {
        return new Response(JSON.stringify({ error: status.status, threadId: tId }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
      await new Promise((r) => setTimeout(r, 500));
      status = await client.beta.threads.runs.retrieve(tId, run.id);
      if (Date.now() - start > 24000) break;
    }

    const list = await client.beta.threads.messages.list(tId, { order: "desc", limit: 10 });
    const lastAssistant = list.data.find((m) => m.role === "assistant");
    let replyText = "";
    if (lastAssistant) {
      replyText = (lastAssistant.content || [])
        .map((c) => (c.type === "text" ? c.text?.value : ""))
        .join("\n")
        .trim();
    }

    return new Response(JSON.stringify({ reply: replyText, threadId: tId }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err && err.message) || "Unknown error" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
};

export const config = {
  path: "/api/assistant",
};
