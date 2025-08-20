// Gen Z Chat — OpenAI Assistant API integration (Netlify)
// ------------------------------------------------------------------
// This keeps the original UI but swaps the fake reply for a real backend call
// to your Netlify Function at /api/assistant (uses OPENAI_ASSISTANT_ID).
// It returns JSON (non‑streaming) to avoid the “typing… forever” edge case.

import React, { useEffect, useRef, useState } from "react";

/** @typedef {"sending"|"sent"|"delivered"|"read"|"failed"} MessageStatus */
/** @typedef {"user"|"assistant"} Role */
/** @typedef {{ id: string; role: Role; text: string; timestamp: number; status?: MessageStatus }} ChatMessage */

// ---- Persona ----
const PERSONA = {
  name: "Avery",
};

// ---- Storage ----
const STORAGE_KEY = "genz-chat-demo";
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

// ---- Utils ----
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
function formatTime(ts) { const d = new Date(ts); const hh = d.getHours(); const h12 = ((hh + 11) % 12) + 1; const mm = d.getMinutes().toString().padStart(2, "0"); return `${h12}:${mm} ${hh>=12?"PM":"AM"}`; }

// ---- Icons ----
const SingleCheck = (props) => (
  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M7.629 13.233L3.9 9.504l1.414-1.414 2.315 2.315 6.06-6.06 1.414 1.415z" />
  </svg>
);
const DoubleCheck = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M9.5 16.2L3.8 10.5l1.4-1.4 4.3 4.3 9-9 1.4 1.4z" />
    <path d="M20.2 6.8l1.4 1.4-8.1 8.1-1.4-1.4z" />
  </svg>
);

const TypingDots = () => (
  <span className="flex items-end gap-1">
    <span className="w-2 h-2 rounded-full bg-white/80 animate-bounce [animation-delay:0ms]"></span>
    <span className="w-2 h-2 rounded-full bg-white/80 animate-bounce [animation-delay:150ms]"></span>
    <span className="w-2 h-2 rounded-full bg-white/80 animate-bounce [animation-delay:300ms]"></span>
  </span>
);

// ---- Server call ----
async function callAssistantEndpoint({ text, threadId }) {
  const res = await fetch("/api/assistant", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, threadId }),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); if (j?.error) msg = j.error; } catch {}
    throw new Error(msg);
  }
  return res.json(); // { reply, threadId }
}

