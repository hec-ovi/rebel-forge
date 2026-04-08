"""
Products/Topics — define what you're promoting so the agent knows context.
Each product has: name, description, target audience, key features, links.
Training corrections are linked to products so the agent learns tone per product.
"""
import logging
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from rebel_forge_backend.api.auth import require_owner
from rebel_forge_backend.core.config import get_settings
from rebel_forge_backend.db.session import get_db
from rebel_forge_backend.services.workspace import WorkspaceService

logger = logging.getLogger("rebel_forge_backend.products")

router = APIRouter()


class Product(BaseModel):
    id: str = ""
    name: str
    description: str = ""
    target_audience: str = ""
    key_features: list[str] = []
    links: dict[str, str] = {}  # {"website": "https://...", "repo": "https://github.com/..."}
    tags: list[str] = []  # ["ai", "open-source", "local-first"]


class ProductList(BaseModel):
    products: list[Product]


def _get_products(bp) -> list[dict]:
    if not bp or not bp.style_notes:
        return []
    return bp.style_notes.get("products", [])


def _save_products(bp, products: list[dict], db):
    from sqlalchemy.orm.attributes import flag_modified
    style = dict(bp.style_notes or {})
    style["products"] = list(products)
    bp.style_notes = style
    flag_modified(bp, "style_notes")
    db.commit()


@router.get("/products", response_model=ProductList)
def list_products(db: Session = Depends(get_db), _role: str = Depends(require_owner)):
    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)
    products = _get_products(workspace.brand_profile)
    return ProductList(products=[Product(**p) for p in products])


@router.post("/products", response_model=Product)
def create_product(payload: Product, db: Session = Depends(get_db), _role: str = Depends(require_owner)):
    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)
    bp = workspace.brand_profile
    if not bp:
        raise HTTPException(status_code=400, detail="No brand profile")

    products = _get_products(bp)
    product_data = payload.model_dump()
    product_data["id"] = str(uuid4())
    products.append(product_data)
    _save_products(bp, products, db)

    logger.info("[products] Created: %s", product_data["name"])
    return Product(**product_data)


@router.put("/products/{product_id}", response_model=Product)
def update_product(product_id: str, payload: Product, db: Session = Depends(get_db), _role: str = Depends(require_owner)):
    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)
    bp = workspace.brand_profile
    if not bp:
        raise HTTPException(status_code=400, detail="No brand profile")

    products = _get_products(bp)
    for i, p in enumerate(products):
        if p.get("id") == product_id:
            updated = payload.model_dump()
            updated["id"] = product_id
            products[i] = updated
            _save_products(bp, products, db)
            return Product(**updated)

    raise HTTPException(status_code=404, detail="Product not found")


@router.delete("/products/{product_id}")
def delete_product(product_id: str, db: Session = Depends(get_db), _role: str = Depends(require_owner)):
    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)
    bp = workspace.brand_profile
    if not bp:
        raise HTTPException(status_code=400, detail="No brand profile")

    products = _get_products(bp)
    products = [p for p in products if p.get("id") != product_id]
    _save_products(bp, products, db)

    return {"status": "deleted", "product_id": product_id}


@router.get("/products/{product_id}", response_model=Product)
def get_product(product_id: str, db: Session = Depends(get_db), _role: str = Depends(require_owner)):
    settings = get_settings()
    workspace = WorkspaceService(settings).get_or_create_primary_workspace(db)
    products = _get_products(workspace.brand_profile)
    for p in products:
        if p.get("id") == product_id:
            return Product(**p)
    raise HTTPException(status_code=404, detail="Product not found")
