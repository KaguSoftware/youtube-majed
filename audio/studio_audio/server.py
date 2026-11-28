"""The local audio service. Models load once at start-up and stay loaded.

    uv run python -m studio_audio.server                      # original Chatterbox on MPS
    uv run python -m studio_audio.server --engine turbo --device cpu

Endpoints (JSON, 127.0.0.1 only):
    GET  /health   engine, device, revisions
    POST /line     voice ONE line: text, energy (1-5), seed, reference clip  -> take + word times
    POST /master   assemble takes into the narration track, master it, write voice.json
"""

from __future__ import annotations

import argparse
import logging
import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from . import config, pins
from .studio import Studio

log = logging.getLogger("studio_audio.server")
studio: Studio | None = None
busy = threading.Lock()  # the models serve one request at a time


class LineIn(BaseModel):
    outDir: str
    id: str
    text: str = Field(min_length=1)
    energy: int = Field(ge=1, le=5)
    seed: int | None = None
    reference: str | None = None
    exaggeration: float | None = None  # explicit overrides of the energy preset
    cfgWeight: float | None = None
    temperature: float | None = None
    maxAttempts: int = Field(default=3, ge=1, le=6)


class TrackLine(BaseModel):
    id: str
    key: str


class MasterIn(BaseModel):
    outDir: str
    lines: list[TrackLine] = Field(min_length=1)
    reference: str | None = None


def _safe_dir(p: str) -> Path:
    path = Path(p).resolve()
    if config.REPO not in path.parents and path != config.REPO:
        raise HTTPException(400, f"outDir must be inside the repository ({config.REPO})")
    return path


def create_app(engine: str, device: str) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_: FastAPI):
        global studio
        studio = Studio(engine, device).load()
        log.info("ready: %s on %s", studio.voice.engine, studio.voice.device)
        yield

    app = FastAPI(title="studio-audio", lifespan=lifespan)

    @app.get("/health")
    def health() -> dict:
        assert studio is not None
        return {
            "ok": True, "engine": studio.voice.engine, "revision": studio.voice.revision, "device": studio.voice.device,
            "aligner": pins.MODELS["align"].repo, "alignerRevision": pins.MODELS["align"].revision, "busy": busy.locked(),
        }

    @app.post("/line")
    def line(req: LineIn) -> dict:
        assert studio is not None
        overrides = {"exaggeration": req.exaggeration, "cfg_weight": req.cfgWeight, "temperature": req.temperature}
        try:
            with busy:
                return studio.line(_safe_dir(req.outDir), req.id, req.text, req.energy, req.seed, req.reference, overrides, req.maxAttempts)
        except FileNotFoundError as e:
            raise HTTPException(400, str(e)) from e

    @app.post("/master")
    def master_track(req: MasterIn) -> dict:
        assert studio is not None
        try:
            with busy:
                return studio.track(_safe_dir(req.outDir), [l.model_dump() for l in req.lines], req.reference)
        except FileNotFoundError as e:
            raise HTTPException(400, f"missing take: {e}") from e

    return app


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--engine", default=os.environ.get("STUDIO_AUDIO_ENGINE", "original"), choices=["original", "turbo"])
    ap.add_argument("--device", default=os.environ.get("STUDIO_AUDIO_DEVICE", "auto"), choices=["auto", "mps", "cuda", "cpu"])
    ap.add_argument("--port", type=int, default=int(os.environ.get("STUDIO_AUDIO_PORT", "8765")))
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    uvicorn.run(create_app(a.engine, a.device), host="127.0.0.1", port=a.port, log_level="warning")


if __name__ == "__main__":
    main()
