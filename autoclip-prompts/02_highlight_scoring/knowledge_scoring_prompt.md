# Stage 2: Educational & Knowledge Highlight Scoring Prompt

## Purpose
Specialized scoring matrix prioritizing clarity, fascination, "mind-blown" factors, and educational retention.

---

## Educational Scoring Weights
1. **Fascination / Mind-Blown Factor (35 pts)**: How surprising or mind-expanding is this concept?
2. **Conceptual Clarity & Metaphor (30 pts)**: Is the explanation so crystal-clear that anyone can grasp it?
3. **Pacing & Engagement (20 pts)**: Does it sustain curiosity throughout without dry academic jargon?
4. **Save & Reference Potential (15 pts)**: Will viewers bookmark this video to re-watch or study?

---

## Prompt Template

```markdown
You are a lead educational content reviewer. Score the provided educational transcript snippet for short-form video engagement and viral learning potential.

### Segment Transcript:
{{candidate_transcript}}

### Evaluation Metrics:
- **Mind-Blown Factor (0-35)**
- **Clarity & Analogy (0-30)**
- **Pacing & Story (0-20)**
- **Save Rate Potential (0-15)**

### Output Format (Return ONLY valid JSON):
```json
{
  "mind_blown_score": 33,
  "clarity_score": 28,
  "pacing_score": 18,
  "save_rate_score": 14,
  "total_score": 93,
  "complexity_level": "Simple | Moderate | Complex",
  "key_metaphor": "The exact mental model or analogy used in the clip.",
  "educational_takeaway": "What new understanding the viewer walks away with.",
  "recommended_action": "KEEP | DISCARD | TRIM"
}
```
```
