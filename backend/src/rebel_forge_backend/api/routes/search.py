from fastapi import APIRouter, Depends
from pydantic import BaseModel

from rebel_forge_backend.api.auth import require_owner
from rebel_forge_backend.core.config import get_settings
from rebel_forge_backend.providers.search.firecrawl import FirecrawlProvider

router = APIRouter()


class SearchRequest(BaseModel):
    query: str
    limit: int = 5


class SearchResult(BaseModel):
    title: str
    url: str
    description: str


class SearchResponse(BaseModel):
    results: list[SearchResult]


@router.post("/search", response_model=SearchResponse)
def web_search(payload: SearchRequest, _role: str = Depends(require_owner)):
    settings = get_settings()
    fc = FirecrawlProvider(settings)
    raw = fc.search(payload.query, limit=payload.limit)
    results = [
        SearchResult(
            title=r.get("title", ""),
            url=r.get("url", ""),
            description=r.get("description", r.get("snippet", "")),
        )
        for r in raw
        if r.get("url")
    ]
    return SearchResponse(results=results)
