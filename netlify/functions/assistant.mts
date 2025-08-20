// assistant.mts — Patched for Multi-Session Thread Support
import { Configuration, OpenAIApi } from "openai-edge";
import { OpenAIStream, StreamingTextResponse } from "ai";

const openai = new OpenAIApi(new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
}));

// In-memory thread storage (temporary — use DB in prod)
const threadMap = new Map<string, string>();

export const config = {
  runtime: "edge",
};

export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { text, threadId, sessionId } = await req.json();

    if (!text || !sessionId) {
      return new Response("Missing 'text' or 'sessionId' in body", { status: 400 });
    }

    let finalThreadId = threadId || threadMap.get(sessionId);

    // Create new thread if needed
    if (!finalThreadId) {
      const thread = await openai.beta.threads.create();
      finalThreadId = thread.id;
      threadMap.set(sessionId, finalThreadId);
    }

    // Send message to the thread
    await openai.beta.threads.messages.create(finalThreadId, {
      role: "user",
      content: text,
    });

    // Run the assistant
    const run = await openai.beta.threads.runs.create(finalThreadId, {
      assistant_id: process.env.OPENAI_ASSISTANT_ID!,
    });

    // Poll until the run is complete
    let runStatus = run;
    while (runStatus.status !== "completed") {
      await new Promise((res) => setTimeout(res, 800));
      runStatus = await openai.beta.threads.runs.retrieve(finalThreadId, run.id);
    }

    // Retrieve the messages
    const messages = await openai.beta.threads.messages.list(finalThreadId);
    const lastMessage = messages.data.find(m => m.role === "assistant");
    const fullText = lastMessage?.content?.map(c => (c.type === "text" ? c.text.value : "")).join("\n");

    return new Response(JSON.stringify({ reply: fullText, threadId: finalThreadId }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err: any) {
    console.error("/api/assistant error:", err);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
