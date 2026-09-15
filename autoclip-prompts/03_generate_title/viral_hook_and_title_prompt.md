# Stage 3: Viral Hook & High-CTR Title Generation Prompt

## Purpose
Generates compelling 3-second on-screen text hooks, click-through-optimized titles, and curiosity gap descriptions for a selected clip.

---

## The 5 Rules of High-CTR Titles & Hooks

1. **Curiosity Gap**: Reveal just enough to spark intrigue, but withhold the resolution (e.g., "The mistake that cost $400k in 1 hour" instead of "How we made a coding bug").
2. **First 3 Seconds Text Overlay**: Keep on-screen hook text under 7 words so it can be read in 1.5 seconds.
3. **Pattern Interrupt**: Use strong contrast or counter-intuitive statements ("Stop doing X if you want Y").
4. **Emotional Power Words**: Words like *Brutal, Secret, Never, Exact, Banned, Truth*.
5. **No False Clickbait**: The video clip must deliver on the promised payoff.

---

## Prompt Template

```markdown
You are a master viral copywriter and short-form video strategist. Generate high-CTR titles, caption copy, and on-screen hook overlays for the following video clip.

### Clip Context:
- Category: {{video_category}}
- Duration: {{duration_seconds}}s
- Original Video Title: {{video_title}}

### Clip Transcript:
{{clip_transcript}}

### Task:
Generate 3 distinct title styles, 3 on-screen hook variants, and a social media caption with hashtags.

### Output Format (Return ONLY valid JSON):
```json
{
  "titles": {
    "curiosity_gap": "The Unspoken Rule Nobody Tells You in Tech 🤫",
    "contrarian_shock": "Why Working Hard is Keeping You Broke 🛑",
    "actionable_how_to": "How to 10x Your Focus in 30 Seconds ⚡"
  },
  "on_screen_hooks": [
    "This 1 habit changes everything...",
    "Wait until you hear the last part 🤯",
    "Why 99% of people fail at this"
  ],
  "caption": "The hardest part about building a business isn't starting—it's this one mistake. Drop your thoughts below 👇",
  "hashtags": [
    "#entrepreneurship",
    "#productivity",
    "#mindset",
    "#businessgrowth"
  ],
  "stickers_and_broll_suggestions": [
    "Red highlight over key metric at 00:15",
    "Zoom-in cut at punchline at 00:32"
  ]
}
```
```
