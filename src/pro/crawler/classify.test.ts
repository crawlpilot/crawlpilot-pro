import { describe, expect, it } from 'vitest';
import { classify, keepHeaders, retryAfterMs } from './classify';

const page = (text: string) => `${text} `.repeat(Math.ceil(3000 / (text.length + 1)));
const NOW = Date.parse('2026-10-28T12:00:00Z');

describe('classify', () => {
    it('classes navigation errors by Chromium net error', () => {
        const cases: [string, string][] = [
            ['net::ERR_NAME_NOT_RESOLVED at https://x.test', 'dns'],
            ['net::ERR_PROXY_CONNECTION_FAILED', 'proxy'],
            ['net::ERR_TUNNEL_CONNECTION_FAILED', 'proxy'],
            ['net::ERR_CERT_DATE_INVALID', 'tls'],
            ['page.goto: Timeout 30000ms exceeded.', 'timeout'],
            ['net::ERR_CONNECTION_RESET', 'connection'],
            ['net::ERR_TOO_MANY_REDIRECTS', 'navigation'],
            ['something odd', 'unknown'],
        ];
        for (const [error, cls] of cases) expect(classify({ error }).errorClass, error).toBe(cls);
        expect(classify({ error: 'net::ERR_CERT_DATE_INVALID' })).toMatchObject({ retryable: false, pageStatus: 'error' });
        expect(classify({ error: 'Timeout 1ms exceeded' })).toMatchObject({ retryable: true, pageStatus: 'timeout' });
    });

    it('reads rate limits, with Retry-After in seconds or as a date', () => {
        expect(classify({ status: 429, headers: { 'retry-after': '30' } }, NOW)).toMatchObject({ errorClass: 'rate_limited', retryAfterMs: 30_000, pageStatus: 'blocked', blockSignal: 'status 429' });
        expect(retryAfterMs('Tue, 28 Oct 2026 12:01:00 GMT', NOW)).toBe(60_000);
        expect(retryAfterMs('soon', NOW)).toBeUndefined();
        expect(classify({ status: 407 }).errorClass).toBe('proxy_auth');
    });

    it('finds blocks from status, headers, title and short block pages, with the vendor and a confidence', () => {
        expect(classify({ status: 403, headers: { 'cf-mitigated': 'challenge', server: 'cloudflare' }, title: 'Just a moment...' })).toMatchObject({
            errorClass: 'blocked', protection: ['Cloudflare'], blockSignal: 'status 403 + cf-mitigated: challenge + Cloudflare challenge page',
            block: { vendor: 'Cloudflare', kind: 'challenge', confidence: 'high' },
        });
        expect(classify({ status: 200, title: 'Access Denied', text: 'You don\'t have permission. Reference #18.2f1b.1730.4a2b' }))
            .toMatchObject({ errorClass: 'blocked', blockSignal: 'status 200 + Akamai reference + block wording', block: { vendor: 'Akamai', kind: 'block', confidence: 'high' } });
        expect(classify({ status: 200, text: 'Please verify you are a human. Complete the CAPTCHA below.' }))
            .toMatchObject({ errorClass: 'captcha', pageStatus: 'blocked', block: { vendor: 'unknown', kind: 'captcha', confidence: 'medium' } });
        expect(classify({ status: 403, text: page('Nothing to see') })).toMatchObject({ errorClass: 'blocked', blockSignal: 'status 403', block: { vendor: 'unknown', confidence: 'low' } });
        expect(classify({ status: 503, title: 'Just a moment...' }).errorClass).toBe('blocked');
    });

    it('does not take a long, ordinary page for a block because it mentions a captcha', () => {
        const text = page('Linen shirt 29.90 EUR. Sign up for our newsletter (protected by reCAPTCHA).');
        expect(classify({ status: 200, title: 'Linen shirt', text })).toMatchObject({ errorClass: 'none', pageStatus: 'ok' });
    });

    it('classes other statuses and empty pages', () => {
        expect(classify({ status: 404, text: page('Not found') })).toMatchObject({ errorClass: 'not_found', retryable: false, pageStatus: 'not_found' });
        expect(classify({ status: 410 }).errorClass).toBe('gone');
        expect(classify({ status: 400 })).toMatchObject({ errorClass: 'client_error', retryable: false });
        expect(classify({ status: 502 })).toMatchObject({ errorClass: 'server_error', retryable: true });
        expect(classify({ status: 200, text: '   ' })).toMatchObject({ errorClass: 'empty_page', retryable: true });
    });

    it('keeps a known set of headers, cut short, and every header name', () => {
        const { headers, headerNames } = keepHeaders({ server: 'nginx', 'set-cookie': 'session=secret', 'cf-ray': 'x'.repeat(600) });
        expect(headers).toEqual({ server: 'nginx', 'cf-ray': 'x'.repeat(512) });
        expect(headerNames).toEqual(['cf-ray', 'server', 'set-cookie']);
    });
});
