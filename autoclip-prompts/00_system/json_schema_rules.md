# System Rules: JSON Schema & Anti-Hallucination Constraints

## 1. Zero Hallucination Constraint
- Every timestamp (`start_time`, `end_time`) MUST be directly traceable to the provided transcript input.
- Do NOT generate clips with timestamps beyond the total duration of the provided transcript.
- If a section contains no highlights matching the threshold, return an empty array `[]` rather than fabricating fake highlights.

---

## 2. Standard Time Format
All timestamps in outputs must follow standard formats:
- **String Format (HH:MM:SS or MM:SS)**: e.g., `"00:02:14"` or `"02:14"`
- **Seconds (Float/Integer)**: e.g., `134.5`

---

## 3. Universal Response Schema

```json
{
  "status": "success",
  "total_clips_found": 3,
  "clips": [
    {
      "id": "clip_01",
      "start_time": "00:01:25",
      "end_time": "00:02:10",
      "duration_seconds": 45,
      "score": 92,
      "hook": "Why 99% of businesses fail in their first 6 months",
      "title": "The Brutal Truth About First-Year Startups 🚨",
      "summary": "The speaker breaks down cash flow mismanagement and explains the 3-month survival runway rule.",
      "category": "business",
      "reasoning": "Strong emotional hook in the first 4 seconds, clear standalone advice, punchy delivery."
    }
  ]
}
```

---

## 4. Output Cleansing Rules
1. Never wrap the JSON in unescaped quotes.
2. Ensure all special characters in titles and hooks (e.g., quotes, emojis, backslashes) are properly JSON-escaped.
3. Keep the JSON payload compact and strictly valid according to RFC 8259.
