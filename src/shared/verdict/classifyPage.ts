/**
 * What a loaded page is, before any extraction runs: real content, or a wall that would otherwise be
 * saved as empty or junk rows. Pure and side-effect free so it runs in the service worker and in tests.
 *
 * Ideas follow thenos's scraper detection (detect.py): challenges are told apart from plain blocks so a
 * person can solve them, waiting rooms are not bot walls, and soft 404s fail like real ones.
 */
import { BotManagerHit, CHALLENGE_WIDGETS, detectBotManagers } from './botManagers';

export type PageVerdict =
    | 'ok'
    | 'challenge'      // CAPTCHA / "verify you are human": a person can solve it
    | 'blocked'        // access denied, no way through from the page
    | 'rate_limited'   // 429 or "too many requests": back off and retry later
    | 'waiting_room'   // the site is queueing every visitor for a while
    | 'login_wall'     // redirected to, or showing only, a sign-in form
    | 'soft_404'       // a not-found page served as 200, or a deep link answered by the home page
    | 'http_error'     // 4xx/5xx status
    | 'empty';         // no text and no links

/** Collected in the page by {@link collectPageSignals}. */
export interface PageSignals {
    url: string;
    /** HTTP status of the main document when the browser exposes it (0 when unknown). */
    status: number;
    title: string;
    /** Visible text, truncated. */
    text: string;
    /** Full visible text length (before truncation). */
    textLength: number;
    linkCount: number;
    hasPasswordInput: boolean;
    cookieNames: string[];
    /** Outer HTML, truncated. */
    html: string;
}

export interface PageClassification {
    verdict: PageVerdict;
    reason: string;
    botManagers: BotManagerHit[];
}

/** Under this much visible text a page is a wall or a stub, not content. */
const THIN_TEXT = 1500;

const CHALLENGE_TEXT = /verify (that )?you are (a )?human|are you a robot|press (&|and) hold|checking (if the site connection is secure|your browser)|unusual traffic from your (computer|network)|complete the security check|confirm you are not a robot|just a moment\.\.\./i;
const BLOCK_TEXT = /access (is )?denied|you have been blocked|request (was )?blocked|pardon our interruption|forbidden|not authori[sz]ed to access|incapsula incident|error reference #|sorry, you have been blocked|bot activity|automated (access|requests|queries)/i;
const RATE_TEXT = /too many requests|rate limit(ed)?|slow down|exceeded .{0,20}requests/i;
const WAITING_TEXT = /thank you for your patience|waiting room|you are (now )?in (the |a )?(queue|line)|estimated wait(ing)? time|we are letting (people|visitors|customers) in|be right back/i;
const NOT_FOUND_TEXT = /page (not|cannot be) found|404|doesn'?t exist|does not exist|no longer available|couldn'?t find (that|this|the) page|nothing (was )?found here/i;
const LOGIN_PATH = /\/(log-?in|sign-?in|signin|auth|sso|account\/login|accounts\/login|session\/new)(\/|$|\?)/i;

function pathOf(u: string): string {
    try { return new URL(u).pathname; } catch { return ''; }
}

/**
 * @param requestedUrl the URL the run asked for (the page may have redirected away from it).
 */
export function classifyPage(s: PageSignals, requestedUrl: string = s.url): PageClassification {
    const botManagers = detectBotManagers(s.cookieNames, s.html);
    const thin = s.textLength < THIN_TEXT;
    const head = `${s.title}\n${s.text.slice(0, 2000)}`;
    const result = (verdict: PageVerdict, reason: string): PageClassification => ({ verdict, reason, botManagers });

    if (s.status === 429 || (thin && RATE_TEXT.test(head))) {
        return result('rate_limited', s.status === 429 ? 'HTTP 429' : 'page says too many requests');
    }
    if (thin && WAITING_TEXT.test(head)) {
        return result('waiting_room', 'site is queueing visitors');
    }
    const widget = botManagers.find(b => CHALLENGE_WIDGETS.includes(b.id));
    if (CHALLENGE_TEXT.test(s.title) || (thin && CHALLENGE_TEXT.test(head)) || (thin && widget && !s.hasPasswordInput)) {
        return result('challenge', widget ? `${widget.name} challenge` : 'human verification page');
    }
    if ((s.status === 401 || s.status === 403) || (thin && BLOCK_TEXT.test(head))) {
        const vendor = botManagers.find(b => !CHALLENGE_WIDGETS.includes(b.id));
        return result('blocked', vendor ? `blocked by ${vendor.name}` : s.status ? `HTTP ${s.status}` : 'access denied page');
    }
    if (s.status === 404 || s.status === 410) {
        return result('http_error', `HTTP ${s.status}`);
    }
    if (s.status >= 400) {
        return result('http_error', `HTTP ${s.status}`);
    }

    const requestedPath = pathOf(requestedUrl);
    const finalPath = pathOf(s.url);
    if (LOGIN_PATH.test(finalPath) && !LOGIN_PATH.test(requestedPath)) {
        return result('login_wall', 'redirected to sign-in');
    }
    if (thin && s.hasPasswordInput && s.linkCount < 30) {
        return result('login_wall', 'only a sign-in form is shown');
    }
    if (thin && NOT_FOUND_TEXT.test(s.title)) {
        return result('soft_404', 'not-found page');
    }
    if (requestedPath.length > 1 && (finalPath === '/' || finalPath === '') ) {
        return result('soft_404', 'deep link redirected to the home page');
    }
    if (s.textLength < 50 && s.linkCount < 3) {
        return result('empty', 'no text and no links');
    }
    return result('ok', '');
}

/** Verdicts that make a page not worth extracting. */
export function isDeadVerdict(v: PageVerdict): boolean {
    return v !== 'ok';
}

export const VERDICT_LABELS: Record<PageVerdict, string> = {
    ok: 'OK',
    challenge: 'Bot check',
    blocked: 'Blocked',
    rate_limited: 'Rate limited',
    waiting_room: 'Waiting room',
    login_wall: 'Login required',
    soft_404: 'Not found',
    http_error: 'HTTP error',
    empty: 'Empty page',
};

/**
 * Self-contained: injected with chrome.scripting.executeScript, so it must not reference anything
 * outside its own body.
 */
export function collectPageSignals(): PageSignals {
    let status = 0;
    try {
        const nav = performance.getEntriesByType('navigation')[0] as any;
        if (nav && typeof nav.responseStatus === 'number') status = nav.responseStatus;
    } catch { /* not exposed */ }
    const body = document.body;
    const fullText = body ? (body.innerText || body.textContent || '') : '';
    const text = fullText.replace(/\s+/g, ' ').trim();
    const cookieNames = document.cookie
        .split(';')
        .map(c => c.split('=')[0].trim())
        .filter(Boolean);
    return {
        url: location.href,
        status,
        title: document.title || '',
        text: text.slice(0, 3000),
        textLength: text.length,
        linkCount: document.links.length,
        hasPasswordInput: !!document.querySelector('input[type="password"]'),
        cookieNames,
        html: document.documentElement.outerHTML.slice(0, 200_000),
    };
}
