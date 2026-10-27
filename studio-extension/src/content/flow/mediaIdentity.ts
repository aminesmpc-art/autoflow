/* ============================================================
   Is this file the one this node generated?

   Split out so it can be tested, because the wrong answer is silent. A clip
   that borrows another generation's last frame produces a chained shot that
   continues from the wrong place — nothing errors, nothing looks broken, and
   the first sign of it is a film that does not cut together.

   Flow serves one generation under URLs that share no substring, so the
   question cannot be answered by comparing them. Measured on
   flow.google.com, 2026-09-17:

     grid thumbnail   https://flow.google.com/asb/<TOKEN>
     grid player      https://flow.google.com/asb/<TOKEN>=mm,22,15
     API clip         https://flow-content.google/video/<uuid>?Expires=…&Signature=…
     API still        https://flow-content.google/image/<uuid>?Expires=…
     labs.google      https://labs.google/…/media.getMediaUrlRedirect?name=<mediaId>

   Two facts fall out of that list and both matter here.

   The first is that a video tile's thumbnail and its player carry the SAME
   token, the player's being the thumbnail's plus `=mm,22,15`. A video tile
   holds no data-media-id and no data-tile-id — measured: none of its elements
   carries an identifying attribute at all — so that token is the only name it
   has, and it is enough to recognise its own player by.

   The second is that the signed URLs are re-issued: two requests for the same
   media differ in Expires and Signature. Anything downstream of this has to
   key on the uuid and drop the query, or the same clip stops matching itself
   a few minutes later.

   The two id spaces do not convert into each other. An `/asb/` token cannot
   be turned into a uuid, so a comparison across them is unanswerable rather
   than false, and `mediaKey` returns '' to say so.
   ============================================================ */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * The one comparable name for whatever `url` points at, or '' when it has
 * none.
 *
 * '' is not "no match" — it is "not a question this URL can answer", and the
 * caller has to treat it as such. A `blob:` src is the case that matters: it
 * is a handle to bytes this page already holds and says nothing whatever
 * about which generation they came from.
 */
export function mediaKey(url: string): string {
  if (!url) return '';

  /* Before the uuid check, and stopping at `=`: the suffix is a rendition
     (`=mm,22,15` is the clip, no suffix is the poster), not a different
     media, so both have to reduce to the same name. */
  const asb = url.match(/\/asb\/([^/?#=]+)/);
  if (asb) return `asb:${asb[1]}`;

  const named = url.match(/[?&]name=([^&#]+)/);
  if (named) {
    const inner = decodeURIComponent(named[1]);
    const uuid = inner.match(UUID);
    return `id:${(uuid ? uuid[0] : inner).toLowerCase()}`;
  }

  /* Bare, so a mediaId from the API status cache can be passed in directly
     alongside the URLs rather than being special-cased by every caller. */
  const uuid = url.match(UUID);
  if (uuid) return `id:${uuid[0].toLowerCase()}`;

  return '';
}

/**
 * Whether `candidate` is one of the names this generation is known by.
 *
 * Deliberately false when nothing can be established. The two outcomes are
 * not worth the same: refusing a player that was in fact ours costs a
 * recovery path that is already the fallback to a fallback — the downloaded
 * file is tried first and an honest "captured nothing" follows — while
 * accepting one that was not ours writes another clip's ending into this
 * node and hands it to the shot chained below.
 */
export function isSameGeneration(candidate: string, knownBy: Array<string | undefined>): boolean {
  const key = mediaKey(candidate);
  if (!key) return false;
  return knownBy.some((k) => mediaKey(k || '') === key);
}
