# Stage 3: Multi-Platform Optimized Title & Metadata Prompt

## Purpose
Customizes video titles, hashtags, and metadata specifically formatted for TikTok, YouTube Shorts, Instagram Reels, and X/LinkedIn.

---

## Platform Algorithms & Formatting Rules

| Platform | Best Title Style | Emoji Usage | Ideal Caption Length |
| :--- | :--- | :--- | :--- |
| **TikTok** | Raw, informal, text-message style, conversational | 🔥 💀 😭 😳 | Short (1-2 sentences) + 4-5 trending tags |
| **YouTube Shorts** | High-contrast, bold claims, question format | 🚨 ⚡ 🤯 📈 | Medium + 3 hashtags in title (#Shorts) |
| **Instagram Reels** | Aesthetic, inspirational, clean typography | ✨ 💡 🎯 | Long-form captions with storytelling / saves |
| **LinkedIn / X** | Business takeaway, numbered framework | 📌 🧵 | Professional hook + clear lesson + engagement question |

---

## Prompt Template

```markdown
You are a multi-platform distribution director. Format this video clip's title and metadata for all major platforms.

### Clip Transcript:
{{clip_transcript}}

### Output Format (Return ONLY valid JSON):
```json
{
  "tiktok": {
    "title": "i still can’t believe he said this out loud 💀",
    "caption": "tell me i’m not the only one who thinks this is wild #fyp #trending #podcast",
    "sound_recommendation": "Trending ambient suspense audio"
  },
  "youtube_shorts": {
    "title": "The $1,000,000 Mistake You're Making Daily 💸 #Shorts",
    "description": "Watch until the end to see the full breakdown. Subscribe for daily business breakdowns.",
    "tags": ["shorts", "business", "startups", "finance"]
  },
  "instagram_reels": {
    "title": "A harsh reminder for anyone building a career in 2026 ✨",
    "caption": "Save this reel for when you need a reminder. Which point resonated most with you? Let us know in the comments below 💬",
    "cover_frame_timestamp": "00:00:02"
  },
  "linkedin": {
    "title": "The 1 skill that separated senior engineers from directors in our team:",
    "post_body": "Most people think technical competence is what gets you promoted. Here is the reality:\n\n1. Communication velocity\n2. Alignment over perfection\n3. Owning business outcomes\n\nFull thoughts in the clip below."
  }
}
```
```
