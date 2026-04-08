# Rebel Forge Backend Scope

Last updated: 2026-03-17

This file is the current source of truth for backend scope. If the product grows, we extend this file instead of improvising architecture in code.

## Product Boundary

- We are building for one logical client only.
- That client can be a creator, a personal brand, a restaurant, or any other brand account.
- For backend purposes, those are the same thing: one workspace with one brand context and one set of connected channels.
- We are not building multi-user, multi-client, or agency support right now.

## Core Goal

Build a backend that can become the production system later without forcing a rewrite of the core architecture.

That means:

- local-first and low-cost now
- simple enough to ship in small slices
- clean boundaries so future auth, billing, and multi-tenant support can be added without replacing the foundation

## Locked Architecture Decisions

### 1. Backend shape

- Use a Python modular monolith.
- Primary framework: FastAPI.
- API style for now: REST only.
- Real-time UX can use polling first. WebSockets are deferred.

### 2. Inference boundary

- The sibling `vllm-gpt` project is the inference layer.
- It is not the memory layer, job layer, or orchestration layer.
- The backend owns:
  - prompt assembly
  - tool definitions
  - tool execution
  - retries
  - persistence
  - session state
  - policy and validation

### 3. Database

- Use Postgres from day one.
- `pgvector` is allowed later, but vector search is not required for phase 1.
- Even though we support only one logical client now, core domain tables should still carry a `workspace_id`.
- This keeps the schema expandable later without redesigning every table.

### 4. Background work

- Do not rely on FastAPI `BackgroundTasks` for LLM runs, media generation, social publishing, or analytics sync.
- Use a separate worker process from the same codebase.
- Job state should live in Postgres.
- Start with a DB-backed job queue pattern.
- Redis is optional later, not required for the first version.

### 5. Storage

- Assets must go through a storage adapter interface.
- Development can use local disk storage.
- The interface must be compatible with future S3/R2/MinIO style object storage.
- Do not hardwire business logic directly to filesystem paths.

### 6. Media generation

- Media generation is in scope.
- Use local providers only for now.
- First media provider: local ComfyUI through an internal adapter.
- The backend should request generation through provider interfaces, not by scattering raw ComfyUI calls across the codebase.

### 7. Social publishing

- Use a publisher adapter pattern.
- First target platform: Instagram.
- If Instagram direct publish is not ready in the first slice, return publish-ready export payloads instead of inventing fake backend abstractions.
- Threads can be added later, but it is not the first product priority.

### 8. Workflow/orchestration

- Do not build visible multi-agent theater in phase 1.
- Internally, use a deterministic application flow with optional LLM tool use.
- One orchestrator is enough.
- We can split behavior into services/modules without pretending they are independent agents.

### 9. n8n

- n8n is not the core product backend.
- It may be used later for internal ops glue, alerts, or side automations.
- Product logic, persistence, publishing, and approvals stay in the Python backend.

## Phase 1 Scope

These are the first backend capabilities that should survive into the final product:

1. Workspace and brand context
- One workspace record
- Brand profile
- Goals
- Audience notes
- Tone/style constraints
- Reference examples

2. Draft generation
- Generate a single post package
- Minimum package:
  - caption
  - hook
  - CTA
  - hashtags
  - alt text
  - media prompt
  - optional script

3. Week planning
- Generate 5 to 7 draft items for a week
- Store them as calendar drafts
- Support statuses such as:
  - draft
  - reviewed
  - approved
  - scheduled
  - published
  - failed

4. Media generation adapter
- Accept a media generation request
- Send it to local ComfyUI
- Store resulting asset metadata
- Return an asset reference and preview URL

5. Publish pipeline
- Approve one draft
- Produce a publish job
- Publish to Instagram when the integration is ready
- If not ready yet, still preserve the publish job model and export payload shape

6. Basic analytics sync
- Track posts published by this backend
- Pull basic metrics only for those posts
- Save snapshots over time

7. Audit/event history
- Record important state transitions
- Example:
  - draft generated
  - asset requested
  - asset completed
  - post approved
  - publish attempted
  - publish succeeded
  - metrics synced

## Explicitly Out Of Scope For Now

- multi-client support
- multiple internal users
- role-based auth
- billing
- team collaboration
- no-login approval links
- WebSockets
- heavy trend crawling
- full competitor intelligence
- PDF reporting
- Google Calendar sync
- Canva integration
- TikTok integration
- YouTube integration
- X integration
- LinkedIn integration
- Pinterest integration
- full autonomous daily loops running everywhere
- agency-oriented project management features

## Future-Safe Design Rules

These rules exist to avoid refactors later:

### Rule 1

Every business record belongs to a `workspace_id`, even if there is only one workspace for now.

### Rule 2

External systems must be wrapped behind adapters:

- `InferenceProvider`
- `MediaProvider`
- `Publisher`
- `AssetStorage`

### Rule 3

Prompt templates, tool schemas, and orchestration logic must live in backend modules, not in route handlers.

### Rule 4

Async work must be resumable and inspectable through persisted job records.

### Rule 5

Every publish attempt and analytics sync must be traceable through event records.

### Rule 6

Do not use the vLLM response store as durable memory.

### Rule 7

Do not couple domain logic to one provider's payload shape.

### Rule 8

No feature should require a distributed system before the product has traffic that justifies it.

## Minimal Domain Model

The first schema should be small but durable:

- `workspaces`
- `brand_profiles`
- `content_drafts`
- `calendar_entries`
- `assets`
- `media_jobs`
- `publish_accounts`
- `publish_jobs`
- `published_posts`
- `metric_snapshots`
- `events`

This can evolve, but these concepts should stay recognizable.

## Recommended Initial Build Order

1. App skeleton
- FastAPI app
- Postgres models
- migrations
- health endpoint

2. Core domain
- workspace
- brand profile
- drafts
- calendar entries

3. Inference integration
- `vllm-gpt` client
- prompt assembly
- content generation service

4. Job system
- persisted jobs
- worker process
- job polling endpoint

5. Media adapter
- ComfyUI provider
- asset persistence

6. Instagram publisher
- account connection model
- publish job
- status sync

7. Basic analytics
- post metrics snapshots

## Current Product Interpretation

The backend is a single-tenant social content operating system:

- it remembers a brand
- plans content
- generates drafts
- can generate media through local tools
- publishes to at least one platform
- records outcomes
- improves later with better memory and more integrations

It is not a full Rella clone in phase 1.

## Research Notes That Affect Scope

- FastAPI itself recommends bigger tools than `BackgroundTasks` for heavy background computation when work does not need to stay in the same process.
- n8n queue mode requires Redis and does not support filesystem binary storage in queue mode.
- Meta's official Instagram and Threads docs support programmatic publishing, but Instagram is the more relevant first product target.
- TikTok direct posting exists, but its policy constraints make it a worse first integration.
- Postgres plus `pgvector` gives us a credible future path for embeddings without forcing a separate vector database now.

## Change Policy

If a future task conflicts with this file:

- update this file first
- then implement the code

Do not silently drift the architecture.
