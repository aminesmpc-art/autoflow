/* What Motion does with the provider tabs while a job works in them.

   'show': switch to Gemini, Claude or Flow each time the work
   moves there, keeping the working tab/window in front during the step.
   'background': never switch. Flow and the analysis engine stay wherever the
   user left them ("work fully in the background without me to see the tab").

   The panel orchestrates the run through Studio's shared service worker, which reads two keys:
   `af_background_tabs` (Studio's beta: no routine grab every 30 seconds) and
   `af_background_strict` (Motion only: no switch at the hand-off, no raise
   before an upload; see studio-extension/src/background/backgroundMode.ts).
   'show' disables the beta and strict mode, restoring the original foreground
   behavior; 'background' enables both.

   Restore following the work once on upgrade; later explicit choices are preserved. */
export type TabsChoice = 'show' | 'background';
export const TABS_CHOICE_KEY = 'af_motion_tabs';
export const TABS_FOLLOW_VERSION_KEY = 'af_motion_follow_tabs_v2';

export const readChoice = (stored: unknown): TabsChoice => (stored === 'background' ? 'background' : 'show');

export async function loadTabsChoice(): Promise<TabsChoice> {
  const stored = await chrome.storage.local.get([TABS_CHOICE_KEY, TABS_FOLLOW_VERSION_KEY]);
  if (stored[TABS_FOLLOW_VERSION_KEY] === true) return readChoice(stored[TABS_CHOICE_KEY]);
  await chrome.storage.local.set({ [TABS_CHOICE_KEY]: 'show', [TABS_FOLLOW_VERSION_KEY]: true });
  return 'show';
}

export async function prepareWorkingTabs(platform: string): Promise<void> {
  const choice = await loadTabsChoice();
  await chrome.storage.local.set(workerFlags(choice, platform));
}

/** ChatGPT's adapter has not been made safe in a hidden tab, so its tab keeps coming forward as it always did. */
export const backgroundAllowed = (platform: string) => platform !== 'chatgpt';

/** What the shared worker should read, for this choice and this analysis engine. */
export function workerFlags(choice: TabsChoice, platform: string) {
  const background = choice === 'background' && backgroundAllowed(platform);
  return { af_background_tabs: background, af_background_strict: background };
}
