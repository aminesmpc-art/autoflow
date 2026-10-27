/** Editable starters, never submitted automatically. */
export const ASK_STARTERS = [
  { label: 'Ideas', prompt: 'Suggest 5 distinct short-video ideas for the topic below or in the connected input. Give each a hook and a simple visual concept. Keep my audience and style in mind.\n\nTopic: ' },
  { label: 'Script', prompt: 'Write a short-video script for the topic below or in the connected input. Include an opening hook, visual beats and natural voiceover. Keep it concise and avoid unsupported claims.\n\nTopic: ' },
  { label: 'Improve', prompt: 'Improve the text or generation prompt below or in the connected input. Make it clearer and more specific without changing my intent, facts or voice. Return only the improved version.\n\nText: ' },
] as const;
