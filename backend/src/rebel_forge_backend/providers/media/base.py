from typing import Protocol


class GeneratedImageResult(Protocol):
    prompt: str
    revised_prompt: str | None
    b64_json: str | None
    external_url: str | None


class MediaProvider(Protocol):
    def generate_image(self, *, prompt: str, size: str) -> GeneratedImageResult:
        ...

