import { useEffect, useMemo, useState } from 'react';
import { Button, Dialog, Notice, Progress, Select, Stack, Text, TextArea, ToggleChip, Tooltip } from '../../ui';
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
        <Dialog open={open} onClose={onClose} size="lg" title="Map to an output schema"
            description="Give the data the same shape whatever site it came from: map columns to fields, check what's missing, export JSON that follows the schema."
            actions={<>
                <Button variant="ghost" className="mr-auto" onClick={onClose}>Close</Button>
                <Button disabled={!contract} onClick={() => contract && downloadJson(contractJsonSchema(contract), `${slug(contract.id, '-', 'export')}.schema.json`)}>Schema</Button>
                <Button variant="primary" disabled={!contract || shaped.length === 0} onClick={() => downloadJson(shaped, `${slug(tableName, '-', 'export')}.json`)}>Export JSON</Button>
            </>}>
            <Stack gap={3}>
                <div className="flex flex-wrap gap-1.5">
                    {CONTRACT_PRESETS.map(c => <ToggleChip key={c.id} selected={contractId === c.id} onClick={() => setContractId(c.id)}>{c.label}</ToggleChip>)}
                    <ToggleChip selected={contractId === 'custom'} onClick={() => setContractId('custom')}>My schema</ToggleChip>
                </div>
                {contractId === 'custom' && (
                    <TextArea mono rows={5} value={customText} onChange={e => setCustomText(e.target.value)}
                        placeholder={'Paste a JSON Schema or an example object, or one field per line:\ntitle\nprice: current price'}
                        error={customText.trim().length > 0 ? intake?.error : undefined} />
                )}

                {contract && report && (
                    <>
                        {report.unmappedRequired.length > 0 && <Notice tone="danger">Required with no column: {report.unmappedRequired.join(', ')}</Notice>}
                        {report.underFloor.length > 0 && (
                            <Notice tone="warning">Too often empty: {report.underFloor.map(u => `${u.name} ${Math.round(u.fill * 100)}% (needs ${Math.round(u.floor * 100)}%)`).join(', ')}</Notice>
                        )}
                        {report.ok && <Notice tone="success">Every required field is mapped and filled. {rows.length} records ready.</Notice>}
                        <div className="overflow-hidden rounded-field border border-line">
                            {contract.fields.map((f, i) => {
                                const fill = report.coverage[f.name] ?? 0;
                                const floor = f.floor ?? (f.required ? REQUIRED_FLOOR : 0);
                                return (
                                    <div key={f.name} className={`flex items-center gap-2 px-3 py-1.5 ${i ? 'border-t border-line' : ''}`}>
                                        <Tooltip title={f.description ?? ''}>
                                            <div className="w-32 min-w-0 shrink-0">
                                                <Text size="caption" weight="semibold" truncate>{f.name}{f.required ? ' *' : ''}</Text>
                                                <Text size="caption" tone="faint" className="text-[10.5px]">{f.type}</Text>
                                            </div>
                                        </Tooltip>
                                        <div className="min-w-0 flex-1">
                                            {f.runtime ? (
                                                <Text size="caption" tone="muted">Filled by the export (row order)</Text>
                                            ) : (
                                                <Select size="sm" aria-label={f.name} value={mapping[f.name] ?? ''} onChange={v => setField(f.name, v)}
                                                    options={[
                                                        { value: '', label: f.derive ? 'none (taken from the URL)' : f.default !== undefined ? `none (${JSON.stringify(f.default)})` : 'none' },
                                                        ...columns.filter(c => c.id !== 'recordId').map(c => ({ value: c.id, label: c.name })),
                                                    ]} />
                                            )}
                                        </div>
                                        <Tooltip title={`${Math.round(fill * 100)}% of records have it${floor ? `; needs ${Math.round(floor * 100)}%` : ''}`}>
                                            <div className="w-10 shrink-0"><Progress size="sm" value={fill * 100} tone={floor && fill < floor ? 'danger' : 'success'} /></div>
                                        </Tooltip>
                                    </div>
                                );
                            })}
                        </div>
                        {shaped[0] && (
                            <div>
                                <Text size="caption" weight="semibold" tone="muted" className="mb-1">First record</Text>
                                <pre className="m-0 max-h-40 overflow-auto rounded-field bg-surface-2 p-3 text-[11px] text-ink">{JSON.stringify(shaped[0], null, 2)}</pre>
                            </div>
                        )}
                    </>
                )}
            </Stack>
        </Dialog>
    );
}
