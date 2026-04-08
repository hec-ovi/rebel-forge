import hmac
import hashlib
import base64
import time
import uuid
from dataclasses import dataclass
from urllib.parse import quote

import httpx


@dataclass
class PublishResult:
    success: bool
    platform_post_id: str | None = None
    url: str | None = None
    error: str | None = None


class XPublisher:
    """Publish posts to X/Twitter via API v2 with OAuth 1.0a."""

    def __init__(
        self,
        consumer_key: str,
        consumer_secret: str,
        access_token: str,
        access_token_secret: str,
    ) -> None:
        self.consumer_key = consumer_key
        self.consumer_secret = consumer_secret
        self.access_token = access_token
        self.access_token_secret = access_token_secret

    def _oauth_header(self, method: str, url: str) -> str:
        """Build OAuth 1.0a Authorization header."""
        oauth_params = {
            "oauth_consumer_key": self.consumer_key,
            "oauth_nonce": uuid.uuid4().hex,
            "oauth_signature_method": "HMAC-SHA1",
            "oauth_timestamp": str(int(time.time())),
            "oauth_token": self.access_token,
            "oauth_version": "1.0",
        }
        param_str = "&".join(
            f"{quote(k, safe='')}={quote(str(v), safe='')}"
            for k, v in sorted(oauth_params.items())
        )
        base_string = f"{method.upper()}&{quote(url, safe='')}&{quote(param_str, safe='')}"
        signing_key = f"{quote(self.consumer_secret, safe='')}&{quote(self.access_token_secret, safe='')}"
        signature = base64.b64encode(
            hmac.new(signing_key.encode(), base_string.encode(), hashlib.sha1).digest()
        ).decode()
        oauth_params["oauth_signature"] = signature
        return "OAuth " + ", ".join(
            f'{quote(k, safe="")}="{quote(v, safe="")}"'
            for k, v in sorted(oauth_params.items())
        )

    def publish_text(self, text: str) -> PublishResult:
        """Publish a text-only tweet."""
        url = "https://api.x.com/2/tweets"
        auth = self._oauth_header("POST", url)

        r = httpx.post(
            url,
            json={"text": text},
            headers={
                "Authorization": auth,
                "Content-Type": "application/json",
            },
            timeout=10.0,
        )

        if r.status_code == 201:
            data = r.json()
            post_id = data["data"]["id"]
            return PublishResult(
                success=True,
                platform_post_id=post_id,
                url=f"https://x.com/hec_ovi/status/{post_id}",
            )
        else:
            return PublishResult(
                success=False,
                error=f"X API {r.status_code}: {r.text}",
            )

    def format_draft_as_tweet(self, caption: str, hashtags: list[str]) -> str:
        """Format a draft's caption and hashtags into a tweet (max 280 chars)."""
        # Try with hashtags first
        if hashtags:
            tags = " ".join(f"#{tag.lstrip('#')}" for tag in hashtags[:5])
            full = f"{caption}\n\n{tags}"
            # If fits, use it
            if len(full) <= 280:
                return full
            # Try fewer hashtags
            for n in range(4, 0, -1):
                tags = " ".join(f"#{tag.lstrip('#')}" for tag in hashtags[:n])
                full = f"{caption}\n\n{tags}"
                if len(full) <= 280:
                    return full
            # Still too long — caption only, trimmed
        # No hashtags or all combos too long
        if len(caption) <= 280:
            return caption
        return caption[:277] + "..."
