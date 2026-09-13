# Stage 2: Entertainment & Podcast Highlight Scoring Prompt

## Purpose
Specialized scoring matrix prioritizing emotional spikes, comedic timing, dramatic stakes, and meme potential.

---

## Entertainment Scoring Weights
1. **Emotional Amplitude / Energy Peak (35 pts)**: Level of laughter, shock, heated drama, or raw emotion.
2. **Setup to Punchline Delivery (30 pts)**: Timing, rhythm, delivery, and narrative payoff.
3. **Meme / Reaction Potential (20 pts)**: Quotable one-liners, facial expressions, soundbite value.
4. **Shareability to Group Chats (15 pts)**: "You HAVE to see this" factor.

---

## Prompt Template

```markdown
You are a viral comedy and podcast highlight strategist. Score this entertainment segment for viral clipping potential.

### Segment Transcript:
{{candidate_transcript}}

### Evaluation Metrics:
- **Emotional Peak & Energy (0-35)**
- **Punchline & Payoff (0-30)**
- **Meme / Soundbite Potential (0-20)**
- **Group Chat Share Factor (0-15)**

### Output Format (Return ONLY valid JSON):
```json
{
  "energy_score": 34,
  "punchline_score": 29,
  "meme_score": 19,
  "share_factor_score": 14,
  "total_score": 96,
  "dominant_emotion": "Hilarious / Shocking / Heated / Heartwarming",
  "viral_soundbite": "The single most quotable line from the clip.",
  "recommended_action": "KEEP | DISCARD | TRIM"
}
```
```
