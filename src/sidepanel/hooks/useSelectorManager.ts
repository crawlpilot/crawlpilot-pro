import { useState, useCallback } from 'react';
import type { ListPick } from '../../shared/types/extraction';

/** The List Extractor's picks: the lists, and the Next / Load more control's chain. */
export function useSelectorManager() {
    const [selectors, setSelectors] = useState<ListPick[]>([]);
    const [next, setNext] = useState<string[]>([]);

    const addSelector = useCallback((pick: ListPick) => {
        setSelectors(prev => [...prev, pick]);
    }, []);

    const removeSelector = useCallback((id: string) => {
        setSelectors(prev => prev.filter(s => s.id !== id));
    }, []);

    const updateSelector = useCallback((id: string, updates: Partial<ListPick>) => {
        setSelectors(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
    }, []);

    const clearSelectors = useCallback(() => {
        setSelectors([]);
    }, []);

    return { selectors, next, setNext, addSelector, removeSelector, updateSelector, clearSelectors };
}
