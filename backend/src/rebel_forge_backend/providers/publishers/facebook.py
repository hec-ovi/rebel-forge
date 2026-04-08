from dataclasses import dataclass

import httpx


@dataclass
class PublishResult:
    success: bool
    platform_post_id: str | None = None
    url: str | None = None
    error: str | None = None


class FacebookPublisher:
    """Publish posts to a Facebook Page via Graph API."""

    def __init__(self, access_token: str) -> None:
        self.access_token = access_token

    def get_pages(self) -> list[dict]:
        """Get list of pages the user manages."""
        try:
            with httpx.Client(timeout=30.0) as client:
                r = client.get(
                    "https://graph.facebook.com/v23.0/me/accounts",
                    params={"access_token": self.access_token},
                )
                if r.status_code == 200:
                    return r.json().get("data", [])
                return []
        except Exception:
            return []

    def publish_text(self, text: str, page_id: str | None = None, page_token: str | None = None) -> PublishResult:
        """Publish a text post to a Facebook Page."""
        try:
            # If no page specified, get the first page
            if not page_id or not page_token:
                pages = self.get_pages()
                if not pages:
                    return PublishResult(success=False, error="No Facebook Pages found. Make sure you have a Page linked.")
                page_id = pages[0]["id"]
                page_token = pages[0]["access_token"]

            with httpx.Client(timeout=30.0) as client:
                r = client.post(
                    f"https://graph.facebook.com/v23.0/{page_id}/feed",
                    params={
                        "message": text,
                        "access_token": page_token,
                    },
                )

                if r.status_code == 200:
                    post_id = r.json().get("id", "")
                    return PublishResult(
                        success=True,
                        platform_post_id=post_id,
                        url=f"https://www.facebook.com/{post_id}",
                    )
                else:
                    return PublishResult(success=False, error=f"Facebook API {r.status_code}: {r.text[:200]}")

        except Exception as e:
            return PublishResult(success=False, error=str(e))

    def format_post(self, caption: str, hashtags: list[str]) -> str:
        """Format caption with hashtags for Facebook."""
        tags = " ".join(f"#{tag.lstrip('#')}" for tag in hashtags[:10])
        full = f"{caption}\n\n{tags}" if tags else caption
        return full[:63206]  # FB's max
