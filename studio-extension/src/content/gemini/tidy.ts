/**
 * Clearing up the Gemini thread a node used.
 *
 * Its own module rather than a section of the adapter, because this is the one
 * thing in here that destroys something. The adapter is a 1,400-line file that
 * runs top-level side effects on import and so cannot be loaded by a test; this
 * can, and the guard below — the part that decides whether a conversation is
 * ours to delete — is worth testing against a real DOM rather than asserting
 * about as source text.
 *
 * Every selector here was read off gemini.google.com, not guessed:
 *
 *   [data-test-id="conversation"]        the sidebar row (a gem-nav-list-item)
 *   a[href="/app/<id>"]                  inside it, unique per conversation
 *   [data-test-id="actions-menu-button"] its ⋮, mounted on hover
 *   [data-test-id="delete-button"]       in the menu that opens
 *
 * The confirm dialog is the exception, and the reason CONFIRMS below is a word
 * list instead of a selector: measured on the live dialog, its Cancel and
 * Delete buttons are byte-for-byte identical in class and attributes. Text and
 * DOM order are the only things that tell them apart.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Delete the thread this node just used.
 *
 * Every node starts a new chat so that Gemini answers it on its own merits,
 * which means every node also LEAVES one. A clipper running nine cuts against
 * one video ends the afternoon with a sidebar of near-identical "Speaker
 * Position JSON Detection" threads, none of which anyone will ever open —
 * a mess made by the automation, so the automation clears it.
 *
 * ── What this will not do ─────────────────────────────────────────────────
 *
 * Delete a conversation it did not create. The guard is not the title, which
 * Gemini writes itself and could match anything, and not "whatever is on
 * screen", which is only right if the run went to plan. It is the pair of
 * paths either side of the exchange:
 *
 *   before   /app          a fresh chat with nothing in it
 *   after    /app/<id>     the thread that exchange created
 *
 * Anything else — a run that began inside an existing conversation because
 * the New Chat control could not be found, an agent turn continuing a thread
 * deliberately, a path that did not change — is left alone. Losing the tidying
 * costs a stale row in a sidebar. Getting it wrong costs someone's work.
 *
 * Soft-fails throughout, and never before the answer is captured: the reply is
 * already sent by the time this runs, so a Gemini redesign that moves these
 * controls leaves untidied threads rather than a broken node.
 */

/**
 * Whether the thread this turn used is the automation's to throw away.
 *
 * Lived as an expression in the adapter until a Story node run on Gemini
 * failed in a way nothing could see. The Story loop is a CONVERSATION: it
 * writes every prompt in turn one, then comes back in turn two to say what was
 * wrong and ask for those shots again. Turn two sends newChat 'never', so it
 * was never the turn that deleted anything — but turn ONE sends 'auto' and
 * asks for text, and text meant disposable, so the thread was deleted the
 * instant the first reply landed. Turn two then typed "send back only shot 4,
 * the others are accepted" into an empty chat that had never seen a brief, a
 * shot list, or a reference image.
 *
 * That is why the director could name six things wrong with a plan and fix
 * none of them: the repair was real, the loop was right, and the room it was
 * shouting into had been demolished.
 *
 * So `deleteWhenDone: false` now means what it says, and the runner sets it on
 * every turn that opens a thread it intends to continue. The classification
 * was wrong on its own terms too: the header above justifies deleting text
 * threads because they are machine chatter nobody will reopen, and a Story
 * thread holds the cast, the world, the look and thirteen prompts. That is the
 * kind of thread the same paragraph says to keep.
 */
export function shouldTidy(config: {
  mediaType?: string;
  newChat?: 'auto' | 'never';
  deleteWhenDone?: boolean;
} | null | undefined): boolean {
  /* Continuing a thread is not the turn that made it, and tidyAwayConversation
     refuses these anyway — its `before` path already names a conversation.
     Kept here so the decision reads in one place rather than two. */
  if (config?.newChat === 'never') return false;
  /* Said explicitly, either way, before anything is inferred from the media. */
  if (config?.deleteWhenDone === false) return false;
  if (config?.deleteWhenDone === true) return true;
  /* Unsaid: a one-shot text ask is the clipper's machine chatter, and a
     generation is work somebody will want to look at again. */
  return config?.mediaType === 'text';
}

