import { useState, useCallback } from 'react';
import type { ListPick } from '../../shared/types/extraction';

/** The List Extractor's picks: the lists, and the Next / Load more control's chain. */
export function useSelectorManager(initial?: { selectors: ListPick[]; next: string[] }) {
    const [selectors, setSelectors] = useState<ListPick[]>(initial?.selectors ?? []);
    const [next, setNext] = useState<string[]>(initial?.next ?? []);

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
