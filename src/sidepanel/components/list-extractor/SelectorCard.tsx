import { useState } from 'react';
import { CheckCircle2, Edit, Eye, Trash2, Database } from 'lucide-react';
import { SelectorState } from '../../../shared/types/extraction';
import { SelectorEditDialog } from '../shared/SelectorEditDialog';
import { FieldEditor } from './FieldEditor';
import { Box, Card, Typography, IconButton, Button, Stack, Chip } from '@mui/material';

function getSelectorQuality(selector: string): { label: string; color: 'success' | 'warning' | 'error' } {
    if (!selector) return { label: 'None', color: 'error' };
    if (selector.includes('[data-') || selector.includes(':has(') || selector.includes('[role') || selector.includes('[aria-')) {
        return { label: 'Semantic', color: 'success' };
    }
    if (selector.includes('.') && !selector.startsWith('div >') && !selector.startsWith('main >')) {
        return { label: 'Class-based', color: 'success' };
    }
    // Structural: contains > combinators with no class or attribute anchor
    if ((selector.match(/>/g) || []).length >= 3 && !selector.includes('.') && !selector.includes('[')) {
        return { label: 'Structural', color: 'error' };
    }
    return { label: 'Generic', color: 'warning' };
}

interface SelectorCardProps {
    selector: SelectorState;
    onUpdate: (id: string, updates: Partial<SelectorState>) => void;
    onRemove: (id: string) => void;
    onTest: (selector: string) => void;
}

export function SelectorCard({ selector, onUpdate, onRemove, onTest }: SelectorCardProps) {
    const [editMode, setEditMode] = useState<'container' | 'items' | null>(null);

    return (
        <Card
            variant="outlined"
            sx={{
                p: 2,
                borderRadius: 3,
                borderColor: 'primary.main',
                bgcolor: 'background.paper',
                position: 'relative',
                overflow: 'visible'
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Box sx={{
                        width: 32,
                        height: 32,
                        borderRadius: '50%',
                        bgcolor: 'success.light',
                        color: 'success.dark',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        opacity: 0.2
                    }}>
                        <CheckCircle2 size={16} style={{ opacity: 1 }} />
                    </Box>
                    <Box>
                        <Typography variant="subtitle2" fontWeight="600">
                            {selector.patternFound ? 'Repeating Pattern Found' : 'Single Element Selected'}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                            {selector.count} matching items on page
                        </Typography>
                    </Box>
                </Box>

                <Stack direction="row" spacing={0.5}>
                    <IconButton
                        size="small"
                        onClick={async () => {
                            if (selector.data) {
                                try {
                                    const { db } = await import('../../../shared/db');
                                    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                                    const pageTitle = tab?.title || new URL(selector.data.source_url || window.location.href).hostname;

                                    const tableId = await db.tables.save(selector.data, {
                                        name: pageTitle,
                                        preview: true
                                    });

                                    const url = chrome.runtime.getURL(`sidepanel.html?view=data-table&tableId=${tableId}`);
                                    chrome.windows.create({
                                        url: url,
                                        type: 'popup',
                                        width: 1000,
                                        height: 800
                                    });
                                } catch (e) {
                                    console.error('Failed to open preview', e);
                                }
                            }
                        }}
                        title="Preview Sample Data"
                        color="primary"
                    >
                        <Database size={16} />
                    </IconButton>
                    <IconButton
                        size="small"
                        onClick={() => onTest(selector.containerSelector)}
                        title="Highlight on page"
                    >
                        <Eye size={16} />
                    </IconButton>
                    <IconButton
                        size="small"
                        color="error"
                        onClick={() => onRemove(selector.id)}
                        title="Remove"
                    >
                        <Trash2 size={16} />
                    </IconButton>
                </Stack>
            </Box>

            <Stack spacing={2}>
                {/* 1. Container Selectors */}
                <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                        <Typography variant="caption" fontWeight="bold" color="text.secondary" textTransform="uppercase">
                            Parent Container
                        </Typography>
                        <Button
                            size="small"
                            startIcon={<Edit size={12} />}
                            onClick={() => setEditMode('container')}
                            sx={{ fontSize: '0.65rem', minWidth: 0, p: 0.5 }}
                        >
                            Edit
                        </Button>
                    </Box>
                    <Box sx={{
                        bgcolor: 'action.hover',
                        p: 1.5,
                        borderRadius: 2,
                        border: '1px solid',
                        borderColor: 'divider'
                    }}>
                        <Typography variant="caption" fontFamily="monospace" color="primary.main" sx={{ wordBreak: 'break-all' }}>
                            {selector.containerSelector}
                        </Typography>
                    </Box>
                </Box>

                {/* 2. Item Selectors */}
                <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="caption" fontWeight="bold" color="text.secondary" textTransform="uppercase">
                                Repeating Item Selector
                            </Typography>
                            {selector.itemSelector && (
                                <Chip
                                    label={getSelectorQuality(selector.itemSelector).label}
                                    size="small"
                                    color={getSelectorQuality(selector.itemSelector).color}
                                    variant="outlined"
                                    sx={{ fontSize: '0.65rem', height: 20 }}
                                />
                            )}
                        </Box>
                        <Button
                            size="small"
                            startIcon={<Edit size={12} />}
                            onClick={() => setEditMode('items')}
                            sx={{ fontSize: '0.65rem', minWidth: 0, p: 0.5 }}
                        >
                            Edit
                        </Button>
                    </Box>
                    <Box sx={{
                        bgcolor: 'action.hover',
                        p: 1.5,
                        borderRadius: 2,
                        border: '1px solid',
                        borderColor: 'divider'
                    }}>
                        <Typography variant="caption" fontFamily="monospace" color="success.main" sx={{ wordBreak: 'break-all' }}>
                            {selector.itemSelector}
                        </Typography>
                    </Box>
                </Box>

                {/* 3. Fields: what the run will extract, one column each */}
                {selector.data?.columns?.length > 0 && (
                    <FieldEditor data={selector.data} onChange={data => onUpdate(selector.id, { data })} />
                )}
            </Stack>

            {/* Editor Modal for Container */}
            <SelectorEditDialog
                isOpen={editMode === 'container'}
                title="Edit List Container Selectors"
                selectors={selector.containerSelectors && selector.containerSelectors.length > 0
                    ? selector.containerSelectors
                    : [{ selector: selector.containerSelector, strategy: 'Manual' }]
                }
                onSave={(newSelectors) => {
                    const primary = newSelectors[0].selector;
                    onUpdate(selector.id, {
                        containerSelector: primary,
                        containerSelectors: newSelectors
                    });
                    setEditMode(null);
                }}
                onCancel={() => setEditMode(null)}
                onVerify={onTest}
            />

            {/* Editor Modal for Items */}
            <SelectorEditDialog
                isOpen={editMode === 'items'}
                title="Edit Item Unit Selectors"
                selectors={selector.itemSelectors && selector.itemSelectors.length > 0
                    ? selector.itemSelectors
                    : (selector.itemSelector ? [{ selector: selector.itemSelector, strategy: 'Manual' }] : [])
                }
                onSave={(newSelectors) => {
                    const primary = newSelectors[0]?.selector;
                    if (primary) {
                        onUpdate(selector.id, {
                            itemSelector: primary,
                            itemSelectors: newSelectors
                        });
                    }
                    setEditMode(null);
                }}
                onCancel={() => setEditMode(null)}
                onVerify={onTest}
            />
        </Card>
    );
}
