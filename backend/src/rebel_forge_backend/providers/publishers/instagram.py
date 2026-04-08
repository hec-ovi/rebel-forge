from dataclasses import dataclass

import httpx


@dataclass
class PublishResult:
    success: bool
    platform_post_id: str | None = None
    url: str | None = None
    error: str | None = None


class InstagramPublisher:
    """Publish posts to Instagram via Graph API."""

    def __init__(self, access_token: str, ig_user_id: str) -> None:
        self.access_token = access_token
        self.ig_user_id = ig_user_id

    def publish_text_post(self, caption: str) -> PublishResult:
        """Publish a text-only post (carousel with no media not supported, needs image).
        For now, create a media container with an image URL if available."""
        # Instagram requires an image for posts — text-only isn't supported
        # We'll use this for image posts once ComfyUI is integrated
        return PublishResult(
            success=False,
            error="Instagram requires an image. Text-only posts are not supported. Use ComfyUI to generate an image first.",
        )

    def publish_image_post(self, image_url: str, caption: str) -> PublishResult:
        """Publish a photo post to Instagram."""
        import time

        try:
            with httpx.Client(timeout=60.0) as client:
                # Step 1: Create media container
                r = client.post(
                    f"https://graph.instagram.com/v23.0/{self.ig_user_id}/media",
                    params={
                        "image_url": image_url,
                        "caption": caption,
                        "access_token": self.access_token,
                    },
                )

                if r.status_code != 200:
                    return PublishResult(success=False, error=f"Instagram media creation failed: {r.text[:200]}")

                container_id = r.json().get("id")
                if not container_id:
                    return PublishResult(success=False, error="No container ID returned")

                # Step 2: Wait for container to be ready
                for attempt in range(12):
                    time.sleep(5)
                    r = client.get(
                        f"https://graph.instagram.com/v23.0/{container_id}",
                        params={
                            "fields": "status_code",
                            "access_token": self.access_token,
                        },
                    )
                    if r.status_code == 200:
                        status = r.json().get("status_code")
                        if status == "FINISHED":
                            break
                        if status == "ERROR":
                            return PublishResult(success=False, error="Instagram media processing failed")

                # Step 3: Publish the container
                r = client.post(
                    f"https://graph.instagram.com/v23.0/{self.ig_user_id}/media_publish",
                    params={
                        "creation_id": container_id,
                        "access_token": self.access_token,
                    },
                )

                if r.status_code == 200:
                    post_id = r.json().get("id", "")
                    # Fetch the actual permalink
                    post_url = f"https://www.instagram.com/{self.ig_user_id}/"
                    try:
                        pr = client.get(
                            f"https://graph.instagram.com/v19.0/{post_id}",
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
                    return PublishResult(success=False, error=f"Instagram publish failed: {r.text[:200]}")

        except Exception as e:
            return PublishResult(success=False, error=str(e))

    def format_caption(self, caption: str, hashtags: list[str]) -> str:
        """Format caption with hashtags for Instagram (max 2200 chars)."""
        tags = " ".join(f"#{tag.lstrip('#')}" for tag in hashtags[:30])
        full = f"{caption}\n\n{tags}" if tags else caption
        return full[:2200]
