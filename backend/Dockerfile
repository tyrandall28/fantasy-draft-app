# Build context is the REPO ROOT, not backend/, because the frontend is built
# into this same image:
#
#   docker build -f backend/Dockerfile -t fantasy-draft .
#
# One image, one Cloud Run service, one origin. That last part is not a
# preference — frontend/src/api/client.ts uses relative URLs (BASE_URL = "")
# and DraftContext.tsx derives the WebSocket URL from window.location.host, so
# same-origin is what the frontend already assumes. Serving both halves from
# here means CORS never enters the picture and /ws works with no extra config.

# ---- Stage 1: build the frontend ----------------------------------------
# Node 24, the version in .nvmrc, which local dev and CI also use.
FROM node:24-slim AS frontend

WORKDIR /build

# Copy manifests alone first so `npm ci` is cached until dependencies change.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build


# ---- Stage 2: the API, serving that build -------------------------------
FROM python:3.12-slim

# Bytecode caching is pointless in a container that starts once, and unbuffered
# output is what makes `print()` from scripts.refresh_data show up in Cloud
# Logging as it happens rather than in one lump at exit.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

# Where main.py looks for the SPA. Absent (as in local dev) the API just serves
# no static files, which is exactly what you want behind the Vite dev proxy.
COPY --from=frontend /build/dist ./static

# Don't run as root. Numeric UID so the runtime doesn't have to resolve a name.
RUN useradd --create-home --uid 1000 app && chown -R app:app /app
USER app

# Cloud Run injects $PORT and ignores EXPOSE; the default keeps `docker run`
# and local use working unchanged. Shell form so ${PORT} actually expands.
ENV PORT=8000
EXPOSE 8000
CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
