from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class AssistantStatusResponse(BaseModel):
    """Whether the assistant answers questions on this deployment.

    Lets the frontend render the held state up front instead of discovering it
    from a 503 after someone has typed a question and waited.
    """
    enabled: bool
    # Why it's unavailable, in words fit to show a user. None when enabled.
    message: str | None = None


# A question longer than this isn't a question. Generous for a typed sentence,
# and the ceiling on what one request can push into a paid context window.
MAX_QUESTION_CHARS = 2_000

# The whole conversation. Assistant turns are echoed back from previous
# responses and can be long, so this is deliberately loose — it exists to stop
# a 40-message payload of padding, not to police normal use.
MAX_CONVERSATION_CHARS = 120_000


class AssistantQueryRequest(BaseModel):
    # Full visible conversation; the new user question is the last message.
    messages: list[ChatMessage] = Field(..., min_length=1, max_length=40)

    @model_validator(mode="after")
    def _bound_the_payload(self) -> "AssistantQueryRequest":
        """Cap what one request can cost.

        Message *count* was capped but message *length* wasn't, so a single
        request could carry megabytes of text into a metered context window.
        The caps are split by role because the two are echoes of different
        things: the user's question is the only part they type fresh, while the
        assistant turns are our own prior answers coming back.
        """
        question = self.messages[-1]
        if question.role == "user" and len(question.content) > MAX_QUESTION_CHARS:
            raise ValueError(
                f"That question is {len(question.content)} characters; the limit is "
                f"{MAX_QUESTION_CHARS}. Try asking something shorter."
            )
        total = sum(len(m.content) for m in self.messages)
        if total > MAX_CONVERSATION_CHARS:
            raise ValueError(
                "This conversation has grown too long to continue. Start a new one."
            )
        return self


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
