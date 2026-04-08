"""
Cloud storage service — uploads images to Cloudflare R2.
S3-compatible API. Used for:
- Making ComfyUI images publicly accessible (Instagram needs this)
- Media library persistence
- Asset CDN
"""
import io
import logging
import uuid

import boto3
from botocore.config import Config

from rebel_forge_backend.core.config import Settings

logger = logging.getLogger("rebel_forge_backend.cloud_storage")


class CloudStorage:
    """Upload and manage files on Cloudflare R2."""

    def __init__(self, settings: Settings) -> None:
        self.bucket = settings.r2_bucket_name
        self.public_url = settings.r2_public_url.rstrip("/")

        self.client = boto3.client(
            "s3",
            endpoint_url=settings.r2_endpoint_url,
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )

    def upload_bytes(self, data: bytes, filename: str, content_type: str = "image/png") -> str:
        """Upload raw bytes to R2. Returns public URL."""
        key = f"assets/{filename}"

        self.client.upload_fileobj(
            io.BytesIO(data),
            self.bucket,
            key,
            ExtraArgs={"ContentType": content_type},
        )

        url = f"{self.public_url}/{key}"
        logger.info("[cloud] Uploaded %s (%d bytes) → %s", filename, len(data), url)
        return url

    def upload_image_from_url(self, source_url: str, filename: str | None = None) -> str:
        """Download image from URL and upload to R2. Returns public URL."""
        import httpx

        if not filename:
            filename = f"{uuid.uuid4().hex}.png"

        with httpx.Client(timeout=30.0) as client:
            r = client.get(source_url)
            r.raise_for_status()

        content_type = r.headers.get("content-type", "image/png")
        return self.upload_bytes(r.content, filename, content_type)

    def delete(self, filename: str) -> None:
        """Delete a file from R2."""
        key = f"assets/{filename}"
        self.client.delete_object(Bucket=self.bucket, Key=key)
        logger.info("[cloud] Deleted %s", key)
