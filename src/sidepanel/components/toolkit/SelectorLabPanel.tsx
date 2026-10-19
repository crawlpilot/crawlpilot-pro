import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Chip, IconButton, Notice, Stack, Text, TextField, ToggleChip, Tooltip, cx } from '../../ui';
import { Crosshair, Play, X, Info, Sparkles, Code2, Database, MousePointerClick } from 'lucide-react';
import type { LabEval, LabCandidate, LabChainEntry, LabPick } from '../../../content/features/lab/SelectorLab';
import { SNIPPET_LABELS, SnippetTarget, toSnippet } from '../../../shared/selectors/snippets';
import { on } from '../../../shared/messages';
import { useToolkit } from './context';
import { CodeBlock, CopyButton, DetailSection, GroupLabel, ToolIntro } from './ui';

const GRADE_COLOR = { strong: 'success', fragile: 'warning', broken: 'danger' } as const;
const GRADE_LABEL = { strong: 'Strong', fragile: 'Fragile', broken: 'Broken' } as const;
const GRADE_HELP = {
    strong: 'Built on something the site is unlikely to change (an id, a test id, a stable attribute).',
    fragile: 'Depends on position, layout classes or text, which often change when the site is updated.',
    broken: 'Finds nothing on this page, or is not a valid selector.',
} as const;
const EXAMPLES = ['h1', 'a[href]', 'img', '[data-testid]', '//h2'];
const LIVE_DELAY_MS = 450;
const CANDIDATES_SHOWN = 3;

function GradeChip({ ev }: { ev: LabEval }) {
    const g = ev.grade.grade;
    return <Tooltip title={GRADE_HELP[g]}><span><Chip tone={GRADE_COLOR[g]}>{GRADE_LABEL[g]}</Chip></span></Tooltip>;
}

