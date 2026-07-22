import json

import httpx
import pytest
from sqlalchemy.orm import Session

from rebel_forge_backend.core.config import Settings
from rebel_forge_backend.providers.llm.openai_compatible import OpenAIResponsesProvider
from rebel_forge_backend.providers.media.comfyui import ComfyUIProvider, _load_workflow
from rebel_forge_backend.providers.media.fal_ai import FalAIProvider
from rebel_forge_backend.providers.media.openai_compatible import OpenAIImagesProvider
from rebel_forge_backend.providers.publishers.x_twitter import XPublisher
from rebel_forge_backend.services.cloud_storage import CloudStorage
from rebel_forge_backend.services.llm_config import get_active_llm


def draft_response() -> dict:
    arguments = {
        "drafts": [
            {
                "platform": "x",
                "concept": "Testing",
                "caption": "A tested caption",
                "hook": "Hook",
                "cta": "CTA",
                "hashtags": ["test"],
                "alt_text": "Alt",
                "media_prompt": None,
                "script": None,
            }
        ]
    }
    return {
        "output": [
            {
                "type": "function_call",
                "name": "submit_draft_package",
                "arguments": json.dumps(arguments),
            }
        ]
    }


def test_llm_provider_sends_schema_without_output_cap(settings: Settings, monkeypatch) -> None:
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        captured["authorization"] = request.headers.get("authorization")
        return httpx.Response(200, json=draft_response())

    provider = OpenAIResponsesProvider(
        settings,
        base_url="https://llm.test/v1",
        api_key="secret",
        model="test-model",
    )
    monkeypatch.setattr(
        provider,
        "_client",
        lambda: httpx.Client(
            base_url="https://llm.test/v1",
            transport=httpx.MockTransport(handler),
            headers={"Authorization": "Bearer secret"},
        ),
    )

    package = provider.generate_draft_package(prompt="Write it", count=1)

    assert package.drafts[0].caption == "A tested caption"
    assert captured["body"]["model"] == "test-model"
    assert "max_output_tokens" not in captured["body"]
    assert "max_tokens" not in captured["body"]
    assert captured["authorization"] == "Bearer secret"


def test_llm_provider_requires_expected_function_call(settings: Settings, monkeypatch) -> None:
    provider = OpenAIResponsesProvider(settings, base_url="https://llm.test/v1")
    monkeypatch.setattr(
        provider,
        "_client",
        lambda: httpx.Client(
            base_url="https://llm.test/v1",
            transport=httpx.MockTransport(
                lambda _request: httpx.Response(200, json={"output": []})
            ),
        ),
    )

    with pytest.raises(ValueError, match="expected function call"):
        provider.generate_draft_package(prompt="Write", count=1)


def test_image_provider_sends_configured_payload(settings: Settings, monkeypatch) -> None:
    captured = {}
    configured = settings.model_copy(
        update={
            "media_model": "image-model",
            "media_response_format": "b64_json",
        }
    )
    provider = OpenAIImagesProvider(configured)

    def handler(request: httpx.Request) -> httpx.Response:
        captured.update(json.loads(request.content))
        return httpx.Response(200, json={"data": [{"b64_json": "cG5n", "revised_prompt": "R"}]})

    monkeypatch.setattr(
        provider,
        "_client",
        lambda: httpx.Client(
            base_url="https://images.test/v1",
            transport=httpx.MockTransport(handler),
        ),
    )

    result = provider.generate_image(prompt="A prompt", size="1024x1024")

    assert captured == {
        "model": "image-model",
        "prompt": "A prompt",
        "size": "1024x1024",
        "response_format": "b64_json",
    }
    assert result.b64_json == "cG5n"


def test_fal_provider_uses_model_specific_shape(settings: Settings, monkeypatch) -> None:
    captured = {}
    configured = settings.model_copy(
        update={"fal_key": "fal-secret", "fal_model": "fal-ai/nano-banana-2"}
    )
    original_client = httpx.Client

    def handler(request: httpx.Request) -> httpx.Response:
        captured.update(json.loads(request.content))
        return httpx.Response(200, json={"images": [{"url": "https://image", "width": 1024}]})

    monkeypatch.setattr(
        "rebel_forge_backend.providers.media.fal_ai.httpx.Client",
        lambda *args, **kwargs: original_client(transport=httpx.MockTransport(handler)),
    )

    result = FalAIProvider(configured).generate_image(prompt="Banana", size="1280x720")

    assert captured["aspect_ratio"] == "16:9"
    assert captured["resolution"] == "1K"
    assert "image_size" not in captured
    assert result.image_url == "https://image"


