# Stage 2: Business & Finance Highlight Scoring Prompt

## Purpose
Specialized scoring matrix emphasizing ROI, practical entrepreneurial takeaways, market insights, and thought leadership.

---

## Business Scoring Weights
1. **Credibility & Authority (25 pts)**: Proven results, empirical proof, real metrics.
2. **Actionable ROI (35 pts)**: A framework or system the viewer can apply today.
3. **Counterintuitive Hook (25 pts)**: Debunking common business myths or traditional advice.
4. **Discussion & Debate Trigger (15 pts)**: Sparks healthy discussion around strategies and ethics in the comments.

---

## Prompt Template

```markdown
You are an executive content editor for business and tech thought leaders. Score this business segment for short-form video viability.

### Segment Transcript:
{{candidate_transcript}}

### Evaluation Metrics:
- **Authority & Proof (0-25)**
- **Actionable Takeaway (0-35)**
- **Hook & Pattern Interrupt (0-25)**
- **Discussion Factor (0-15)**

### Output Format (Return ONLY valid JSON):
```json
{
  "authority_score": 23,
  "actionability_score": 32,
  "hook_score": 24,
  "discussion_score": 13,
  "total_score": 92,
  "business_niche": "Marketing / AI / Startups / Personal Finance",
  "primary_takeaway": "The one-sentence core lesson of this clip.",
  "target_audience": "Founders, Marketers, Developers, Investors",
  "recommended_action": "KEEP | DISCARD | TRIM"
}
```
```
