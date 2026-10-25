/**
 * Advertising and telemetry in a page's JSON: never offered as data. A sponsored competitor's product
 * sits next to the real one in many stores' state, and leaving it out beats warning about it.
 * Deliberately no bare `ad`: `shadeName` and `gradeLabel` are product data.
 */
const NOISE_KEYS = new Set([
    'ad', 'ads', 'adunit', 'adunits', 'adsenabled', 'adconfig', 'adslot', 'telemetry', 'beacon', 'beacons',
    'tracking', 'analytics', 'typename', 'pixel', 'pixels', 'impression', 'impressions',
]);
const NOISE_PARTS = ['advertis', 'sponsor', 'telemetry', 'beacon', 'analytic', 'tracking', 'adcontent', 'admodule', 'adsenabled', 'adserver'];

/** Whether the subtree under this key is advertising or telemetry. */
export function isNoiseKey(key: string | number): boolean {
    const k = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
    return k.length > 0 && (NOISE_KEYS.has(k) || NOISE_PARTS.some(p => k.includes(p)));
}
