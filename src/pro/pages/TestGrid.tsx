/**
 * A test on several pages as a grid (recipe-improvements-plan C11): a row per field, a column per page,
 * each cell found, empty or a problem. A cell opens what was read there.
 */
import { useState } from 'react';
import { cx, Text } from '../../sidepanel/ui';
import type { FieldResult, PageResult } from '../runner/testPage';

const preview = (v: unknown) => v === null || v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v);

function mark(f?: FieldResult): { text: string; tone: string; label: string } {
    if (!f) return { text: '!', tone: 'text-danger', label: 'page not read' };
    if (!f.ok) return { text: '✗', tone: 'text-danger', label: f.problem ?? 'problem' };
    return f.filled ? { text: '✓', tone: 'text-success', label: 'found' } : { text: '–', tone: 'text-ink-3', label: 'empty' };
}

export function TestGrid({ results, fields }: { results: PageResult[]; fields: { id: string; name: string }[] }) {
    const [open, setOpen] = useState<{ field: string; page: number } | null>(null);
    const cell = (fieldId: string, page: number) => results[page].fields.find(f => f.fieldId === fieldId);
    const opened = open && cell(open.field, open.page);
    const host = (url: string) => { try { const u = new URL(url); return u.host + u.pathname; } catch { return url; } };

    return (
        <div className="flex flex-col gap-2" data-testid="pro-test-grid">
            <div className="overflow-x-auto">
                <table className="w-full border-collapse text-caption">
                    <thead>
                        <tr>
                            <th className="py-1 pr-2 text-left font-semibold text-ink-2">Field</th>
                            {results.map((r, i) => <th key={i} title={r.url} className="w-7 py-1 text-center font-semibold text-ink-2">{i + 1}</th>)}
                            <th className="py-1 pl-2 text-right font-semibold text-ink-2">Found</th>
                        </tr>
                    </thead>
                    <tbody>
                        {fields.map(f => {
                            const found = results.filter((_, i) => cell(f.id, i)?.filled).length;
                            return (
                                <tr key={f.id} className="border-t border-line">
                                    <td className="max-w-32 truncate py-1 pr-2 text-ink" title={f.name}>{f.name}</td>
                                    {results.map((r, i) => {
                                        const m = r.error ? { text: '!', tone: 'text-danger', label: r.error } : mark(cell(f.id, i));
                                        const active = open?.field === f.id && open.page === i;
                                        return (
                                            <td key={i} className="text-center">
                                                <button type="button" aria-label={`${f.name} on page ${i + 1}: ${m.label}`} title={m.label}
                                                    onClick={() => setOpen(active ? null : { field: f.id, page: i })}
                                                    className={cx('size-6 cursor-pointer rounded-md font-bold', m.tone, active ? 'bg-ink/10' : 'hover:bg-ink/6')}>{m.text}</button>
                                            </td>
                                        );
                                    })}
                                    <td className="py-1 pl-2 text-right text-ink-2">{found}/{results.length}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            {results.some(r => r.error) && (
                <Text size="caption" tone="danger">{results.filter(r => r.error).map(r => `${host(r.url)}: ${r.error}`).join(' · ')}</Text>
            )}
            {open && (
                <div className="flex flex-col gap-0.5 rounded-xl bg-ink/4 px-2.5 py-2" data-testid="pro-grid-cell">
                    <Text size="caption" tone="muted" className="break-all">{fields.find(f => f.id === open.field)?.name} on {host(results[open.page].url)}{opened ? ` (${opened.status})` : ''}</Text>
                    <Text size="caption" mono className="break-all" lines={4}>{opened ? (opened.ok ? preview(opened.value) : `${opened.problem}: ${preview(opened.raw)}`) : results[open.page].error}</Text>
                </div>
            )}
        </div>
    );
}
