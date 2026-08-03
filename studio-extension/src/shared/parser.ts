/* ============================================================
   AutoFlow – Prompt Parser Utility
   Split by blank lines, trim, ignore empties.
   ============================================================ */

export interface ParsedPromptNode {
  text: string;
  isExtension: boolean;
  baseIndex: number;
}

/**
 * Parse a multiline text block into an array of structured prompt nodes.
 * Prompts are separated by one or more blank lines.
 * Bracketed blocks `[ ]` group prompts into an extension chain.
 */
export function parsePrompts(raw: string): ParsedPromptNode[] {
  if (!raw || !raw.trim()) return [];
  
  const blocks = raw.split(/\n\s*\n+/).map(b => b.trim()).filter(b => b.length > 0);
  const results: ParsedPromptNode[] = [];
  for (let i = 0; i < blocks.length; i++) {
    results.push({
      text: blocks[i],
      isExtension: false,
      baseIndex: i
    });
  }
  
  return results;
}

/**
 * Validate parsed prompts. Returns error string or null.
 */
export function validatePrompts(prompts: ParsedPromptNode[]): string | null {
  if (prompts.length === 0) {
    return 'No prompts found. Enter at least one prompt.';
  }
  for (let i = 0; i < prompts.length; i++) {
    if (prompts[i].text.length > 20000) {
      return `Prompt #${i + 1} exceeds 20,000 characters.`;
    }
  }
  return null;
}
