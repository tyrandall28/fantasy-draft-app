from typing import Any, Literal

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class AssistantQueryRequest(BaseModel):
    # Full visible conversation; the new user question is the last message.
    messages: list[ChatMessage] = Field(..., min_length=1, max_length=40)


class AssistantToolCall(BaseModel):
    tool: str
    input: dict[str, Any]
    result_summary: str


class AssistantTraceStep(BaseModel):
    """One iteration of the agentic loop — what the model thought and did."""
    iteration: int
    model: str | None = None
    thinking: str | None = None
    tool_calls: list[AssistantToolCall] = []
    stop_reason: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None


class AssistantQueryResponse(BaseModel):
    answer: str
    # Per-iteration debug trace (model reasoning + tool decisions).
    trace: list[AssistantTraceStep] = []
