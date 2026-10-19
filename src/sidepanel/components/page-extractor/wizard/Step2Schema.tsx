import { useEffect, useState } from 'react';
import { HighlightSender } from '../../../../shared/messages';
import { PickerControls } from '../../shared/PickerControls';
import { ArrowRight, Crosshair, Image as ImageIcon, Link2, List, MousePointerClick, Pencil, Sparkles, Type, X, Zap } from 'lucide-react';
import AiSchemaDialog from '../AiSchemaDialog';
import { Button, Card, CardButton, Chip, Dialog, Heading, IconButton, Select, Spinner, Stack, Text, TextArea, TextField } from '../../../ui';

interface Step2SchemaProps {
    elements: any[];
    selectionStatus: 'idle' | 'selecting' | 'ready';
    isTabLoading?: boolean;
    startSelection: (mode: 'list' | 'nextButton' | 'detail', action?: 'extract' | 'click') => void;
    handleDeleteElement: (id: string) => void;
    handleClearAllElements: () => void;
    handleChangeElementType: (id: string, newType: string) => void;
    handleEditElement: (el: any) => void;
    /** Opens the picker on the field to make it wider or narrower (plan L6). */
    handleAdjustElement?: (el: any) => void;
    /** Picks the field again, in place (it isn't on the page any more). */
    handleRepickElement?: (el: any) => void;
    /** A field Adjust couldn't find on the page. */
    missingField?: { id: string; error: string } | null;
    showEditModal: boolean;
    setShowEditModal: (show: boolean) => void;
    pendingElement: any;
    setPendingElement: (el: any) => void;
    elementName: string;
    setElementName: (name: string) => void;
    elementAction: 'extract' | 'click';
    handleSaveElement: () => void;
    onBack: () => void;
    onNext: () => void;
    onCancel: () => void;
    sendHighlightMessage: HighlightSender;
    /** Adds fields built by the AI schema flow. */
    onAddElements?: (elements: any[]) => void;
}

