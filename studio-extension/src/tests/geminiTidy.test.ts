/**
 * @jest-environment jsdom
 */

/**
 * Clearing up the thread a node used — and, much more importantly, NOT
 * clearing up anything else.
 *
 * Every node starts a new Gemini chat so the answer is not coloured by the
 * previous one, which means every node also leaves one behind. A clipping run
 * ends with a sidebar of near-identical "Speaker Position JSON Detection"
 * threads nobody will ever open. The automation made that mess, so it clears
 * it — but it is the only thing in this extension that destroys something a
 * person might want, so the interesting tests here are the refusals.
 *
 * The DOM below mirrors gemini.google.com as it was read off the live page:
 * a gem-nav-list-item carrying data-test-id="conversation", an anchor whose
 * href is /app/<id>, a hover-mounted ⋮ with data-test-id="actions-menu-button",
 * a menu item with data-test-id="delete-button", and a mat-dialog-container
 * whose two buttons are indistinguishable except by their text.
 */

import {
  conversationId, findConversationRow, shouldTidy, tidyAwayConversation,
} from '../content/gemini/tidy';

/* ------------------------------------------------------------------ */

/** A sidebar the way Gemini renders one. */
function sidebar(ids: string[]): void {
  document.body.innerHTML = `
    <mat-nav-list>
      ${ids.map((id) => `
        <gem-nav-list-item data-test-id="conversation">
          <a href="/app/${id}"><span class="title-text">Chat ${id}</span></a>
          <div class="hovered-trailing-content">
            <button data-test-id="actions-menu-button">⋮</button>
          </div>
        </gem-nav-list-item>`).join('')}
    </mat-nav-list>`;
}

/**
 * Wire the row menus up the way the page does, so a click actually opens
 * something. Deleting removes the row only once the dialog is confirmed.
 */
function makeInteractive(): { deleted: string[]; cancelled: number } {
  const state = { deleted: [] as string[], cancelled: 0 };

  for (const row of Array.from(document.querySelectorAll('gem-nav-list-item'))) {
    const id = row.querySelector('a')!.getAttribute('href')!.split('/').pop()!;
    row.querySelector('[data-test-id="actions-menu-button"]')!
      .addEventListener('click', () => {
        const menu = document.createElement('div');
        menu.setAttribute('role', 'menu');
        menu.innerHTML = `
          <button data-test-id="share-button">Share conversation</button>
          <button data-test-id="pin-button">Pin</button>
          <button data-test-id="delete-button">Delete</button>`;
        document.body.appendChild(menu);

        menu.querySelector('[data-test-id="delete-button"]')!
          .addEventListener('click', () => {
            menu.remove();
            const dialog = document.createElement('mat-dialog-container');
            dialog.innerHTML = '<h2>Delete chat?</h2><button>Cancel</button><button>Delete</button>';
            const [cancel, confirm] = Array.from(dialog.querySelectorAll('button'));
            cancel.addEventListener('click', () => { state.cancelled++; dialog.remove(); });
            confirm.addEventListener('click', () => {
              state.deleted.push(id);
              row.remove();
              dialog.remove();
            });
            document.body.appendChild(dialog);
          });
      });
  }
  return state;
}

const at = (path: string) => {
  window.history.replaceState({}, '', path);
};

