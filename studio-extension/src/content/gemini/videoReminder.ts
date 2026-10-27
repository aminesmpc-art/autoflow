/**
 * Gemini's "A reminder about creating videos".
 *
 *   A reminder about creating videos
 *   Make sure you have the rights to any content you upload, and that you
 *   have permission from anyone whose voice or image you're using. Learn more
 *   about our prohibited use policy.
 *
 *                                                   [Cancel]  [Agree]
 *
 * ── What it does to a run ─────────────────────────────────────────────────
 *
 * It is raised when a message carrying a video is SENT — seen with the piece's
 * prompt already typed and its clip already attached, so the attach had
 * finished and the Send click is what brought it up. The message does not go
 * until it is answered. Nothing reported it: the adapter's three send attempts
 * (click, Enter, pointer sequence) each waited three seconds for a turn that
 * the modal was holding back, and the Director sat at "Directing piece 1 of
 * 1…" with the dialog on screen in a tab nobody was looking at.
 *
 * It is handled in its own module because the adapter runs side effects on
 * import and cannot be loaded by a test (see ./tidy.ts); this can be.
 *
 * ── How it is recognised ──────────────────────────────────────────────────
 *
 * The dialog shape was measured live for tidy.ts: Gemini's dialogs are
 * `mat-dialog-container` / `[role="dialog"]`, and their buttons are identical
 * in class and attributes, so text and DOM order are all that separate them —
 * with the confirming action LAST. The same holds here: Cancel, then Agree.
 *
 * Recognised by its own wording (English, read off the dialog), or by the
 * link it carries to the prohibited-use policy, which does not translate.
 * Anything else is left alone: a dialog that merely has a policy link and an
 * Accept button — an updated-terms notice, say — is not this one, and is not
 * the automation's to accept.
 */

import { isVisible } from '../shared/visible';

const DIALOGS = 'mat-dialog-container, [role="dialog"], [role="alertdialog"]';

/* Two phrases from the dialog, either enough. Straight or curly apostrophes
   are irrelevant — neither phrase contains one. */
const REMINDER_TEXT = /reminder about creating videos|rights to any content you upload/i;

/* "Learn more about our prohibited use policy" — a URL survives translation
   where the sentence around it does not. `use-policy` is specific to the
   prohibited-use page; the general terms live at /terms and do not match. */
const POLICY_LINK = 'a[href*="use-policy"]';

/* Exact words, not substrings: a button reading "Agree and continue" should
   still match, a translated Cancel must never. The fallback below is DOM
   order, so a language missing from these lists still works. */
const AGREE = /^(i )?(agree|accept)( and continue)?$|^(j'accepte|accepter|aceptar|acepto|akzeptieren|zustimmen|accetto|accetta|aceitar|concordo|akkoord|kabul et|принять|согласен|同意|동의|موافق)$/i;
const CANCEL = /^(cancel|not now|annuler|cancelar|abbrechen|annulla|annuleren|iptal|отмена|取消|キャンセル|취소|إلغاء)$/i;

export type ReminderChoice = 'agree' | 'cancel';

const label = (b: HTMLElement): string => (b.textContent || '').replace(/\s+/g, ' ').trim();

/** The reminder, if it is on screen. Never any other dialog. */
export function videoReminder(doc: Document = document): HTMLElement | null {
  for (const dialog of doc.querySelectorAll<HTMLElement>(DIALOGS)) {
    if (dialog.getAttribute('aria-hidden') === 'true' || !isVisible(dialog)) continue;
    if (REMINDER_TEXT.test(dialog.textContent || '') || dialog.querySelector(POLICY_LINK)) return dialog;
  }
  return null;
}

/**
 * The button for a choice, inside a dialog already known to be the reminder.
 *
 * Agree: by its word, else the last labelled button that is not a Cancel —
 * the confirming action comes last in Gemini's dialogs. Cancel: by its word,
 * else the first. Icon-only buttons are skipped either way; they have no word
 * to check and are never the choice being made.
 */
export function reminderButton(dialog: HTMLElement, choice: ReminderChoice): HTMLElement | null {
  const buttons = Array.from(dialog.querySelectorAll<HTMLElement>('button, [role="button"]'))
    .filter((b) => label(b) && isVisible(b));
  if (choice === 'cancel') {
    return buttons.find((b) => CANCEL.test(label(b))) || buttons[0] || null;
  }
  return buttons.find((b) => AGREE.test(label(b)))
    || [...buttons].reverse().find((b) => !CANCEL.test(label(b)))
    || null;
}

/**
 * Answer the reminder if it is up. Says whether it was, and never throws —
 * a dialog that cannot be answered is a stuck turn the caller reports, not a
 * crash in the middle of a send.
 */
export function answerVideoReminder(choice: ReminderChoice, doc: Document = document): boolean {
  try {
    const dialog = videoReminder(doc);
    if (!dialog) return false;
    const button = reminderButton(dialog, choice);
    if (!button) return false;
    /* A plain click — the same one tidy.ts uses on Gemini's confirm dialog,
       where it is proven to work. */
    button.click();
    return true;
  } catch {
    return false;
  }
}