export function Step2Schema({
    elements,
    selectionStatus,
    isTabLoading = false,
    startSelection,
    handleDeleteElement,
    handleClearAllElements,
    handleChangeElementType,
    handleEditElement,
    handleAdjustElement,
    handleRepickElement,
    missingField,
    showEditModal,
    setShowEditModal,
    pendingElement,
    setPendingElement,
    elementName,
    setElementName,
    elementAction,
    handleSaveElement,
    onBack,
    onNext,
    onCancel,
    sendHighlightMessage,
    onAddElements
}: Step2SchemaProps) {
    const [aiOpen, setAiOpen] = useState(false);
    // --- Persistent Selection Highlights Sync ---
    useEffect(() => {
        // Show highlights for all already-selected elements when Step 2 mounts
        if (elements.length > 0) {
            sendHighlightMessage('SHOW_SELECTION_HIGHLIGHTS', { elements });
        }

        // Clear highlights when Step 2 unmounts (user leaves this step)
        return () => {
            sendHighlightMessage('CLEAR_SELECTION_HIGHLIGHTS');
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Only on mount/unmount


    const fieldCount = elements.filter(el => el.action !== 'click').length;
    const clickCount = elements.filter(el => el.action === 'click').length;
    const kindIcon = (el: any) => el.action === 'click' ? <Zap /> : el.type === 'image' ? <ImageIcon /> : el.type === 'link' ? <Link2 /> : el.type === 'list' || el.type === 'table' ? <List /> : <Type />;

    return (
        <Stack gap={4} className="animate-slide-up">
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <Heading size="heading">Pick the fields</Heading>
                    <div className="mt-1 flex flex-wrap gap-1">
                        {fieldCount > 0 && <Chip tone="success">{fieldCount} field{fieldCount !== 1 ? 's' : ''}</Chip>}
                        {clickCount > 0 && <Chip tone="warning">{clickCount} click{clickCount !== 1 ? 's' : ''}</Chip>}
                        {elements.length === 0 && <Text size="small" tone="muted">Point at what you want from each page.</Text>}
                    </div>
                </div>
                {elements.length > 0 && (
                    <Button size="sm" variant="ghost" className="shrink-0 text-danger" onClick={() => { handleClearAllElements(); sendHighlightMessage('CLEAR_SELECTION_HIGHLIGHTS'); }}>
                        Clear all
                    </Button>
                )}
            </div>

            {isTabLoading && selectionStatus !== 'selecting' && (
                <Card tone="sunken" className="flex flex-col items-center gap-2.5 text-center">
                    <Spinner size={26} />
                    <div>
                        <Text weight="semibold">Page loading…</Text>
                        <Text size="caption" tone="muted">Wait for the page to finish loading before picking elements.</Text>
                    </div>
                </Card>
            )}

            {selectionStatus === 'selecting' && <PickerControls onCancel={onCancel} />}

            {elements.length === 0 && selectionStatus !== 'selecting' ? (
                <div className="grid grid-cols-2 gap-2">
                    <CardButton tone="lilac" pad="sm" onClick={() => startSelection('detail', 'extract')} className="flex flex-col items-start gap-1">
                        <span className="mb-1 flex size-8 items-center justify-center rounded-lg bg-surface/80 text-ink"><MousePointerClick size={16} /></span>
                        <Text size="small" weight="semibold">Pick data fields</Text>
                        <Text size="caption" tone="muted">Text, links or images to take from each page</Text>
                    </CardButton>
                    <CardButton tone="butter" pad="sm" onClick={() => startSelection('detail', 'click')} className="flex flex-col items-start gap-1">
                        <span className="mb-1 flex size-8 items-center justify-center rounded-lg bg-surface/80 text-ink"><Zap size={16} /></span>
                        <Text size="small" weight="semibold">Add a click</Text>
                        <Text size="caption" tone="muted">Open tabs, dropdowns, “Show more” or close a cookie banner first</Text>
                    </CardButton>
                </div>
            ) : elements.length > 0 && (
                <Stack gap={1.5}>
                    {elements.map((el) => (
                        <div key={el.id} className="group rounded-field border border-line bg-surface p-2.5">
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex min-w-0 items-center gap-2.5">
                                    <span className={`flex size-7 shrink-0 items-center justify-center rounded-lg [&_svg]:size-3.5 ${el.action === 'click' ? 'bg-tile-butter' : 'bg-tile-lilac'} text-ink`}>{kindIcon(el)}</span>
                                    <div className="min-w-0">
                                        <Text size="small" weight="semibold" truncate>{el.name}</Text>
                                        <Text size="caption" tone="faint" mono truncate>{el.value || 'No preview'}</Text>
                                    </div>
                                </div>
                                <div className="flex shrink-0 items-center">
                                    {handleAdjustElement && <IconButton size="sm" label="Adjust on the page (wider or narrower)" onClick={() => handleAdjustElement(el)} disabled={selectionStatus === 'selecting'}><Crosshair /></IconButton>}
                                    <IconButton size="sm" label="Edit" onClick={() => handleEditElement(el)}><Pencil /></IconButton>
                                    <IconButton size="sm" label="Remove" className="hover:text-danger" onClick={() => handleDeleteElement(el.id)}><X /></IconButton>
                                </div>
                            </div>
                            {missingField?.id === el.id && (
                                <div className="mt-2 flex items-center justify-between gap-2 rounded-field bg-danger-soft px-2.5 py-1.5">
                                    <Text size="caption">{missingField?.error}</Text>
                                    {handleRepickElement && <Button size="sm" variant="ghost" onClick={() => handleRepickElement(el)}>Pick again</Button>}
                                </div>
                            )}
                            {el.action === 'extract' && (
                                <Select size="sm" className="mt-2" aria-label="Type" value={el.type || 'text'} onChange={v => handleChangeElementType(el.id, v)}
                                    options={[
                                        { value: 'text', label: 'Text' },
                                        { value: 'link', label: 'Link (href)' },
                                        { value: 'image', label: 'Image (src)' },
                                        { value: 'list', label: 'List (rows)' },
                                        { value: 'table', label: 'Table (rows)' },
                                    ]} />
                            )}
                        </div>
                    ))}
                    <div className="mt-1 flex gap-2">
                        <Button size="sm" className="flex-1 border-dashed" icon={<MousePointerClick />} onClick={() => startSelection('detail', 'extract')}>Add field</Button>
                        <Button size="sm" className="flex-1 border-dashed" icon={<Zap />} onClick={() => startSelection('detail', 'click')}>Add a click</Button>
                    </div>
                    <Text size="caption" tone="muted">
                        <b>Add field</b> takes text, links or images from each page. <b>Add a click</b> clicks before reading, to reveal hidden content: dropdowns, accordions, tabs, overlays or cookie banners.
                    </Text>
                </Stack>
            )}

            {onAddElements && selectionStatus !== 'selecting' && (
                <>
                    <Button fullWidth variant="ghost" icon={<Sparkles />} onClick={() => setAiOpen(true)}>Fill fields from a schema (on-device AI)</Button>
                    <AiSchemaDialog open={aiOpen} onClose={() => setAiOpen(false)} onAddElements={onAddElements} />
                </>
            )}

            <Dialog open={showEditModal} onClose={() => setShowEditModal(false)} size="sm" title="Name this field"
                actions={<>
                    <Button variant="ghost" onClick={() => setShowEditModal(false)}>Cancel</Button>
                    <Button variant="primary" onClick={handleSaveElement} disabled={!elementName.trim()}>Save field</Button>
                </>}>
                <Stack gap={3}>
                    <TextField label="Field name" value={elementName} onChange={e => setElementName(e.target.value)} placeholder="e.g. title, price, description" autoFocus />
                    {elementAction === 'extract' && pendingElement && (
                        <Select label="What to take" value={pendingElement.type || 'text'} onChange={v => setPendingElement({ ...pendingElement, type: v })}
                            options={[
                                { value: 'text', label: 'Text (default)' },
                                { value: 'link', label: 'Link target (href)' },
                                { value: 'image', label: 'Image source (src)' },
                                { value: 'list', label: 'Structured fields (smart)' },
                                { value: 'table', label: 'Table data' },
                            ]} />
                    )}
                    <div className="rounded-field bg-surface-2 p-3">
                        <Text size="caption" tone="muted">Preview</Text>
                        <Text size="small" mono truncate>{pendingElement?.value || 'No content'}</Text>
                    </div>
                    {pendingElement && (
                        <TextArea mono rows={3} label="Selectors" hint="CSS or XPath, one per line, best first; later lines are backups."
                            value={(pendingElement.selectors ?? []).join('\n')}
                            onChange={e => setPendingElement({ ...pendingElement, selectors: e.target.value.split('\n') })} />
                    )}
                </Stack>
            </Dialog>

            <div className="flex justify-between gap-3 border-t border-line pt-4">
                <Button variant="ghost" onClick={onBack}>Back</Button>
                <Button variant="primary" onClick={onNext} disabled={elements.length === 0} iconEnd={<ArrowRight />}>Review & run</Button>
            </div>
        </Stack>
    );
}
