/** Run-scoped tab protection. Session storage survives worker recycling, not browser shutdown. */
export const PROVIDER_KEEPALIVE_KEY = 'af_motion_provider_keepalive';
export type ProviderTarget = { tabId: number; platform: string };
type ProtectedTab = ProviderTarget & { autoDiscardable: boolean };
type Snapshot = { target: ProviderTarget | null; tabs: ProtectedTab[] };

const providers = new Set(['flow', 'gemini', 'claude', 'chatgpt']);
const validTarget = (value: any): value is ProviderTarget =>
  Number.isInteger(value?.tabId) && value.tabId >= 0 && providers.has(value.platform);

export class ProviderKeepalive {
  private snapshot: Snapshot = { target: null, tabs: [] };
  private loaded = false;
  private pending: Promise<unknown> = Promise.resolve();

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.pending.then(operation, operation);
    this.pending = next.catch(() => {});
    return next;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    const saved = (await chrome.storage.session.get(PROVIDER_KEEPALIVE_KEY))?.[PROVIDER_KEEPALIVE_KEY];
    this.snapshot = {
      target: validTarget(saved?.target) ? saved.target : null,
      tabs: Array.isArray(saved?.tabs) ? saved.tabs.filter((tab: any) =>
        typeof tab?.autoDiscardable === 'boolean' && validTarget(tab)) : [],
    };
    this.loaded = true;
  }

  private async save(): Promise<void> {
    await chrome.storage.session.set({ [PROVIDER_KEEPALIVE_KEY]: this.snapshot });
  }

  hold(tabId: number, platform: string): Promise<void> {
    return this.serial(async () => {
      if (!validTarget({ tabId, platform })) return;
      await this.load();
      const tab = await chrome.tabs.get(tabId);
      if (!this.snapshot.tabs.some(saved => saved.tabId === tabId)) {
        this.snapshot.tabs.push({ tabId, platform, autoDiscardable: tab.autoDiscardable !== false });
      }
      this.snapshot.target = { tabId, platform };
      // Save the original setting BEFORE changing it, including when the worker dies mid-handoff.
      await this.save();
      await chrome.tabs.update(tabId, { autoDiscardable: false });
    });
  }

  recover(): Promise<ProviderTarget | null> {
    return this.serial(async () => {
      await this.load();
      return this.snapshot.target;
    });
  }

  release(): Promise<void> {
    return this.serial(async () => {
      await this.load();
      const remaining: ProtectedTab[] = [];
      for (const saved of this.snapshot.tabs) {
        try {
          const tab = await chrome.tabs.get(saved.tabId);
          // If the user changed the setting meanwhile, do not overwrite that choice.
          if (tab.autoDiscardable === false) {
            await chrome.tabs.update(saved.tabId, { autoDiscardable: saved.autoDiscardable });
          }
        } catch {
          // A closed tab needs no restoration; retain reachable tabs if an update failed.
          try { await chrome.tabs.get(saved.tabId); remaining.push(saved); } catch { /* closed */ }
        }
      }
      this.snapshot = { target: null, tabs: remaining };
      await this.save();
    });
  }
}
