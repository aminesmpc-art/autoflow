# Stage 2: Universal Multi-Factor Highlight Scoring Prompt

## Purpose
Evaluates candidate segments on a 0–100 scale using a rigorous 4-pillar retention and viral algorithm formula.

---

## Scoring Formula Breakdown (100 Points Total)

| Pillar | Weight | Evaluation Criteria |
| :--- | :--- | :--- |
| **1. Hook Strength (0–30 pts)** | 30% | Does the first 3 seconds immediately trigger curiosity, surprise, or an unresolved question? |
| **2. Core Content Density (0–40 pts)** | 40% | Is there sustained value, high emotional resonance, a breakthrough idea, or a hilarious punchline with no wasted filler? |
| **3. Standalone Completeness (0–20 pts)** | 20% | Does the clip tell a self-contained micro-story without requiring prior or subsequent context? |
| **4. Viral Shareability (0–10 pts)** | 10% | Would a viewer share this with a friend, comment their opinion, or save it for later reference? |

---

## Prompt Template

```markdown
You are a Lead Content Scoring Algorithm at a top short-form video studio. Evaluate the provided video segment and calculate its exact Highlight Score based on viral potential and retention heuristics.

### Candidate Segment Information:
- Video Title: {{video_title}}
- Video Category: {{video_category}}
- Candidate Start Time: {{start_time}}
- Candidate End Time: {{end_time}}
- Total Duration: {{duration_seconds}}s

### Transcript of Candidate Segment:
{{candidate_transcript}}

### Evaluation Steps:
1. **Hook Analysis (0-30 pts)**: Grade the opening sentence. Is it compelling or boring?
2. **Value & Density Analysis (0-40 pts)**: Assess the core meat of the speech.
3. **Standalone Integrity (0-20 pts)**: Verify start/end resolution.
4. **Shareability (0-10 pts)**: Rate the likelihood of comments and shares.
5. Compute `final_score = hook_score + value_score + standalone_score + shareability_score`.
6. Only recommend clips with `final_score >= {{min_score_threshold}}`.

### Output Format (Return ONLY valid JSON):
```json
{
  "start_time": "{{start_time}}",
  "end_time": "{{end_time}}",
  "duration_seconds": {{duration_seconds}},
  "hook_score": 28,
  "value_score": 38,
  "standalone_score": 18,
  "shareability_score": 9,
  "final_score": 93,
  "is_recommended": true,
  "scoring_rationale": "Starts immediately with a shocking thesis, delivers 3 practical steps with zero fluff, and ends on an inspirational climax.",
  "ideal_platform": "TikTok | YouTube Shorts | Instagram Reels | All",
  "suggested_cut_adjustments": {
    "trim_start_seconds": 0,
    "trim_end_seconds": 0,
    "reason": "Exact fit."
  }
}
```
```