def test_comfyui_uses_configured_url_and_workflow(settings: Settings) -> None:
    configured = settings.model_copy(update={"comfyui_base_url": "https://comfy.example/custom/"})
    provider = ComfyUIProvider(configured)
    workflow = _load_workflow("A lighthouse", 1280, 720, settings=configured)

    assert provider.base_url == "https://comfy.example/custom"
    assert provider.ws_url == "wss://comfy.example/custom"
    assert workflow["76"]["inputs"]["value"] == "A lighthouse"
    assert workflow["75:68"]["inputs"]["value"] == 1280
    assert workflow["75:69"]["inputs"]["value"] == 720


def test_cloud_storage_uploads_to_expected_r2_key(settings: Settings, monkeypatch) -> None:
    calls = {}

    class FakeS3:
        def upload_fileobj(self, stream, bucket, key, ExtraArgs):
            calls.update(
                data=stream.read(),
                bucket=bucket,
                key=key,
                content_type=ExtraArgs["ContentType"],
            )

    monkeypatch.setattr(
        "rebel_forge_backend.services.cloud_storage.boto3.client",
        lambda *args, **kwargs: FakeS3(),
    )
    configured = settings.model_copy(
        update={
            "r2_bucket_name": "bucket",
            "r2_public_url": "https://cdn.example",
            "r2_endpoint_url": "https://r2.example",
        }
    )

    url = CloudStorage(configured).upload_bytes(b"image", "test.png")

    assert calls == {
        "data": b"image",
        "bucket": "bucket",
        "key": "assets/test.png",
        "content_type": "image/png",
    }
    assert url == "https://cdn.example/assets/test.png"


def test_llm_fallback_does_not_claim_missing_codex(
    db: Session,
    settings: Settings,
    monkeypatch,
) -> None:
    monkeypatch.setattr(httpx, "get", lambda *args, **kwargs: (_ for _ in ()).throw(OSError()))
    monkeypatch.setattr("rebel_forge_backend.services.llm_config.shutil.which", lambda _name: None)

    config = get_active_llm(db, settings)

    assert config.provider == "vllm"
    assert config.base_url == settings.llm_base_url


def test_llm_fallback_uses_installed_codex(db: Session, settings: Settings, monkeypatch) -> None:
    monkeypatch.setattr(httpx, "get", lambda *args, **kwargs: (_ for _ in ()).throw(OSError()))
    monkeypatch.setattr(
        "rebel_forge_backend.services.llm_config.shutil.which",
        lambda _name: "/usr/bin/codex",
    )

    assert get_active_llm(db, settings).provider == "codex"


def test_x_formatter_honors_platform_character_limit() -> None:
    publisher = XPublisher("key", "secret", "token", "token-secret")

    with pytest.raises(ValueError, match="maximum is 280"):
        publisher.format_draft_as_tweet("x" * 300, ["one", "two"])


def test_x_publish_permalink_is_not_hardcoded_to_an_account(monkeypatch) -> None:
    monkeypatch.setattr(
        "rebel_forge_backend.providers.publishers.x_twitter.httpx.post",
        lambda *args, **kwargs: httpx.Response(201, json={"data": {"id": "12345"}}),
    )
    publisher = XPublisher("key", "secret", "token", "token-secret")

    result = publisher.publish_text("Hello")

    assert result.success is True
    assert result.url == "https://x.com/i/web/status/12345"


def test_instagram_publish_accepts_asset_with_public_url_only(
    db: Session,
    workspace,
    settings: Settings,
    monkeypatch,
) -> None:
    from rebel_forge_backend.api.routes.publish import _publish_to_instagram
    from rebel_forge_backend.db.models import Asset, AssetStatus, ContentDraft, DraftStatus
    from rebel_forge_backend.providers.publishers.instagram import PublishResult

    draft = ContentDraft(
        workspace_id=workspace.id,
        platform="instagram",
        status=DraftStatus.APPROVED,
        concept="Visual",
        caption="Caption",
        hook="Hook",
        cta="CTA",
        hashtags=[],
        alt_text="Alt",
        metadata_json={},
    )
    db.add(draft)
    db.flush()
    db.add(
        Asset(
            workspace_id=workspace.id,
            draft_id=draft.id,
            provider="fal_ai",
            status=AssetStatus.READY,
            prompt="Visual",
            public_url="https://cdn.example/image.png",
            external_url=None,
            metadata_json={},
        )
    )
    db.commit()
    captured = {}

    def publish_image(self, image_url, caption):
        captured.update(image_url=image_url, caption=caption)
        return PublishResult(success=True, platform_post_id="ig-1", url="https://instagram/p/ig-1")

    monkeypatch.setattr(
        "rebel_forge_backend.providers.publishers.instagram.InstagramPublisher.publish_image_post",
        publish_image,
    )
    configured = settings.model_copy(
        update={"instagram_access_token": "token", "instagram_user_id": "user"}
    )

    result = _publish_to_instagram(draft, configured, db)

    assert result.success is True
    assert captured["image_url"] == "https://cdn.example/image.png"
