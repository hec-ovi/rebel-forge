import httpx

from rebel_forge_backend.core.config import Settings


class FirecrawlProvider:
    """Search and scrape the web via Firecrawl API."""

    def __init__(self, settings: Settings) -> None:
        self.api_url = settings.firecrawl_api_url.rstrip("/")
        self.api_key = settings.firecrawl_api_key

    def _headers(self) -> dict[str, str]:
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }

    def search(self, query: str, limit: int = 5) -> list[dict]:
        """Web search. Returns list of {title, url, description, markdown?}."""
        with httpx.Client(timeout=30.0) as client:
            res = client.post(
                f"{self.api_url}/v1/search",
                headers=self._headers(),
                json={"query": query, "limit": limit},
            )
            res.raise_for_status()
            data = res.json()
            return data.get("data", [])

    def scrape(self, url: str) -> str:
        """Scrape a URL, return markdown content."""
        with httpx.Client(timeout=30.0) as client:
            res = client.post(
                f"{self.api_url}/v1/scrape",
                headers=self._headers(),
                json={"url": url, "formats": ["markdown"]},
            )
            res.raise_for_status()
            data = res.json()
            return data.get("data", {}).get("markdown", "")
