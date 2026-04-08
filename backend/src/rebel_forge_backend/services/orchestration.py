import logging

from sqlalchemy.orm import Session

from rebel_forge_backend.core.config import Settings

logger = logging.getLogger("rebel_forge_backend.orchestration")
from rebel_forge_backend.db.models import Asset, AssetStatus, ContentDraft, DraftStatus, Job, JobType, Workspace
from rebel_forge_backend.providers.registry import build_llm_provider, build_media_provider
from rebel_forge_backend.schemas.drafts import DraftGenerationRequest, DraftPackageItem
from rebel_forge_backend.schemas.media import MediaGenerationRequest
from rebel_forge_backend.services.events import record_event
from rebel_forge_backend.services.storage import LocalAssetStorage


def _detect_media_provider(settings) -> str | None:
    """Detect available media provider: comfyui > fal_ai > None."""
    try:
        import httpx as _hx
        _r = _hx.get(f"{settings.comfyui_base_url}/", timeout=3.0)
        if _r.status_code == 200:
            return "comfyui"
    except Exception:
        pass
    if settings.fal_key:
        return "fal_ai"
    return None


class JobOrchestrator:
    def __init__(self, settings: Settings, *, db: Session | None = None) -> None:
        self.settings = settings
        # Resolve active LLM provider from DB if possible
        llm_overrides = {}
        if db:
            try:
                from rebel_forge_backend.services.llm_config import get_active_llm
                llm = get_active_llm(db, settings)
                llm_overrides = {"base_url": llm.base_url, "api_key": llm.api_key, "model": llm.model, "provider": llm.provider}
            except Exception:
                pass
        self.llm_provider = build_llm_provider(settings, **llm_overrides)
        self.media_provider = build_media_provider(settings)
        self.asset_storage = LocalAssetStorage(settings)

    def process(self, db: Session, job: Job) -> dict:
        if job.job_type == JobType.DRAFT_GENERATION:
            return self._process_draft_generation(db, job)
        if job.job_type == JobType.MEDIA_GENERATION:
            return self._process_media_generation(db, job)
        raise ValueError(f"Unsupported job type: {job.job_type}")

    def _process_draft_generation(self, db: Session, job: Job) -> dict:
        request = DraftGenerationRequest.model_validate(job.input_payload)
        workspace = db.get(Workspace, job.workspace_id)
        if workspace is None or workspace.brand_profile is None:
            raise ValueError("Workspace or brand profile not found for draft generation.")

        # Build unified context for draft generation — filtered to target platform
        from rebel_forge_backend.services.context_builder import build_context, get_mode_description
        unified_context = build_context(
            db=db, settings=self.settings, mode="draft_generation",
            mode_description=get_mode_description("draft_generation"),
            platform=request.platform,
        )

        prompt = self._build_draft_prompt(
            workspace_name=workspace.name,
            voice_summary=workspace.brand_profile.voice_summary,
            audience_summary=workspace.brand_profile.audience_summary,
            goals=workspace.brand_profile.goals,
            style_notes=workspace.brand_profile.style_notes,
            reference_examples=workspace.brand_profile.reference_examples,
            request=request,
            corrections=unified_context,
        )
        submission = self.llm_provider.generate_draft_package(prompt=prompt, count=request.count)

        draft_ids: list[str] = []
        media_job_ids: list[str] = []
        for draft in submission.drafts:
            draft_record = self._create_draft_record(db, job=job, request=request, draft=draft)
            draft_ids.append(str(draft_record.id))
            record_event(
                db,
                workspace_id=job.workspace_id,
                entity_type="content_draft",
                entity_id=draft_record.id,
                event_type="draft.generated",
                payload={"platform": draft_record.platform, "job_id": str(job.id)},
            )

            # Queue image generation based on generate_image flag
            gen_img = job.input_payload.get("generate_image")
            should_gen_image = gen_img if gen_img is not None else bool(draft_record.media_prompt)
            if should_gen_image:
                img_prompt = draft_record.media_prompt or f"Social media image for: {draft_record.concept[:200]}"
                media_provider = _detect_media_provider(self.settings)
                if media_provider:
                    from rebel_forge_backend.services.jobs import JobService as _JS
                    media_job = _JS().enqueue_job(
                        db,
                        workspace_id=job.workspace_id,
                        job_type=JobType.MEDIA_GENERATION,
                        input_payload={
                            "prompt": img_prompt,
                            "size": "1024x1024",
                            "draft_id": str(draft_record.id),
                            "provider": media_provider,
                        },
                    )
                    media_job_ids.append(str(media_job.id))

        # Auto-approve if requested
        auto_approve = request.auto_approve or request.auto_publish
        auto_publish = request.auto_publish
        approved_ids: list[str] = []
        published_ids: list[str] = []
        publish_errors: list[dict] = []

        if auto_approve:
            for did in draft_ids:
                from uuid import UUID as _UUID
                draft_obj = db.get(ContentDraft, _UUID(did))
                if draft_obj and draft_obj.status == DraftStatus.DRAFT:
                    draft_obj.status = DraftStatus.APPROVED
                    db.flush()
                    approved_ids.append(did)
                    record_event(db, workspace_id=job.workspace_id, entity_type="content_draft", entity_id=draft_obj.id, event_type="draft.approved", payload={"auto": True})

        if auto_publish:
            for did in approved_ids:
                from uuid import UUID as _UUID
                draft_obj = db.get(ContentDraft, _UUID(did))
                if not draft_obj:
                    continue
                # Skip Instagram auto-publish — image generation is async and may not be ready yet
                if draft_obj.platform.lower() == "instagram":
                    publish_errors.append({"draft_id": did, "error": "Instagram auto-publish skipped — image may still be generating. Publish manually after image is ready."})
                    continue
                try:
                    from rebel_forge_backend.api.routes.publish import PUBLISHERS
                    publish_fn = PUBLISHERS.get(draft_obj.platform.lower())
                    if publish_fn:
                        pub_result = publish_fn(draft_obj, self.settings, db)
                        if pub_result.success:
                            draft_obj.status = DraftStatus.PUBLISHED
                            db.flush()
                            published_ids.append(did)
                            record_event(db, workspace_id=job.workspace_id, entity_type="content_draft", entity_id=draft_obj.id, event_type="draft.published", payload={"auto": True, "url": pub_result.url})
                        else:
                            publish_errors.append({"draft_id": did, "error": pub_result.error})
                    else:
                        publish_errors.append({"draft_id": did, "error": f"No publisher for {draft_obj.platform}"})
                except Exception as e:
                    publish_errors.append({"draft_id": did, "error": str(e)})

        return {
            "draft_ids": draft_ids,
            "media_job_ids": media_job_ids,
            "count": len(draft_ids),
            "approved_ids": approved_ids,
            "published_ids": published_ids,
            "publish_errors": publish_errors,
        }

    def _process_media_generation(self, db: Session, job: Job) -> dict:
        request = MediaGenerationRequest.model_validate(job.input_payload)
        provider = job.input_payload.get("provider", "")

        # Use ComfyUI if specified
        if provider == "comfyui":
            from rebel_forge_backend.providers.media.comfyui import ComfyUIProvider
            comfy = ComfyUIProvider()
            result = comfy.generate_image(prompt=request.prompt)

            if not result.success:
                raise RuntimeError(f"ComfyUI generation failed: {result.error}")

            # Upload to R2 for public access (needed for Instagram)
            public_url = result.image_url  # fallback to local ComfyUI URL
            try:
                from rebel_forge_backend.services.cloud_storage import CloudStorage
                if self.settings.r2_endpoint_url and self.settings.r2_public_url:
                    cloud = CloudStorage(self.settings)
                    filename = result.local_path or f"{job.id}.png"
                    public_url = cloud.upload_image_from_url(result.image_url, filename)
                    logger.info("[media] Uploaded to R2: %s", public_url)
            except Exception as e:
                logger.warning("[media] R2 upload failed, using local URL: %s", e)

            asset = Asset(
                workspace_id=job.workspace_id,
                job_id=job.id,
                draft_id=request.draft_id,
                provider="comfyui",
                status=AssetStatus.READY,
                prompt=request.prompt,
                external_url=public_url,
                public_url=public_url,
                metadata_json={"local_path": result.local_path, "comfyui_url": result.image_url, "r2_url": public_url},
            )
            db.add(asset)
            db.flush()

            record_event(
                db,
                workspace_id=job.workspace_id,
                entity_type="asset",
                entity_id=asset.id,
                event_type="asset.generated",
                payload={"draft_id": str(request.draft_id) if request.draft_id else None, "provider": "comfyui"},
            )
            return {
                "asset_id": str(asset.id),
                "image_url": result.image_url,
            }

        # fal.ai provider
        if provider == "fal_ai":
            from rebel_forge_backend.providers.media.fal_ai import FalAIProvider
            fal = FalAIProvider(self.settings)
            result = fal.generate_image(prompt=request.prompt, size=request.size)

            asset = Asset(
                workspace_id=job.workspace_id,
                job_id=job.id,
                draft_id=request.draft_id,
                provider="fal_ai",
                status=AssetStatus.READY,
                prompt=request.prompt,
                external_url=result.image_url,
                public_url=result.image_url,
                metadata_json={"fal_url": result.image_url, "width": result.width, "height": result.height, "model": self.settings.fal_model},
            )
            db.add(asset)
            db.flush()

            record_event(
                db,
                workspace_id=job.workspace_id,
                entity_type="asset",
                entity_id=asset.id,
                event_type="asset.generated",
                payload={"draft_id": str(request.draft_id) if request.draft_id else None, "provider": "fal_ai"},
            )
            return {"asset_id": str(asset.id), "image_url": result.image_url}

        # Fallback to original media provider
        generated = self.media_provider.generate_image(prompt=request.prompt, size=request.size)
        asset = Asset(
            workspace_id=job.workspace_id,
            job_id=job.id,
            draft_id=request.draft_id,
            provider=self.settings.media_provider,
            status=AssetStatus.PENDING,
            prompt=request.prompt,
            metadata_json={"size": request.size, "revised_prompt": generated.revised_prompt},
        )
        db.add(asset)
        db.flush()

        if generated.b64_json:
            stored = self.asset_storage.store_png_base64(
                workspace_id=job.workspace_id, image_b64=generated.b64_json
            )
            asset.storage_path = stored.storage_path
            asset.public_url = stored.public_url
            asset.status = AssetStatus.READY
        elif generated.external_url:
            asset.external_url = generated.external_url
            asset.status = AssetStatus.READY
        else:
            raise ValueError("Media provider returned neither b64 image data nor an external URL.")

        record_event(
            db,
            workspace_id=job.workspace_id,
            entity_type="asset",
            entity_id=asset.id,
            event_type="asset.generated",
            payload={"draft_id": str(request.draft_id) if request.draft_id else None},
        )
        return {
            "asset_id": str(asset.id),
            "public_url": asset.public_url,
            "external_url": asset.external_url,
        }

    @staticmethod
    def _create_draft_record(
        db: Session,
        *,
        job: Job,
        request: DraftGenerationRequest,
        draft: DraftPackageItem,
    ) -> ContentDraft:
        record = ContentDraft(
            workspace_id=job.workspace_id,
            job_id=job.id,
            platform=draft.platform,
            concept=draft.concept,
            brief=request.brief,
            caption=draft.caption,
            hook=draft.hook,
            cta=draft.cta,
            hashtags=draft.hashtags,
            alt_text=draft.alt_text,
            media_prompt=draft.media_prompt,
            script=draft.script,
            metadata_json={
                "objective": request.objective,
                "context_notes": request.context_notes,
            },
        )
        db.add(record)
        db.flush()
        return record

    @staticmethod
    def _build_draft_prompt(
        *,
        workspace_name: str,
        voice_summary: str | None,
        audience_summary: str | None,
        goals: dict,
        style_notes: dict,
        reference_examples: list,
        request: DraftGenerationRequest,
        corrections: str = "",
    ) -> str:
        return f"""
You are generating production-usable {request.platform} content drafts for a single client workspace.

Important rules:
- Call the tool exactly once.
- Return exactly {request.count} draft objects.
- Keep the drafts distinct from one another.
- Make the drafts practical for a real {request.platform} content calendar.
- Match the brand voice and audience described below.
- Hashtags must be concise and relevant to {request.platform}.
- media_prompt controls image generation. Include it ONLY when an image is needed:
  - Instagram: ALWAYS include media_prompt (images are required).
  - Other platforms (X, LinkedIn, Facebook, Threads): ONLY include media_prompt if the user explicitly asked for an image. For text-only posts, set media_prompt to null.

Workspace:
- name: {workspace_name}
- voice summary: {voice_summary or "not set"}
- audience summary: {audience_summary or "not set"}
- goals: {goals}
- style notes: {style_notes}
- reference examples: {reference_examples}

Request:
- platform: {request.platform}
- objective: {request.objective}
- count: {request.count}
- brief: {request.brief or "none"}
- context notes: {request.context_notes or "none"}

Each draft should include:
- platform
- concept
- caption
- hook
- cta
- hashtags
- alt_text
- media_prompt (only if image is needed, null otherwise)
- optional script

{corrections}
""".strip()

