/* ============================================================
   AutoFlow – Prompt Parser Utility
   Split by blank lines, trim, ignore empties.
   ============================================================ */

/**
 * Parse a multiline text block into an array of prompt strings.
 * Prompts are separated by one or more blank lines.
 */
export function parsePrompts(raw: string): string[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(/\n\s*\n+/)        // split on blank line(s)
    .map(block => block.trim())
    .filter(block => block.length > 0);
}

/**
 * Validate parsed prompts. Returns error string or null.
 */
export function validatePrompts(prompts: string[]): string | null {
  if (prompts.length === 0) {
    return 'No prompts found. Enter at least one prompt.';
  }
  for (let i = 0; i < prompts.length; i++) {
    if (prompts[i].length > 20000) {
      return `Prompt #${i + 1} exceeds 20,000 characters.`;
    }
  }
  return null;
}
