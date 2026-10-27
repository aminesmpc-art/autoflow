/**
 * @jest-environment jsdom
 */

/**
 * Gemini's "A reminder about creating videos".
 *
 * Raised when a message carrying a video is sent, and the message is held
 * until it is answered. The Director sat at "Directing piece 1 of 1…" with the
 * dialog up in a tab nobody was watching: each of the adapter's three send
 * attempts waited its three seconds behind the modal, and the next fired
 * underneath it.
 *
 * The dialog markup below follows what tidy.ts measured on Gemini's live
 * dialogs — mat-dialog-container, plain buttons identical in class, the
 * confirming action last — with the wording from the dialog itself.
 */

/// <reference types="node" />

import { readFileSync } from 'fs';
import { join } from 'path';

import { videoReminder, reminderButton, answerVideoReminder } from '../content/gemini/videoReminder';

const REMINDER = `
  <mat-dialog-container role="dialog">
    <h2>A reminder about creating videos</h2>
    <p>Make sure you have the rights to any content you upload, and that you have
       permission from anyone whose voice or image you’re using.
       <a href="https://policies.google.com/terms/generative-ai/use-policy">Learn more</a>
       about our prohibited use policy.</p>
    <button>Cancel</button><button>Agree</button>
  </mat-dialog-container>`;

/** Render, give every element a real size, and record which buttons get pressed. */
function show(html: string, rect = { width: 320, height: 40 }): string[] {
  document.body.innerHTML = html;
  for (const el of Array.from(document.querySelectorAll('*'))) {
    (el as any).getBoundingClientRect = () => ({ ...rect, left: 0, top: 0, right: rect.width, bottom: rect.height });
  }
  const pressed: string[] = [];
  for (const b of Array.from(document.querySelectorAll('button'))) {
    b.addEventListener('click', () => pressed.push((b.textContent || '').trim() || '(icon)'));
  }
  return pressed;
}

afterEach(() => {
  document.body.innerHTML = '';
  delete (document as any).hidden;
});

describe('answering the reminder', () => {
  it('agrees, and only agrees', () => {
    const pressed = show(REMINDER);
    expect(answerVideoReminder('agree')).toBe(true);
    expect(pressed).toEqual(['Agree']);
  });

  it('cancels when asked to — for a reminder left over from an earlier send', () => {
    /* Agreeing to a stale one would send that old message and double the turn. */
    const pressed = show(REMINDER);
    expect(answerVideoReminder('cancel')).toBe(true);
    expect(pressed).toEqual(['Cancel']);
  });

  it('says so when there is nothing to answer', () => {
    show('<main><rich-textarea></rich-textarea></main>');
    expect(answerVideoReminder('agree')).toBe(false);
  });
});

