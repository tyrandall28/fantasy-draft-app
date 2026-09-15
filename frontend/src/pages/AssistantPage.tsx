import { useEffect, useRef, useState } from "react";
import { askAssistant, type ChatMessage, type TraceStep } from "../api/assistant";

const SUGGESTIONS = [
  "Who led WRs in touchdowns in 2024?",
  "How does Josh Jacobs compare to Kenneth Walker?",
  "Top 5 RBs by yards per carry in 2025",
  "How has CeeDee Lamb trended over the last few seasons?",
];

// Local message: a ChatMessage plus the debug trace we got back for assistant turns.
interface DisplayMessage extends ChatMessage {
  trace?: TraceStep[];
}

// Persist the conversation so it survives navigation away from the page / reloads.
const STORAGE_KEY = "assistant.conversation.v1";

function loadMessages(): DisplayMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as DisplayMessage[]) : [];
  } catch {
    return [];
  }
}

function TracePanel({ trace }: { trace: TraceStep[] }) {
  const totalIn = trace.reduce((s, t) => s + (t.input_tokens ?? 0), 0);
  const totalOut = trace.reduce((s, t) => s + (t.output_tokens ?? 0), 0);
  const calls = trace.flatMap((t) => t.tool_calls);
  const model = trace.find((t) => t.model)?.model ?? "unknown model";

  return (
    <details className="mt-1.5 max-w-[85%] text-xs">
      <summary className="cursor-pointer select-none text-slate-500 hover:text-slate-300">
        🔍 {model} · {trace.length} step{trace.length === 1 ? "" : "s"},{" "}
        {calls.length} tool call{calls.length === 1 ? "" : "s"}, {totalIn + totalOut} tokens
      </summary>
      <div className="mt-2 space-y-3 rounded-lg border border-white/10 bg-[#0b0d12] p-3 font-mono text-slate-400">
        {trace.map((step) => (
          <div key={step.iteration} className="space-y-1.5">
            <div className="text-slate-500">
              ── step {step.iteration} · stop={step.stop_reason} · tokens in=
              {step.input_tokens} out={step.output_tokens}
            </div>
            {step.thinking && (
              <div className="whitespace-pre-wrap border-l-2 border-amber-500/40 pl-2 text-amber-200/70">
                {step.thinking}
              </div>
            )}
            {step.tool_calls.map((c, i) => (
              <div key={i} className="border-l-2 border-sky-500/40 pl-2">
                <span className="text-sky-300">{c.tool}</span>
                <span className="text-slate-300">({JSON.stringify(c.input)})</span>
                <div className="text-emerald-300/70">→ {c.result_summary}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}

export default function AssistantPage() {
  const [messages, setMessages] = useState<DisplayMessage[]>(loadMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  // Persist on every change so the conversation is restored on return.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      /* ignore quota / serialization errors */
    }
  }, [messages]);

  function newChat() {
    setMessages([]);
    setError(null);
    localStorage.removeItem(STORAGE_KEY);
  }

  async function send(text: string) {
    const question = text.trim();
    if (!question || loading) return;

    const next: DisplayMessage[] = [...messages, { role: "user", content: question }];
    setMessages(next);
    setInput("");
    setError(null);
    setLoading(true);
    try {
      // Only role/content go to the API — strip local trace fields.
      const payload: ChatMessage[] = next.map((m) => ({ role: m.role, content: m.content }));
      const res = await askAssistant(payload);
      setMessages([...next, { role: "assistant", content: res.answer, trace: res.trace }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    send(input);
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-57px)] max-w-3xl flex-col px-4">
      <div className="flex items-start justify-between py-4">
        <div>
          <h1 className="text-xl font-bold text-white">Ask the Data</h1>
          <p className="text-sm text-slate-400">
            Natural-language questions about NFL player stats (2022–2025).
          </p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={newChat}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-white/10"
          >
            New chat
          </button>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto pb-4">
        {messages.length === 0 && (
          <div className="mt-6 space-y-3">
            <p className="text-sm text-slate-500">Try asking:</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-white/10"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex flex-col items-end" : "flex flex-col items-start"}>
            <div
              className={
                m.role === "user"
                  ? "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-sky-600 px-4 py-2.5 text-sm text-white"
                  : "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm border border-white/5 bg-[#12141b] px-4 py-2.5 text-sm text-slate-200"
              }
            >
              {m.content}
            </div>
            {m.role === "assistant" && m.trace && m.trace.length > 0 && (
              <TracePanel trace={m.trace} />
            )}
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm border border-white/5 bg-[#12141b] px-4 py-2.5 text-sm text-slate-400">
              Thinking…
            </div>
          </div>
        )}

        {error && <div className="text-sm text-red-400">{error}</div>}
      </div>

      <form onSubmit={onSubmit} className="border-t border-white/5 py-3">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about player stats…"
            disabled={loading}
            className="flex-1 rounded-xl border border-white/10 bg-[#12141b] px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-sky-500/50 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-sky-500 disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
