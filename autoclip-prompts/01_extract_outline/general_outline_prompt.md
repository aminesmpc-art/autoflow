# Stage 1: General Video Outline & Segmentation Prompt

## Purpose
Analyzes the entire raw video transcript, segments the video into distinct topical chapters, and identifies candidate boundary ranges for short-form clips.

---

## Prompt Template

```markdown
You are an expert video editor. Analyze the provided video transcript and break it down into logical topical chapters and candidate clip segments.

### Instructions:
1. Divide the transcript into continuous, non-overlapping topical chapters.
2. For each chapter:
   - Identify the main topic and core message.
   - Note the exact start time and end time based on the subtitle timestamps.
   - Identify whether this chapter contains potential standalone short-form clips (between {{min_clip_duration}}s and {{max_clip_duration}}s).
3. Ensure that segment boundaries start and end on complete sentences.

### Video Information:
- Title: {{video_title}}
- Target Clip Length: {{min_clip_duration}} to {{max_clip_duration}} seconds

### Video Transcript:
{{transcript_with_timestamps}}

### Output Format (Return ONLY valid JSON):
```json
{
  "video_summary": "High-level 2-sentence summary of the entire video.",
  "chapters": [
    {
      "chapter_id": 1,
      "topic": "Introduction & The Core Problem",
      "start_time": "00:00:00",
      "end_time": "00:03:15",
      "summary": "Brief summary of what happens in this section.",
      "has_candidate_clip": true,
      "candidate_ranges": [
        {
          "start_time": "00:00:45",
          "end_time": "00:01:35",
          "estimated_duration": 50,
          "hook_text": "The single biggest mistake creators make when launching."
        }
      ]
    }
  ]
}
```
```
