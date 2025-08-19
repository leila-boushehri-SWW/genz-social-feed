import { useEffect, useMemo, useRef, useState } from "react";

function useSSE(url, body, { onToken, onDone, signal }) {
  useEffect(() => {
    if (!body) return;
    let cancelled = false;

    (async () => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal
      });
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (!cancelled) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          if (part.startsWith("data:")) {
            const payload = JSON.parse(part.slice(5));
            if (payload.type === "delta") onToken?.(payload.delta);
            if (payload.type === "done") onDone?.();
          }
        }
      }
    })();

    return () => { cancelled = true; };
  }, [url, JSON.stringify(body), signal]);
}

export default function AveryChat() {
  const [input, setInput] = useState("");
  const [items, setItems] = useState([]); // {id, role, content}
  const [isStreaming, setIsStreaming] = useState(false);
  const controllerRef = useRef(null);
  const listRef = useRef(null);

  // Only render the last N messages to avoid long reflows
  const visible = useMemo(() => items.slice(-50), [items]);

  useEffect(() => {
    // autoscroll to bottom on new content
    listRef.current?.lastElementChild?.scrollIntoView({ behavior: "smooth" });
  }, [items.length]);

  async function send() {
    const msg = input.trim();
    if (!msg || isStreaming) return;

    setItems(prev => [...prev, { id: crypto.randomUUID(), role: "user", content: msg }]);
    setInput("");

    const id = crypto.randomUUID();
    setItems(prev => [...prev, { id, role: "assistant", content: "" }]);

    controllerRef.current?.abort();
    controllerRef.current = new AbortController();
    setIsStreaming(true);

    const history = items.map(({ role, content }) => ({ role, content }));

    let buffer = "";
    let raf = 0;
    const flush = () => {
      setItems(prev => prev.map(m => (m.id === id ? { ...m, content: m.content + buffer } : m)));
      buffer = "";
      raf = 0;
    };

    useSSE("/api/avery", { message: msg, history }, {
      signal: controllerRef.current.signal,
      onToken: (t) => {
        buffer += t;
        if (!raf) raf = requestAnimationFrame(flush);
      },
      onDone: () => {
        if (buffer) flush();
        setIsStreaming(false);
      }
    });
  }

  return (
    <div className="mx-auto max-w-screen-sm h-dvh flex flex-col">
      <header className="p-4 border-b text-sm text-gray-600">💬 Avery — your Gen Z AI friend</header>

      <main ref={listRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {visible.map(m => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={(m.role === "user" ? "bg-black text-white" : "bg-gray-100 text-gray-900") + " px-3 py-2 rounded-2xl max-w-[80%] whitespace-pre-wrap"}>
              {m.content || (m.role === "assistant" && isStreaming ? <span className="opacity-60">typing…</span> : null)}
            </div>
          </div>
        ))}
      </main>

      <form
        onSubmit={(e) => { e.preventDefault(); send(); }}
        className="p-3 border-t flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask me anything…"
          className="flex-1 px-3 py-2 rounded-xl border outline-none focus:ring"
          maxLength={2000}
        />
        <button
          disabled={!input.trim() || isStreaming}
          className="px-4 py-2 rounded-xl bg-black text-white disabled:opacity-40"
        >Send</button>
      </form>
    </div>
  );
}
