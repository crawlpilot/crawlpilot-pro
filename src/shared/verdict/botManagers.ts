/**
 * Bot-protection vendors recognised from cookies and markup. Report-only: CrawlPilot names what a page
 * uses so a person can choose a scraping approach; it never tries to get around it.
 */

export type BotManagerId =
    | 'cloudflare' | 'akamai' | 'perimeterx' | 'datadome' | 'kasada' | 'imperva'
    | 'recaptcha' | 'hcaptcha' | 'turnstile' | 'arkose' | 'queue-it';

export interface BotManagerHit {
    id: BotManagerId;
    name: string;
    /** What gave it away: a cookie name or a markup fragment. */
    evidence: string;
}

interface Rule {
    id: BotManagerId;
    name: string;
    cookies?: RegExp;
    markup?: string[];
}

const RULES: Rule[] = [
    { id: 'cloudflare', name: 'Cloudflare', cookies: /^(__cf_bm|cf_clearance|__cflb|cf_chl_.*)$/, markup: ['/cdn-cgi/challenge-platform', 'cf-chl-', 'cf_chl_opt'] },
    { id: 'akamai', name: 'Akamai Bot Manager', cookies: /^(_abck|bm_sz|ak_bmsc|bm_sv|bm_mi)$/, markup: ['vpwaitingroom', 'x_aka_vp_wrcookie'] },
    { id: 'perimeterx', name: 'HUMAN (PerimeterX)', cookies: /^(_px\d?|_pxhd|_pxvid|_pxff_.*|pxcts)$/, markup: ['px-captcha', 'client.perimeterx.net', '/px/client/main.min.js'] },
    { id: 'datadome', name: 'DataDome', cookies: /^datadome$/, markup: ['captcha-delivery.com', 'js.datadome.co'] },
    { id: 'kasada', name: 'Kasada', cookies: /^(KP_UIDz|KP_UIDz-ssn)$/, markup: ['x-kpsdk', 'KPSDK'] },
    { id: 'imperva', name: 'Imperva (Incapsula)', cookies: /^(incap_ses_.*|visid_incap_.*|nlbi_.*|reese84)$/, markup: ['_Incapsula_Resource', 'incapsula incident'] },
    { id: 'queue-it', name: 'Queue-it', cookies: /^QueueITAccepted.*$/, markup: ['queue-it.net', 'queueit'] },
    { id: 'recaptcha', name: 'Google reCAPTCHA', markup: ['g-recaptcha', 'google.com/recaptcha', 'recaptcha/api.js'] },
    { id: 'hcaptcha', name: 'hCaptcha', markup: ['h-captcha', 'hcaptcha.com'] },
    { id: 'turnstile', name: 'Cloudflare Turnstile', markup: ['cf-turnstile', 'challenges.cloudflare.com/turnstile'] },
    { id: 'arkose', name: 'Arkose Labs (FunCaptcha)', markup: ['arkoselabs.com', 'funcaptcha'] },
];

/** Interactive widgets a person can solve: a page showing one with little else is a challenge. */
export const CHALLENGE_WIDGETS: BotManagerId[] = ['recaptcha', 'hcaptcha', 'turnstile', 'arkose'];

export function detectBotManagers(cookieNames: string[], html: string): BotManagerHit[] {
    const hits: BotManagerHit[] = [];
    const lowerHtml = html.toLowerCase();
    for (const rule of RULES) {
        const cookie = rule.cookies ? cookieNames.find(c => rule.cookies!.test(c)) : undefined;
        if (cookie) {
            hits.push({ id: rule.id, name: rule.name, evidence: `cookie ${cookie}` });
            continue;
        }
        const mark = rule.markup?.find(m => lowerHtml.includes(m.toLowerCase()));
        if (mark) hits.push({ id: rule.id, name: rule.name, evidence: mark });
    }
    return hits;
}
