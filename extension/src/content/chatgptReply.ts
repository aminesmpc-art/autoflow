/* ============================================================
   Turning a ChatGPT reply into a usable prompt.

   Split out of the content script so it can be tested without a DOM. The
   parsing is the fragile part: ChatGPT answers conversationally even when
   told not to, and a stray "Sure! Here's the prompt:" line gets fed straight
   into Flow as if it were part of the shot description.
   ============================================================ */

/** Lines that are ChatGPT talking to the user rather than the answer itself. */
const PREAMBLE = /^(sure|certainly|absolutely|of course|here(?:'s| is)|got it|okay|ok)\b[^\n]*[:\-—]?\s*$/i;

/**
 * Strip the conversation around a reply, leaving the content.
 *
 * Order matters: fences come off first, because a preamble line sits outside
 * the fence and would otherwise be mistaken for the first line of the answer.
 */
export function cleanAssistantReply(raw: string): string {
  let text = (raw || '').replace(/\r\n/g, '\n').trim();
  if (!text) return '';

  // A reply that is entirely one code block is the common "output only the
  // prompt" shape — take what's inside and ignore everything else.
  const fenced = text.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
  if (fenced && fenced[1].trim()) {
    text = fenced[1].trim();
  } else {
    // Otherwise just remove stray fence markers so they don't reach Flow.
    text = text.replace(/^```[a-zA-Z]*\s*$/gm, '').trim();
  }

  // Drop a leading "Sure! Here's the prompt:" style line, but only when there
  // is something after it — otherwise a short valid answer would vanish.
  const lines = text.split('\n');
  while (lines.length > 1 && (PREAMBLE.test(lines[0].trim()) || !lines[0].trim())) {
    lines.shift();
  }
  text = lines.join('\n').trim();

  // Surrounding quotes are common when the answer is "one line".
  if (text.length > 1 && /^["“'].*["”']$/s.test(text)) {
    text = text.slice(1, -1).trim();
  }

  return text;
}

/**
 * Whether a reply looks finished and usable.
 *
 * Guards two real cases: a half-streamed sentence captured too early, and
 * ChatGPT refusing or asking a clarifying question instead of answering.
 */
export function looksLikeUsablePrompt(text: string): boolean {
  const t = (text || '').trim();
  if (t.length < 20) return false;
  // A reply that is only a question is ChatGPT asking, not answering.
  if (t.endsWith('?') && t.split(/[.!]/).length <= 1) return false;
  return true;
}
