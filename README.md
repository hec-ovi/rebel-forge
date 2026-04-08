<h1 align="center">Rebel Forge</h1>

<p align="center">
  <strong>The AI agent that runs your social media. Not a dashboard. An autonomous system.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Status-Demo-blue" alt="Status" />
  <img src="https://img.shields.io/badge/Platforms-5-brightgreen" alt="Platforms" />
  <img src="https://img.shields.io/badge/Tools-11-orange" alt="Tools" />
  <img src="https://img.shields.io/badge/Endpoints-65+-purple" alt="Endpoints" />
  <img src="https://img.shields.io/badge/License-Contact-red" alt="License" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/FastAPI-Backend-009688?logo=fastapi" alt="FastAPI" />
  <img src="https://img.shields.io/badge/Next.js_16-Frontend-000?logo=nextdotjs" alt="Next.js" />
  <img src="https://img.shields.io/badge/PostgreSQL-Database-336791?logo=postgresql" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/vLLM-Local_Inference-FF6F00" alt="vLLM" />
  <img src="https://img.shields.io/badge/Codex_CLI-OpenAI-412991?logo=openai" alt="Codex" />
  <img src="https://img.shields.io/badge/fal.ai-Cloud_Images-000" alt="fal.ai" />
</p>

<p align="center">
  <em>Built in 2 weeks by one engineer with Claude Code + Codex CLI.<br/>For the production version, <a href="https://linkedin.com/in/hec-ovi">contact me</a>.</em>
</p>

<p align="center">
  <a href="https://www.youtube.com/watch?v=AVQRFr58sTI">
    <img src="https://img.shields.io/badge/Watch_Demo-YouTube-FF0000?logo=youtube&logoColor=white&style=for-the-badge" alt="Watch Demo on YouTube" />
  </a>
</p>

---

## One Prompt. Multiple Platforms. The Agent Handles Everything.

Say _"search for AI trends, then make a post for X, LinkedIn, and Threads"_ and the agent:

1. **Searches the web** for current trends
2. **Recalls your X training** (style guide + corrections + writing patterns)
3. **Generates an X draft**
4. **Recalls your LinkedIn training**
5. **Generates a LinkedIn draft**
6. **Generates a Threads draft**
7. **Responds** (with a summary, if applies)

**One message. Six tool calls. Three platform-specific drafts. All in your trained voice.**

<p align="center">
  <img src="gif/rebel-chat.gif" alt="Rebel Chat — Agentic Tool Chaining" width="700" />
</p>

---

## Why This Exists

Social media tools charge $48-399/mo for calendars and stateless GPT wrappers. They forget everything between sessions.

| Tool | Monthly Cost | Memory? | Self-Hosted? | Autonomous? |
|------|-------------|---------|-------------|-------------|
| Hootsuite | $199-399/user | No | No | No |
| Sprout Social | $199-399/seat | No | No | No |
| Later | $18-82 | No | No | No |
| Rella | $24-48 | Basic | No | No |
| **Rebel Forge** | **$0** | **Per-platform voice memory** | **Yes** | **Yes** |

---

## Agentic Tool Loop

The agent chains tools autonomously. Up to 8 steps per turn. It decides what to call, in what order, and when to stop.

| Tool | Purpose |
|------|---------|
| `recall_training` | Load platform-specific voice, corrections, and style before generating |
| `generate_drafts` | Create drafts with auto-approve and auto-publish flags |
| `web_search` | Search the web for trends, news, context |
| `generate_image` | Generate images via fal.ai or ComfyUI |
| `publish_draft` | Publish to any platform (platform-matched draft selection) |
| `approve_draft` | Approve content for publishing |
| `run_heartbeat` | Trigger full Scout > Analyst > Creator cycle |
| `update_brand` | Update voice, audience, goals |
| `setup_platform` | Generate bio, handle, starter posts |
| `query_drafts` | Query your drafts database |
| `save_onboarding` | Save brand profile from onboarding |

Real chains observed in production:

```
web_search > generate_drafts                                    (2 tools)
recall_training > generate_drafts                               (2 tools)
recall_training > web_search > generate_drafts                  (3 tools)
web_search > generate_drafts > recall_training > generate_drafts (4 tools)
```

### Tools & Error Recovery

The agent is resilient to mid-chain failures. If any step fails (API timeout, provider error, rate limit), the agent re-spins the failed step and continues from where it left off. No manual intervention, no lost progress — the chain completes even when a middle step is interrupted.

<p align="center">
  <img src="gif/tools.gif" alt="Agentic Tool Loop — Tools & Error Recovery" width="700" />
</p>

---

## Per-Platform Voice Training

The agent doesn't just remember your brand. It remembers **how you sound on each platform**.

**General Voice** sets the baseline ("No fluff. Write like a builder."). **Per-platform styles** override it ("X: max 2 sentences. LinkedIn: 5 paragraphs with a question."). The agent recalls the right combination before every generation.

| Layer | What It Does | Stored In |
|-------|-------------|-----------|
| General Voice | Base rules for all platforms | `platform_styles` (platform=general) |
| Platform Style Guide | Per-platform tone override | `platform_styles` per platform |
| User Corrections | Original vs. edited samples with ratings | `corrections` table |
| Style Learning | Patterns from your real published posts | Learned from fetched post data |

**Same prompt, different platform, different output.** The X draft is 84 characters. The LinkedIn draft is 730.

### Style Learning

Fetch your real posts from any connected platform. Sort by engagement, views, likes, or date. Hit "Learn Style" and the agent absorbs your actual writing patterns — per platform.

