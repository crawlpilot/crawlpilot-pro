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
        navigationDelay: 4000,
        contentLoadDelay: 4000,
        pageLoadDelay: 2000,
        urlChangeTimeout: 15000,
        maxContentNoChange: 3,
        scrollDelay: 1000
    },
    normal: {
        navigationDelay: 1500,
        contentLoadDelay: 2000,
        pageLoadDelay: 1000,
        urlChangeTimeout: 10000,
        maxContentNoChange: 2,
        scrollDelay: 400
    },
    fast: {
        navigationDelay: 500,
        contentLoadDelay: 1000,
        pageLoadDelay: 500,
        urlChangeTimeout: 5000,
        maxContentNoChange: 2,
        scrollDelay: 150
    }
};

export const DEFAULT_PAGINATION_SPEED: PaginationSpeed = 'normal';
