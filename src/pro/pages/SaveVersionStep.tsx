/**
 * An extractor's last step in a recipe session: save the picks as a version, with a note, instead of
 * running them. A new recipe also gets its name here. A save from a stale version or with no change is
 * refused and said so; nothing is overwritten.
 */
import { useState } from 'react';
import { ArrowLeft, BookOpen, ClipboardCheck, Save } from 'lucide-react';
import { openNext } from '../nav';
import { Button, Card, Notice, Text, TextArea, TextField } from '../../sidepanel/ui';
import type { ProEdit } from '../edit';
import type { ProRecipe, Version } from '../recipe/types';

interface Props {
    edit: ProEdit;
    /** The site a new recipe is for. */
    site: string;
    /** What is being saved, in one line ("3 fields · 1 click · 2 pages"). */
    summary: string;
    canSave: boolean;
    save: (name: string, note: string) => Promise<{ recipe: ProRecipe; version: Version }>;
    onBack: () => void;
    /** Back to the Recipes screen. */
    onDone: () => void;
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function SaveVersionStep({ edit, site, summary, canSave, save, onBack, onDone }: Props) {
    const [name, setName] = useState(edit.recipe?.name ?? (site ? `${site} · ${edit.kind === 'list' ? 'list' : 'page details'}` : ''));
    const [note, setNote] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState<{ id: string; name: string; version: number } | null>(null);
    const editing = edit.recipe && edit.version;

    const onSave = async () => {
        setSaving(true);
        setError(null);
        try {
            const { recipe, version } = await save(name, note);
            setSaved({ id: recipe.id, name: recipe.name, version: version.version });
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setSaving(false);
        }
    };

    if (saved) {
        return (
            <div className="flex flex-col gap-3">
                <Notice tone="success" title={`Saved ${saved.name} v${saved.version}`}>
                    {edit.kind === 'page' ? 'Nothing ran. Next, check what it reads on this page.' : 'Nothing ran. Test and submit it from Recipes.'}
                </Notice>
                {edit.kind === 'page' && <Button variant="primary" icon={<ClipboardCheck />} onClick={() => { openNext(saved.id, 'pro-check'); onDone(); }}>Check it on this page</Button>}
                <Button variant={edit.kind === 'page' ? 'ghost' : 'primary'} icon={<BookOpen />} onClick={onDone}>Back to recipes</Button>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3" data-testid="pro-save-version">
            <Card className="flex flex-col gap-1">
                <Text weight="semibold">{editing ? `${edit.recipe!.name}: version ${edit.version!.version + 1}` : `A new ${edit.kind} recipe`}</Text>
                <Text size="caption" tone="muted">{summary}{site ? ` · ${site}` : ''}</Text>
                {editing && <Text size="caption" tone="faint">Edited from version {edit.version!.version}</Text>}
            </Card>
            {!editing && <TextField label="Recipe name" value={name} onChange={e => setName(e.target.value)} />}
            <TextArea label="What changed" hint="Kept with the version, shown in its history." value={note} rows={2}
                placeholder={editing ? 'Price read from the page data first' : 'First version'} onChange={e => setNote(e.target.value)} />
            {error && <Notice tone="danger">{error}</Notice>}
            <div className="flex gap-2">
                <Button variant="ghost" icon={<ArrowLeft />} onClick={onBack}>Back</Button>
                <Button variant="primary" className="flex-1" icon={<Save />} loading={saving}
                    disabled={!canSave || (!editing && !name.trim())} onClick={onSave}>Save version</Button>
            </div>
        </div>
    );
}
