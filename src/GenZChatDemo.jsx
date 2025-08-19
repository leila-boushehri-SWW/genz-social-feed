// Gen Z Chat
// ---------------------------------------------------------
// What this is:
// • A mobile-first, SMS-style web chat you can drop into any React app.
// • Bubbles, typing indicator, delivery + read receipts, and optimistic sending.
// • Clear integration points to connect your AI-powered Gen Z persona (SSE/WebSocket/HTTP).
//
// How to use:
// 1) Paste this component into your project and render <GenZChatDemo />.
// 2) Replace `simulateAssistantReply` with your real backend call.
//    - For streaming, wire up Server-Sent Events (EventSource) or a WebSocket and
//      call `appendToAssistantMessage()` as text arrives. Use the included
//      event helpers to update message statuses (sent → delivered → read).
// 3) Tailwind is used for styling. Ensure Tailwind is enabled in your build.
// 4) Optional: Make it a PWA by adding a web manifest + service worker for
//    "Add to Home Screen" on iOS/Android.
//
// Notes on receipts:
// - 'sent' means the message left the device and your server acknowledged.
// - 'delivered' means your assistant/agent service received it and is processing.
// - 'read' means the assistant produced/output a reply (or you emitted a read event).
//
// Accessibility:
// - aria-live regions announce new messages.
// - Labels for input & buttons; sufficient color contrast.
//
// Security & privacy (brief):
// - Avoid logging raw PII in analytics.
// - Consider per-session pseudonymous IDs and short retention windows.
// - If recording transcripts for workshop debrief, surface consent copy.

import React, { useEffect, useMemo, useRef, useState } from "react";

// ---- Types ----
/** @typedef {"sending"|"sent"|"delivered"|"read"|"failed"} MessageStatus */
/** @typedef {"user"|"assistant"} Role */

/** @typedef {{
 *   id: string;
 *   role: Role;
 *   text: string;
 *   timestamp: number; // ms epoch
 *   status?: MessageStatus; // for user messages primarily
 * }} ChatMessage */

// ---- Persona Config (example) ----
// Tweak this to shape your Gen Z synthetic persona.
const PERSONA = {
  name: "Z",
  vibe: "Playful, empathetic, plain-spoken, emoji-light, short sentences.",
  guardrails:
    "No medical/financial/legal advice. Avoid identity inferences. Keep it kind.",
  styleNotes:
    "Use casual modern slang sparingly (e.g., 'low-key', 'vibe', 'big yikes'), no profanity.",
};

// Utility for time formatting
function formatTime(ts) {
  const d = new Date(ts);
  const hh = d.getHours();
  const h12 = ((hh + 11) % 12) + 1;
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ampm = hh >= 12 ? "PM" : "AM";
  return `${h12}:${mm} ${ampm}`;
}

// Generate a reasonably unique id
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// Minimal local store (per tab)
const STORAGE_KEY = "genz-chat-demo";
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

// ---- SVG icons (check marks) ----
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

// Typing dots
const TypingDots = () => (
  <span className="flex items-end gap-1">
    <span className="w-2 h-2 rounded-full bg-white/80 animate-bounce [animation-delay:0ms]"></span>
    <span className="w-2 h-2 rounded-full bg-white/80 animate-bounce [animation-delay:150ms]"></span>
    <span className="w-2 h-2 rounded-full bg-white/80 animate-bounce [animation-delay:300ms]"></span>
  </span>
);