export default function GenZChatDemo() {
  const persisted = loadState();
  const [messages, setMessages] = useState(/** @type {ChatMessage[]} */(persisted?.messages || []));
  const [threadId, setThreadId] = useState(persisted?.threadId || null);
  const [input, setInput] = useState("");
  const [showTypingIndicator, setShowTypingIndicator] = useState(false);
  const [sending, setSending] = useState(false);
  const typingTimerRef = useRef(/** @type {any} */(null));
  const listRef = useRef(/** @type {HTMLDivElement|null} */(null));
  const textareaRef = useRef(/** @type {HTMLTextAreaElement|null} */(null));

  // persist
  useEffect(() => saveState({ messages, threadId }), [messages, threadId]);

  // autoscroll
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages, showTypingIndicator]);

  // autosize
  const resizeTextarea = () => { const ta = textareaRef.current; if (!ta) return; ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; };
  useEffect(() => resizeTextarea(), [input]);

  // statuses
  const markStatus = (id, status, delayMs = 0) => {
    setTimeout(() => setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, status } : m))), delayMs);
  };

  const commitAssistantMessage = (fullText) => {
    const parts = fullText.split('\n').filter((line) => line.trim() !== "");
  
    const now = Date.now();
    const messagesToAdd = parts.map((text, i) => ({
      id: uid(),
      role: "assistant",
      text: text.trim(),
      timestamp: now + i, // slightly stagger timestamps for visual order
    }));
  
    setMessages((prev) => [...prev, ...messagesToAdd]);
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || sending) return;

    const id = uid();
    const now = Date.now();
    setMessages((prev) => [...prev, { id, role: "user", text: trimmed, timestamp: now, status: "sending" }]);
    setInput("");
    setSending(true);

    // show typing if it takes a moment
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    setShowTypingIndicator(false);
    typingTimerRef.current = setTimeout(() => setShowTypingIndicator(true), 700);

    // optimistic receipts for UX
    markStatus(id, "sent", 200);
    markStatus(id, "delivered", 600);

    try {
      const { reply, threadId: newTid } = await callAssistantEndpoint({ text: trimmed, threadId });
      if (newTid && newTid !== threadId) setThreadId(newTid);
      commitAssistantMessage(reply || "(no content)");
      markStatus(id, "read", 0);
    } catch (e) {
      console.error(e);
      markStatus(id, "failed", 0);
    } finally {
      if (typingTimerRef.current) { clearTimeout(typingTimerRef.current); typingTimerRef.current = null; }
      setShowTypingIndicator(false);
      setSending(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <div className="flex items-center justify-center min-h-[100dvh] overflow-x-hidden bg-neutral-100 text-neutral-900">
      <div className="w-full max-w-md h-[100dvh] sm:h-[90dvh] bg-white rounded-3xl shadow-xl overflow-hidden border border-neutral-200 flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-200">
          <div className="relative w-10 h-10 rounded-full bg-gradient-to-br from-fuchsia-500 to-indigo-500 flex items-center justify-center text-white font-semibold">
            A
            <span className="absolute -right-0 -bottom-0 w-3 h-3 rounded-full bg-green-500 ring-2 ring-white" aria-label="online" />
          </div>
          <div className="flex flex-col">
            <div className="font-semibold leading-tight">{PERSONA.name}</div>
            <div className="text-xs text-neutral-500">Gen Z • Online</div>
          </div>
        </div>

        {/* Messages */}
        <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-4 bg-neutral-50 overflow-x-hidden" aria-live="polite" aria-relevant="additions">
          <DayDivider when={messages[0]?.timestamp} />
          {messages.map((m) => (<MessageBubble key={m.id} msg={m} />))}

          {showTypingIndicator && (
            <div className="flex items-end gap-2 my-1">
              <Avatar />
              <div className="max-w-[78%] min-w-0 bg-neutral-300 text-neutral-900 px-3 py-2 rounded-2xl rounded-tl-md shadow-sm">
                <TypingDots />
              </div>
            </div>
          )}
          <div className="h-2" />
        </div>

        {/* Composer */}
        <div className="px-3 pb-[env(safe-area-inset-bottom)] pb-3 bg-white">
          <div className="m-2 p-2 border border-neutral-200 rounded-2xl bg-white shadow-sm">
            <label htmlFor="composer" className="sr-only">Message input</label>
            <textarea id="composer" ref={textareaRef} rows={1} className="w-full resize-none outline-none placeholder:text-neutral-400 bg-transparent px-2 py-1 text-[15px]" placeholder="Type your message…" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown} onInput={resizeTextarea} />
            <div className="flex items-center justify-between px-1">
              <div className="text-[11px] text-neutral-400">Press Enter to send • Shift+Enter for new line</div>
              <button onClick={handleSend} disabled={!input.trim() || sending} className="px-3 py-1.5 text-sm rounded-full bg-neutral-900 text-white disabled:opacity-30" aria-label="Send message">Send</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Avatar() {
  return (
    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-fuchsia-500 to-indigo-500 text-white text-xs font-semibold grid place-items-center select-none">A</div>
  );
}

function DayDivider({ when }) {
  if (!when) return null;
  const label = new Date(when).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return (
    <div className="flex items-center justify-center my-2">
      <div className="text-[11px] text-neutral-500 bg-white border border-neutral-200 rounded-full px-2 py-0.5 shadow-sm">{label}</div>
    </div>
  );
}

function MessageBubble({ msg }) {
  const isUser = msg.role === "user";
  const bubbleClass = isUser
    ? "bg-gradient-to-br from-blue-600 to-indigo-600 text-white rounded-2xl rounded-br-md"
    : "bg-neutral-300 text-neutral-900 rounded-2xl rounded-bl-md";

  return (
    <div className={"flex my-1 " + (isUser ? "justify-end" : "items-end gap-2") }>
      {!isUser && <Avatar />}
      <div className="max-w-[78%] min-w-0">
        <div className={`px-3 py-2 shadow-sm ${bubbleClass}`}>
          <div className="whitespace-pre-wrap leading-snug text-[15px] break-words">{msg.text}</div>
        </div>
        <div className={"flex items-center gap-1 mt-0.5 " + (isUser ? "justify-end" : "justify-start")}>
          <span className="text-[10px] text-neutral-400">{formatTime(msg.timestamp)}</span>
          {isUser && <Receipt status={msg.status} />}
          {msg.status === "failed" && (
            <span className="text-[10px] text-red-500">Failed</span>
          )}
        </div>
      </div>
    </div>
  );
}

function Receipt({ status }) {
  if (!status) return null;
  const base = "w-3 h-3";
  switch (status) {
    case "sending": return <SingleCheck className={`${base} text-neutral-300`} />;
    case "sent": return <SingleCheck className={`${base} text-neutral-400`} />;
    case "delivered": return <DoubleCheck className={`${base} text-neutral-400`} />;
    case "read": return <DoubleCheck className={`${base} text-blue-500`} />; // colored when read
    case "failed": return <SingleCheck className={`${base} text-red-500`} />;
    default: return null;
  }
}
