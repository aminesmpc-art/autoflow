/* ============================================================
   The voices Flow offers.

   Ported from the original extension's side panel, which has shipped this
   list since the feature was added. The names are Google's — stars, moons and
   Greek figures — and they carry no information at all on their own: nothing
   about "Sadaltager" tells you it is a mid-pitch male voice. So the descriptor
   travels with the name everywhere the list is shown, exactly as Flow's own
   picker does.

   Hardcoded rather than scraped. Scraping would need the Flow tab open and the
   "+" menu opened before the dropdown could be populated, which is the wrong
   trade for a list that changes perhaps once a year — and a node whose voice
   menu is empty until you open another tab is worse than one that is briefly
   out of date. If Flow adds a voice, the name is typed into its search box
   verbatim, so an unlisted voice still works when set by hand.
   ============================================================ */

export interface FlowVoice {
  /** Exactly as Flow spells it — typed into the picker's search box. */
  id: string;
  /** '♀' | '♂' | '⚥', as Flow labels them. */
  sex: string;
  /** Flow's own one-line character note. */
  hint: string;
}

export const NO_VOICE = 'none';

export const FLOW_VOICES: readonly FlowVoice[] = [
  { id: 'Achernar',      sex: '♀', hint: 'soft, high' },
  { id: 'Achird',        sex: '♂', hint: 'friendly, mid' },
  { id: 'Algenib',       sex: '♂', hint: 'gravelly, low' },
  { id: 'Algieba',       sex: '♂', hint: 'easy-going, mid-low' },
  { id: 'Alnilam',       sex: '♂', hint: 'firm, mid-low' },
  { id: 'Aoede',         sex: '♀', hint: 'breezy, mid' },
  { id: 'Autonoe',       sex: '♀', hint: 'bright, mid' },
  { id: 'Callirrhoe',    sex: '♀', hint: 'easy-going, mid' },
  { id: 'Charon',        sex: '♂', hint: 'informative, low' },
  { id: 'Despina',       sex: '♀', hint: 'smooth, mid' },
  { id: 'Enceladus',     sex: '♂', hint: 'breathy, low' },
  { id: 'Erinome',       sex: '♀', hint: 'clear, mid' },
  { id: 'Fenrir',        sex: '♂', hint: 'excitable, young' },
  { id: 'Gacrux',        sex: '♀', hint: 'mature, mid' },
  { id: 'Iapetus',       sex: '♂', hint: 'clear, mid-low' },
  { id: 'Kore',          sex: '♀', hint: 'firm, mid' },
  { id: 'Laomedeia',     sex: '♀', hint: 'upbeat, mid-high' },
  { id: 'Leda',          sex: '♀', hint: 'youthful, mid-high' },
  { id: 'Orus',          sex: '♂', hint: 'firm, mid-low' },
  { id: 'Puck',          sex: '♂', hint: 'upbeat, mid' },
  { id: 'Pulcherrima',   sex: '⚥', hint: 'forward, mid-high' },
  { id: 'Rasalgethi',    sex: '♂', hint: 'informative, mid' },
  { id: 'Sadachbia',     sex: '♂', hint: 'lively, low' },
  { id: 'Sadaltager',    sex: '♂', hint: 'knowledgeable, mid' },
  { id: 'Schedar',       sex: '♂', hint: 'even, mid-low' },
  { id: 'Sulafat',       sex: '♀', hint: 'warm, mid' },
  { id: 'Umbriel',       sex: '♂', hint: 'smooth, low' },
  { id: 'Vindemiatrix',  sex: '♀', hint: 'gentle, mid' },
  { id: 'Zephyr',        sex: '♀', hint: 'bright, mid-high' },
  { id: 'Zubenelgenubi', sex: '♂', hint: 'casual, mid-low' },
];

/** "Sulafat ♀ warm, mid" — the name alone tells you nothing. */
export function voiceLabel(v: FlowVoice): string {
  return `${v.id} ${v.sex} ${v.hint}`;
}

/**
 * The voice a node should actually apply.
 *
 * Flow attaches a voice to a CHARACTER, not to a prompt: with no reference
 * image in the ingredient tray the picker's selection has nothing to speak
 * through and the generation comes back silent. The original extension says as
 * much in its help text and passes 'none' in that case — so a node with a
 * voice set and no image would otherwise open the menu, hunt the list, click a
 * name and change nothing, which looks from the outside exactly like a broken
 * automation.
 *
 * Returning NO_VOICE here keeps that decision in one testable place instead of
 * an inline condition in the queue builder, and lets the node say why the
 * control it is showing will not take effect.
 */
export function effectiveVoice(voice: string | undefined, hasReferenceImage: boolean): string {
  if (!voice || voice === NO_VOICE) return NO_VOICE;
  return hasReferenceImage ? voice : NO_VOICE;
}
