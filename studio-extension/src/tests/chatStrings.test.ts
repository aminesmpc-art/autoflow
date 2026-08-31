/**
 * @jest-environment jsdom
 */

/**
 * The chat adapters, in a browser that is not in English.
 *
 * Flow's labels were translated into thirteen languages long ago. The five
 * chat adapters were not, and every one of them looks for English:
 *
 *     aria-label="New chat"   aria-label="Send message"   aria-label="Submit"
 *
 * All five sites translate those from the browser's language. On a French
 * Chrome every selector misses, and it fails quietly: the adapter finds no
 * send button, waits out its timeout, and reports that the site never
 * answered. Nothing says "I was looking for a word that is not on this page".
 *
 * It had already happened once. chatgpt/index.ts matched `aria-label*="stop"`
 * and `aria-label*="arrêter"` side by side — somebody hit it, patched the one
 * selector that bit them, and moved on.
 */

/// <reference types="node" />

import * as fs from 'fs';
import * as path from 'path';

import {
  CHAT_STRINGS, matchesChatText, chatLabelSelector, findByChatLabel,
  type ChatStringKey,
} from '../content/shared/chatStrings';

describe('the words themselves', () => {
  it('covers the languages Flow already covers', () => {
    /* Anything less means Studio drives Flow in a language it cannot drive
       the chat in, which is a half-working product in that locale. */
    const flow = fs.readFileSync(
      path.resolve(__dirname, '../content/flow/flowStrings.ts'), 'utf8',
    );
    /* Flow's file marks each entry with a language comment; the count of
       distinct markers is the coverage claim being matched. */
    const langs = new Set(Array.from(flow.matchAll(/\/\/ ([A-Z]{2})\b/g)).map((m) => m[1]));
    expect(langs.size).toBeGreaterThanOrEqual(10);
  });

  it('has French for every key, since that is the browser that found this', () => {
    const french: Record<ChatStringKey, string> = {
      newChat: 'nouvelle discussion',
      send: 'envoyer',
      stop: 'arrêter',
      copy: 'copier',
      attach: 'joindre',
      aspectRatio: 'format',
    };
    for (const [key, word] of Object.entries(french)) {
      expect(matchesChatText(word, key as ChatStringKey)).toBe(true);
    }
  });

  it('still matches the English it replaces', () => {
    /* A translation table that breaks the original locale trades one bug for
       a bigger one. */
    expect(matchesChatText('New chat', 'newChat')).toBe(true);
    expect(matchesChatText('Send message', 'send')).toBe(true);
    expect(matchesChatText('Stop generating', 'stop')).toBe(true);
    expect(matchesChatText('Copy', 'copy')).toBe(true);
    expect(matchesChatText('Choose image aspect ratio', 'aspectRatio')).toBe(true);
  });

  it('survives the decoration these sites add', () => {
    /* "Send message" becomes "Send message (⌘↵)" without warning. Exact
       matching would break on a keyboard hint, which is why it is substring. */
    expect(matchesChatText('Send message (⌘↵)', 'send')).toBe(true);
    expect(matchesChatText('Envoyer le message (Ctrl+Entrée)', 'send')).toBe(true);
    expect(matchesChatText('  NEW CHAT  ', 'newChat')).toBe(true);
  });

  it('says no to something that is not the control', () => {
    expect(matchesChatText('Delete conversation', 'newChat')).toBe(false);
    expect(matchesChatText('', 'send')).toBe(false);
    expect(matchesChatText('   ', 'stop')).toBe(false);
  });
});

describe('the selector it builds', () => {
  it('matches both capitalisations, because CSS attribute matching is case-sensitive', () => {
    const sel = chatLabelSelector('newChat');
    expect(sel).toContain('[aria-label*="new chat"]');
    expect(sel).toContain('[aria-label*="New chat"]');
  });

  it('covers title as well as aria-label', () => {
    /* Grok labels some controls with title, and Gemini has used both. */
    expect(chatLabelSelector('send')).toContain('[title*=');
  });

  it('can be narrowed to a tag', () => {
    expect(chatLabelSelector('send', 'button')).toContain('button[aria-label*=');
  });

  it('is a selector the DOM will actually accept', () => {
    /* One stray quote and querySelectorAll throws, taking the adapter with
       it. Every key is compiled rather than eyeballed. */
    for (const key of Object.keys(CHAT_STRINGS) as ChatStringKey[]) {
      expect(() => document.querySelectorAll(chatLabelSelector(key))).not.toThrow();
    }
  });
});

describe('finding the real control', () => {
  it('skips the hidden duplicate these UIs keep for mobile', () => {
    /* Clicking that one does nothing and looks like it worked — the failure
       this whole file is about, one layer down. */
    document.body.innerHTML = `
      <button id="ghost" aria-label="Envoyer le message"></button>
      <button id="real" aria-label="Envoyer le message"></button>
    `;
    const ghost = document.getElementById('ghost') as HTMLElement;
    const real = document.getElementById('real') as HTMLElement;
    ghost.getBoundingClientRect = () => ({ width: 0, height: 0 }) as DOMRect;
    real.getBoundingClientRect = () => ({ width: 40, height: 40 }) as DOMRect;

    expect(findByChatLabel('send')?.id).toBe('real');
  });

  it('returns null rather than throwing when nothing is there', () => {
    document.body.innerHTML = '<div>nothing to see</div>';
    expect(findByChatLabel('send')).toBeNull();
  });
});
