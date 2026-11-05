/**
 * Check (`docs/plans/pro-ops-workflow-review.md`): what the recipe reads, field by field, before anyone submits it.
 * - **This page:** one row per field: the value as the crawler will output it (typed: money with its currency, a
 *   date as the date understood), whether it checks out, and where it came from. Each field's element is outlined
 *   on the page with its name; a row brings its element into view. A "for each" step gives a row per item. A page
 *   rule that held (a 404, a captcha) or another product than the URL names is said instead, and an error page can
 *   be kept as a sample that should hit its rule.
 * - **Sample pages:** the same recipe on the samples, as a grid of fields × pages.
 * - **Ready to submit:** what is left, each with the way to it.
 * It checks the newest version as saved; Edit fields changes it.
 */
import { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Eye, EyeOff, FlaskConical, Layers, Pencil, Plus } from 'lucide-react';
import ToolHeader from '../../sidepanel/components/ui/ToolHeader';
import { Button, Card, Chip, Notice, Text, TextField } from '../../sidepanel/ui';
import { usePageTab } from '../../sidepanel/hooks/usePageTab';
import { pro } from '../db';
import { passed } from '../db/tests';
import { openedRecipe } from '../nav';
import { variablesOf } from '../recipe/actions';
import type { Field, PageRecipeSpec, ProRecipe, Review, Sample, Version } from '../recipe/types';
import { expectations, pageOutcome } from '../runner/outcome';
import { shownValue, sourceOf, verdictOf, type Verdict } from '../runner/present';
import { testOnTab, type FieldResult, type PageResult } from '../runner/testPage';
import { testOnPages, type PagesProgress } from '../runner/testPages';
import { call } from '../runner/tabSteps';
import type { ShownField } from '../steps/showFields';
import { TestGrid } from './TestGrid';
import { ReadinessCard, readinessItems, type ReadinessItem } from './ReadinessCard';

interface Props {
    onBack: () => void;
    onNavigate: (view: string) => void;
}

/** Sample pages a check reads, at most. */
const CHECK_PAGES = 5;

const TONE: Record<Verdict['tone'], 'success' | 'danger' | 'neutral'> = { ok: 'success', bad: 'danger', empty: 'neutral' };

const selectorsOf = (f: Field) => f.ways.flatMap(w => w.kind === 'selector' ? [w.selector] : []);

/** One field's row: name, value, verdict, source. */
function FieldRow({ field, result, onFocus }: { field: Field; result?: FieldResult; onFocus: () => void }) {
    const verdict = result ? verdictOf(result, field.type) : null;
    return (
        <button type="button" onClick={onFocus} data-testid="pro-check-row"
            className="flex w-full flex-col gap-0.5 rounded-xl px-2.5 py-2 text-left hover:bg-ink/4">
            <span className="flex min-w-0 items-center gap-1.5">
                <Text size="small" weight="semibold" className="truncate">{field.name}</Text>
                {field.required && <Chip>required</Chip>}
                <span className="flex-1" />
                {verdict && <Chip tone={TONE[verdict.tone]}>{verdict.tone === 'ok' ? '✓ ' : verdict.tone === 'bad' ? '✗ ' : ''}{verdict.text}</Chip>}
            </span>
            <Text size="caption" mono className="break-all" lines={2} data-testid="pro-check-value">{result ? shownValue(result, field.type) : '…'}</Text>
            {result && <Text size="caption" tone="faint">{sourceOf(result.status)}</Text>}
        </button>
    );
}

