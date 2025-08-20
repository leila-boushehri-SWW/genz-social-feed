import { Configuration, OpenAIApi } from "openai-edge";
import dotenv from "dotenv";

dotenv.config();

const openai = new OpenAIApi(new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
}));

const threadMap = new Map<string, string>();

export const config = { runtime: "edge" };

export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { text, threadId, sessionId } = await req.json();

    console.log("🟡 Incoming request", { text, threadId, sessionId });

    if (!text || !sessionId) {
      return new Response("Missing 'text' or 'sessionId'", { status: 400 });
    }

    let finalThreadId = threadId || threadMap.get(sessionId);

    if (!finalThreadId) {
      const thread = await openai.beta.threads.create();
      finalThreadId = thread.id;
      threadMap.set(sessionId, finalThreadId);
      console.log("🧵 Created new thread:", finalThreadId);
    }

    await openai.beta.threads.messages.create(finalThreadId, {
      role: "user",
      content: text,
    });

    const run = await openai.beta.threads.runs.create(finalThreadId, {
      assistant_id: process.env.OPENAI_ASSISTANT_ID!,
    });

    let runStatus = run;
    for (let i = 0; i < 30; i++) {
      await new Promise((res) => setTimeout(res, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(finalThreadId, run.id);
      if (runStatus.status === "completed" || runStatus.status === "failed") break;
    }

    if (runStatus.status !== "completed") {
      return new Response(JSON.stringify({ error: "Assistant run did not complete" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }

    const messages = await openai.beta.threads.messages.list(finalThreadId);
    const assistantMessages = messages.data.filter((m) => m.role === "assistant");

    const latest = assistantMessages[0];
    const fullText = latest?.content
      ?.map((c: any) => (c.type === "text" ? c.text.value : ""))
      .join("\n") || "(no response)";

    console.log("✅ Final reply:", fullText);

    return new Response(JSON.stringify({ reply: fullText, threadId: finalThreadId }), {
      headers: { "content-type": "application/json" },
    });

  } catch (err: any) {
    console.error("❌ API error:", err);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
