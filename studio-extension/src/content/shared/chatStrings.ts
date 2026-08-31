/**
 * chatStrings.ts — the chat adapters' UI labels, in every language they ship in.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * Flow got this treatment already: flowStrings.ts holds its labels in thirteen
 * languages so the adapter matches whatever the site renders. The five chat
 * adapters never did, and every one of them looks for English:
 *
 *     aria-label="New chat"          aria-label="Send message"
 *     aria-label="Submit"            aria-label="Aspect Ratio"
 *     aria-label="Skip Thinking"     aria-label="Generation mode"
 *
 * ChatGPT, Gemini, Claude, Grok and Z.AI all translate those from the
 * browser's language. On a French Chrome every selector above misses, and the
 * failure is the quiet kind: the adapter finds no send button, waits out its
 * timeout, and reports that the site never answered. Nothing says "I was
 * looking for a word that is not on this page".
 *
 * The proof it was already happening is in chatgpt/index.ts, which matched
 * `aria-label*="stop"` and `aria-label*="arrêter"` side by side — somebody hit
 * this once, patched the one selector that bit them, and moved on. This is
 * that patch generalised.
 *
 * ── The shape, and why it matches Flow's ──────────────────────────────────
 *
 * A flat array of translations per key, matched case-insensitively by
 * substring. Deliberately identical to flowStrings so there is one idea in the
 * codebase rather than two: anyone who has read that file can read this one,
 * and adding a language is the same edit in both.
 *
 * Substring rather than equality because these are aria-labels, which sites
 * decorate — "Send message" becomes "Send message (⌘↵)" without warning, and
 * an exact match would break on a keyboard hint.
 *
 * ── Adding a language ─────────────────────────────────────────────────────
 *
 *   1. Open the chat in that language
 *   2. Inspect the control and read its aria-label
 *   3. Add the string to the matching array
 *
 * A wrong entry costs nothing: it simply never matches. A missing one costs a
 * silent timeout, which is why the lists lean towards including variants.
 */

