from dataclasses import dataclass

import httpx

from rebel_forge_backend.core.integrations import LINKEDIN_API_BASE, LINKEDIN_API_VERSION
from rebel_forge_backend.providers.publishers.formatting import format_platform_post


@dataclass
class PublishResult:
    success: bool
    platform_post_id: str | None = None
    url: str | None = None
    error: str | None = None
    ambiguous: bool = False


class LinkedInPublisher:
    """Publish posts to LinkedIn via REST API v2."""

    def __init__(self, access_token: str) -> None:
        self.access_token = access_token
        self.base_url = LINKEDIN_API_BASE

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
            "Linkedin-Version": LINKEDIN_API_VERSION,
            "X-Restli-Protocol-Version": "2.0.0",
        }

    def get_profile_id(self) -> str | None:
        """Get the authenticated user's LinkedIn profile URN."""
        try:
            with httpx.Client(timeout=30.0) as client:
                r = client.get("https://api.linkedin.com/v2/userinfo", headers=self._headers())
                if r.status_code == 200:
                    data = r.json()
                    return data.get("sub")
            return None
        except Exception:
            return None

    def publish_text(self, text: str, author_urn: str | None = None) -> PublishResult:
        """Publish a text-only post to LinkedIn."""
        if not author_urn:
            profile_id = self.get_profile_id()
            if not profile_id:
                return PublishResult(success=False, error="Could not get LinkedIn profile ID")
            author_urn = f"urn:li:person:{profile_id}"

        payload = {
            "author": author_urn,
            "commentary": text,
            "visibility": "PUBLIC",
            "distribution": {
                "feedDistribution": "MAIN_FEED",
                "targetEntities": [],
                "thirdPartyDistributionChannels": [],
            },
            "lifecycleState": "PUBLISHED",
            "isReshareDisabledByAuthor": False,
        }

        try:
            with httpx.Client(timeout=30.0) as client:
                r = client.post(
                    f"{self.base_url}/posts",
                    headers=self._headers(),
                    json=payload,
                )

                if r.status_code == 201:
                    post_id = r.headers.get("x-restli-id", "")
                    if not post_id:
                        return PublishResult(
                            success=False,
                            error="LinkedIn Posts API returned no x-restli-id header",
                            ambiguous=True,
                        )
                    return PublishResult(
                        success=True,
                        platform_post_id=post_id,
                        url=f"https://www.linkedin.com/feed/update/{post_id}/",
                    )
                else:
                    return PublishResult(
                        success=False,
                        error=f"LinkedIn API {r.status_code}: {r.text[:200]}",
                    )
        except Exception as e:
            return PublishResult(success=False, error=str(e), ambiguous=True)

    def format_draft_as_post(self, caption: str, hashtags: list[str]) -> str:
        """Format a draft into a LinkedIn post (max 3000 chars)."""
        return format_platform_post("linkedin", caption, hashtags)
