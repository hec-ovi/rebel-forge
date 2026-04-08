from rebel_forge_backend.core.config import Settings
from rebel_forge_backend.providers.llm.openai_compatible import OpenAIResponsesProvider
from rebel_forge_backend.providers.media.openai_compatible import OpenAIImagesProvider


def build_llm_provider(settings: Settings, *, base_url: str = "", api_key: str = "", model: str = "", provider: str = ""):
    """Build the appropriate LLM provider based on the active provider type."""
    if provider == "codex":
        from rebel_forge_backend.providers.llm.codex_cli import CodexCLIProvider
        return CodexCLIProvider(settings, model=model)

    return OpenAIResponsesProvider(settings, base_url=base_url, api_key=api_key, model=model)


def build_media_provider(settings: Settings) -> OpenAIImagesProvider:
    return OpenAIImagesProvider(settings)
