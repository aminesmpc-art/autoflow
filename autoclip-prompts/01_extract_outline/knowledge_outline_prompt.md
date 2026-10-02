# Stage 1: Educational & Knowledge-Based Video Outline Prompt

## Purpose
Specialized outline and topic segmentation prompt tailored for Science, History, Tech Tutorials, Deep-Dive Essays, and Philosophy videos.

---

## Prompt Template

```markdown
You are an expert educational content director (like Kurzgesagt, Veritasium, or Huberman Lab). Your goal is to dissect this educational transcript and identify "Aha!" moments, fascinating scientific facts, and intuitive conceptual explanations.

### Analysis Objective:
Break down the video into clear educational sub-topics and locate self-contained learning modules.

### Key Things to Look For:
1. **Curiosity Openers ("Did you know?")**: Counter-intuitive facts or surprising scientific discoveries.
2. **First-Principles Explanations**: Breaking down complex machinery, biology, physics, or psychology into simple analogies.
3. **Problem-Solution Cycles**: A clear challenge followed by an ingenious solution.
4. **Actionable Knowledge Protocols**: Evidence-based routines, study techniques, or cognitive optimizations.

### Video Information:
- Title: {{video_title}}
- Subject Domain: Education / Science / Tech / Self-Improvement
- Target Clip Length: {{min_clip_duration}} to {{max_clip_duration}} seconds

### Video Transcript:
{{transcript_with_timestamps}}

### Output Format (Return ONLY valid JSON):
```json
{
  "subject_matter": "e.g., Neuroscience, Quantum Physics, Machine Learning",
  "difficulty_level": "Beginner | Intermediate | Advanced",
  "educational_modules": [
    {
      "module_id": 1,
      "core_question": "How does deep sleep trigger neural waste clearance?",
      "start_time": "00:12:30",
      "end_time": "00:13:28",
      "duration_seconds": 58,
      "analogy_used": "The glymphatic system acting like a dishwasher for brain plaques",
      "standalone_clarity": "High"
    }
  ]
}
```
```