const isXPath = (s: string) => /^\(?\.?\//.test(s.trim());

/** A stored chain in order: family, grade, matches, and the entry a run would use on this page. */
function StoredChain({ title, entries, onUse }: { title: string; entries: LabChainEntry[]; onUse?: (selector: string) => void }) {
    const winner = entries.findIndex(e => e.wins);
    return (
        <div>
            <Text size="caption" weight="bold" className="mb-1">{title}</Text>
            {winner > 0 && (
                <Text size="caption" tone="warning" className="mb-1">
                    The first {winner === 1 ? 'entry no longer works' : `${winner} entries no longer work`} here: a run would use backup #{winner + 1}.
                </Text>
            )}
            {winner < 0 && entries.length > 0 && <Text size="caption" tone="danger" className="mb-1">No entry finds it on this page.</Text>}
            <Stack gap={1}>
                {entries.map((e, i) => (
                    <div key={e.selector} onClick={onUse ? () => onUse(e.selector) : undefined}
                        className={cx('rounded-field border p-2.5', e.wins ? 'border-success' : 'border-line', onUse && 'cursor-pointer hover:border-line-strong')}>
                        <div className="mb-1 flex flex-wrap items-center gap-1.5">
                            <Text size="caption" weight="bold">#{i + 1}</Text>
                            <Chip tone={GRADE_COLOR[e.grade.grade]}>{GRADE_LABEL[e.grade.grade]}</Chip>
                            <Text size="caption" tone="muted">{e.family} · {e.count} match{e.count !== 1 ? 'es' : ''}</Text>
                            {e.wins && <Chip tone="outline">used now</Chip>}
                        </div>
                        <Text size="caption" mono className="break-all">{e.selector}</Text>
                    </div>
                ))}
            </Stack>
        </div>
    );
}

function CandidateCard({ c, best, active, onUse }: { c: LabCandidate; best: boolean; active: boolean; onUse: () => void }) {
    return (
        <div onClick={onUse}
            className={cx('cursor-pointer rounded-field border p-2.5 transition-colors hover:border-line-strong',
                active ? 'border-[1.5px] border-line-strong' : best ? 'border-success/50 bg-success-soft/50' : 'border-line')}>
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
                {best && <Chip tone="brand" icon={<Sparkles />}>Recommended</Chip>}
                <GradeChip ev={c} />
                <Text size="caption" tone="muted" className="flex-1">
                    {c.list ? `all similar · ${c.count}` : c.count === 1 ? 'unique' : `${c.count} matches`} · {c.grade.family}
                </Text>
                <CopyButton text={c.selector} label="Copy selector" />
            </div>
            <Text size="caption" mono className="break-all">{c.selector}</Text>
            <Text size="caption" tone="faint" className="text-[10.5px]">{c.grade.reason}</Text>
        </div>
    );
}

export default function SelectorLabPanel() {
    const { send, page } = useToolkit();
    const [selector, setSelector] = useState('');
    const [result, setResult] = useState<LabEval | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [picking, setPicking] = useState(false);
    const [pick, setPick] = useState<LabPick | null>(null);
    const [target, setTarget] = useState<SnippetTarget>('playwright');
    const [showAll, setShowAll] = useState(false);
    const typed = useRef(false);

    const evaluate = useCallback(async (sel: string) => {
        if (!sel.trim()) return;
        setError(null);
        try {
            const res = await send('LAB_EVAL', { selector: sel.trim() });
            setResult(res.result);
        } catch (e: any) {
            setError(e.message);
        }
    }, [send]);

    // Test as you type: a moment after the last keystroke, highlight what the selector matches.
    useEffect(() => {
        if (!typed.current || selector.trim().length < 2) return;
        const t = setTimeout(() => evaluate(selector), LIVE_DELAY_MS);
        return () => clearTimeout(t);
    }, [selector, evaluate]);

    useEffect(() => {
        const off = on('LAB_PICKED', picked => {
            setPicking(false);
            if (!picked) return;
            setPick(picked);
            setShowAll(false);
            const best = picked.candidates[0];
            if (best) { typed.current = false; setSelector(best.selector); void evaluate(best.selector); }
        });
        return () => {
            off();
            send('LAB_CLEAR').catch(() => { /* tab gone */ });
        };
    }, [evaluate, send]);

    const startPick = async () => {
        setError(null);
        try {
            await send('LAB_PICK_START');
            setPicking(true);
        } catch (e: any) {
            setError(e.message);
        }
    };

    const use = (sel: string) => {
        typed.current = false;
        setSelector(sel);
        void evaluate(sel);
    };

    const clear = () => {
        typed.current = false;
        setSelector('');
        setResult(null);
        setPick(null);
        send('LAB_CLEAR').catch(() => undefined);
    };

    const snippet = result && result.count > 0 ? toSnippet(target, result.selector, result.count > 1) : '';
    const candidates = pick ? (showAll ? pick.candidates : pick.candidates.slice(0, CANDIDATES_SHOWN)) : [];

    return (
        <Stack gap={3}>
            {!result && !pick && (
                <ToolIntro icon={<Crosshair />} title="Find a selector that won't break"
                    text="Click any element on the page to get the most robust ways to find it, or type a CSS or XPath selector to test it live."
                    points={['Matches are highlighted on the page as you type', 'Each selector is graded on how likely it survives site updates', 'Copy it as Playwright, Puppeteer, Selenium, Scrapy… code']} />
            )}

            <Button variant={picking ? 'brand' : 'primary'} onClick={picking ? undefined : startPick} disabled={!page.web}
                icon={picking ? <MousePointerClick /> : <Crosshair />} className={picking ? 'animate-pulse' : undefined}>
                {picking ? 'Now click an element on the page (Esc cancels)' : 'Pick an element on the page'}
            </Button>

            <div>
                <div className="flex gap-2">
                    <TextField size="md" className="flex-1" inputClassName="font-mono text-small" aria-label="Selector" placeholder="or type a selector: .price, //h1"
                        value={selector}
                        onChange={e => { typed.current = true; setSelector(e.target.value); }}
                        onKeyDown={e => { if (e.key === 'Enter') evaluate(selector); }}
                        end={selector ? (
                            <span className="flex items-center gap-1">
                                <Chip>{isXPath(selector) ? 'XPath' : 'CSS'}</Chip>
                                <IconButton size="sm" label="Clear" noTooltip onClick={clear}><X /></IconButton>
                            </span>
                        ) : undefined} />
                    <IconButton variant="secondary" size="lg" label="Test (Enter)" onClick={() => evaluate(selector)} disabled={!selector.trim()}><Play /></IconButton>
                </div>
                {!selector && (
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                        <Text size="caption" tone="muted" as="span" className="mr-0.5">Try:</Text>
                        {EXAMPLES.map(x => <ToggleChip key={x} selected={false} onClick={() => use(x)} className="font-mono">{x}</ToggleChip>)}
                    </div>
                )}
            </div>
            {error && <Notice tone="warning" onClose={() => setError(null)}>{error}</Notice>}

            {result && (
                <div className={cx('rounded-card border bg-surface p-4', result.count > 0 ? 'border-line' : 'border-danger/45')}>
                    <div className="mb-1 flex items-baseline gap-2">
                        <span className={cx('font-display text-title leading-none font-extrabold', result.count > 0 ? 'text-ink' : 'text-danger')}>{result.count}</span>
                        <Text size="caption" tone="muted" className="flex-1">
                            match{result.count !== 1 ? 'es' : ''} · {result.kind.toUpperCase()}{result.count > 0 ? ' · highlighted on the page' : ''}
                        </Text>
                        <GradeChip ev={result} />
                        <CopyButton text={result.selector} label="Copy selector" />
                    </div>
                    <Text size="caption" tone="muted" className={result.samples.length ? 'mb-2' : undefined}>
                        {result.count === 0 && !result.error ? 'Nothing matches. Check the spelling, or pick the element instead.' : result.grade.reason}
                    </Text>
                    {result.samples.length > 0 && (
                        <div className="flex flex-col gap-0.5 rounded-field bg-surface-2 p-2">
                            {result.samples.map((s, i) => (
                                <div key={i} className="flex min-w-0 gap-2 text-caption">
                                    <span className="min-w-3.5 text-right font-bold text-accent">{i + 1}</span>
                                    <span className="truncate text-ink">{s || <em>(no text)</em>}</span>
                                </div>
                            ))}
                            {result.count > result.samples.length && <Text size="caption" tone="faint" className="pl-5.5">…and {result.count - result.samples.length} more</Text>}
                        </div>
                    )}
                </div>
            )}

            {pick && (
                <div>
                    <GroupLabel>Ways to find &lt;{pick.tag}&gt; “{pick.text.slice(0, 32)}{pick.text.length > 32 ? '…' : ''}”</GroupLabel>
                    {pick.candidates.length === 0 && <Text size="caption" tone="muted">No selector found for this element.</Text>}
                    <Stack gap={1.5}>
                        {candidates.map((c, i) => <CandidateCard key={c.selector} c={c} best={i === 0 && c.grade.grade === 'strong'} active={result?.selector === c.selector} onUse={() => use(c.selector)} />)}
                    </Stack>
                    {pick.candidates.length > CANDIDATES_SHOWN && (
                        <Button size="sm" variant="ghost" className="mt-1" onClick={() => setShowAll(s => !s)}>
                            {showAll ? 'Show fewer' : `Show ${pick.candidates.length - CANDIDATES_SHOWN} more`}
                        </Button>
                    )}
                </div>
            )}

            {snippet && (
                <DetailSection icon={<Code2 />} title="Use it in code" summary={SNIPPET_LABELS[target]} defaultOpen>
                    <div className="mb-2 flex flex-wrap gap-1">
                        {(Object.keys(SNIPPET_LABELS) as SnippetTarget[]).map(k => (
                            <ToggleChip key={k} selected={target === k} onClick={() => setTarget(k)}>{SNIPPET_LABELS[k]}</ToggleChip>
                        ))}
                    </div>
                    <CodeBlock code={snippet} />
                </DetailSection>
            )}

            {pick && (
                <DetailSection icon={<Database />} title="What a saved recipe stores" summary={`${pick.stored.length} backups`}>
                    <div className="mb-2.5 flex gap-2">
                        <Info size={14} className="mt-0.5 shrink-0 text-ink-3" />
                        <Text size="caption" tone="muted">Recipes keep several ways to find each element, best first. If the site changes and the first stops working, a run falls back to the next.</Text>
                    </div>
                    <Stack gap={3}>
                        <StoredChain title="This element (Page Extractor)" entries={pick.stored} onUse={use} />
                        {pick.storedList && (
                            <>
                                <StoredChain title="Its list: container" entries={pick.storedList.container} onUse={use} />
                                <StoredChain title="Its list: items (inside the container)" entries={pick.storedList.items} />
                            </>
                        )}
                    </Stack>
                </DetailSection>
            )}
        </Stack>
    );
}
