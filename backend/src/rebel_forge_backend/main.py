from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from rebel_forge_backend.api.router import api_router
from rebel_forge_backend.core.config import get_settings
from rebel_forge_backend.core.logging import configure_logging


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    Path(settings.storage_base_path).mkdir(parents=True, exist_ok=True)
    yield


configure_logging()
settings = get_settings()
Path(settings.storage_base_path).mkdir(parents=True, exist_ok=True)
app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api_router)
app.mount("/assets", StaticFiles(directory=settings.storage_base_path), name="assets")