describe('recognising it, and nothing else', () => {
  it('never touches the delete confirmation, which has the same shape', () => {
    /* tidy.ts opens this one. Two plain buttons, the action last — the exact
       shape the DOM-order fallback would press. Pressing its last button
       deletes a conversation. */
    const pressed = show(`
      <mat-dialog-container role="dialog">
        <h2>Delete chat?</h2><p>You'll no longer see this chat here.</p>
        <button>Cancel</button><button>Delete</button>
      </mat-dialog-container>`);
    expect(videoReminder()).toBeNull();
    expect(answerVideoReminder('agree')).toBe(false);
    expect(answerVideoReminder('cancel')).toBe(false);
    expect(pressed).toEqual([]);
  });

  it('leaves an updated-terms notice alone, policy link and all', () => {
    /* Accepting terms nobody read is not the automation's to do. The general
       terms live at /terms; only the prohibited-use page matches. */
    const pressed = show(`
      <mat-dialog-container role="dialog">
        <h2>We've updated our terms</h2>
        <p>Read the <a href="https://policies.google.com/terms">Terms of Service</a>.</p>
        <button>Not now</button><button>Accept</button>
      </mat-dialog-container>`);
    expect(answerVideoReminder('agree')).toBe(false);
    expect(pressed).toEqual([]);
  });

  it('recognises a translated reminder by its policy link, and agrees by position', () => {
    /* Polish is in neither word list: this is the DOM-order fallback, which
       rests on the live measurement that the confirming action comes last. */
    const pressed = show(`
      <mat-dialog-container role="dialog">
        <h2>Przypomnienie o tworzeniu filmów</h2>
        <p>Upewnij się, że masz prawa… <a href="https://policies.google.com/terms/generative-ai/use-policy">Więcej</a></p>
        <button>Anuluj</button><button>Zgadzam się</button>
      </mat-dialog-container>`);
    expect(answerVideoReminder('agree')).toBe(true);
    expect(pressed).toEqual(['Zgadzam się']);
  });

  it('never agrees with a Cancel, even one that comes last', () => {
    const dialog = (show(`
      <mat-dialog-container role="dialog">
        <p>A reminder about creating videos</p>
        <button>Agree</button><button>Cancel</button>
      </mat-dialog-container>`), document.querySelector('mat-dialog-container') as HTMLElement);
    expect(reminderButton(dialog, 'agree')?.textContent).toBe('Agree');
  });

  it('skips an icon-only close button when falling back on position', () => {
    const pressed = show(`
      <mat-dialog-container role="dialog">
        <p><a href="https://policies.google.com/terms/generative-ai/use-policy">x</a></p>
        <button>Anuluj</button><button>Zgadzam się</button><button aria-label="Close"><svg></svg></button>
      </mat-dialog-container>`);
    answerVideoReminder('agree');
    expect(pressed).toEqual(['Zgadzam się']);
  });

  it('ignores a reminder that is closed but still in the DOM', () => {
    const pressed = show(REMINDER);
    document.querySelector('mat-dialog-container')!.setAttribute('aria-hidden', 'true');
    expect(answerVideoReminder('agree')).toBe(false);
    expect(pressed).toEqual([]);
  });

  it('still finds it in a background tab, where everything measures 0×0', () => {
    /* Motion runs Gemini in a tab nobody is looking at. Chrome computes no
       layout there, and a size check would call the dialog invisible — the
       bug ../shared/visible.ts was written to end. */
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    const pressed = show(REMINDER, { width: 0, height: 0 });
    expect(answerVideoReminder('agree')).toBe(true);
    expect(pressed).toEqual(['Agree']);
  });
});

describe('the adapter answers it where it can appear', () => {
  const SRC = readFileSync(join(__dirname, '..', 'content', 'gemini', 'index.ts'), 'utf8');

  it('agrees during the send, and gives the send fresh time', () => {
    const start = SRC.indexOf('const accepted = async');
    const fn = SRC.slice(start, SRC.indexOf('\n  };', start));
    expect(fn).toMatch(/answerVideoReminder\('agree'\)/);
    /* Agreeing is what sends, so the wait restarts rather than running on the
       scraps of a three-second window — and it stays a COUNT of polls, which
       a throttled background tab stretches, rather than a clock it would cut. */
    expect(fn).toMatch(/polls = i \+ 1 \+ 40/);
    expect(fn).not.toMatch(/Date\.now\(\)/);
  });

  it('agrees during the attach, and counts the route as taken', () => {
    const start = SRC.indexOf('async function attachReferences');
    const fn = SRC.slice(start, SRC.indexOf('\n}\n', start));
    const probe = fn.slice(fn.indexOf('], () => {'), fn.indexOf('ROUTE_BUDGET_MS);'));
    expect(probe).toMatch(/answerVideoReminder\('agree'\)[\s\S]*return true;/);
  });

  it('cancels a leftover one before a turn starts — never agrees to it', () => {
    const start = SRC.indexOf('async function handleExecute');
    const head = SRC.slice(start, SRC.indexOf('await waitForNoDialog();', start));
    expect(head).toMatch(/answerVideoReminder\('cancel'\)/);
    expect(head).not.toMatch(/answerVideoReminder\('agree'\)/);
  });
});