export default function CheckPage({ onBack, onNavigate }: Props) {
    const page = usePageTab();
    const [recipeId] = useState(openedRecipe);
    const [recipe, setRecipe] = useState<ProRecipe | null>(null);
    const [version, setVersion] = useState<Version | null>(null);
    const [samples, setSamples] = useState<Sample[]>([]);
    const [review, setReview] = useState<Review | undefined>();
    const [context, setContext] = useState<Record<string, string>>({});
    const [result, setResult] = useState<PageResult | null>(null);
    const [checking, setChecking] = useState(false);
    const [outlined, setOutlined] = useState(true);
    const [pages, setPages] = useState<PageResult[] | null>(null);
    const [progress, setProgress] = useState<PagesProgress | null>(null);

    const load = async () => {
        if (!recipeId) return;
        const r = await pro.recipes.get(recipeId);
        const v = r && await pro.versions.get(r.id, r.latestVersion);
        setRecipe(r ?? null);
        setVersion(v ?? null);
        if (!r || !v) return;
        setSamples(await pro.samples.list(r.id));
        setReview((await pro.reviews.states(r.id)).get(v.version));
        setPages((await pro.tests.latest(r.id, v.digest, 'pages'))?.results ?? null);
        const key = `pro.testContext.${r.id}`;
        const saved = (await chrome.storage.local.get(key))[key];
        if (saved && typeof saved === 'object') setContext(saved as Record<string, string>);
    };
    useEffect(() => { void load(); }, [recipeId]);
    // The outlines leave the page with this screen.
    useEffect(() => () => { if (page.tab?.id) void call(page.tab.id, 'clearFields', []).catch(() => {}); }, [page.tab?.id]);

    const spec = version?.spec.kind === 'page' ? version.spec as PageRecipeSpec : null;
    const fields = useMemo(() => spec?.steps.flatMap(s => s.kind === 'field' ? [s.field] : []) ?? [], [spec]);
    const variables = spec ? variablesOf(spec) : [];
    const byId = new Map((result?.fields ?? []).map(f => [f.fieldId, f]));

    /** The fields outlined on the tab, coloured by their check. */
    const outline = async (r: PageResult | null, on: boolean) => {
        if (!page.tab?.id) return;
        if (!on || !r) { await call(page.tab.id, 'clearFields', []).catch(() => {}); return; }
        const list: ShownField[] = fields.map(f => {
            const res = r.fields.find(x => x.fieldId === f.id);
            return { name: f.name, selectors: selectorsOf(f), tone: res ? verdictOf(res, f.type).tone : 'empty' };
        });
        await call(page.tab.id, 'showFields', [list]).catch(() => {});
    };

    const checkPage = async () => {
        if (!recipe || !version || !spec || !page.tab?.id) return;
        setChecking(true);
        const r = await testOnTab(page.tab.id, page.url, spec, version.settings, context);
        setResult(r);
        await pro.tests.save({ recipeId: recipe.id, digest: version.digest, kind: 'page', results: [r], passed: passed([r]), at: Date.now() });
        setChecking(false);
        if (outlined) await outline(r, true);
    };

    const checkSamples = async () => {
        if (!recipe || !version || !spec) return;
        const results = await testOnPages(samples.slice(0, CHECK_PAGES).map(s => s.url), spec, version.settings, setProgress, undefined, context);
        setProgress(null);
        setPages(results);
        await pro.tests.save({ recipeId: recipe.id, digest: version.digest, kind: 'pages', results, passed: passed(results, samples), at: Date.now() });
    };

    /** `rule`: kept as a page that should hit that rule. */
    const addSample = async (rule?: string) => {
        if (!recipe) return;
        if (samples.some(s => s.url === page.url)) await pro.samples.expectRule(recipe.id, page.url, rule);
        else await pro.samples.add(recipe.id, [page.url], rule ? { [page.url]: rule } : {});
        setSamples(await pro.samples.list(recipe.id));
    };

    const changeContext = (next: Record<string, string>) => {
        setContext(next);
        if (recipe) void chrome.storage.local.set({ [`pro.testContext.${recipe.id}`]: next });
    };

    const header = (
        <ToolHeader title="Check" subtitle={recipe && version ? `${recipe.name} · v${version.version}` : undefined} onBack={onBack}
            actions={recipe && <Button size="sm" variant="ghost" icon={<Pencil />} onClick={() => onNavigate('pro-editor')}>Edit fields</Button>} />
    );
    if (!recipe || !version) return <div className="flex h-full flex-col">{header}</div>;
    if (!spec) {
        return (
            <div className="flex h-full flex-col">{header}
                <div className="p-4"><Notice tone="info">Check reads page recipes. A list recipe is checked in the List Extractor for now.</Notice></div>
            </div>
        );
    }

    const expect = expectations(samples);
    const outcome = result ? pageOutcome(result, expect.get(result.url)) : null;
    const keptFor = samples.find(s => s.url === page.url)?.expectRule;
    // What stands between this version and a submit, each with the way to it.
    const thisPage = !result || !outcome ? { ok: false, text: 'Not checked on this page yet' }
        : result.error ? { ok: false, text: `This page could not be checked: ${result.error}` }
        : outcome.kind === 'read' ? { ok: outcome.ok && result.fields.some(f => f.filled), text: `${outcome.title} on this page${outcome.detail ? `; ${outcome.detail.toLowerCase()}` : ''}` }
        : { ok: outcome.ok, text: `${outcome.title}${outcome.detail ? `. ${outcome.detail}` : ''}` };
    const checklist: ReadinessItem[] = [
        thisPage,
        ...readinessItems({ recipe, version, samples, ...(review ? { review } : {}), ...(pages ? { pages } : {}),
            actions: { targeting: () => onNavigate('pro-history'), review: () => onNavigate('pro-history') } }),
    ];

    return (
        <div className="flex h-full flex-col">
            {header}
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
                <Card className="flex flex-col gap-2" data-testid="pro-check-page">
                    <div className="flex items-center gap-2">
                        <ClipboardCheck size={16} className="shrink-0 text-ink-2" />
                        <Text weight="semibold" className="min-w-0 flex-1 truncate">On {page.host || 'this page'}</Text>
                        {result && !result.error && !result.rule && (
                            <Button size="sm" variant="ghost" icon={outlined ? <EyeOff /> : <Eye />}
                                onClick={() => { const on = !outlined; setOutlined(on); void outline(result, on); }}>{outlined ? 'Hide on page' : 'Show on page'}</Button>
                        )}
                    </div>
                    {variables.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {variables.map(v => <TextField key={v} size="sm" className="w-28" label={`{${v}}`} value={context[v] ?? ''} onChange={e => changeContext({ ...context, [v]: e.target.value })} />)}
                        </div>
                    )}
                    <div><Button variant="primary" icon={<FlaskConical />} loading={checking} disabled={!page.web} onClick={checkPage}
                        title={page.web ? undefined : 'Open the page in a tab first'}>Check this page</Button></div>
                    {result?.error && <Notice tone="danger" title="The check stopped">{result.error}</Notice>}
                    {result && outcome && outcome.kind !== 'read' && outcome.kind !== 'error' && (
                        <div data-testid="pro-check-outcome">
                            <Notice tone={outcome.ok ? 'success' : 'warning'} title={outcome.title}>
                                {outcome.detail}
                                {result.rule && !outcome.ok && (
                                    <div className="pt-1.5">
                                        <Button size="sm" variant="secondary" onClick={() => void addSample(result.rule!.name)}>
                                            Keep as a sample that should hit "{result.rule.name}"
                                        </Button>
                                    </div>
                                )}
                            </Notice>
                        </div>
                    )}
                    {result?.setup && <Text size="caption" tone="muted">{result.setup.ran ? `Session set up first: ${result.setup.steps.map(s => s.name).join(', ')}.` : 'Session already set up.'}</Text>}
                    {result && !result.error && !result.rule && (
                        <div className="flex flex-col divide-y divide-line" data-testid="pro-check-table">
                            {fields.map(f => <FieldRow key={f.id} field={f} result={byId.get(f.id)}
                                onFocus={() => { if (page.tab?.id) void call(page.tab.id, 'focusField', [f.name]).catch(() => {}); }} />)}
                        </div>
                    )}
                    {result && !result.error && !result.rule && (result.record !== undefined || result.recordError) && (
                        <div className="flex flex-col gap-1 rounded-xl bg-ink/4 px-2.5 py-2" data-testid="pro-check-record">
                            <Text size="caption" tone="muted">The record, after the transform</Text>
                            {result.recordError
                                ? <Text size="caption" tone="danger">The transform failed: {result.recordError}</Text>
                                : <pre className="max-h-72 overflow-auto font-mono text-caption whitespace-pre-wrap break-all">{JSON.stringify(result.record, null, 2)}</pre>}
                        </div>
                    )}
                    {result?.options && (
                        <div className="flex flex-col gap-1 rounded-xl bg-ink/4 px-2.5 py-2" data-testid="pro-check-options">
                            <Text size="caption" tone="muted">One row per item of "{result.options[0]?.step}"</Text>
                            {result.options.map(o => (
                                <Text key={o.label} size="caption" mono className="break-all">
                                    {o.label}: {o.fields.map(x => `${x.name} = ${shownValue(x, fields.find(f => f.id === x.fieldId)?.type ?? 'text')}`).join('; ') || '—'}
                                </Text>
                            ))}
                        </div>
                    )}
                </Card>

                <Card className="flex flex-col gap-2" data-testid="pro-check-samples">
                    <div className="flex items-center gap-2">
                        <Layers size={16} className="shrink-0 text-ink-2" />
                        <Text weight="semibold" className="flex-1">Sample pages ({samples.length})</Text>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => void addSample()} disabled={!page.web || samples.some(s => s.url === page.url)}>Add this page</Button>
                        <Button size="sm" variant="secondary" icon={<FlaskConical />} loading={!!progress} disabled={!samples.length || !!progress} onClick={checkSamples}>
                            Check {Math.min(samples.length, CHECK_PAGES)} sample page{Math.min(samples.length, CHECK_PAGES) === 1 ? '' : 's'}
                        </Button>
                    </div>
                    {progress && <Text size="caption" tone="muted">Checking page {progress.done + 1} of {progress.total}…</Text>}
                    {keptFor && <Text size="caption" tone="muted" data-testid="pro-check-kept">This page is a sample that should hit "{keptFor}".</Text>}
                    {pages && <TestGrid results={pages} fields={fields.map(f => ({ id: f.id, name: f.name }))} expect={expect} />}
                </Card>

                <ReadinessCard items={checklist} />
            </div>
        </div>
    );
}
