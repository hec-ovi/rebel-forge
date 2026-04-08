from typing import Protocol

from rebel_forge_backend.schemas.drafts import DraftPackageSubmission


class LLMProvider(Protocol):
    def generate_draft_package(self, *, prompt: str, count: int) -> DraftPackageSubmission:
        ...

