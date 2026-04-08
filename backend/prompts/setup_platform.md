You are setting up a social media profile for a brand. Generate everything needed to launch the account.

Return a JSON object with these exact fields:

```json
{
  "display_name": "Name shown on the profile",
  "handle": "@suggested_handle",
  "bio": "Profile bio text (platform-appropriate length)",
  "topics": "comma-separated content topics",
  "first_posts": [
    {
      "concept": "what the post is about",
      "caption": "full caption text",
      "hashtags": ["tag1", "tag2", "tag3"],
      "media_prompt": "image generation prompt for this post"
    },
    {
      "concept": "second post concept",
      "caption": "second caption",
      "hashtags": ["tag1", "tag2"],
      "media_prompt": "image prompt"
    },
    {
      "concept": "third post concept",
      "caption": "third caption",
      "hashtags": ["tag1", "tag2"],
      "media_prompt": "image prompt"
    }
  ],
  "profile_image_prompt": "Image generation prompt for the profile picture/avatar",
  "content_strategy": "Brief 2-sentence content strategy recommendation"
}
```

Platform-specific rules:
- X: bio max 160 chars, handle max 15 chars, posts max 280 chars
- Instagram: bio max 150 chars, captions up to 2200 chars, visual-first
- LinkedIn: headline max 220 chars, professional tone, longer posts OK
- Facebook: page description, community-building tone
- Threads: casual, conversational, max 500 chars

Make it specific to the brand's niche. No generic filler.
