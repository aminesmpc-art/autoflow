import type { ReactNode } from 'react';
import { upgradeUrl, type UpgradePlace } from './billing';

/** Fired when an Upgrade link is pressed, so the panel watches for Pro. */
export const UPGRADE_OPENED = 'motion:upgrade';

/** Every Upgrade button: checkout for this account, tagged with where it was pressed. */
export function UpgradeLink({ email, place, className, title, children }: {
  email?: string | null; place: UpgradePlace; className?: string; title?: string; children: ReactNode;
}) {
  return <a className={className} href={upgradeUrl(email, place)} target="_blank" rel="noreferrer" title={title}
    onClick={() => window.dispatchEvent(new Event(UPGRADE_OPENED))}>{children}</a>;
}
