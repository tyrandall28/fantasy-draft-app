from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.players import router as players_router
from app.api.rankings import router as rankings_router
from app.api.leagues import router as leagues_router
from app.api.drafts import router as drafts_router
from app.ws.events import router as ws_router
from app.config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
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
app.include_router(ws_router)
