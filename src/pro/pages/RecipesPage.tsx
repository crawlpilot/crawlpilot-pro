/**
 * Pro's home: every recipe with its labels (`latest vN`, `live vN`), import and export of
 * `.crawlpilot.json`, and Build new, which opens the public tools to pick a recipe on a page.
 * Internal tool, so the text is English only.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Download, FileText, Hammer, History, List, Pencil, Upload } from 'lucide-react';
import ToolHeader from '../../sidepanel/components/ui/ToolHeader';
import { Button, Chip, Dialog, EmptyState, IconButton, Notice, Text } from '../../sidepanel/ui';
import uniqlo from '../../shared/samples/recipes/uniqlo-product.json';
import zara from '../../shared/samples/recipes/zara-product.json';
import { pro } from '../db';
import { writeRecipeFile } from '../recipe/file';
import { LOCAL_AUTHOR, setProEdit } from '../edit';
import { openRecipe } from '../nav';
import type { ProRecipe, RecipeKind } from '../recipe/types';

interface Props {
    onNavigate: (view: string) => void;
}

function download(name: string, text: string) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    a.click();
    URL.revokeObjectURL(url);
}

const fileName = (r: ProRecipe) => `${r.name.replace(/[^\w.-]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}.crawlpilot.json`;

export default function RecipesPage({ onNavigate }: Props) {
    const [recipes, setRecipes] = useState<ProRecipe[] | null>(null);
    const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
    const [choosing, setChoosing] = useState(false);
    const input = useRef<HTMLInputElement>(null);

    const load = useCallback(() => pro.recipes.list().then(setRecipes), []);
    useEffect(() => { load(); }, [load]);

    const importTexts = async (texts: string[]) => {
        const done: string[] = [];
        try {
            for (const text of texts) {
                const { recipe, added } = await pro.importRecipeFile(text, LOCAL_AUTHOR);
                done.push(added ? `${recipe.name}: ${added} version${added > 1 ? 's' : ''} added` : `${recipe.name}: already up to date`);
            }
            setMessage({ tone: 'success', text: done.join(' · ') });
        } catch (e) {
            setMessage({ tone: 'danger', text: e instanceof Error ? e.message : String(e) });
        }
        load();
    };

    const onFiles = async (files: FileList | null) => {
        if (!files?.length) return;
        await importTexts(await Promise.all([...files].map(f => f.text())));
        if (input.current) input.current.value = '';
    };

    const extractor = (kind: RecipeKind) => kind === 'page' ? 'page-extractor' : 'list-extractor';

    /** A new recipe: its extractor opens on the current tab, and ends with Save version. */
    const buildNew = (kind: RecipeKind) => {
        setProEdit({ kind });
        onNavigate(extractor(kind));
    };

    /** Opens the latest version in the fields panel (re-picking on the page is one click from there). */
    const editRecipe = (r: ProRecipe) => {
        openRecipe(r.id);
        onNavigate('pro-editor');
    };

    const exportRecipe = async (r: ProRecipe) => {
        const [versions, samples] = await Promise.all([pro.versions.list(r.id), pro.samples.list(r.id)]);
        download(fileName(r), writeRecipeFile(r, versions, samples));
    };

    return (
        <div className="flex h-full flex-col">
            <ToolHeader
                title="Recipes"
                subtitle="Versioned crawl recipes"
                actions={<>
                    <Button size="sm" variant="ghost" icon={<Upload />} onClick={() => input.current?.click()}>Import</Button>
                    <Button size="sm" variant="primary" icon={<Hammer />} onClick={() => setChoosing(true)}>Build new</Button>
                </>}
            />
            <Dialog open={choosing} onClose={() => setChoosing(false)} size="sm" title="Build a new recipe" description="Pick it on the open page. Its last step saves version 1; nothing runs.">
                <div className="flex flex-col gap-2">
                    <Button variant="secondary" icon={<FileText />} onClick={() => buildNew('page')}>Page recipe: the same fields from each page</Button>
                    <Button variant="secondary" icon={<List />} onClick={() => buildNew('list')}>List recipe: every item in a list, page after page</Button>
                </div>
            </Dialog>
            <input ref={input} type="file" accept=".json,application/json" multiple hidden data-testid="recipe-import" onChange={e => onFiles(e.target.files)} />
            <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-4">
                {message && <Notice tone={message.tone} onClose={() => setMessage(null)}>{message.text}</Notice>}
                {recipes?.length === 0 && (
                    <EmptyState icon={<BookOpen />} title="No recipes yet"
                        action={<Button variant="primary" onClick={() => importTexts([JSON.stringify(uniqlo), JSON.stringify(zara)])}>Add the UNIQLO and ZARA samples</Button>}>
                        Build one on a page with Build new, or import a .crawlpilot.json file.
                    </EmptyState>
                )}
                {recipes?.map(r => (
                    <div key={r.id} className="flex items-start gap-3 rounded-card border border-line bg-surface p-3.5" data-testid="pro-recipe">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-tile-mint text-ink"><BookOpen size={17} /></span>
                        <div className="min-w-0 flex-1">
                            <Text weight="semibold" truncate title={r.name}>{r.name}</Text>
                            <Text size="caption" tone="faint" truncate>{r.site} · {r.kind} · updated {new Date(r.updatedAt).toLocaleDateString()}</Text>
                            <div className="mt-1.5 flex flex-wrap gap-1">
                                {r.labels.live ? <Chip tone="success">live v{r.labels.live}</Chip> : <Chip tone="neutral">draft</Chip>}
                                {r.labels.latest && <Chip tone="info">latest v{r.labels.latest}</Chip>}
                                {r.labels.test && <Chip tone="warning">test v{r.labels.test}</Chip>}
                            </div>
                        </div>
                        <IconButton label={`History of ${r.name}`} onClick={() => { openRecipe(r.id); onNavigate('pro-history'); }}><History /></IconButton>
                        <IconButton label={`Edit ${r.name}`} onClick={() => editRecipe(r)}><Pencil /></IconButton>
                        <IconButton label={`Export ${r.name}`} onClick={() => exportRecipe(r)}><Download /></IconButton>
                    </div>
                ))}
            </div>
        </div>
    );
}
