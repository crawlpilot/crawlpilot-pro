/**
 * Smart detection in the Page Extractor: the attributes this page carries in its own data (JSON-LD,
 * app state), found with no model and no selectors. The person ticks the ones they need, names each
 * the way their schema does, and they become the recipe's fields, read from every page's data.
 */
import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { CardButton, Dialog, Text } from '../../ui';
import { ToolkitProvider, usePageTab } from '../toolkit/context';
import PageDataExtract from '../toolkit/page-data/PageDataExtract';
import { sendToPage } from '../../../shared/messages';
import type { DataElement } from '../../../shared/pageJson/scan';

/** How many attributes the page's main item has (null: none, or not known yet). */
function useAttributeCount(): number | null {
    const page = usePageTab();
    const [count, setCount] = useState<number | null>(null);
    useEffect(() => {
        let alive = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        setCount(null);
        if (!page.web) return;
        // The page may be opening again (picking fields reloads it): ask a few times before giving up.
        const ask = (left: number) => sendToPage(page.tab, 'PAGE_JSON_SCAN')
            .then(r => r.candidates.find(c => c.kind === 'item')?.attributes.length || null)
            .catch(() => null)
            .then(n => {
                if (!alive) return;
                if (n) setCount(n);
                else if (left > 0) timer = setTimeout(() => void ask(left - 1), 1000);
            });
        void ask(5);
        return () => { alive = false; clearTimeout(timer); };
    }, [page.tab?.id, page.url, page.web]);
    return count;
}

export function PageAttributesCard({ onOpen }: { onOpen: () => void }) {
    const count = useAttributeCount();
    if (!count) return null;
    return (
        <CardButton tone="mint" pad="sm" onClick={onOpen} className="flex items-start gap-3" data-testid="smart-detection">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface/80 text-ink"><Sparkles size={16} /></span>
            <span className="min-w-0">
                <Text size="small" weight="semibold">Smart detection: {count} attributes found</Text>
                <Text size="caption" tone="muted">Pick from the data this page carries: price, images, specs… They hold when the page's layout changes.</Text>
            </span>
        </CardButton>
    );
}

export default function PageAttributesDialog({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (elements: DataElement[]) => void }) {
    const page = usePageTab();
    return (
        <Dialog open={open} onClose={onClose} size="lg" title="Attributes found on this page"
            description="Smart detection reads the data this page publishes. Nothing leaves your browser.">
            {open && (
                <ToolkitProvider page={page} openTool={() => undefined}>
                    <PageDataExtract onUse={els => { onAdd(els); onClose(); }} />
                </ToolkitProvider>
            )}
        </Dialog>
    );
}
