/**
 * Site settings: what depends on the site, not on the recipe, and is set once for every recipe of it.
 *
 * - **Speed:** how fast to go (a delay between pages, tabs at once). Some sites block fast visitors.
 * - **Page wait:** how long to wait for the content (a slow site draws its list or prices late).
 * - **Login or "are you human" check:** pause so the user can handle it, or skip the page.
 * - **Steps before reading** (a cookie banner, a region picker) come with the site settings screen.
 *
 * Kept per site in `chrome.storage.local`. A site that rate-limited a run is set to Careful by itself
 * (`learned`), until the user sets its speed.
 */
import { storage } from '../storage';

export type Pace = 'careful' | 'normal' | 'fast';

export const PACES: Record<Pace, { delayMs: number; tabs: number }> = {
    careful: { delayMs: 4000, tabs: 1 },
    normal: { delayMs: 1000, tabs: 3 },
    fast: { delayMs: 250, tabs: 5 },
};

export const DEFAULT_PAGE_WAIT_MS = 10_000;

export interface SiteSettings {
    pace?: Pace;
    /** The delay and tabs, when the user changed them from the pace's. */
    delayMs?: number;
    tabs?: number;
    pageWaitMs?: number;
    /** A login page or a bot check: pause and show the tab, or skip the page. */
    onWall?: 'pause' | 'skip';
    /** Set by a run (a rate limit), not by the user: shown as such, replaced by the user's choice. */
    learned?: { reason: string; at: number };
}

/** What a run uses for a site: its settings, the defaults for what isn't set. */
export interface SiteRun {
    pace: Pace;
    delayMs: number;
    tabs: number;
    pageWaitMs: number;
    onWall: 'pause' | 'skip';
}

/** The site of an address: its host without `www.` (shop.example.com and example.com are different sites). */
export function siteOf(url: string | undefined): string {
    try { return url ? new URL(url).hostname.replace(/^www\./, '').toLowerCase() : ''; } catch { return ''; }
}

export function siteRun(s: SiteSettings | undefined): SiteRun {
    const pace = s?.pace ?? 'normal';
    return {
        pace,
        delayMs: s?.delayMs ?? PACES[pace].delayMs,
        tabs: s?.tabs ?? PACES[pace].tabs,
        pageWaitMs: s?.pageWaitMs ?? DEFAULT_PAGE_WAIT_MS,
        onWall: s?.onWall ?? 'pause',
    };
}

export async function allSiteSettings(): Promise<Record<string, SiteSettings>> {
    return (await storage.get('siteSettings')) ?? {};
}

/** The site's settings, or undefined when it has none (runs then use their own). */
export async function siteSettings(site: string): Promise<SiteSettings | undefined> {
    return site ? (await allSiteSettings())[site] : undefined;
}

/** Saves the user's settings for a site (what they set replaces anything learned). */
export async function setSiteSettings(site: string, next: SiteSettings | null): Promise<void> {
    if (!site) return;
    const all = await allSiteSettings();
    if (next === null) delete all[site];
    else {
        const { learned: _, ...mine } = next;
        all[site] = mine;
    }
    await storage.set('siteSettings', all);
}

/** A run was rate-limited: the site goes Careful, unless the user has set its speed. */
export async function learnCareful(site: string, reason: string): Promise<boolean> {
    if (!site) return false;
    const all = await allSiteSettings();
    const current = all[site];
    if (current?.pace && !current.learned) return false;
    if (current?.pace === 'careful') return false;
    all[site] = { ...current, pace: 'careful', delayMs: undefined, tabs: undefined, learned: { reason, at: Date.now() } };
    await storage.set('siteSettings', all);
    return true;
}
