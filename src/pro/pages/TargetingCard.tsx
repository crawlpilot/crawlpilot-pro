/**
 * What the crawler workers find a recipe by: its competitor and page type, and, when several recipes share
 * those, the URLs it is for. Edited in a dialog that shows, as you type, any sample page the rules leave
 * out. Until the competitor and page type are set, the recipe cannot be submitted.
 */
import { useState } from 'react';
import { Crosshair, Pencil } from 'lucide-react';
import { Button, Card, Chip, Dialog, Notice, Text, TextArea, TextField } from '../../sidepanel/ui';
import { pro } from '../db';
import { targetingReasons, uncoveredSamples } from '../recipe/targeting';
import type { MatchRules, ProRecipe } from '../recipe/types';

interface Props {
    recipe: ProRecipe;
    samples: string[];
    onSaved: () => void;
}

const lines = (text: string) => text.split('\n').map(l => l.trim()).filter(Boolean);

export function TargetingCard({ recipe, samples, onSaved }: Props) {
    const [editing, setEditing] = useState(false);
    const [competitor, setCompetitor] = useState('');
    const [pageType, setPageType] = useState('');
    const [include, setInclude] = useState('');
    const [exclude, setExclude] = useState('');
    const [error, setError] = useState<string | null>(null);

    const open = () => {
        setCompetitor(recipe.competitor ?? '');
        setPageType(recipe.pageType ?? '');
        setInclude((recipe.matchRules?.include ?? []).join('\n'));
        setExclude((recipe.matchRules?.exclude ?? []).join('\n'));
        setError(null);
        setEditing(true);
    };

    const rules: MatchRules | undefined = lines(include).length ? { include: lines(include), exclude: lines(exclude) } : undefined;
    const left = uncoveredSamples(rules, samples);

    const save = async () => {
        try {
            await pro.recipes.setTargeting(recipe.id, { competitor, pageType, matchRules: rules });
            setEditing(false);
            onSaved();
        } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    };

    const missing = targetingReasons(recipe, samples);

    return (
        <Card className="flex flex-col gap-1.5" data-testid="pro-targeting">
            <div className="flex items-center gap-2">
                <Crosshair size={15} className="shrink-0 text-ink-3" />
                <Text size="small" weight="semibold" className="flex-1">Crawler targeting</Text>
                <Button size="sm" variant="ghost" icon={<Pencil />} onClick={open}>Edit targeting</Button>
            </div>
            <div className="flex flex-wrap gap-1">
                {recipe.competitor ? <Chip tone="neutral">{recipe.competitor}</Chip> : null}
                {recipe.pageType ? <Chip tone="neutral">{recipe.pageType}</Chip> : null}
            </div>
            {recipe.matchRules && (
                <Text size="caption" tone="muted" className="break-all">
                    For {recipe.matchRules.include.join(', ')}{recipe.matchRules.exclude?.length ? `, except ${recipe.matchRules.exclude.join(', ')}` : ''}
                </Text>
            )}
            {missing.length > 0 && <Text size="caption" tone="warning" data-testid="pro-targeting-missing">Needed to submit: {missing.join(' ')}</Text>}

            <Dialog open={editing} onClose={() => setEditing(false)} size="sm" title="Crawler targeting"
                description="Workers pick the live version of the recipe for a URL's competitor and page type."
                actions={<>
                    <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                    <Button variant="primary" onClick={save}>Save</Button>
                </>}>
                <div className="flex flex-col gap-3">
                    <TextField label="Competitor" value={competitor} onChange={e => setCompetitor(e.target.value)} placeholder="zara" autoFocus />
                    <TextField label="Page type" value={pageType} onChange={e => setPageType(e.target.value)} placeholder="product" />
                    <TextArea label="URLs it is for" mono rows={2} value={include} onChange={e => setInclude(e.target.value)}
                        placeholder="https://www.zara.com/*-p*.html*" hint="Optional. One per line; * matches anything. Only when several recipes share a competitor and page type." />
                    <TextArea label="Except" mono rows={2} value={exclude} onChange={e => setExclude(e.target.value)} placeholder="*/kids/*" />
                    {left.length > 0 && <Notice tone="warning">These rules leave out {left.length} sample page{left.length === 1 ? '' : 's'}: {left.join(', ')}</Notice>}
                    {error && <Notice tone="danger">{error}</Notice>}
                </div>
            </Dialog>
        </Card>
    );
}
