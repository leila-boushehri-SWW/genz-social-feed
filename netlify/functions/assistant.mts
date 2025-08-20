const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const handler: Handler = async (event) => {
  const { text, threadId, sessionId } = JSON.parse(event.body || "{}");

  if (!text || !sessionId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing 'text' or 'sessionId'." }),
    };
  }

  let thread = threadId
    ? { id: threadId }
    : await openai.beta.threads.create();

  // Ensure the assistant exists
  const assistant = await openai.beta.assistants.retrieve(OPENAI_ASSISTANT_ID);

  // Add the message
  await openai.beta.threads.messages.create(thread.id, {
    role: "user",
    content: text,
  });

  // Run the assistant
  const run = await openai.beta.threads.runs.create(thread.id, {
    assistant_id: assistant.id,
  });

  // Wait for the run to complete (polling)
  let result;
  while (true) {
    const status = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    if (status.status === "completed") {
      result = status;
      break;
    }
    if (status.status === "failed") {
      throw new Error("Assistant run failed.");
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  const messages = await openai.beta.threads.messages.list(thread.id);
  const reply = messages.data.find((m) => m.role === "assistant")?.content?.[0]?.text?.value || "(no reply)";

  return {
    statusCode: 200,
    body: JSON.stringify({
      reply,
      threadId: thread.id,
    }),
  };
};

export { handler };
