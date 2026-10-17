/** One JSON response captured by the API Finder's page hook (public/net-hook.js). */
export interface NetEntry {
    seq: number;
    url: string;
    method: string;
    status: number;
    contentType: string;
    requestHeaders: Record<string, string>;
    requestBody?: string;
    responseText: string;
    /** Response length before truncation. */
    size: number;
    truncated: boolean;
    at: number;
    via: 'fetch' | 'xhr';
}

export type JsonPath = (string | number)[];
