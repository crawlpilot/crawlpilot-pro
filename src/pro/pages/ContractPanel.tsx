/**
 * The recipe's output contract in the editor: choose a known contract or paste a JSON Schema, then see
 * which recipe field gives each contract field (by name, or set here) and, after a test on sample pages,
 * how often each one was filled against its floor.
 */
import { useState } from 'react';
import { Button, Chip, Notice, Select, Text, TextArea } from '../../sidepanel/ui';
import { checkAgainstContract, contractFromSchema, KNOWN_CONTRACTS } from '../recipe/contract';
import type { PageResult } from '../runner/testPage';
import type { Field, OutputSpec, PageRecipeSpec } from '../recipe/types';

interface Props {
    output: OutputSpec;
    onChange: (output: OutputSpec) => void;
    fields: Field[];
    /** The newest test on sample pages of this spec, for fill. */
    results?: PageResult[];
    /** The recipe's transform: when there is one, its output is what is checked, by the contract's names. */
    transform?: PageRecipeSpec['transform'];
}

const NONE = '';
const PASTE = '__paste__';

export function ContractPanel({ output, onChange, fields, results, transform }: Props) {
    const [pasting, setPasting] = useState(false);
    const [schema, setSchema] = useState('');
    const [error, setError] = useState<string | null>(null);
    const contract = output.contract;
    const known = KNOWN_CONTRACTS.some(k => k.id === contract?.id);
    const choice = pasting ? PASTE : contract?.id ?? NONE;
    const options = [
        { value: NONE, label: 'No contract' },
        ...KNOWN_CONTRACTS.map(k => ({ value: k.id, label: k.label })),
        ...(contract && !known ? [{ value: contract.id, label: contract.label }] : []),
        { value: PASTE, label: 'Paste a JSON Schema…' },
    ];

    const choose = (id: string) => {
        setError(null);
        if (id === PASTE) { setPasting(true); return; }
        setPasting(false);
        const next = KNOWN_CONTRACTS.find(k => k.id === id)?.contract();
        onChange(next ? { contract: next } : {});
    };

    const usePasted = () => {
        try {
            onChange({ contract: contractFromSchema(schema, 'custom', 'Pasted schema') });
            setPasting(false);
            setSchema('');
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    };

    const check = contract ? checkAgainstContract(contract, fields, results ?? [], output.mapping, transform) : null;
    const setMapping = (name: string, field: string) =>
        onChange({ ...output, mapping: { ...output.mapping, [name]: field || null } });

    return (
        <div className="flex flex-col gap-2" data-testid="pro-contract">
            <Select size="sm" label="Output contract" value={choice} options={options} onChange={choose} />
            {pasting && (
                <div className="flex flex-col gap-1.5">
                    <TextArea mono rows={4} label="JSON Schema" value={schema} onChange={e => setSchema(e.target.value)} placeholder='{"type":"object","required":["title"],"properties":{"title":{"type":"string"}}}' />
                    {error && <Notice tone="danger">{error}</Notice>}
                    <div><Button size="sm" variant="secondary" onClick={usePasted} disabled={!schema.trim()}>Use this schema</Button></div>
                </div>
            )}
            {contract && check?.on === 'transform' && (
                <Text size="caption" tone="faint">The transform's output is checked: each contract field is its key of that name. Map them in the transform.</Text>
            )}
            {contract && check && (
                <table className="w-full border-collapse text-caption">
                    <thead>
                        <tr className="text-left text-ink-2">
                            <th className="py-1 font-semibold">Contract field</th>
                            <th className="py-1 font-semibold">From</th>
                            {results && <th className="py-1 text-right font-semibold">Filled</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {contract.fields.filter(f => !f.runtime).map(f => {
                            const under = check.report.underFloor.find(u => u.name === f.name);
                            const missing = check.report.unmappedRequired.includes(f.name);
                            return (
                                <tr key={f.name} className="border-t border-line" data-testid="pro-contract-row">
                                    <td className="py-1 pr-2">
                                        <span className="flex flex-wrap items-center gap-1">{f.name}{f.required && <Chip tone={missing ? 'danger' : 'warning'}>required</Chip>}</span>
                                    </td>
                                    <td className="py-1 pr-2">
                                        {check.on === 'transform'
                                            ? <Text size="caption" tone={check.mapping[f.name] ? 'muted' : 'faint'}>{check.mapping[f.name] ? 'output' : results ? 'not in the output' : '—'}</Text>
                                            : <Select size="sm" aria-label={`Field for ${f.name}`} value={check.mapping[f.name] ?? ''}
                                                options={[{ value: '', label: '—' }, ...fields.map(x => ({ value: x.name, label: x.name }))]}
                                                onChange={v => setMapping(f.name, v)} />}
                                    </td>
                                    {results && (
                                        <td className={`py-1 text-right ${under ? 'font-semibold text-danger' : 'text-ink-2'}`}>
                                            {Math.round((check.report.coverage[f.name] ?? 0) * 100)}%
                                        </td>
                                    )}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            )}
            {contract && !results && <Text size="caption" tone="faint">Test on sample pages to see how often each field is filled.</Text>}
        </div>
    );
}
