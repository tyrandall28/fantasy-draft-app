import { apiFetch } from "./client";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ToolCall {
  tool: string;
  input: Record<string, unknown>;
  result_summary: string;
}

export interface TraceStep {
  iteration: number;
  model: string | null;
  thinking: string | null;
  tool_calls: ToolCall[];
  stop_reason: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
}

export interface AssistantQueryResponse {
  answer: string;
  trace: TraceStep[];
}

export interface AssistantStatus {
  enabled: boolean;
  /** Why it's unavailable, fit to show a user. Null when enabled. */
  message: string | null;
}

/**
 * Whether the assistant is answering questions on this deployment.
 *
 * It's held in production (cost control — see the backend's api/assistant.py),
 * so the page asks first and renders a "coming soon" state instead of offering
 * an input box that can only produce an error.
 */
export async function getAssistantStatus(): Promise<AssistantStatus> {
  return apiFetch<AssistantStatus>("/api/assistant/status");
}

/** Send the full visible conversation; the new question is the last message. */
export async function askAssistant(messages: ChatMessage[]): Promise<AssistantQueryResponse> {
  return apiFetch<AssistantQueryResponse>("/api/assistant/query", {
    method: "POST",
    body: JSON.stringify({ messages }),
  });
}
