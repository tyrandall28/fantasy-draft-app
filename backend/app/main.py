import logging
from contextlib import asynccontextmanager
from pathlib import Path, PurePath

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.auth import router as auth_router
from app.api.players import router as players_router
from app.api.rankings import router as rankings_router
from app.api.leagues import router as leagues_router
from app.api.drafts import router as drafts_router
from app.api.analytics import router as analytics_router
from app.api.assistant import router as assistant_router
from app.ws.events import router as ws_router
from app.config import settings

# The built frontend, if it's there. The Docker image writes it here; a local
# checkout has no `static/` and runs the frontend from the Vite dev server
# instead, so this is absent in development and that's the intended state.
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


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


@app.get("/healthz", include_in_schema=False)
async def healthz():
    """Liveness only — deliberately does not touch the database.

    Cloud Run restarts a container that fails this. Querying Postgres here
    would turn a brief database blip into a restart loop, which is strictly
    worse than serving errors from a container that is otherwise fine.
    `scripts.doctor` is the check that actually inspects the data.
    """
    return {"status": "ok", "environment": settings.environment}


app.include_router(auth_router)
app.include_router(players_router)
app.include_router(rankings_router)
app.include_router(leagues_router)
app.include_router(drafts_router)
app.include_router(analytics_router)
app.include_router(assistant_router)
app.include_router(ws_router)


# --- the built frontend, served from this same origin --------------------
# Registered last so every route above wins. A Mount at "/" is greedy: put it
# first and it would swallow /api and /ws.
if STATIC_DIR.is_dir():

    class SPAStaticFiles(StaticFiles):
        """Static files with a client-side-routing fallback.

        react-router owns paths like /rankings and /draft/<id>, which exist in
        the browser but not on disk. Plain StaticFiles 404s those, so a reload
        on any page but "/" would break. Unknown paths therefore return
        index.html and let the router sort it out — except under /assets/,
        where a miss is a genuinely missing bundle and should stay a 404
        rather than be papered over with a page of HTML.
        """

        async def get_response(self, path: str, scope):
            try:
                return await super().get_response(path, scope)
            except StarletteHTTPException as exc:
                # `path` arrives OS-normalised, so on Windows it's
                # "assets\index-abc.js". Compare parts, not a "assets/" prefix.
                is_asset = PurePath(path).parts[:1] == ("assets",)
                if exc.status_code == 404 and not is_asset:
                    return FileResponse(STATIC_DIR / "index.html")
                raise

    app.mount("/", SPAStaticFiles(directory=STATIC_DIR, html=True), name="spa")