export const CHAT_STRINGS = {
  /** Start a fresh conversation. */
  newChat: [
    'new chat', 'new conversation',      // EN
    'nouvelle discussion', 'nouvelle conversation', 'nouveau chat',  // FR
    'nuevo chat', 'nueva conversación',  // ES
    'novo chat', 'nova conversa',        // PT
    'neuer chat', 'neue unterhaltung',   // DE
    'nuova chat', 'nuova conversazione', // IT
    'nieuwe chat',                       // NL
    'yeni sohbet',                       // TR
    'новый чат',                         // RU
    '新しいチャット',                      // JA
    '새 채팅',                            // KO
    '新对话', '新聊天',                    // ZH
    'محادثة جديدة',                       // AR
  ],

  /** Submit the prompt. */
  send: [
    'send message', 'send prompt', 'send', 'submit',   // EN
    'envoyer un message', 'envoyer le message', 'envoyer', 'soumettre',  // FR
    'enviar mensaje', 'enviar',          // ES
    'enviar mensagem',                   // PT
    'nachricht senden', 'senden',        // DE
    'invia messaggio', 'invia',          // IT
    'bericht verzenden', 'verzenden',    // NL
    'mesaj gönder', 'gönder',            // TR
    'отправить сообщение', 'отправить',  // RU
    'メッセージを送信', '送信',            // JA
    '메시지 보내기', '보내기',              // KO
    '发送消息', '发送',                    // ZH
    'إرسال رسالة', 'إرسال',               // AR
  ],

  /** Interrupt a running generation — how "still working" is detected. */
  stop: [
    'stop generating', 'stop streaming', 'stop',   // EN
    'arrêter la génération', 'arrêter',  // FR
    'detener', 'parar',                  // ES
    'parar de gerar', 'interromper',     // PT
    'generierung stoppen', 'stoppen',    // DE
    'interrompi',                        // IT
    'stoppen met genereren',             // NL
    'durdur',                            // TR
    'остановить',                        // RU
    '停止', '生成を停止',                  // JA / ZH
    '중지',                               // KO
    'إيقاف',                              // AR
  ],

  /** Copy the reply — used to find the end of a finished turn. */
  copy: [
    'copy', 'copy to clipboard',         // EN
    'copier', 'copier dans le presse-papiers',  // FR
    'copiar',                            // ES / PT
    'kopieren',                          // DE
    'copia',                             // IT
    'kopiëren',                          // NL
    'kopyala',                           // TR
    'копировать',                        // RU
    'コピー',                             // JA
    '복사',                               // KO
    '复制',                               // ZH
    'نسخ',                                // AR
  ],

  /** Attach a file or image to the prompt. */
  attach: [
    'attach', 'attach file', 'add photos', 'upload',   // EN
    'joindre', 'joindre un fichier', 'ajouter des photos', 'importer', 'télécharger',  // FR
    'adjuntar', 'subir',                 // ES
    'anexar', 'carregar',                // PT
    'anhängen', 'hochladen',             // DE
    'allega', 'carica',                  // IT
    'bijvoegen', 'uploaden',             // NL
    'ekle', 'yükle',                     // TR
    'прикрепить', 'загрузить',           // RU
    '添付', 'アップロード',                // JA
    '첨부', '업로드',                      // KO
    '附加', '上传',                       // ZH
    'إرفاق', 'تحميل',                     // AR
  ],

  /** The aspect-ratio control on image and video composers. */
  aspectRatio: [
    'aspect ratio', 'choose image aspect ratio', 'image aspect ratio',  // EN
    'format', "format d'image", 'rapport hauteur/largeur', 'proportions',  // FR
    'relación de aspecto', 'proporción',  // ES
    'proporção', 'proporção da imagem',   // PT
    'seitenverhältnis',                   // DE
    'proporzioni', 'formato',             // IT
    'beeldverhouding',                    // NL
    'en boy oranı',                       // TR
    'соотношение сторон',                 // RU
    'アスペクト比', '縦横比',               // JA
    '가로세로 비율',                        // KO
    '宽高比', '长宽比',                     // ZH
    'نسبة العرض إلى الارتفاع',              // AR
  ],
} as const;

export type ChatStringKey = keyof typeof CHAT_STRINGS;

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * Does this text carry the label, in any language we know?
 *
 * Substring and case-insensitive, for the reason in the header: sites append
 * keyboard hints and counts to aria-labels without notice.
 */
export function matchesChatText(text: string, key: ChatStringKey): boolean {
  const lower = String(text || '').trim().toLowerCase();
  if (!lower) return false;
  return CHAT_STRINGS[key].some((t) => lower.includes(t.toLowerCase()));
}

/**
 * A selector matching this control in every language, by aria-label or title.
 *
 * Both capitalisations, because CSS attribute matching is case-sensitive by
 * default and sites are inconsistent about sentence case. `title` is included
 * because Grok labels some controls that way and Gemini has done both.
 */
export function chatLabelSelector(key: ChatStringKey, tag = ''): string {
  return CHAT_STRINGS[key]
    .flatMap((t) => [t, capitalize(t)])
    .flatMap((t) => [`${tag}[aria-label*="${t}"]`, `${tag}[title*="${t}"]`])
    .join(', ');
}

/**
 * The first visible element carrying this label, in any language.
 *
 * Visibility matters more than it looks: these UIs keep a hidden copy of the
 * send button for the mobile layout, and clicking that one does nothing at all
 * while appearing to have worked.
 */
export function findByChatLabel(
  key: ChatStringKey,
  doc: Document = document,
  tag = '',
): HTMLElement | null {
  const seen = doc.querySelectorAll<HTMLElement>(chatLabelSelector(key, tag) || '*');
  for (const el of Array.from(seen)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}