The agent uses this when `recall_training` fires: your corrections, your style guide, and your real writing patterns all load before content generation.

<p align="center">
  <img src="gif/training.gif" alt="Training — Per-Platform Voice Learning" width="700" />
</p>

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   REBEL FORGE                       │
├──────────┬──────────────┬──────────────┬────────────┤
│ Frontend │   Backend    │   Worker     │  Database  │
│ Next.js  │   FastAPI    │  Heartbeat   │ PostgreSQL │
│  :3000   │    :8080     │  + Jobs      │   :5432    │
└──────────┴──────┬───────┴─────┬────────┴────────────┘
                  │             │
         ┌────────┴────────┐    │
         │  LLM Provider   │    │
         │  (hot-swap)     │    │
         ├─────────────────┤    │
         │ vLLM (local)    │    │
         │ Codex CLI       │    │
         │ OpenRouter      │    │
         └─────────────────┘    │
                           ┌────┴─────────────┐
                           │ Image Provider   │
                           │ (auto-fallback)  │
                           ├──────────────────┤
                           │ ComfyUI (local)  │
                           │ fal.ai (cloud)   │
                           └──────────────────┘
```

LLM and image providers are **hot-swappable from settings**. ComfyUI down? fal.ai takes over automatically.

### Local Infrastructure

Both providers run on local hardware — no cloud bills, no rate limits, no data leaving your machine.

| Service | Repo | What It Does |
|---------|------|-------------|
| ![vLLM](https://img.shields.io/badge/vLLM-Local_LLM-FF6F00) | [hec-ovi/vllm-gpt](https://github.com/hec-ovi/vllm-gpt) | GPT-OSS 20B/120B on AMD Strix Halo via ROCm — OpenAI-compatible `/v1/responses` |
| ![ComfyUI](https://img.shields.io/badge/ComfyUI-Local_Images-9B59B6) | [hec-ovi/comfyui-strix-docker](https://github.com/hec-ovi/comfyui-strix-docker) | FLUX / Stable Diffusion on AMD RDNA 3.5 — verified ROCm Docker setup |

---

## Publishing

Live, tested, working. The agent publishes from chat with one command.

| Platform | Text | Images | Auto-publish | Live |
|----------|------|--------|-------------|------|
| ![X](https://img.shields.io/badge/X-000?logo=x&logoColor=white) | yes | -- | yes | yes |
| ![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?logo=linkedin&logoColor=white) | yes | -- | yes | yes |
| ![Facebook](https://img.shields.io/badge/Facebook-1877F2?logo=facebook&logoColor=white) | yes | -- | yes | yes |
| ![Instagram](https://img.shields.io/badge/Instagram-E4405F?logo=instagram&logoColor=white) | yes | yes | yes | yes |
| ![Threads](https://img.shields.io/badge/Threads-000?logo=threads&logoColor=white) | yes | -- | yes | yes |

---

## Content Management

Masonry layout. Platform icons. Status colors. Inline editing with character limits (280 for X). Approve > Publish workflow with edit-reverts-to-draft safety. Published posts show live permalinks.

<p align="center">
  <img src="gif/content.gif" alt="Content — Masonry Grid" width="700" />
</p>

---

## Heartbeat

Three agents on an autonomous loop:

```
Scout    → web search for trends
Analyst  → reviews past performance
Creator  → drafts content in your trained voice
```

Runs on a configurable interval. You approve or let it auto-publish.

---

## API

**65+ endpoints.** Full OpenAPI docs at `localhost:8080/docs`.

```
POST /v1/chat                           — Agentic chat with 11 tools + multi-step tool loop
POST /v1/drafts/generate                — Generate platform-specific content
POST /v1/drafts/{id}/publish            — Publish (platform-matched draft selection)
POST /v1/training/feedback              — Submit voice corrections with rating
PUT  /v1/training/platform-styles/{p}   — Set general or per-platform style guides
GET  /v1/fetch-posts/{platform}         — Fetch your posts with engagement metrics
POST /v1/training/style-learn           — Learn voice patterns from real posts
GET  /v1/training/style-learn/{p}       — Get learned style data for a platform
POST /v1/heartbeat/trigger              — Trigger autonomous agent cycle
```

---

## Tech

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.12+-3776AB?logo=python&logoColor=white" />
  <img src="https://img.shields.io/badge/TypeScript-5+-3178C6?logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white" />
  <img src="https://img.shields.io/badge/Next.js-16-000?logo=nextdotjs&logoColor=white" />
  <img src="https://img.shields.io/badge/Tailwind-v4-06B6D4?logo=tailwindcss&logoColor=white" />
  <img src="https://img.shields.io/badge/PostgreSQL-17-336791?logo=postgresql&logoColor=white" />
  <img src="https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white" />
</p>

---

## Demo

> **This project is at ~60% toward production.** What you see here already works — agentic tool chains, per-platform voice memory, five-platform publishing, error recovery, local inference. Built in 2 weeks by one engineer.
>
> Looking for someone who builds complex agentic systems, autonomous tooling, and production AI pipelines? That's what I do.
>
> **[hec-ovi.dev](https://hec-ovi.dev)** | **[linkedin.com/in/hec-ovi](https://linkedin.com/in/hec-ovi)**

---

<p align="center">
  <strong>Built by <a href="https://linkedin.com/in/hec-ovi">Hector Oviedo</a></strong><br/>
  <em>Engineered with AI.</em>
</p>
