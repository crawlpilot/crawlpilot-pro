import { useState, useCallback } from 'react';
import { SelectorState, SelectorMetadata } from '../../shared/types/extraction';

export function useSelectorManager() {
    const [selectors, setSelectors] = useState<SelectorState[]>([]);
    const [nextButtonSelector, setNextButtonSelector] = useState<string | null>(null);
    const [nextButtonSelectors, setNextButtonSelectors] = useState<SelectorMetadata[]>([]);

    const addSelector = useCallback((newSelector: SelectorState) => {
        setSelectors(prev => [...prev, newSelector]);
    }, []);

    const removeSelector = useCallback((id: string) => {
        setSelectors(prev => prev.filter(s => s.id !== id));
    }, []);

    const updateSelector = useCallback((id: string, updates: Partial<SelectorState>) => {
        setSelectors(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
    }, []);

    const setNextButton = useCallback((selector: string | null, metadata?: SelectorMetadata[]) => {
        setNextButtonSelector(selector);

        if (metadata && metadata.length > 0) {
            setNextButtonSelectors(metadata);
        } else if (selector) {
            setNextButtonSelectors([{ selector, strategy: 'Manual/Direct' }]);
        } else {
            setNextButtonSelectors([]);
        }
    }, []);

    return {
        selectors,
        nextButtonSelector,
        nextButtonSelectors,
        addSelector,
        removeSelector,
        updateSelector,
        setNextButton
    };
}
