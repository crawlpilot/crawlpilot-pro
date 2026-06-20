export type PaginationSpeed = 'slow' | 'normal' | 'fast';

export interface PaginationProfile {
    navigationDelay: number;
    contentLoadDelay: number;
    pageLoadDelay: number;
    urlChangeTimeout: number;
    maxContentNoChange: number;
    scrollDelay?: number;
}

export const PAGINATION_PROFILES: Record<PaginationSpeed, PaginationProfile> = {
    slow: {
        navigationDelay: 0,     // unused — navigation is now detected adaptively
        contentLoadDelay: 3000,
        pageLoadDelay: 1500,
        urlChangeTimeout: 15000,
        maxContentNoChange: 3,
        scrollDelay: 800
    },
    normal: {
        navigationDelay: 0,
        contentLoadDelay: 1000,
        pageLoadDelay: 500,
        urlChangeTimeout: 10000,
        maxContentNoChange: 2,
        scrollDelay: 300
    },
    fast: {
        navigationDelay: 0,
        contentLoadDelay: 500,
        pageLoadDelay: 250,
        urlChangeTimeout: 5000,
        maxContentNoChange: 2,
        scrollDelay: 100
    }
};

export const DEFAULT_PAGINATION_SPEED: PaginationSpeed = 'normal';
