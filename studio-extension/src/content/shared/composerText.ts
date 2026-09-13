/* ============================================================
   Typing into a composer that nobody is looking at

   `document.execCommand('insertText', …)` is how every rich composer here
   is filled, and it is the one step that genuinely needs the DOCUMENT to
   have focus — not merely to be visible. In a background tab it is a silent
   no-op: no error, no exception, nothing inserted. The adapter then reads
   the composer back, finds it empty, and reports that it could not type.

   Reported from a real background run: "Gemini not working in the
   background until I click on the page of it." Clicking gives the document
   focus back, and the very next attempt works — which is the whole
   diagnosis in one sentence.

   Visibility was never the problem. Reading the DOM while hidden is fine,
   which is why steps 2-4 worked; WRITING through execCommand is not.

   ── The fallback ────────────────────────────────────────────────────────

   A dispatched ClipboardEvent does not need focus. Quill, ProseMirror and
   Lexical — which is all of these composers — implement paste, because
   pasting is how people put text into them. The Gemini adapter already
   relies on exactly this to attach reference images, so the technique is
   proven in this codebase rather than assumed.

   execCommand is still tried first: it is the path these adapters have
   always used and the one the sites are known to accept. The paste only
   runs when the text did not land, which visible is never.
   ============================================================ */

/** How much of the text has to be present to call the insert successful.
    Proportional, with no ceiling: a fixed floor passes a 27-character
    placeholder for a 200-character prompt. */
function landed(el: HTMLElement, text: string): boolean {
  const got = (el.innerText || el.textContent || '').trim();
  return got.length >= Math.max(4, Math.floor(text.trim().length * 0.6));
}

/** Put `text` into a contenteditable, with or without document focus. */
export function insertIntoEditable(el: HTMLElement, text: string): boolean {
  el.focus();

  /* 1. The proven path. Needs document focus, so it does nothing at all in a
        background tab — silently, which is what made this hard to see. */
  try {
    const sel = window.getSelection();
    sel?.selectAllChildren(el);
    document.execCommand('insertText', false, text);
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true, data: text, inputType: 'insertText',
    }));
  } catch { /* fall through to the paste */ }

  if (landed(el, text)) return true;

  /* 2. A synthetic paste. Dispatching an event needs no focus, and every
        editor here handles paste because that is how text arrives in them. */
  try {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true, cancelable: true, clipboardData: dt,
    }));
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true, data: text, inputType: 'insertFromPaste',
    }));
  } catch { /* fall through to the last resort */ }

  if (landed(el, text)) return true;

  /* 3. Last resort: write it in and say so.
        Quill re-renders from its own model and drops a bare textContent on
        the next keystroke — but a composer that is submitted immediately
        often survives it, and an empty send is certain to fail. */
  try {
    el.textContent = text;
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true, data: text, inputType: 'insertText',
    }));
  } catch { /* nothing left to try */ }

  return landed(el, text);
}