beforeEach(() => {
  document.body.innerHTML = '';
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

/* ------------------------------------------------------------------ */

describe('whether the thread is ours to throw away', () => {
  /* The bug this describe exists for.
   *
   * A Story node is a conversation, not an ask. Turn one writes every prompt;
   * turn two says what came back wrong and asks for those shots again. Turn
   * two sends newChat 'never' and was correctly never the turn that deleted
   * anything — but turn one sends 'auto' and asks for text, and text meant
   * disposable. So the thread was deleted the moment the first reply landed,
   * and turn two typed "send back only shot 4, the others are accepted" into
   * an empty chat that had never seen a brief, a shot list or a reference
   * still.
   *
   * The visible symptom was the director naming six things wrong with a plan
   * and fixing none of them. Nothing in the logs said why, because from the
   * runner's side the repair went out exactly as written. */
  it('keeps a thread the caller says it will come back to', () => {
    expect(shouldTidy({ mediaType: 'text', newChat: 'auto', deleteWhenDone: false }))
      .toBe(false);
  });

  it('still clears a one-shot text ask, which is what it was built for', () => {
    /* Nine "give the horizontal position of the SPEAKER in these 8 stills"
       threads is the mess this whole module exists to clean up. */
    expect(shouldTidy({ mediaType: 'text', newChat: 'auto' })).toBe(true);
  });

  it('never clears a thread that produced a picture or a clip', () => {
    /* The node captures one result; the thread is where the others and any
       higher-quality version still live. */
    expect(shouldTidy({ mediaType: 'image', newChat: 'auto' })).toBe(false);
    expect(shouldTidy({ mediaType: 'video', newChat: 'auto' })).toBe(false);
  });

  it('clears a media thread when the caller asks for it outright', () => {
    expect(shouldTidy({ mediaType: 'image', newChat: 'auto', deleteWhenDone: true }))
      .toBe(true);
  });

  it('never clears on a turn that is continuing a thread', () => {
    /* Belt and braces: tidyAwayConversation refuses these too, because its
       `before` path already names a conversation. */
    expect(shouldTidy({ mediaType: 'text', newChat: 'never' })).toBe(false);
    expect(shouldTidy({ mediaType: 'text', newChat: 'never', deleteWhenDone: true }))
      .toBe(false);
  });

  it('does not fall over on a config that is not there', () => {
    expect(shouldTidy(undefined)).toBe(false);
    expect(shouldTidy(null)).toBe(false);
    expect(shouldTidy({})).toBe(false);
  });
});

describe('telling a conversation path from the new-chat route', () => {
  it('reads the id out of a conversation path', () => {
    expect(conversationId('/app/c_a1b2c3d4e5f6a7b8')).toBe('c_a1b2c3d4e5f6a7b8');
  });

  it('gives nothing for the new-chat route', () => {
    /* This is the whole guard. /app is a chat that does not exist yet; the
       path it turns into afterwards is the one this run created. */
    expect(conversationId('/app')).toBe('');
    expect(conversationId('/app/')).toBe('');
  });

  it('gives nothing for the other Gemini routes', () => {
    for (const path of ['/images', '/videos', '/app/x/y', '/gems/abc/edit']) {
      expect(conversationId(path)).toBe('');
    }
  });
});

describe('finding the row for a conversation', () => {
  it('matches on the id in the href, not on the title', () => {
    /* Gemini writes the titles itself, and a clipping run produces several
       identical ones. Matching on text would delete an arbitrary one. */
    sidebar(['aaa', 'bbb', 'ccc']);
    const row = findConversationRow('bbb');
    expect(row!.querySelector('a')!.getAttribute('href')).toBe('/app/bbb');
  });

  it('finds nothing when the id is not in the sidebar', () => {
    sidebar(['aaa']);
    expect(findConversationRow('zzz')).toBeNull();
  });
});

describe('what it deletes', () => {
  it('deletes the thread the node created', async () => {
    sidebar(['aaa', 'new1', 'ccc']);
    const state = makeInteractive();
    at('/app/new1');

    await tidyAwayConversation('/app');

    expect(state.deleted).toEqual(['new1']);
    expect(document.querySelectorAll('gem-nav-list-item')).toHaveLength(2);
  });

  it('leaves the dialog closed behind it', async () => {
    sidebar(['new1']);
    makeInteractive();
    at('/app/new1');

    await tidyAwayConversation('/app');

    expect(document.querySelector('mat-dialog-container')).toBeNull();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('waits for a row Gemini has not written to the sidebar yet', async () => {
    /* The row appears after the exchange settles. Assuming it is already
       there would skip the clear-up on every fast machine. */
    sidebar([]);
    at('/app/late1');

    const running = tidyAwayConversation('/app');
    await new Promise((r) => setTimeout(r, 400));
    sidebar(['late1']);
    const state = makeInteractive();
    await running;

    expect(state.deleted).toEqual(['late1']);
  });
});

describe('what it refuses to delete', () => {
  /* The failure this guards against is not a stale sidebar row. It is a run
     whose New Chat click missed, which continued inside a conversation the
     person was already using, and which then deleted it. */

  it('refuses when the run began inside an existing conversation', async () => {
    sidebar(['existing']);
    const state = makeInteractive();
    at('/app/existing');

    await tidyAwayConversation('/app/existing');

    expect(state.deleted).toEqual([]);
    expect(document.querySelectorAll('gem-nav-list-item')).toHaveLength(1);
  });

  it('refuses when the path never became a conversation', async () => {
    /* Nothing was created, so there is nothing of ours to remove — and the
       sidebar is full of threads that are not ours. */
    sidebar(['aaa', 'bbb']);
    const state = makeInteractive();
    at('/app');

    await tidyAwayConversation('/app');

    expect(state.deleted).toEqual([]);
  });

  it('refuses when the node was continuing an agent thread', async () => {
    sidebar(['agent']);
    const state = makeInteractive();
    at('/app/agent');

    await tidyAwayConversation('/app/agent');

    expect(state.deleted).toEqual([]);
  });

  it('gives up rather than guessing when the menu has no Delete', async () => {
    /* A Gemini redesign. The answer is already captured and sent by the time
       this runs, so the right outcome is an untidied thread, not a wrong
       click on whatever is in that position now. */
    sidebar(['new1']);
    at('/app/new1');
    document.querySelector('[data-test-id="actions-menu-button"]')!
      .addEventListener('click', () => {
        const menu = document.createElement('div');
        menu.setAttribute('role', 'menu');
        menu.innerHTML = '<button data-test-id="share-button">Share</button>';
        document.body.appendChild(menu);
      });

    await expect(tidyAwayConversation('/app')).resolves.toBeUndefined();
    expect(document.querySelectorAll('gem-nav-list-item')).toHaveLength(1);
  });

  it('gives up rather than guessing when the row has no menu at all', async () => {
    sidebar(['new1']);
    document.querySelector('[data-test-id="actions-menu-button"]')!.remove();
    at('/app/new1');

    await expect(tidyAwayConversation('/app')).resolves.toBeUndefined();
    expect(document.querySelectorAll('gem-nav-list-item')).toHaveLength(1);
  });
});

describe('picking the confirming button', () => {
  /* Measured on the live dialog: Cancel and Delete are byte-for-byte identical
     in class and attributes. Only text and order separate them.

     Both routes fail SAFE. Picking wrong clicks Cancel and the thread simply
     survives — and the dialog is only ever opened on a row already matched by
     id, so no other conversation is reachable from here. */

  const openOn = (labels: string[]) => {
    sidebar(['new1']);
    at('/app/new1');
    const clicked: string[] = [];
    document.querySelector('[data-test-id="actions-menu-button"]')!
      .addEventListener('click', () => {
        const menu = document.createElement('div');
        menu.setAttribute('role', 'menu');
        menu.innerHTML = '<button data-test-id="delete-button">Delete</button>';
        document.body.appendChild(menu);
        menu.querySelector('button')!.addEventListener('click', () => {
          menu.remove();
          const dialog = document.createElement('mat-dialog-container');
          dialog.innerHTML = labels.map((l) => `<button>${l}</button>`).join('');
          for (const b of Array.from(dialog.querySelectorAll('button'))) {
            b.addEventListener('click', () => {
              clicked.push(b.textContent!);
              dialog.remove();
              if (b.textContent !== 'Cancel') document.querySelector('gem-nav-list-item')!.remove();
            });
          }
          document.body.appendChild(dialog);
        });
      });
    return clicked;
  };

  it('picks Delete over Cancel by its words, not its position', async () => {
    const clicked = openOn(['Delete', 'Cancel']);   // reversed on purpose
    await tidyAwayConversation('/app');
    expect(clicked).toEqual(['Delete']);
  });

  it('recognises the word in other languages', async () => {
    const clicked = openOn(['Annuler', 'Supprimer']);
    await tidyAwayConversation('/app');
    expect(clicked).toEqual(['Supprimer']);
  });

  it('falls back to the last button when it recognises neither', async () => {
    const clicked = openOn(['Behalten', 'Entfernen']);
    await tidyAwayConversation('/app');
    expect(clicked).toEqual(['Entfernen']);
  });

  it('reports rather than claims success when the row survives', async () => {
    /* A confirm that did not delete must not read as a delete in the log, or
       a sidebar that keeps growing goes unnoticed for a week. */
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    openOn(['Cancel', 'Cancel']);                   // nothing here deletes

    await tidyAwayConversation('/app');

    expect(warn.mock.calls.flat().join(' ')).toMatch(/still in the sidebar/);
    expect(log.mock.calls.flat().join(' ')).not.toMatch(/Cleared up/);
  });
});
