from dataclasses import dataclass

import httpx


@dataclass
class PublishResult:
    success: bool
    platform_post_id: str | None = None
    url: str | None = None
    error: str | None = None


class LinkedInPublisher:
    """Publish posts to LinkedIn via REST API v2."""

    def __init__(self, access_token: str) -> None:
        self.access_token = access_token
        self.base_url = "https://api.linkedin.com/v2"

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json",
            "X-Restli-Protocol-Version": "2.0.0",
        }

    def get_profile_id(self) -> str | None:
        """Get the authenticated user's LinkedIn profile URN."""
        try:
            with httpx.Client(timeout=30.0) as client:
                r = client.get(f"{self.base_url}/userinfo", headers=self._headers())
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
            "lifecycleState": "PUBLISHED",
            "specificContent": {
                "com.linkedin.ugc.ShareContent": {
                    "shareCommentary": {
                        "text": text
                    },
                    "shareMediaCategory": "NONE",
                }
            },
            "visibility": {
                "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"
            },
        }

        try:
            with httpx.Client(timeout=30.0) as client:
                r = client.post(
                    f"{self.base_url}/ugcPosts",
                    headers=self._headers(),
                    json=payload,
                )

                if r.status_code == 201:
                    data = r.json()
                    post_id = data.get("id", "")
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
            return PublishResult(success=False, error=str(e))

    def format_draft_as_post(self, caption: str, hashtags: list[str]) -> str:
        """Format a draft into a LinkedIn post (max 3000 chars)."""
        tags = " ".join(f"#{tag.lstrip('#')}" for tag in hashtags[:10])
        full = f"{caption}\n\n{tags}" if tags else caption
        return full[:3000]
