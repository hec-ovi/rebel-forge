**Agentic AI Backend Specification**  
*(Developer view – single content creator only. No agencies, no multi-client. Focus: exactly what the backend must implement to let one creator run autonomous loops while controlling everything via frontend.)*

### What the Backend Must Do (Exact Requirements)

The backend runs the agent loop engine and stores all data for one creator. It exposes a REST + WebSocket API so the creator’s frontend (phone/web) can:

1. **Brand Voice & Persistent Memory**  
   - Store creator’s voice guidelines, tone examples, target audience, goals, and all past posts + performance history.  
   - Retrieve full context for every agent decision.  
   - Creator can update this data at any time; backend persists it forever (MySQL layer as planned).

2. **Content Calendar CRUD**  
   - Create, read, update, delete scheduled posts (with status: draft → approved → posted → analyzed).  
   - Support drag-and-drop reordering and status changes.  
   - Auto-fill gaps when creator asks the AI to “build next week’s calendar”.

3. **Agent Loop Orchestration**  
   - Run the chain: Ideation Agent → Visual Agent → Caption Agent → Analytics Agent → Posting Agent → Reporting Agent.  
   - Each agent can call the others and external tools.  
   - Creator can trigger a full loop (“plan 7 Reels”), pause at any step, or override any output.  
   - Show visible loop steps in the calendar UI (creator sees what each agent decided).

4. **Autonomous Content Generation**  
   - Generate full post package: caption + media prompt + alt text + hashtags + first comment.  
   - Repurpose one piece of content into multiple formats (Reel → carousel → static post).  
   - Creator triggers via one API call; backend returns ready-to-approve package.

5. **Scheduling & Posting**  
   - Decide best time (based on creator’s historical data).  
   - Send post to platform or hold for creator approval.  
   - Retry failed posts automatically.

6. **Analytics Pull & Optimization**  
   - Fetch performance after every post.  
   - Update future calendar automatically (more of what worked).  
   - Creator can ask “why did this post fail?” and get explanation.

7. **Task & Approval Handling**  
   - Create non-post tasks (e.g., “shoot video”).  
   - Send preview to creator for approval (simple link, no login needed).  
   - Store feedback and feed it back into next loop.

8. **Trend Research**  
   - Daily scan for platform trends relevant to creator’s niche.  
   - Suggest hooks that fit voice.

### External APIs the Backend Must Connect To (Exact 2026 Status)

These are the only integrations required. Backend implements OAuth once per platform, then calls them on behalf of the creator:

- **Instagram Graph API** (Content Publishing + Insights)  
  - Post Reels, Stories, Feed posts, carousels.  
  - Fetch reach, engagement, saves, audience data.  
  - First-comment scheduling.

- **Facebook Graph API** (same as Instagram for cross-post)  
  - Posts + Reels on Page or personal profile.

- **TikTok Content Posting API**  
  - Upload videos + photos.  
  - Fetch basic analytics.

- **YouTube Data API v3**  
  - Upload videos + Shorts.  
  - Fetch views, likes, comments.

- **LinkedIn API v2**  
  - Post to personal profile or company page.  
  - Fetch engagement metrics.

- **X API v2** (formerly Twitter)  
  - Post tweets + media.  
  - Fetch impressions + engagement.

- **Threads API** (via Instagram Graph)  
  - Post threads.

- **Pinterest API**  
  - Create pins.

- **Google Calendar API** (optional but required for sync)  
  - Align posts with creator’s real events.

- **Canva API** (media generation)  
  - Pull or create visuals.

No other APIs. Backend stores tokens securely and refreshes them automatically.

### Creator-Facing Capabilities (What One Creator Can Actually Do)

- Upload brand voice once → AI remembers forever.  
- Set one goal (“grow Reels engagement”) → AI builds entire calendar.  
- Open phone app → see calendar → tap “Generate week” → review AI proposals → approve or edit one click.  
- Approve post → it auto-posts at best time.  
- See live metrics + AI explanation on every post.  
- Ask AI questions in chat (“suggest 3 trend hooks”) → get answers that update calendar.  
- Share preview link with collaborator (no account needed) → get feedback → AI incorporates it.  
- Download branded report with one tap.

### API Endpoints Backend Must Expose (Minimal Set)

- `POST /agent/loop` – trigger full agent cycle with goal.  
- `GET /calendar` – return full visual calendar.  
- `POST /post/generate` – generate one post package.  
- `POST /post/approve` – send to platforms.  
- `GET /analytics/{postId}` – pull live data.  
- `POST /brand/update` – save voice/goals.  
- WebSocket `/loop/status` – real-time agent step updates.

This is the complete, exact list of what needs to be built. No extra fluff. Use your vLLM inference as the brain, MySQL as memory, and the APIs above as tools. Ready for frontend to consume.  

Copy-paste this into your repo. Want the exact request/response schemas next?