import { describe, it, expect } from 'vitest';
import { classifyPage, PageSignals } from './classifyPage';
import { detectBotManagers } from './botManagers';

const LONG = 'Product details and specifications. '.repeat(100);

function page(overrides: Partial<PageSignals>): PageSignals {
    return {
        url: 'https://shop.example.com/p/123',
        status: 200,
        title: 'Desk lamp | Example Shop',
        text: LONG.slice(0, 3000),
        textLength: LONG.length,
        linkCount: 120,
        hasPasswordInput: false,
        cookieNames: [],
        html: '<html><body>…</body></html>',
        ...overrides,
    };
}

describe('classifyPage', () => {
    it('passes a normal content page', () => {
        expect(classifyPage(page({})).verdict).toBe('ok');
    });

    it('a contact form with reCAPTCHA on a full page is still ok', () => {
        const r = classifyPage(page({ html: '<div class="g-recaptcha"></div>' }));
        expect(r.verdict).toBe('ok');
        expect(r.botManagers.map(b => b.id)).toContain('recaptcha');
    });

    it('Cloudflare interstitial is a challenge', () => {
        const r = classifyPage(page({ title: 'Just a moment...', text: 'Checking your browser', textLength: 40, linkCount: 0, status: 403, cookieNames: ['__cf_bm'] }));
        expect(r.verdict).toBe('challenge');
    });

    it('thin page with a hCaptcha widget is a challenge', () => {
        const r = classifyPage(page({ title: 'Security check', text: 'Please complete', textLength: 15, linkCount: 1, html: '<div class="h-captcha" data-sitekey="x"></div>' }));
        expect(r.verdict).toBe('challenge');
        expect(r.reason).toMatch(/hCaptcha/);
    });

    it('PerimeterX press-and-hold is a challenge', () => {
        const r = classifyPage(page({ title: 'Access to this page has been denied', text: 'Press & Hold to confirm you are a human', textLength: 60, linkCount: 2, html: '<div id="px-captcha"></div>' }));
        expect(r.verdict).toBe('challenge');
    });

    it('Akamai access denied is blocked and names the vendor', () => {
        const r = classifyPage(page({ title: 'Access Denied', text: "You don't have permission to access this page. Reference #18.abc", textLength: 80, linkCount: 0, status: 403, cookieNames: ['_abck', 'bm_sz'] }));
        expect(r.verdict).toBe('blocked');
        expect(r.reason).toMatch(/Akamai/);
    });

    it('429 is rate limited', () => {
        expect(classifyPage(page({ status: 429 })).verdict).toBe('rate_limited');
        expect(classifyPage(page({ title: 'Too Many Requests', text: 'Too many requests', textLength: 20, status: 0 })).verdict).toBe('rate_limited');
    });

    it('queue page is a waiting room, not a bot wall', () => {
        const r = classifyPage(page({ title: 'Please wait', text: 'Thank you for your patience. You are now in line.', textLength: 50, linkCount: 1 }));
        expect(r.verdict).toBe('waiting_room');
    });

    it('redirect to sign-in is a login wall', () => {
        const r = classifyPage(page({ url: 'https://shop.example.com/account/login?next=/orders' }), 'https://shop.example.com/orders');
        expect(r.verdict).toBe('login_wall');
    });

    it('a login page that was asked for is not a login wall', () => {
        const r = classifyPage(page({ url: 'https://shop.example.com/login' }), 'https://shop.example.com/login');
        expect(r.verdict).toBe('ok');
    });

    it('not-found title on a 200 is a soft 404', () => {
        const r = classifyPage(page({ title: 'Page not found', text: 'Sorry', textLength: 300, linkCount: 40 }));
        expect(r.verdict).toBe('soft_404');
    });

    it('deep link answered by the home page is a soft 404', () => {
        const r = classifyPage(page({ url: 'https://shop.example.com/' }), 'https://shop.example.com/p/999');
        expect(r.verdict).toBe('soft_404');
    });

    it('real 404 and 500 are http errors', () => {
        expect(classifyPage(page({ status: 404 })).verdict).toBe('http_error');
        expect(classifyPage(page({ status: 503 })).verdict).toBe('http_error');
    });

    it('blank document is empty', () => {
        expect(classifyPage(page({ text: '', textLength: 0, linkCount: 0 })).verdict).toBe('empty');
    });
});

describe('detectBotManagers', () => {
    it('finds vendors from cookies and markup', () => {
        const hits = detectBotManagers(['datadome', 'incap_ses_123_456'], '<html></html>');
        expect(hits.map(h => h.id).sort()).toEqual(['datadome', 'imperva']);
        expect(detectBotManagers([], '<script>/cdn-cgi/challenge-platform/h/b</script>').map(h => h.id)).toEqual(['cloudflare']);
    });
});
