/**
 * The recipe's transform (`PageRecipeSpec.transform`): a JOLT chain, as Atlas writes it, that turns the page's record
 * (its fields by name) into the schema consumers want. Written as JSON here; "Start from the fields" gives a shift
 * that keeps every field, to rename and nest from. The output is shown on the page the recipe was last tested on.
 */
import { useEffect, useState } from 'react';
import { Shuffle, Trash2 } from 'lucide-react';
import { Button, Text, TextArea } from '../../sidepanel/ui';
import { joltProblems, joltTransform, type JoltOperation } from '../recipe/jolt';

const pretty = (v: unknown) => JSON.stringify(v, null, 2);

/** A shift that writes each field where it is: the start for renaming and nesting. */
export const identityShift = (names: string[]): JoltOperation[] => [{ operation: 'shift', spec: Object.fromEntries(names.map(n => [n, n])) }];

export function TransformPanel({ jolt, fields, sample, onChange, onValid }: {
    jolt?: JoltOperation[];
    /** The recipe's field names. */
    fields: string[];
    /** The record of the page last tested on (fields by name), to show the output on. */
    sample?: Record<string, unknown>;
    onChange: (jolt: JoltOperation[] | undefined) => void;
    /** False while the text is not a chain that can be saved. */
    onValid: (valid: boolean) => void;
}) {
    const [text, setText] = useState(jolt ? pretty(jolt) : '');
    const problems = text.trim() ? joltProblems(text) : [];
    useEffect(() => onValid(problems.length === 0), [problems.length]);

    const edit = (next: string) => {
        setText(next);
        if (!next.trim()) { onChange(undefined); return; }
        if (joltProblems(next).length) return;
        const v = JSON.parse(next);
        onChange(Array.isArray(v) ? v : [v]);
    };

    let output: { value?: unknown; error?: string } | null = null;
    if (sample && jolt?.length && !problems.length) {
        try { output = { value: joltTransform(sample, jolt) }; } catch (e) { output = { error: e instanceof Error ? e.message : String(e) }; }
    }

    return (
        <div className="flex flex-col gap-2 pt-2" data-testid="pro-transform">
            <Text size="caption" tone="faint">
                The page's record (its fields by name) goes through this JOLT chain, as in Atlas: shift, default, remove,
                cardinality, sort, modify-overwrite-beta / modify-default-beta. The crawler writes the result as the scrape's record.
            </Text>
            {!text.trim() && (
                <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="secondary" icon={<Shuffle />} disabled={!fields.length}
                        onClick={() => edit(pretty(identityShift(fields)))}>Start from the fields</Button>
                </div>
            )}
            <TextArea label="JOLT spec (JSON: one operation or a list)" rows={text.trim() ? 10 : 3} value={text}
                mono placeholder='[{ "operation": "shift", "spec": { "title": "product.name" } }]'
                onChange={e => edit(e.target.value)} />
            {problems.map(p => <Text key={p} size="caption" tone="warning">{p}</Text>)}
            {output && (
                <div className="flex flex-col gap-1 rounded-xl bg-ink/4 px-2.5 py-2" data-testid="pro-transform-output">
                    <Text size="caption" tone="muted">On the tested page</Text>
                    {output.error
                        ? <Text size="caption" tone="danger">{output.error}</Text>
                        : <pre className="max-h-64 overflow-auto font-mono text-caption whitespace-pre-wrap break-all">{pretty(output.value)}</pre>}
                </div>
            )}
            {!sample && text.trim() && !problems.length && <Text size="caption" tone="faint">Test on a page to see the output here.</Text>}
            {text.trim() && <div><Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => edit('')}>Remove the transform</Button></div>}
        </div>
    );
}
