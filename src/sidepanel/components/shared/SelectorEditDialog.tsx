import React, { useState, useEffect } from 'react';
import { Plus, Check, Play, Trash2 } from 'lucide-react';
import { Button, Chip, Dialog, IconButton, Select, Stack, Text, TextField } from '../../ui';
import { looksLikeXPath } from '../../../shared/selectors/resolve';
import { selectorFamily } from '../../../shared/selectors/grade';

interface SelectorEditDialogProps {
    isOpen: boolean;
    title: string;
    /** The chain, best first. */
    selectors: string[];
    onSave: (selectors: string[]) => void;
    onCancel: () => void;
    onVerify: (selector: string) => void;
}

interface SelectorItem {
    id: string;
    value: string;
    type: 'CSS' | 'XPath';
}

export const SelectorEditDialog: React.FC<SelectorEditDialogProps> = ({
    isOpen,
    title,
    selectors: initialSelectors,
    onSave,
    onCancel,
    onVerify
}) => {
    const [selectors, setSelectors] = useState<SelectorItem[]>([]);

    useEffect(() => {
        if (isOpen) {
            const items: SelectorItem[] = (initialSelectors.length > 0 ? initialSelectors : ['']).map((s, i) => ({
                id: `sel-${Date.now()}-${i}`,
                value: s,
                type: looksLikeXPath(s) ? 'XPath' : 'CSS',
            }));
            setSelectors(items);
        }
    }, [isOpen, initialSelectors]);

    const handleAdd = () => {
        setSelectors([...selectors, { id: `sel-${Date.now()}`, value: '', type: 'CSS' }]);
    };

    const handleRemove = (id: string) => {
        setSelectors(selectors.filter(s => s.id !== id));
    };

    const handleChange = (id: string, newValue: string) => {
        setSelectors(selectors.map(s => {
            if (s.id === id) {
                const isXPath = typeof newValue === 'string' && looksLikeXPath(newValue);
                const newType = isXPath ? 'XPath' : 'CSS';
                return { ...s, value: newValue, type: newType };
            }
            return s;
        }));
    };

    const handleTypeChange = (id: string, newType: 'CSS' | 'XPath') => {
        setSelectors(selectors.map(s => s.id === id ? { ...s, type: newType } : s));
    };

    const handleSave = () => {
        onSave(selectors.map(s => s.value.trim()).filter(Boolean));
    };

    return (
        <Dialog open={isOpen} onClose={onCancel} size="lg" title={title} description="The first one is used; the others are backups if the page changes."
            actions={<>
                <Button variant="ghost" onClick={onCancel}>Cancel</Button>
                <Button variant="primary" icon={<Check />} onClick={handleSave}>Apply changes</Button>
            </>}>
            <Stack gap={2.5}>
                {selectors.map((sel, index) => (
                    <div key={sel.id} className="rounded-2xl border border-line bg-surface-2/60 p-3">
                        <div className="mb-2 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Text size="caption" weight="semibold" tone="muted">{index === 0 ? 'Selector' : `Backup ${index}`}</Text>
                                {sel.value.trim() && <Chip tone="outline">{selectorFamily(sel.value.trim())}</Chip>}
                            </div>
                            <IconButton size="sm" label="Remove" onClick={() => handleRemove(sel.id)}><Trash2 /></IconButton>
                        </div>
                        <div className="flex gap-2">
                            <Select size="sm" className="w-[92px] shrink-0" aria-label="Type" value={sel.type}
                                onChange={(v: 'CSS' | 'XPath') => handleTypeChange(sel.id, v)}
                                options={[{ value: 'CSS', label: 'CSS' }, { value: 'XPath', label: 'XPath' }]} />
                            <TextField size="sm" className="flex-1" inputClassName="font-mono" aria-label={`Selector ${index + 1}`} value={sel.value}
                                onChange={e => handleChange(sel.id, e.target.value)}
                                placeholder={sel.type === 'CSS' ? '.class-name' : "//div[@id='foo']"} />
                            <IconButton variant="secondary" size="md" label="Verify on page" onClick={() => onVerify(sel.value)}><Play /></IconButton>
                        </div>
                    </div>
                ))}
                <Button fullWidth icon={<Plus />} onClick={handleAdd} className="border-dashed">Add alternative selector</Button>
            </Stack>
        </Dialog>
    );
};
