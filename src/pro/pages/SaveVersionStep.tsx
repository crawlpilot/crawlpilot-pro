/**
 * An extractor's last step in a recipe session: save the picks as a version, with a note, instead of
 * running them. A new recipe also gets its name here. A save from a stale version or with no change is
 * refused and said so; nothing is overwritten.
 */
import { useState } from 'react';
import { ArrowLeft, BookOpen, ClipboardCheck, Save } from 'lucide-react';
import { openNext } from '../nav';
import { Button, Card, Notice, Select, Text, TextArea, TextField } from '../../sidepanel/ui';
import type { ProEdit } from '../edit';
import type { FieldType, ProRecipe, Version } from '../recipe/types';

interface Props {
    edit: ProEdit;
    /** The site a new recipe is for. */
    site: string;
    /** What is being saved, in one line ("3 fields · 1 click · 2 pages"). */
    summary: string;
    canSave: boolean;
    /** A page recipe's fields: their proposed names and output types, set here before saving. */
    fields?: NamedField[];
    save: (name: string, note: string, fields?: NamedField[]) => Promise<{ recipe: ProRecipe; version: Version }>;
    onBack: () => void;
    /** Back to the Recipes screen. */
    onDone: () => void;
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A field in the save step: its name and output type, the value it read, and where the name came from. */
export interface NamedField {
    id: string;
    name: string;
    type: FieldType;
    why: string;
    value?: unknown;
}

const TYPES: FieldType[] = ['text', 'number', 'integer', 'money', 'date', 'url', 'boolean', 'enum', 'list', 'object', 'table'];
const preview = (v: unknown) => v === undefined || v === null || v === '' ? '' : (typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 80);

export function SaveVersionStep({ edit, site, summary, canSave, fields: proposed, save, onBack, onDone }: Props) {
    const [fields, setFields] = useState<NamedField[]>(proposed ?? []);
    const names = fields.map(f => f.name.trim());
    const nameProblem = names.some(n => !n) ? 'Every field needs a name.'
        : names.some((n, i) => names.indexOf(n) !== i) ? 'Two fields have the same name.' : null;
    const [name, setName] = useState(edit.recipe?.name ?? edit.draft?.name ?? (site ? `${site} · ${edit.kind === 'list' ? 'list' : 'page details'}` : ''));
    const [note, setNote] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState<{ id: string; name: string; version: number } | null>(null);
    const editing = edit.recipe && edit.version;

    const onSave = async () => {
        setSaving(true);
        setError(null);
        try {
            const { recipe, version } = await save(name, note, fields.length ? fields : undefined);
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
                {edit.draft && <Text size="caption" tone="faint">For {edit.draft.competitor} · {edit.draft.pageType}</Text>}
                {editing && <Text size="caption" tone="faint">Edited from version {edit.version!.version}</Text>}
            </Card>
            {!editing && <TextField label="Recipe name" value={name} onChange={e => setName(e.target.value)} />}
            {fields.length > 0 && (
                <Card className="flex flex-col gap-2" data-testid="pro-save-fields">
                    <Text weight="semibold">Fields</Text>
                    <Text size="caption" tone="muted">Named and typed as the crawler will output them. Change any that's wrong.</Text>
                    {fields.map((f, i) => (
                        <div key={f.id} className="flex flex-col gap-0.5" data-testid="pro-save-field">
                            <div className="flex items-end gap-2">
                                <TextField size="sm" className="flex-1" label={`Field ${i + 1}`} value={f.name}
                                    onChange={e => setFields(fields.map(x => x.id === f.id ? { ...x, name: e.target.value } : x))} />
                                <Select<FieldType> size="sm" aria-label={`Type of field ${i + 1}`} value={f.type} options={TYPES.map(t => ({ value: t, label: t }))}
                                    onChange={t => setFields(fields.map(x => x.id === f.id ? { ...x, type: t } : x))} />
                            </div>
                            <Text size="caption" tone="faint" className="break-all">
                                {preview(f.value) ? `${preview(f.value)} · ` : ''}{f.why === 'given' ? 'as named' : `named from ${f.why}`}
                            </Text>
                        </div>
                    ))}
                    {nameProblem && <Text size="caption" tone="danger">{nameProblem}</Text>}
                </Card>
            )}
            <TextArea label="What changed" hint="Kept with the version, shown in its history." value={note} rows={2}
                placeholder={editing ? 'Price read from the page data first' : 'First version'} onChange={e => setNote(e.target.value)} />
            {error && <Notice tone="danger">{error}</Notice>}
            <div className="flex gap-2">
                <Button variant="ghost" icon={<ArrowLeft />} onClick={onBack}>Back</Button>
                <Button variant="primary" className="flex-1" icon={<Save />} loading={saving}
                    disabled={!canSave || !!nameProblem || (!editing && !name.trim())} onClick={onSave}>Save version</Button>
            </div>
        </div>
    );
}
