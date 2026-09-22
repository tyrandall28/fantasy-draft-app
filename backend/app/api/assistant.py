"""Natural-language DB assistant endpoint (Phase 1).

See AI_NL_QUERY_PLAN.md. The assistant routes a question to typed query tools;
our code runs the SQL so stat values are always real.

**Held in the deployed app.** `settings.assistant_enabled` is false there, so
/query refuses before reaching Anthropic and /status tells the frontend to
render its "coming soon" page. The reason is cost control: a question costs
real credits and this endpoint has no per-user quota or rate limit in front of
it, so anyone with an account could run up the bill. Turning it on means
setting APP_ASSISTANT_ENABLED=true *and* providing a key — and wanting the
quota work in AI_NL_QUERY_PLAN.md done first.
"""
from fastapi import APIRouter, HTTPException

from app.api.deps import DB, CurrentUser
from app.config import settings
from app.schemas.assistant import (
    AssistantQueryRequest,
    AssistantQueryResponse,
    AssistantStatusResponse,
)
from app.services.assistant_service import answer_question

router = APIRouter(prefix="/api/assistant", tags=["assistant"])

# Shown to the user when the feature is held. Phrased for a person, not an
# operator — the old text told end users to "set APP_ANTHROPIC_API_KEY on the
# backend", which is a message for exactly one reader and he isn't a user.
UNAVAILABLE_MESSAGE = "The AI assistant isn't available yet — it's still being built."


@router.get("/status", response_model=AssistantStatusResponse)
async def status() -> AssistantStatusResponse:
    """Whether the assistant is answering questions.

    Unauthenticated on purpose: it's a single boolean about the deployment,
    reveals nothing, and the frontend needs it to decide what to render before
    it would ever send a question.
    """
    return AssistantStatusResponse(
        enabled=settings.assistant_enabled,
        message=None if settings.assistant_enabled else UNAVAILABLE_MESSAGE,
    )


@router.post("/query", response_model=AssistantQueryResponse)
async def query(body: AssistantQueryRequest, db: DB, _user: CurrentUser):
    # Enforced server-side as well as hidden in the UI. The frontend not
    # showing an input box is presentation; this is the part that actually
    # stops a hand-rolled POST from spending money.
    if not settings.assistant_enabled:
        raise HTTPException(status_code=503, detail=UNAVAILABLE_MESSAGE)
    if body.messages[-1].role != "user":
        raise HTTPException(status_code=400, detail="The last message must be from the user.")

    history = [{"role": m.role, "content": m.content} for m in body.messages]
    answer, trace = await answer_question(db, history)
    return AssistantQueryResponse(answer=answer, trace=trace)