/** A conversation path, as opposed to the new-chat route. */
export const conversationId = (path: string): string =>
  /^\/app\/([A-Za-z0-9_-]+)$/.exec(path)?.[1] || '';

/* The confirm button carries no test id, and — measured on the live dialog —
   is byte-for-byte identical to Cancel in class and attributes. Text is the
   only thing that separates them, so this is a list rather than a selector.

   The fallback is DOM order, where the confirming action comes last. Both
   routes fail safe: picking wrong clicks Cancel, and the thread simply
   survives. The dialog is only ever opened on a row already identified by id,
   so no wrong conversation is reachable from here. */
const CONFIRMS = /^(delete|supprimer|eliminar|borrar|löschen|elimina|excluir|verwijderen|slett|ta bort|usuń|удалить|删除|刪除|削除|삭제|حذف|मिटाएं)$/i;

export function findConversationRow(id: string): HTMLElement | null {
  for (const row of document.querySelectorAll<HTMLElement>('[data-test-id="conversation"]')) {
    const href = row.querySelector('a')?.getAttribute('href') || '';
    if (conversationId(href) === id) return row;
  }
  return null;
}

/** Wait out a confirm dialog left over from the previous node's clear-up. */
export async function waitForNoDialog(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (!document.querySelector('mat-dialog-container, [role="dialog"]')) return;
    await sleep(150);
  }
  console.warn('[AutoFlow Gemini] A dialog is still open — continuing anyway');
}

export async function tidyAwayConversation(before: string): Promise<void> {
  /* Only a thread this run created. See the header. */
  if (conversationId(before)) return;
  const id = conversationId(location.pathname);
  if (!id) return;

  /* Gemini writes the row after the exchange settles, and titles it a moment
     later again. Waiting for it to appear costs nothing; assuming it is there
     would silently skip the tidy-up on every fast machine. */
  let row: HTMLElement | null = null;
  for (let i = 0; i < 20 && !row; i++) {
    row = findConversationRow(id);
    if (!row) await sleep(300);
  }
  if (!row) {
    console.log('[AutoFlow Gemini] Finished thread is not in the sidebar yet — leaving it');
    return;
  }

  /* The row's trailing controls only mount on hover. */
  row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  await sleep(120);

  const menuButton = row.querySelector<HTMLElement>('[data-test-id="actions-menu-button"]');
  if (!menuButton) {
    console.warn('[AutoFlow Gemini] No actions menu on the finished thread — leaving it');
    return;
  }
  menuButton.click();

  let del: HTMLElement | null = null;
  for (let i = 0; i < 12 && !del; i++) {
    await sleep(120);
    del = document.querySelector<HTMLElement>('[role="menu"] [data-test-id="delete-button"]');
  }
  if (!del) {
    console.warn('[AutoFlow Gemini] No Delete in the thread menu — leaving it');
    document.body.click();                       // put the menu away again
    return;
  }
  del.click();

  let dialog: HTMLElement | null = null;
  for (let i = 0; i < 12 && !dialog; i++) {
    await sleep(120);
    dialog = document.querySelector<HTMLElement>('mat-dialog-container, [role="dialog"]');
  }
  if (!dialog) {
    console.warn('[AutoFlow Gemini] Delete asked for no confirmation — leaving it');
    return;
  }

  const buttons = Array.from(dialog.querySelectorAll<HTMLElement>('button'));
  const confirm =
    buttons.find((b) => CONFIRMS.test((b.textContent || '').trim()))
    || buttons[buttons.length - 1];
  if (!confirm) return;
  confirm.click();

  /* Confirmed is not deleted. Reporting it either way would make a failure
     here indistinguishable from success in the log, which is how a growing
     sidebar goes unnoticed for a week. */
  for (let i = 0; i < 12; i++) {
    await sleep(200);
    if (!findConversationRow(id)) {
      console.log('[AutoFlow Gemini] Cleared up the thread this node used');
      return;
    }
  }
  console.warn('[AutoFlow Gemini] The thread was not removed — it is still in the sidebar');
}

