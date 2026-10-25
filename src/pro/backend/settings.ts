/**
 * Where the backend is and the token Pro sends it. The address is kept; the token lives in session
 * storage, gone when the browser closes. It stands in for the company sign-in (`chrome.identity`), which
 * waits on the backend team's choice of identity provider.
 */
import { createClient } from './client';
import type { BackendApi } from './types';

const URL_KEY = 'pro.backend.baseUrl';
const TOKEN_KEY = 'pro.backend.token';

export interface BackendSettings {
    baseUrl: string;
    token: string;
}

export async function loadBackend(): Promise<BackendSettings> {
    const [{ [URL_KEY]: baseUrl }, { [TOKEN_KEY]: token }] = await Promise.all([
        chrome.storage.local.get(URL_KEY), chrome.storage.session.get(TOKEN_KEY),
    ]);
    return { baseUrl: typeof baseUrl === 'string' ? baseUrl : '', token: typeof token === 'string' ? token : '' };
}

export async function saveBackend({ baseUrl, token }: BackendSettings): Promise<void> {
    await Promise.all([chrome.storage.local.set({ [URL_KEY]: baseUrl.trim() }), chrome.storage.session.set({ [TOKEN_KEY]: token.trim() })]);
}

/** The client, or null until an address and a token are set. */
export async function backendApi(): Promise<BackendApi | null> {
    const { baseUrl, token } = await loadBackend();
    return baseUrl && token ? createClient({ baseUrl, token }) : null;
}
