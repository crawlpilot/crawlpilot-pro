import { useState } from 'react';
import { CheckCircle2, Edit, Eye, Trash2, Database } from 'lucide-react';
import type { ListPick } from '../../../shared/types/extraction';
import { SelectorEditDialog } from '../shared/SelectorEditDialog';
import { FieldEditor } from './FieldEditor';
import { Button, Card, Chip, IconButton, Row, Stack, Text } from '../../ui';

function getSelectorQuality(selector: string): { label: string; color: 'success' | 'warning' | 'danger' } {
    if (!selector) return { label: 'None', color: 'danger' };
    if (selector.includes('[data-') || selector.includes(':has(') || selector.includes('[role') || selector.includes('[aria-')) {
        return { label: 'Semantic', color: 'success' };
    }
    if (selector.includes('.') && !selector.startsWith('div >') && !selector.startsWith('main >')) {
        return { label: 'Class-based', color: 'success' };
    }
    // Structural: contains > combinators with no class or attribute anchor
    if ((selector.match(/>/g) || []).length >= 3 && !selector.includes('.') && !selector.includes('[')) {
        return { label: 'Structural', color: 'danger' };
    }
    return { label: 'Generic', color: 'warning' };
}

interface SelectorCardProps {
    selector: ListPick;
    onUpdate: (id: string, updates: Partial<ListPick>) => void;
    onRemove: (id: string) => void;
    onTest: (selector: string) => void;
}

export function SelectorCard({ selector, onUpdate, onRemove, onTest }: SelectorCardProps) {
    const [editMode, setEditMode] = useState<'container' | 'items' | null>(null);

    const openPreview = async () => {
        if (!selector.data) return;
        try {
            const { db } = await import('../../../shared/db');
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            const pageTitle = tab?.title || new URL(selector.data.source_url || window.location.href).hostname;
            const tableId = await db.tables.save(selector.data, { name: pageTitle, preview: true });
            const url = chrome.runtime.getURL(`sidepanel.html?view=data-table&tableId=${tableId}`);
            chrome.windows.create({ url, type: 'popup', width: 1000, height: 800 });
        } catch (e) {
            console.error('Failed to open preview', e);
        }
    };
    const quality = selector.items[0] ? getSelectorQuality(selector.items[0]) : null;

    return (
        <Card>
            <Row justify="between" align="start" className="mb-4">
                <Row gap={2.5} align="start" className="min-w-0">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-success-soft text-success"><CheckCircle2 size={16} /></span>
                    <div className="min-w-0">
                        <Text weight="semibold">{selector.patternFound ? 'Repeating pattern found' : 'Single element selected'}</Text>
                        <Text size="caption" tone="muted">{selector.label ?? `${selector.count} matching items on page`}</Text>
                    </div>
                </Row>
                <Row gap={0.5} className="-mr-1.5 shrink-0">
                    <IconButton size="sm" label="Preview sample data" onClick={openPreview}><Database /></IconButton>
                    <IconButton size="sm" label="Highlight on page" onClick={() => onTest(selector.container[0] ?? '')}><Eye /></IconButton>
                    <IconButton size="sm" label="Remove" variant="danger" className="border-0" onClick={() => onRemove(selector.id)}><Trash2 /></IconButton>
                </Row>
            </Row>

            <Stack gap={3}>
                <SelectorBlock title="Parent container" chain={selector.container} onEdit={() => setEditMode('container')} />
                <SelectorBlock title="Repeating item" chain={selector.items} onEdit={() => setEditMode('items')}
                    chip={quality && <Chip tone={quality.color}>{quality.label}</Chip>} />
                {selector.data?.columns?.length > 0 && (
                    <FieldEditor data={selector.data} onChange={data => onUpdate(selector.id, { data })} />
                )}
            </Stack>

            <SelectorEditDialog
                isOpen={editMode === 'container'}
                title="Edit List Container Selectors"
                selectors={selector.container}
                onSave={(container) => {
                    if (container.length > 0) onUpdate(selector.id, { container });
                    setEditMode(null);
                }}
                onCancel={() => setEditMode(null)}
                onVerify={onTest}
            />
            <SelectorEditDialog
                isOpen={editMode === 'items'}
                title="Edit Item Unit Selectors"
                selectors={selector.items}
                onSave={(items) => {
                    if (items.length > 0) onUpdate(selector.id, { items });
                    setEditMode(null);
                }}
                onCancel={() => setEditMode(null)}
                onVerify={onTest}
            />
        </Card>
    );
}

/** A selector with its backups count and an Edit button. */
function SelectorBlock({ title, chain, chip, onEdit }: { title: string; chain: string[]; chip?: React.ReactNode; onEdit: () => void }) {
    return (
        <div>
            <Row justify="between" className="mb-1">
                <Row gap={1.5}>
                    <Text size="caption" weight="semibold" tone="muted">{title}</Text>
                    {chip}
                </Row>
                <Button size="sm" variant="ghost" icon={<Edit />} onClick={onEdit} className="-mr-2 h-7">Edit</Button>
            </Row>
            <div className="rounded-field bg-surface-2 px-3 py-2 font-mono text-caption break-all text-ink">
                {chain[0]}
                {chain.length > 1 && <span className="text-ink-3">{` +${chain.length - 1} backup${chain.length > 2 ? 's' : ''}`}</span>}
            </div>
        </div>
    );
}
