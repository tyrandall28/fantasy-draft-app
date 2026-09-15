"""Natural-language DB assistant endpoint (Phase 1).

See AI_NL_QUERY_PLAN.md. The assistant routes a question to typed query tools;
our code runs the SQL so stat values are always real.
"""
from fastapi import APIRouter, HTTPException

from app.api.deps import DB, CurrentUser
from app.config import settings
from app.schemas.assistant import AssistantQueryRequest, AssistantQueryResponse
from app.services.assistant_service import answer_question

router = APIRouter(prefix="/api/assistant", tags=["assistant"])


@router.post("/query", response_model=AssistantQueryResponse)
async def query(body: AssistantQueryRequest, db: DB, _user: CurrentUser):
    if not settings.anthropic_api_key:
        raise HTTPException(
            status_code=503,
            detail="The AI assistant isn't configured. Set APP_ANTHROPIC_API_KEY on the backend.",
        )
    if body.messages[-1].role != "user":
        raise HTTPException(status_code=400, detail="The last message must be from the user.")

    history = [{"role": m.role, "content": m.content} for m in body.messages]
    answer, trace = await answer_question(db, history)
    return AssistantQueryResponse(answer=answer, trace=trace)
