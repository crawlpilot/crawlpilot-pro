import { useEffect, useMemo, useState } from 'react';
import {
    Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, MenuItem, Select, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import { Braces } from 'lucide-react';
import {
    autoMap, checkContract, Contract, CONTRACT_PRESETS, contractFromFields, contractJsonSchema, FieldMapping, MappableColumn, REQUIRED_FLOOR, shapeRows,
} from '../../../shared/contracts/contract';
import { parseSchemaInput } from '../../../shared/ai/schemaIntake';
import { slug } from '../../../shared/utils/text';
import { downloadJson } from '../../services/download';

/** Saved with the table, so the mapping is there next time. */
export interface OutputMappingState {
    contractId: string;
    /** The pasted schema, for a custom contract. */
    customText?: string;
    mapping: FieldMapping;
}

interface Props {
    open: boolean;
    onClose: () => void;
    columns: MappableColumn[];
    rows: Record<string, unknown>[];
    tableName: string;
    saved?: OutputMappingState;
    onSave: (state: OutputMappingState) => void;
}

/**
 * Map a table's columns onto an output contract (the retail listing preset or a pasted schema), see
 * what's missing, and export JSON shaped to it, with the contract's JSON Schema.
 */
export default function SchemaMapDialog({ open, onClose, columns, rows, tableName, saved, onSave }: Props) {
    const [contractId, setContractId] = useState(saved?.contractId ?? CONTRACT_PRESETS[0].id);
    const [customText, setCustomText] = useState(saved?.customText ?? '');
    const [mapping, setMapping] = useState<FieldMapping>(saved?.mapping ?? {});

    const intake = useMemo(() => (contractId === 'custom' ? parseSchemaInput(customText) : null), [contractId, customText]);
    const contract: Contract | null = useMemo(() => {
        if (contractId !== 'custom') return CONTRACT_PRESETS.find(c => c.id === contractId) ?? null;
        return intake && !intake.error && intake.fields.length ? contractFromFields(intake.fields) : null;
    }, [contractId, intake]);

    // A new contract (or a first open) starts from the automatic mapping; saved choices win.
    useEffect(() => {
        if (!open || !contract) return;
        const auto = autoMap(contract, columns, rows);
        const keep = saved && saved.contractId === contractId ? saved.mapping : {};
        setMapping({ ...auto, ...Object.fromEntries(Object.entries(keep).filter(([f]) => f in auto)) });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, contract]);

    const shaped = useMemo(() => (contract ? shapeRows(contract, mapping, rows) : []), [contract, mapping, rows]);
    const report = useMemo(() => (contract ? checkContract(contract, mapping, shaped) : null), [contract, mapping, shaped]);

    const setField = (field: string, col: string) => {
        const next = { ...mapping, [field]: col || null };
        setMapping(next);
        onSave({ contractId, customText: contractId === 'custom' ? customText : undefined, mapping: next });
    };

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Braces size={18} /> Map to an output schema
            </DialogTitle>
            <DialogContent dividers>
                <Stack spacing={1.5}>
                    <Typography variant="body2" color="text.secondary">
                        Give the data the same shape whatever site it came from: map columns to fields, check what's missing, export JSON that follows the schema.
                    </Typography>
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        {CONTRACT_PRESETS.map(c => (
                            <Chip key={c.id} size="small" label={c.label} color={contractId === c.id ? 'primary' : 'default'} onClick={() => setContractId(c.id)} />
                        ))}
                        <Chip size="small" label="My schema" color={contractId === 'custom' ? 'primary' : 'default'} onClick={() => setContractId('custom')} />
                    </Stack>
                    {contractId === 'custom' && (
                        <TextField
                            multiline minRows={4} maxRows={10} size="small" value={customText}
                            onChange={e => setCustomText(e.target.value)}
                            placeholder={'Paste a JSON Schema or an example object, or one field per line:\ntitle\nprice: current price'}
                            inputProps={{ style: { fontFamily: 'monospace', fontSize: 12 } }}
                            helperText={intake?.error}
                            error={!!intake?.error && customText.trim().length > 0}
                        />
                    )}

                    {contract && report && (
                        <>
                            {report.unmappedRequired.length > 0 && (
                                <Alert severity="error" variant="outlined" sx={{ py: 0, fontSize: 12 }}>
                                    Required with no column: {report.unmappedRequired.join(', ')}
                                </Alert>
                            )}
                            {report.underFloor.length > 0 && (
                                <Alert severity="warning" variant="outlined" sx={{ py: 0, fontSize: 12 }}>
                                    Too often empty: {report.underFloor.map(u => `${u.name} ${Math.round(u.fill * 100)}% (needs ${Math.round(u.floor * 100)}%)`).join(', ')}
                                </Alert>
                            )}
                            {report.ok && (
                                <Alert severity="success" variant="outlined" sx={{ py: 0, fontSize: 12 }}>
                                    Every required field is mapped and filled. {rows.length} records ready.
                                </Alert>
                            )}
                            <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
                                {contract.fields.map((f, i) => {
                                    const fill = report.coverage[f.name] ?? 0;
                                    const floor = f.floor ?? (f.required ? REQUIRED_FLOOR : 0);
                                    return (
                                        <Box key={f.name} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.5, borderTop: i ? 1 : 0, borderColor: 'divider' }}>
                                            <Tooltip title={f.description ?? ''}>
                                                <Box sx={{ width: 130, minWidth: 0 }}>
                                                    <Typography variant="caption" fontWeight={600} noWrap component="div">
                                                        {f.name}{f.required ? ' *' : ''}
                                                    </Typography>
                                                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>{f.type}</Typography>
                                                </Box>
                                            </Tooltip>
                                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                                {f.runtime ? (
                                                    <Typography variant="caption" color="text.secondary">Filled by the export (row order)</Typography>
                                                ) : (
                                                    <Select
                                                        size="small" fullWidth displayEmpty value={mapping[f.name] ?? ''}
                                                        onChange={e => setField(f.name, String(e.target.value))}
                                                        sx={{ fontSize: 12, '& .MuiSelect-select': { py: 0.5 } }}
                                                    >
                                                        <MenuItem value="" sx={{ fontSize: 12 }}>
                                                            <em>{f.derive ? 'none (taken from the URL)' : f.default !== undefined ? `none (${JSON.stringify(f.default)})` : 'none'}</em>
                                                        </MenuItem>
                                                        {columns.filter(c => c.id !== 'recordId').map(c => (
                                                            <MenuItem key={c.id} value={c.id} sx={{ fontSize: 12 }}>{c.name}</MenuItem>
                                                        ))}
                                                    </Select>
                                                )}
                                            </Box>
                                            <Tooltip title={`${Math.round(fill * 100)}% of records have it${floor ? `; needs ${Math.round(floor * 100)}%` : ''}`}>
                                                <Box sx={{ width: 40 }}>
                                                    <LinearProgress variant="determinate" value={fill * 100}
                                                        color={floor && fill < floor ? 'warning' : fill > 0 ? 'success' : 'inherit'} sx={{ height: 4, borderRadius: 2 }} />
                                                </Box>
                                            </Tooltip>
                                        </Box>
                                    );
                                })}
                            </Box>
                            {shaped[0] && (
                                <Box>
                                    <Typography variant="caption" fontWeight={700} color="text.secondary">First record</Typography>
                                    <Box component="pre" sx={{ m: 0, p: 1, bgcolor: 'action.hover', borderRadius: 1, fontSize: 11, maxHeight: 160, overflow: 'auto' }}>
                                        {JSON.stringify(shaped[0], null, 2)}
                                    </Box>
                                </Box>
                            )}
                        </>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} sx={{ mr: 'auto' }}>Close</Button>
                <Button disabled={!contract} onClick={() => contract && downloadJson(contractJsonSchema(contract), `${slug(contract.id, '-', 'export')}.schema.json`)}>
                    Schema
                </Button>
                <Button variant="contained" disabled={!contract || shaped.length === 0} onClick={() => downloadJson(shaped, `${slug(tableName, '-', 'export')}.json`)}>
                    Export JSON
                </Button>
            </DialogActions>
        </Dialog>
    );
}
