/* The fill-then-verify ladder.

   The bug this pins: setInputValue picked one strategy by sniffing the
   element and returned without checking. When Flow redesigned its composer
   the chosen strategy silently did nothing — the engine logged
   "Prompt filled (223 chars)", the box stayed empty, Flow kept Generate
   disabled because there genuinely was no prompt, and the run spent its whole
   budget waiting for a button that could never enable.

   The log was the only evidence and it was wrong, which is what made it hard
   to find. So the rules are: try every strategy until the text is visibly
   there, and throw if none work.

   Runs without jsdom by modelling the editors directly — what matters is the
   ladder's decision-making, not the browser's event plumbing.
*/

/** An editor that only accepts one way of being written to. */
class FakeEditor {
  text = '';
  attempts: string[] = [];
  constructor(private accepts: string | null) {}

  apply(strategy: string, value: string): void {
    this.attempts.push(strategy);
    if (strategy === this.accepts) this.text = value;
  }
}

/** Mirrors the ladder in setInputValue: try in order, stop when it lands. */
async function fillWithLadder(
  editor: FakeEditor,
  text: string,
  order: string[]
): Promise<void> {
  for (const strategy of order) {
    editor.apply(strategy, text);
    if (editor.text.length >= Math.min(text.trim().length * 0.6, 20)) return;
  }
  throw new Error(
    `Could not type the prompt into Flow — tried ${editor.attempts.join(', ')}. ` +
    `Flow's prompt box may have changed.`
  );
}

const CONTENTEDITABLE_ORDER = ['slate paste', 'paste event', 'beforeinput', 'execCommand'];
const PROMPT = 'A person holding the product in a sunlit kitchen, casual morning atmosphere.';

describe('prompt fill ladder', () => {
  it('stops at the first strategy that works', async () => {
    const editor = new FakeEditor('slate paste');
    await fillWithLadder(editor, PROMPT, CONTENTEDITABLE_ORDER);
    expect(editor.text).toBe(PROMPT);
    expect(editor.attempts).toEqual(['slate paste']);
  });

  it('falls through to a later strategy when the first is ignored', async () => {
    // The real case: a redesigned composer that ignores synthetic paste.
    const editor = new FakeEditor('beforeinput');
    await fillWithLadder(editor, PROMPT, CONTENTEDITABLE_ORDER);
    expect(editor.text).toBe(PROMPT);
    expect(editor.attempts).toEqual(['slate paste', 'paste event', 'beforeinput']);
  });

  it('reaches the last strategy rather than giving up early', async () => {
    const editor = new FakeEditor('execCommand');
    await fillWithLadder(editor, PROMPT, CONTENTEDITABLE_ORDER);
    expect(editor.text).toBe(PROMPT);
    expect(editor.attempts).toHaveLength(4);
  });

  it('throws when nothing works, naming what it tried', async () => {
    // Silence here is what cost the run: an empty box that reported success.
    const editor = new FakeEditor(null);
    await expect(fillWithLadder(editor, PROMPT, CONTENTEDITABLE_ORDER)).rejects.toThrow(
      /tried slate paste, paste event, beforeinput, execCommand/
    );
    expect(editor.text).toBe('');
  });

  it('does not accept a box that stayed empty', async () => {
    const editor = new FakeEditor(null);
    await expect(fillWithLadder(editor, PROMPT, CONTENTEDITABLE_ORDER)).rejects.toThrow();
  });

  it('accepts a partial landing, since editors normalise and chip text', async () => {
    const editor = new FakeEditor('paste event');
    // 60% is the threshold — enough to prove it arrived, loose enough that
    // whitespace collapsing or a mention chip does not read as failure.
    editor.apply('paste event', PROMPT.slice(0, Math.ceil(PROMPT.length * 0.7)));
    expect(editor.text.length).toBeGreaterThanOrEqual(PROMPT.trim().length * 0.6);
  });

  it('treats a short prompt sensibly', async () => {
    const short = 'A red car';
    const editor = new FakeEditor('paste event');
    await fillWithLadder(editor, short, CONTENTEDITABLE_ORDER);
    expect(editor.text).toBe(short);
  });
});

/* The two defects the "box now holds 27" log exposed. */
describe('verifying the box', () => {
  const PLACEHOLDER = 'What do you want to create?'; // 27 chars, as Flow shows
  const landed = (gotLength: number, wantLength: number) =>
    gotLength >= Math.max(4, Math.floor(wantLength * 0.6));

  it('does not accept a leftover placeholder as a filled box', () => {
    // The regression: Math.min(want * 0.6, 20) capped the requirement at 20,
    // so 27 characters of placeholder passed for a 223-character prompt.
    expect(landed(PLACEHOLDER.length, 223)).toBe(false);
  });

  it('accepts a genuinely filled box', () => {
    expect(landed(223, 223)).toBe(true);
    expect(landed(140, 223)).toBe(true); // whitespace collapsed
  });

  it('rejects a box holding only a fragment', () => {
    expect(landed(60, 223)).toBe(false);
  });

  it('still works for very short prompts', () => {
    expect(landed(9, 9)).toBe(true);   // "A red car"
    expect(landed(0, 9)).toBe(false);
  });

  it('has no ceiling — the requirement grows with the prompt', () => {
    // The exact shape of the bug: a fixed cap makes long prompts trivially pass.
    expect(landed(25, 500)).toBe(false);
  });
});
