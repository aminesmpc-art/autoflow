# Stage 4: Thematic Compilation & Collection Clustering Prompt

## Purpose
Takes all generated standalone micro-clips from a long video and intelligently groups them into 3–5 minute themed compilations (e.g., "Top 5 Mistakes", "Best Unhinged Moments", "The Ultimate AI Guide").

---

## Prompt Template

```markdown
You are a video compiler and content packager. Analyze the list of standalone clips extracted from a long-form video and group them into cohesive, high-retention thematic compilation videos.

### Input Clips List:
{{clips_json_array}}

### Grouping Rules:
1. **Thematic Coherence**: Each compilation must have a clear, unifying theme.
2. **Target Total Duration**: Each compilation should total between 3 minutes (180s) and 7 minutes (420s).
3. **Pacing Flow**: Order clips strategically:
   - Clip #1: The strongest hook / most exciting moment to grab attention.
   - Middle Clips: High-value insights or funny moments.
   - Final Clip: Emotional climax or strongest takeaway.
4. Provide a seamless transition script or on-screen title card for between clips.

### Output Format (Return ONLY valid JSON):
```json
{
  "compilations": [
    {
      "compilation_id": "comp_01",
      "theme_title": "Top 3 Things Killing Your Productivity in 2026 🔥",
      "total_duration_seconds": 210,
      "clips_order": [
        {
          "order": 1,
          "clip_id": "clip_03",
          "role": "Opening Hook",
          "title_card": "Mistake #1: Multitasking Fallacy"
        },
        {
          "order": 2,
          "clip_id": "clip_01",
          "role": "Core Insight",
          "title_card": "Mistake #2: The Dopamine Loop"
        },
        {
          "order": 3,
          "clip_id": "clip_07",
          "role": "Climax & Solution",
          "title_card": "Mistake #3: Lack of Deep Work Blocks"
        }
      ],
      "compilation_hook": "If you feel tired by 2 PM every day, you're making at least one of these 3 critical mistakes.",
      "youtube_title": "Stop Doing This! Top 3 Daily Habits Ruining Your Focus",
      "thumbnail_text": "DON'T DO THIS!"
    }
  ]
}
```
```
