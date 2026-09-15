import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.players import router as players_router
from app.api.rankings import router as rankings_router
from app.api.leagues import router as leagues_router
from app.api.drafts import router as drafts_router
from app.api.analytics import router as analytics_router
from app.api.assistant import router as assistant_router
from app.ws.events import router as ws_router
from app.config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Route app-module INFO logs (e.g. the assistant tool-call trace) through
    # uvicorn's console handler so they're visible while the server runs.
    uvicorn_logger = logging.getLogger("uvicorn")
    app_logger = logging.getLogger("app")
    app_logger.setLevel(logging.INFO)
    if uvicorn_logger.handlers:
        app_logger.handlers = uvicorn_logger.handlers
        app_logger.propagate = False
    yield


app = FastAPI(title="Fantasy Draft App", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(players_router)
app.include_router(rankings_router)
app.include_router(leagues_router)
app.include_router(drafts_router)
app.include_router(analytics_router)
app.include_router(assistant_router)
app.include_router(ws_router)
