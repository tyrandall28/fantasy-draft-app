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

/** Send the full visible conversation; the new question is the last message. */
export async function askAssistant(messages: ChatMessage[]): Promise<AssistantQueryResponse> {
  return apiFetch<AssistantQueryResponse>("/api/assistant/query", {
    method: "POST",
    body: JSON.stringify({ messages }),
  });
}
