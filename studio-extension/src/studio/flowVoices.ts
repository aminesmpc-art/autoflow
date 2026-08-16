/* ============================================================
   The voices Flow offers.

   Ported from the original extension's side panel, then checked against the
   live picker on 2026-08-16 — Flow now writes "Female, warm, mid pitch" where
   the old list said "♀ warm, mid", so the descriptors here are Flow's current
   wording rather than the shorthand. The names are Google's — stars, moons and
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
  /** 'Female' | 'Male' | 'Ungendered', as Flow's picker writes it. */
  sex: string;
  /** Flow's own one-line character note. */
  hint: string;
}

export const NO_VOICE = 'none';

export const FLOW_VOICES: readonly FlowVoice[] = [
  { id: 'Achernar', sex: 'Female', hint: 'soft, high pitch' },
  { id: 'Achird', sex: 'Male', hint: 'friendly, mid pitch' },
  { id: 'Algenib', sex: 'Male', hint: 'gravelly, low pitch' },
  { id: 'Algieba', sex: 'Male', hint: 'easy-going, mid-low pitch' },
  { id: 'Alnilam', sex: 'Male', hint: 'firm, mid-low pitch' },
  { id: 'Aoede', sex: 'Female', hint: 'breezy, mid pitch' },
  { id: 'Autonoe', sex: 'Female', hint: 'bright, mid pitch' },
  { id: 'Callirrhoe', sex: 'Female', hint: 'easy-going, mid pitch' },
  { id: 'Charon', sex: 'Male', hint: 'informative, low pitch' },
  { id: 'Despina', sex: 'Female', hint: 'smooth, mid pitch' },
  { id: 'Enceladus', sex: 'Male', hint: 'breathy, low pitch' },
  { id: 'Erinome', sex: 'Female', hint: 'clear, mid pitch' },
  { id: 'Fenrir', sex: 'Male', hint: 'excitable, young pitch' },
  { id: 'Gacrux', sex: 'Female', hint: 'mature, mid pitch' },
  { id: 'Iapetus', sex: 'Male', hint: 'clear, mid-low pitch' },
  { id: 'Kore', sex: 'Female', hint: 'firm, mid pitch' },
  { id: 'Laomedeia', sex: 'Female', hint: 'upbeat, mid-high pitch' },
  { id: 'Leda', sex: 'Female', hint: 'youthful, mid-high pitch' },
  { id: 'Orus', sex: 'Male', hint: 'firm, mid-low pitch' },
  { id: 'Puck', sex: 'Male', hint: 'upbeat, mid pitch' },
  { id: 'Pulcherrima', sex: 'Ungendered', hint: 'forward, mid-high pitch' },
  { id: 'Rasalgethi', sex: 'Male', hint: 'informative, mid pitch' },
  { id: 'Sadachbia', sex: 'Male', hint: 'lively, low pitch' },
  { id: 'Sadaltager', sex: 'Male', hint: 'knowledgeable, mid pitch' },
  { id: 'Schedar', sex: 'Male', hint: 'even, mid-low pitch' },
  { id: 'Sulafat', sex: 'Female', hint: 'warm, mid pitch' },
  { id: 'Umbriel', sex: 'Male', hint: 'smooth, lower pitch' },
  { id: 'Vindemiatrix', sex: 'Female', hint: 'gentle, mid pitch' },
  { id: 'Zephyr', sex: 'Female', hint: 'bright, mid-high pitch' },
  { id: 'Zubenelgenubi', sex: 'Male', hint: 'casual, mid-low pitch' },
];

/** "Sulafat — Female, warm, mid pitch", the way Flow's own picker writes it. */
export function voiceLabel(v: FlowVoice): string {
  return `${v.id} — ${v.sex}, ${v.hint}`;
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
