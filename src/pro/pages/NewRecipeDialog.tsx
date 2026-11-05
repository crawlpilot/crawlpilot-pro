/**
 * Build new (`docs/plans/pro-ops-workflow-review.md`, finding 4): what the recipe is for comes first, before
 * picking: its kind, the competitor (suggested from the open page's site), the page type and a name. They are
 * set on the recipe when version 1 is saved, so it doesn't start out "needed to submit".
 */
import { useEffect, useState } from 'react';
import { FileText, List } from 'lucide-react';
import { Button, Dialog, Segmented, TextField } from '../../sidepanel/ui';
import { usePageTab } from '../../sidepanel/hooks/usePageTab';
import { competitorOf, type NewRecipe } from '../edit';
import type { RecipeKind } from '../recipe/types';

const PAGE_TYPE: Record<RecipeKind, string> = { page: 'product', list: 'listing' };

export function NewRecipeDialog({ open, onClose, onStart }: { open: boolean; onClose: () => void; onStart: (kind: RecipeKind, draft: NewRecipe) => void }) {
    const page = usePageTab();
    const [kind, setKind] = useState<RecipeKind>('page');
    const [competitor, setCompetitor] = useState('');
    const [pageType, setPageType] = useState(PAGE_TYPE.page);
    const [name, setName] = useState('');
    const [named, setNamed] = useState(false);

    // Suggestions from the open page, until the person types their own.
    useEffect(() => { if (open && !competitor && page.host) setCompetitor(competitorOf(page.host)); }, [open, page.host]);
    const suggested = [competitor, pageType].filter(Boolean).join(' ');
    useEffect(() => { if (!named) setName(suggested); }, [suggested, named]);

    const chooseKind = (k: RecipeKind) => {
        if (pageType === PAGE_TYPE[kind]) setPageType(PAGE_TYPE[k]);
        setKind(k);
    };
    const ready = competitor.trim() && pageType.trim() && name.trim();

    return (
        <Dialog open={open} onClose={onClose} size="sm" title="Build a new recipe"
            description="What it is for, then pick its fields on the open page. Its last step saves version 1; nothing runs.">
            <div className="flex flex-col gap-3" data-testid="pro-new-recipe">
                <Segmented<RecipeKind> fullWidth aria-label="Kind" value={kind} onChange={chooseKind} options={[
                    { value: 'page', label: 'Page recipe', icon: <FileText /> },
                    { value: 'list', label: 'List recipe', icon: <List /> },
                ]} />
                <TextField label="Competitor" hint="The crawler finds the recipe by competitor and page type." value={competitor} placeholder="zara"
                    onChange={e => setCompetitor(e.target.value)} />
                <TextField label="Page type" value={pageType} placeholder={PAGE_TYPE[kind]} onChange={e => setPageType(e.target.value)} />
                <TextField label="Name" value={name} onChange={e => { setNamed(true); setName(e.target.value); }} />
                <Button variant="primary" disabled={!ready}
                    onClick={() => onStart(kind, { name: name.trim(), competitor: competitor.trim().toLowerCase(), pageType: pageType.trim().toLowerCase() })}>
                    Pick it on this page
                </Button>
            </div>
        </Dialog>
    );
}
