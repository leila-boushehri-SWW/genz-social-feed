// netlify/functions/assistant.mts
import OpenAI from "openai";
import type { Context } from "@netlify/functions";

export const config = { path: "/api/assistant" };

const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID; // set in Netlify → Site settings → Env

// Poll helper (simple + reliable on Netlify Functions)
async function waitForRunCompletion(client: OpenAI, threadId: string, runId: string, { timeoutMs = 120_000, pollMs = 800 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const run = await client.beta.threads.runs.retrieve(threadId, runId);
    if (run.status === "completed") return run;
    if (["failed", "cancelled", "expired"].includes(run.status as string)) {
      throw new Error(`Run ended with status: ${run.status}`);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error("Run polling timeout");
}

export default async (req: Request, _ctx: Context) => {
  try {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    if (!ASSISTANT_ID) {
      return new Response(JSON.stringify({ error: "Missing OPENAI_ASSISTANT_ID env var." }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }

    const { text, threadId: incomingThreadId } = await req.json();
    if (!text || typeof text !== "string") {
      return new Response(JSON.stringify({ error: "Missing 'text' string." }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // 1) Ensure a thread
    const threadId = incomingThreadId || (await client.beta.threads.create()).id;

    // 2) Add user message
    await client.beta.threads.messages.create(threadId, {
      role: "user",
      content: text,
    });

    // 3) Run the assistant
    const run = await client.beta.threads.runs.create(threadId, {
      assistant_id: ASSISTANT_ID,
    });

    // 4) Wait for completion, then fetch the latest assistant message
    await waitForRunCompletion(client, threadId, run.id);

    const messages = await client.beta.threads.messages.list(threadId, { order: "desc", limit: 10 });
    const assistantMsg = messages.data.find((m) => m.role === "assistant");

    let replyText = "";
    if (assistantMsg) {
      for (const p of assistantMsg.content) {
        if (p.type === "text" && p.text?.value) replyText += p.text.value;
      }
    }

    return new Response(
      JSON.stringify({ reply: replyText || "(no content)", threadId }),
      { headers: { "content-type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || "Unknown error" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
};
