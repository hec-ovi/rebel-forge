from dataclasses import dataclass

import httpx

from rebel_forge_backend.core.integrations import META_GRAPH_API_VERSION
from rebel_forge_backend.providers.publishers.formatting import format_platform_post


@dataclass
class PublishResult:
    success: bool
    platform_post_id: str | None = None
    url: str | None = None
    error: str | None = None
    ambiguous: bool = False


class ThreadsPublisher:
    """Publish posts to Threads via Threads API."""

    def __init__(self, access_token: str, user_id: str) -> None:
        self.access_token = access_token
        self.user_id = user_id

    def publish_text(self, text: str) -> PublishResult:
        """Publish a text-only post to Threads."""
        try:
            with httpx.Client(timeout=30.0) as client:
                # Step 1: Create media container
                r = client.post(
                    f"https://graph.threads.net/{META_GRAPH_API_VERSION}/{self.user_id}/threads",
                    params={
                        "media_type": "TEXT",
                        "text": text,
                        "access_token": self.access_token,
                    },
                )

                if r.status_code != 200:
                    return PublishResult(
                        success=False, error=f"Threads container failed: {r.text[:200]}"
                    )

                container_id = r.json().get("id")
                if not container_id:
                    return PublishResult(success=False, error="No container ID returned")

                # Step 2: Publish the container
                r = client.post(
                    f"https://graph.threads.net/{META_GRAPH_API_VERSION}/{self.user_id}/threads_publish",
                    params={
                        "creation_id": container_id,
                        "access_token": self.access_token,
                    },
                )

                if r.status_code == 200:
                    post_id = r.json().get("id", "")
                    # Fetch the actual permalink
                    post_url = f"https://www.threads.net/@/post/{post_id}"
                    try:
                        pr = client.get(
                            f"https://graph.threads.net/{META_GRAPH_API_VERSION}/{post_id}",
                            params={"fields": "permalink", "access_token": self.access_token},
                        )
                        if pr.status_code == 200:
                            post_url = pr.json().get("permalink", post_url)
                    except Exception:
                        pass
                    return PublishResult(
                        success=True,
                        platform_post_id=post_id,
                        url=post_url,
                    )
                else:
                    return PublishResult(
                        success=False, error=f"Threads publish failed: {r.text[:200]}"
                    )

        except Exception as e:
            return PublishResult(success=False, error=str(e), ambiguous=True)

    def format_post(self, caption: str, hashtags: list[str]) -> str:
        """Format caption with hashtags for Threads (max 500 chars)."""
        return format_platform_post("threads", caption, hashtags)
