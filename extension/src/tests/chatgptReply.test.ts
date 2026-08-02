/* Parsing a ChatGPT reply into a prompt.

   ChatGPT answers conversationally even when told not to, and whatever slips
   through goes straight into Flow as if it were part of the shot description.
*/
import { cleanAssistantReply, looksLikeUsablePrompt } from '../content/chatgptReply';

describe('cleanAssistantReply', () => {
  it('drops a leading "Sure! Here is..." line', () => {
    const raw = "Sure! Here's the prompt:\nA lion carved from white foam on a workbench.";
    expect(cleanAssistantReply(raw)).toBe('A lion carved from white foam on a workbench.');
  });

  it('takes the contents of a fenced block', () => {
    const raw = 'Here you go:\n\n```\nA calico cat asleep on old books.\n```\n\nLet me know if you want changes!';
    expect(cleanAssistantReply(raw)).toBe('A calico cat asleep on old books.');
  });

  it('handles a language-tagged fence', () => {
    expect(cleanAssistantReply('```text\nSlow dolly through a neon alley.\n```'))
      .toBe('Slow dolly through a neon alley.');
  });

  it('strips stray fence markers when there is no complete block', () => {
    expect(cleanAssistantReply('```\nA rooftop at dusk.')).toBe('A rooftop at dusk.');
  });

  it('unwraps a fully quoted one-liner', () => {
    expect(cleanAssistantReply('"A bulldog carved from foam."')).toBe('A bulldog carved from foam.');
    expect(cleanAssistantReply('“A bulldog carved from foam.”')).toBe('A bulldog carved from foam.');
  });

  it('keeps multi-line prompts intact', () => {
    const raw = 'Here is the prompt:\nFRAME 01 — wide shot\nFRAME 02 — close up';
    expect(cleanAssistantReply(raw)).toBe('FRAME 01 — wide shot\nFRAME 02 — close up');
  });

  it('does not eat the answer when it is a single line that looks like preamble', () => {
    // Only line present — removing it would leave nothing at all.
    expect(cleanAssistantReply('Here is a lion.')).toBe('Here is a lion.');
  });

  it('leaves a normal answer untouched', () => {
    const raw = 'A seated lion carved from white styrofoam, macro three-quarter view.';
    expect(cleanAssistantReply(raw)).toBe(raw);
  });

  it('survives empty and junk input', () => {
    expect(cleanAssistantReply('')).toBe('');
    expect(cleanAssistantReply('   \n  ')).toBe('');
    expect(cleanAssistantReply(undefined as any)).toBe('');
  });

  it('normalises CRLF', () => {
    expect(cleanAssistantReply('Sure:\r\nA fox in snow.')).toBe('A fox in snow.');
  });
});

describe('looksLikeUsablePrompt', () => {
  it('accepts a real prompt', () => {
    expect(looksLikeUsablePrompt('A seated lion carved from white styrofoam on a workbench.')).toBe(true);
  });

  it('rejects a half-streamed fragment', () => {
    expect(looksLikeUsablePrompt('A seated')).toBe(false);
  });

  it('rejects ChatGPT asking a clarifying question instead of answering', () => {
    expect(looksLikeUsablePrompt('What kind of animal would you like me to carve?')).toBe(false);
  });

  it('accepts a prompt that merely ends in a question mark', () => {
    // A full answer that happens to contain sentences plus a question.
    expect(looksLikeUsablePrompt(
      'A lion carved from foam. Warm workshop light. Should the mane be rough?'
    )).toBe(true);
  });

  it('rejects empty input', () => {
    expect(looksLikeUsablePrompt('')).toBe(false);
    expect(looksLikeUsablePrompt(undefined as any)).toBe(false);
  });
});