export default function GenZChatDemo() {
  const [messages, setMessages] = useState(() => {
    const persisted = loadState();
    return (
      persisted?.messages || []
    );
  });
  const [input, setInput] = useState("");
  const [showTypingIndicator, setShowTypingIndicator] = useState(false);
  const typingTimerRef = useRef(null);
  const assistantBufferRef = useRef("");
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => saveState({ messages }), [messages]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, showTypingIndicator]);

  // Autosize textarea
  const resizeTextarea = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  };
  useEffect(() => resizeTextarea(), [input]);

  // ---- Sending flow ----
  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || sending) return;

    const newMsgId = uid();
    const now = Date.now();

    // 1) Optimistically add user message as 'sending'
    const userMsg = {
      id: newMsgId,
      role: "user",
      text: trimmed,
      timestamp: now,
      status: "sending",
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);

    // Schedule a delayed typing indicator — only shows if reply takes a moment
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    setShowTypingIndicator(false);
    typingTimerRef.current = setTimeout(() => setShowTypingIndicator(true), 700);

    // 2) Simulate server ACK ('sent'), then 'delivered'. Replace this with your API.
    markStatus(newMsgId, "sent", 200);
    markStatus(newMsgId, "delivered", 600);

    // 3) Kick off assistant reply (streaming simulation)
    await simulateAssistantReply(trimmed, {
      onChunk: (chunk) => {
        // Accumulate tokens silently; we'll render the bubble all at once onDone
        assistantBufferRef.current += chunk;
      },
      onDone: () => {
        // Commit one assistant bubble with the full text
        commitAssistantMessage(assistantBufferRef.current);
        assistantBufferRef.current = "";
        markStatus(newMsgId, "read", 0);
        if (typingTimerRef.current) { clearTimeout(typingTimerRef.current); typingTimerRef.current = null; }
        setShowTypingIndicator(false);
        setSending(false);
      },
      onError: () => {
        if (typingTimerRef.current) { clearTimeout(typingTimerRef.current); typingTimerRef.current = null; }
        setShowTypingIndicator(false);
        setSending(false);
        markStatus(newMsgId, "failed", 0);
      },
    });
  };

  // Update message status with optional delay
  const markStatus = (id, status /** @type {MessageStatus} */, delayMs = 0) => {
    setTimeout(() => {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, status } : m))
      );
    }, delayMs);
  };

  // Assistant message: commit a full reply at once (no streaming UI)
  const commitAssistantMessage = (fullText) => {
    setMessages((prev) => [
      ...prev,
      { id: uid(), role: "assistant", text: fullText, timestamp: Date.now() },
    ]);
  };

  // Simulated streaming assistant (replace with your backend integration)
  async function simulateAssistantReply(userText, { onChunk, onDone, onError }) {
    try {
            const reply = toyPersonaReply(userText);
      // stream it character-by-character
      for (let i = 0; i < reply.length; i++) {
        await new Promise((r) => setTimeout(r, 10 + Math.random() * 25));
        onChunk?.(reply[i]);
      }
      onDone?.();
    } catch (e) {
      onError?.(e);
    }
  }


  function toyPersonaReply(text) {
    // Cheeky heuristic just for the demo
    const lower = text.toLowerCase();
    if (lower.includes("help") || lower.includes("how")) {
      return `${PERSONA.name}: low-key doable. What outcome are you aiming for?`;
    }
    if (lower.includes("brand") || lower.includes("ad")) {
      return `${PERSONA.name}: what's the vibe? funny, heartfelt, or shock-drop energy?`;
    }
    if (lower.includes("workshop") || lower.includes("exercise")) {
      return `${PERSONA.name}: cool. we can run a quick pulse-check then build a mini journey. ready?`;
    }
    return `${PERSONA.name}: gotcha. tell me more so we can make this hit.`;
  }

  // Retry a failed message by resending its text
  const retry = (msg) => {
    setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, status: "sending" } : m)));
    setInput(msg.text);
    setTimeout(() => handleSend(), 0);
  };

  // Keyboard handler: Enter to send, Shift+Enter for newline
  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[100dvh] overflow-x-hidden bg-neutral-100 text-neutral-900">
      <div className="w-full max-w-md h-[100dvh] sm:h-[90dvh] bg-white rounded-3xl shadow-xl overflow-hidden border border-neutral-200 flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-200">
          <div className="relative w-10 h-10 rounded-full bg-gradient-to-br from-fuchsia-500 to-indigo-500 flex items-center justify-center text-white font-semibold">
            Z
            <span className="absolute -right-0 -bottom-0 w-3 h-3 rounded-full bg-green-500 ring-2 ring-white" aria-label="online" />
          </div>
          <div className="flex flex-col">
            <div className="font-semibold leading-tight">Texting with {PERSONA.name}</div>
            <div className="text-xs text-neutral-500">Gen Z • Online</div>
          </div>
        </div>

        {/* Messages */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto px-3 py-4 bg-neutral-50 overflow-x-hidden"
          aria-live="polite"
          aria-relevant="additions"
        >
          <DayDivider when={messages[0]?.timestamp} />
          {messages.map((m) => (
            <MessageBubble key={m.id} msg={m} />
          ))}

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
            <label htmlFor="composer" className="sr-only">
              Message input
            </label>
            <textarea
              id="composer"
              ref={textareaRef}
              rows={1}
              className="w-full resize-none outline-none placeholder:text-neutral-400 bg-transparent px-2 py-1 text-[15px]"
              placeholder="Type your message…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              onInput={resizeTextarea}
            />
            <div className="flex items-center justify-between px-1">
              <div className="text-[11px] text-neutral-400">Press Enter to send • Shift+Enter = new line</div>
              <button
                onClick={handleSend}
                disabled={!input.trim() || sending}
                className="px-3 py-1.5 text-sm rounded-full bg-neutral-900 text-white disabled:opacity-30"
                aria-label="Send message"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Avatar() {
  return (
    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-fuchsia-500 to-indigo-500 text-white text-xs font-semibold grid place-items-center select-none">
      Z
    </div>
  );
}

function DayDivider({ when }) {
  if (!when) return null;
  const label = new Date(when).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return (
    <div className="flex items-center justify-center my-2">
      <div className="text-[11px] text-neutral-500 bg-white border border-neutral-200 rounded-full px-2 py-0.5 shadow-sm">
        {label}
      </div>
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
          <div className="whitespace-pre-wrap leading-snug text-[15px] break-words" >{msg.text}</div>
        </div>
        <div className={"flex items-center gap-1 mt-0.5 " + (isUser ? "justify-end" : "justify-start")}>
          <span className="text-[10px] text-neutral-400">{formatTime(msg.timestamp)}</span>
          {isUser && <Receipt status={msg.status} />}
          {msg.status === "failed" && (
            <span className="text-[10px] text-red-500">Failed • Tap to retry</span>
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
    case "sending":
      return <SingleCheck className={`${base} text-neutral-300`} />;
    case "sent":
      return <SingleCheck className={`${base} text-neutral-400`} />;
    case "delivered":
      return <DoubleCheck className={`${base} text-neutral-400`} />;
    case "read":
      return <DoubleCheck className={`${base} text-blue-500`} />; // colored when read
    case "failed":
      return <SingleCheck className={`${base} text-red-500`} />;
    default:
      return null;
  }
}

// ---- Backend Integration Guide (replace simulateAssistantReply) ----
// Example: Server-Sent Events (SSE)
// async function callAssistantSSE(userMessageId, text) {
//   const ack = await fetch("/api/chat", {
//     method: "POST",
//     headers: { "Content-Type": "application/json" },
//     body: JSON.stringify({ messageId: userMessageId, text }),
//   });
//   if (!ack.ok) throw new Error("Send failed");
//   // Update: markStatus(userMessageId, "sent");
//   const es = new EventSource(`/api/chat/stream?parent=${userMessageId}`);
//   es.onmessage = (ev) => {
//     const { type, data } = JSON.parse(ev.data);
//     if (type === "token") appendToAssistantMessage(data);
//     if (type === "delivered") markStatus(userMessageId, "delivered");
//     if (type === "read") markStatus(userMessageId, "read");
//     if (type === "done") { finalizeAssistantMessage(); es.close(); }
//   };
//   es.onerror = () => { es.close(); markStatus(userMessageId, "failed"); };
// }

// Example: WebSocket
// const ws = new WebSocket("wss://your.api/chat");
// ws.onmessage = (ev) => {
//   const msg = JSON.parse(ev.data);
//   if (msg.type === "ack") markStatus(msg.userMessageId, "sent");
//   if (msg.type === "delivered") markStatus(msg.userMessageId, "delivered");
//   if (msg.type === "read") markStatus(msg.userMessageId, "read");
//   if (msg.type === "token") appendToAssistantMessage(msg.data);
//   if (msg.type === "done") finalizeAssistantMessage();
// };

// Optional Enhancements:
// - Add message grouping by day and sender.
// - Virtualize long lists (react-virtualized) for huge threads.
// - Add image attachments (copy iMessage style). Keep EXIF off for privacy.
// - PWA: offline shell, push notifications for re-engagement during workshops.
// - Analytics hooks for workshop insights (turn count, time-to-first-reply, sentiment proxy).
