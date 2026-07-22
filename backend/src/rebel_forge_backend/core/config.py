from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from rebel_forge_backend.core.env_values import decode_env_value


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Rebel Forge Backend"
    app_env: str = "development"
    log_level: str = "INFO"

    database_url: str = "postgresql+psycopg://postgres:postgres@127.0.0.1:5432/rebel_forge"
    worker_poll_interval_seconds: int = 2
    default_workspace_name: str = "Primary Workspace"
    data_base_path: Path = Path("./data")
    prompts_base_path: Path = Path("./prompts")

    llm_provider: Literal["openai_responses"] = "openai_responses"
    llm_base_url: str = "http://127.0.0.1:8000/v1"
    llm_model: str = "openai/gpt-oss-120b"
    llm_api_key: str = ""

    media_provider: Literal["openai_images"] = "openai_images"
    media_base_url: str = "http://127.0.0.1:8001/v1"
    media_model: str = "gpt-image-1"
    media_api_key: str = ""
    media_response_format: Literal["b64_json", "url"] = "b64_json"

    storage_backend: Literal["local"] = "local"
    storage_base_path: Path = Path("./data/assets")
    public_asset_base_url: str = "http://localhost:8080/assets"

    firecrawl_api_key: str = ""
    firecrawl_api_url: str = "https://api.firecrawl.dev"

    x_consumer_key: str = ""
    x_consumer_secret: str = ""
    x_access_token: str = ""
    x_access_token_secret: str = ""

    linkedin_access_token: str = ""
    linkedin_person_id: str = ""

    facebook_access_token: str = ""
    facebook_page_id: str = ""
    facebook_page_token: str = ""

    instagram_access_token: str = ""
    instagram_user_id: str = ""

    threads_access_token: str = ""
    threads_user_id: str = ""

    comfyui_base_url: str = "http://127.0.0.1:8188"

    fal_key: str = ""
    fal_model: str = "fal-ai/flux/schnell"

    r2_endpoint_url: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket_name: str = "rebel-forge"
    r2_public_url: str = ""

    @field_validator("*", mode="before")
    @classmethod
    def decode_persisted_env_values(cls, value):
        return decode_env_value(value) if isinstance(value, str) else value


@lru_cache
def get_settings() -> Settings:
    return Settings()
