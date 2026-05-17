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
  
  const results: ParsedPromptNode[] = [];
  const regex = /\[([^\]]*)\]|([^\[\]]+)/gs;
  let match;
  
  while ((match = regex.exec(raw)) !== null) {
    if (match[1] !== undefined) {
      // Bracket block: split by blank lines into steps of the chain
      const innerBlocks = match[1].split(/\n\s*\n+/).map(l => l.trim()).filter(l => l.length > 0);
      if (innerBlocks.length > 0) {
        const baseIndex = results.length;
        results.push({ text: innerBlocks[0], isExtension: false, baseIndex });
        for (let i = 1; i < innerBlocks.length; i++) {
          results.push({ text: innerBlocks[i], isExtension: true, baseIndex });
        }
      }
    } else if (match[2] !== undefined) {
      // Non-bracket block: split by blank lines into individual base prompts
      const blocks = match[2].split(/\n\s*\n+/).map(b => b.trim()).filter(b => b.length > 0);
      for (const block of blocks) {
        results.push({ text: block, isExtension: false, baseIndex: results.length });
      }
    }
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
