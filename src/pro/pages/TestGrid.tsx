/**
 * A test on several pages as a grid (recipe-improvements-plan C11): a row per field, a column per page,
 * each cell found, empty or a problem. A cell opens what was read there. A page where a page rule held has no
 * fields read: its column says so, green when the sample expects that rule (`Sample.expectRule`). Under the
 * grid, each page that was not simply read says what happened.
 */
import { useState } from 'react';
import { cx, Text } from '../../sidepanel/ui';
import { pageOutcome } from '../runner/outcome';
import type { FieldResult, PageResult } from '../runner/testPage';

const preview = (v: unknown) => v === null || v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v);

function mark(f?: FieldResult): { text: string; tone: string; label: string } {
    if (!f) return { text: '!', tone: 'text-danger', label: 'page not read' };
    if (!f.ok) return { text: '✗', tone: 'text-danger', label: f.problem ?? 'problem' };
    return f.filled ? { text: '✓', tone: 'text-success', label: 'found' } : { text: '–', tone: 'text-ink-3', label: 'empty' };
}

export function TestGrid({ results, fields, expect = new Map() }: { results: PageResult[]; fields: { id: string; name: string }[]; expect?: Map<string, string> }) {
    const outcomes = results.map(r => pageOutcome(r, expect.get(r.url)));
    // Pages a rule held on have no fields to count.
    const readable = results.filter(r => !r.rule).length;
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
                            {results.map((r, i) => <th key={i} title={`${r.url}${expect.has(r.url) ? ` (should hit "${expect.get(r.url)}")` : ''}`}
                                className={cx('w-7 py-1 text-center font-semibold', outcomes[i].ok ? 'text-ink-2' : 'text-danger')}>{i + 1}{expect.has(r.url) ? '⊘' : ''}</th>)}
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
                                        const m = r.error ? { text: '!', tone: 'text-danger', label: r.error }
                                            : r.rule ? { text: '⊘', tone: outcomes[i].ok ? 'text-success' : 'text-warning', label: outcomes[i].title }
                                            : mark(cell(f.id, i));
                                        const active = open?.field === f.id && open.page === i;
                                        return (
                                            <td key={i} className="text-center">
                                                <button type="button" aria-label={`${f.name} on page ${i + 1}: ${m.label}`} title={m.label}
                                                    onClick={() => setOpen(active ? null : { field: f.id, page: i })}
                                                    className={cx('size-6 cursor-pointer rounded-md font-bold', m.tone, active ? 'bg-ink/10' : 'hover:bg-ink/6')}>{m.text}</button>
                                            </td>
                                        );
                                    })}
                                    <td className="py-1 pl-2 text-right text-ink-2">{found}/{readable}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            {outcomes.some(o => o.kind !== 'read') && (
                <div className="flex flex-col gap-0.5" data-testid="pro-grid-outcomes">
                    {outcomes.map((o, i) => o.kind === 'read' ? null : (
                        <Text key={i} size="caption" tone={o.ok ? 'success' : o.kind === 'error' ? 'danger' : 'warning'} className="break-all" data-testid="pro-grid-outcome">
                            {i + 1}. {host(results[i].url)}: {o.title}{o.detail ? `. ${o.detail}` : ''}
                        </Text>
                    ))}
                </div>
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
