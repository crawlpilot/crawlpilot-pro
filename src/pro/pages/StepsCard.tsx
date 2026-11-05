/**
 * Interaction steps in the editor (`docs/plans/pro-data-collection-plan.md`, C1):
 * - **Before reading:** the session setup (steps run once per session, such as a delivery ZIP or a store), its
 *   check (an element whose text must contain, say, `{zip}`), the dismissals (consent banners, pop-ups closed
 *   whenever they show), test values for the variables, and Try setup on the open tab.
 * - **Action steps** among the fields: click, type, choose, select, press, wait, scroll; optional or not.
 * A step's element is picked on the page with the extension's picker, or typed as a selector.
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Crosshair, FlaskConical, Plus, Trash2, Workflow } from 'lucide-react';
import { Button, Chip, Disclosure, IconButton, Notice, Select, Switch, Text, TextField } from '../../sidepanel/ui';
import { on, sendToTab } from '../../shared/messages';
import { pageTabId } from '../../sidepanel/hooks/usePageTab';
import { describeAction, MAX_EACH, variablesOf } from '../recipe/actions';
import * as edits from '../recipe/editSpec';
import type { ActionKind, Click, PageRecipeSpec, SessionSetup, Way } from '../recipe/types';
import { trySetupOnTab } from '../runner/testPage';
import { Ways } from './Ways';

const KINDS: { value: ActionKind; label: string }[] = [
    { value: 'click', label: 'Click' },
    { value: 'type', label: 'Type text' },
    { value: 'choose', label: 'Choose from a list' },
    { value: 'select', label: 'Pick a dropdown option' },
    { value: 'press', label: 'Press a key' },
    { value: 'wait', label: 'Wait for' },
    { value: 'scroll', label: 'Scroll to' },
];

const VALUE_LABEL: Partial<Record<ActionKind, string>> = {
    type: 'Text to type', choose: 'The item that shows', select: 'Option', press: 'Key',
};
const VALUE_PLACEHOLDER: Partial<Record<ActionKind, string>> = {
    type: '{zip}', choose: '{store} or Delivery', select: 'Large', press: 'Enter or Escape',
};

export const newStep = (name: string, extra: Partial<Click> = {}): Click => ({ id: crypto.randomUUID(), name, ways: [], ...extra });

/** Picking a step's element on the page, with the extension's picker; one pick at a time. */
export function usePicker() {
    const [picking, setPicking] = useState<string | null>(null);
    const done = useRef<((selectors: string[]) => void) | null>(null);
    useEffect(() => {
        const offSelected = on('ELEMENT_SELECTED', selected => {
            if (!done.current || selected.selectionMode !== 'detail') return;
            done.current(selected.selectors ?? []);
            done.current = null;
            setPicking(null);
        });
        const offCancelled = on('PICKER_CANCELLED', () => { done.current = null; setPicking(null); });
        return () => { offSelected(); offCancelled(); };
    }, []);
    const pick = async (key: string, onPicked: (selectors: string[]) => void) => {
        const tabId = await pageTabId();
        if (!tabId) return;
        done.current = onPicked;
        setPicking(key);
        const res = await sendToTab(tabId, 'START_PICKER', { mode: 'detail', action: 'click' }).catch(() => null);
        if (!res?.success) { done.current = null; setPicking(null); }
    };
    return { picking, pick };
}

const withSelectors = (ways: Way[], selectors: string[]): Way[] =>
    [...ways, ...selectors.filter(s => !ways.some(w => w.kind === 'selector' && w.selector === s)).map(selector => ({ kind: 'selector' as const, selector }))];

const wayEdits = (ways: Way[], set: (ways: Way[]) => void) => ({
    onMove: (i: number, d: number) => set(edits.listEdit.move(ways, i, d)),
    onRemove: (i: number) => set(edits.listEdit.remove(ways, i)),
    onAdd: (s: string) => { if (s.trim()) set(withSelectors(ways, [s.trim()])); },
});

/** One action step: what it does, to what, with which value. */
export function ActionEditor({ click, onChange, picker, pickKey, label = 'Step', clickOnly, allowEach }: {
    click: Click; onChange: (c: Click) => void; picker: ReturnType<typeof usePicker>; pickKey: string; label?: string;
    /** A dismissal: always a click, never optional (it is done only when it shows anyway). */
    clickOnly?: boolean;
    /** A page step: a choice can go through each item, one row each. */
    allowEach?: boolean;
}) {
    const [eachText, setEachText] = useState((click.forEach?.values ?? []).join(', '));
    const what = click.do ?? 'click';
    const set = (patch: Partial<Click>) => {
        const next: Click = { ...click, ...patch };
        // A plain click stays plain: no `do`, so the extractor runs it as before.
        if (next.do === 'click') delete next.do;
        for (const k of ['value', 'enter', 'gone', 'index'] as const) if (next[k] === undefined || next[k] === '' || next[k] === false) delete next[k];
        if (!next.optional) delete next.optional;
        if (!next.forEach || next.do !== 'choose') delete next.forEach;
        onChange(next);
    };
    return (
        <div className="flex flex-col gap-2" data-testid="pro-action">
            <div className="flex items-end gap-2">
                <TextField size="sm" className="flex-1" label={`${label} name`} value={click.name} onChange={e => set({ name: e.target.value })} />
                {!clickOnly && <Select<ActionKind> size="sm" label="What it does" value={what} options={KINDS} onChange={k => set({ do: k })} />}
            </div>
            {!clickOnly && VALUE_LABEL[what] && !click.forEach && (
                <TextField size="sm" label={VALUE_LABEL[what]} value={click.value ?? ''} placeholder={VALUE_PLACEHOLDER[what]}
                    hint={what === 'type' || what === 'choose' ? 'A variable in braces, {zip}, takes each job\'s value.' : undefined}
                    onChange={e => set({ value: e.target.value })} />
            )}
            {!clickOnly && <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Switch label="Optional: skip it when it isn't there" checked={!!click.optional} onChange={v => set({ optional: v })} />
                {what === 'type' && <Switch label="Press Enter after" checked={!!click.enter} onChange={v => set({ enter: v })} />}
                {what === 'wait' && <Switch label="Wait for it to go away" checked={!!click.gone} onChange={v => set({ gone: v })} />}
                {what === 'choose' && allowEach && <Switch label="For each item: one row per item" checked={!!click.forEach}
                    onChange={v => set(v ? { forEach: eachText.trim() ? { values: eachText.split(',').map(x => x.trim()).filter(Boolean) } : {}, value: undefined } : { forEach: undefined })} />}
            </div>}
            {click.forEach && (
                <TextField size="sm" label="Only these items, in order" value={eachText} placeholder="Pickup, Delivery, Shipping"
                    hint={`Empty: every item the selector finds, up to ${MAX_EACH}. The fields after this step, up to the next step, are read for each.`}
                    onChange={e => {
                        setEachText(e.target.value);
                        const values = e.target.value.split(',').map(x => x.trim()).filter(Boolean);
                        set({ forEach: values.length ? { ...click.forEach, values } : (({ values: _, ...rest }) => rest)(click.forEach!) });
                    }} />
            )}
            <Ways ways={click.ways} title={what === 'choose' ? 'The items to choose from' : 'Its element'} {...wayEdits(click.ways, ways => set({ ways }))} />
            <div>
                <Button size="sm" variant="ghost" icon={<Crosshair />} loading={picker.picking === pickKey}
                    onClick={() => picker.pick(pickKey, selectors => onChange({ ...click, ways: withSelectors(click.ways, selectors) }))}>
                    {picker.picking === pickKey ? 'Pick it on the page…' : 'Pick on page'}
                </Button>
            </div>
        </div>
    );
}

/** A row of a list of steps: the editor in a disclosure, and move and remove. */
function StepRow({ click, index, count, onChange, onMove, onRemove, picker, label, clickOnly, allowEach }: {
    click: Click; index: number; count: number; onChange: (c: Click) => void; onMove: (d: number) => void; onRemove: () => void;
    picker: ReturnType<typeof usePicker>; label: string; clickOnly?: boolean; allowEach?: boolean;
}) {
    return (
        <Disclosure defaultOpen={click.ways.length === 0}
            summary={<span className="flex min-w-0 items-center gap-1.5"><span className="truncate font-semibold">{index + 1}. {click.name || 'unnamed'}</span><Chip>{describeAction(click)}</Chip></span>}>
            <div className="flex flex-col gap-2 pt-2">
                <ActionEditor click={click} onChange={onChange} picker={picker} pickKey={click.id} label={label} clickOnly={clickOnly} allowEach={allowEach} />
                <div className="flex items-center justify-end">
                    <IconButton size="sm" label="Move up" onClick={() => onMove(-1)} disabled={index === 0}><ArrowUp /></IconButton>
                    <IconButton size="sm" label="Move down" onClick={() => onMove(1)} disabled={index === count - 1}><ArrowDown /></IconButton>
                    <IconButton size="sm" label={`Remove ${label.toLowerCase()} ${click.name}`} onClick={onRemove}><Trash2 /></IconButton>
                </div>
            </div>
        </Disclosure>
    );
}

/** The session setup, dismissals, variables' test values, and Try setup. */
export function BeforeReading({ spec, onChange, context, onContext, picker }: {
    spec: PageRecipeSpec; onChange: (spec: PageRecipeSpec) => void;
    context: Record<string, string>; onContext: (c: Record<string, string>) => void;
    picker: ReturnType<typeof usePicker>;
}) {
    const setup: SessionSetup = spec.setup ?? { steps: [] };
    const edit = (f: (s: SessionSetup) => SessionSetup) => onChange(edits.editSetup(spec, f));
    const variables = variablesOf(spec);
    const [trying, setTrying] = useState(false);
    const [tried, setTried] = useState<Awaited<ReturnType<typeof trySetupOnTab>> | null>(null);
    const count = setup.steps.length + (setup.dismiss?.length ?? 0) + (setup.check ? 1 : 0);

    const trySetup = async () => {
        const tabId = await pageTabId();
        if (!tabId) return;
        setTrying(true);
        setTried(await trySetupOnTab(tabId, spec, context));
        setTrying(false);
    };

    return (
        <div data-testid="pro-before-reading"><Disclosure icon={<Workflow />} defaultOpen={count > 0}
            summary="Before reading"
            meta={count ? <Chip tone="info">{setup.steps.length} step{setup.steps.length === 1 ? '' : 's'}{setup.check ? ', check' : ''}</Chip> : <Text size="caption" tone="faint">none</Text>}>
            <div className="flex flex-col gap-3 pt-2">
                <Text size="caption" tone="muted">
                    Steps that set the session up once, such as a delivery ZIP code or a store, then a check on every page that it
                    still is. Pages are never read for the wrong location.
                </Text>

                <Text size="caption" weight="semibold" tone="muted">Setup steps, in order</Text>
                {setup.steps.map((c, i) => (
                    <StepRow key={c.id} click={c} index={i} count={setup.steps.length} picker={picker} label="Setup step"
                        onChange={next => edit(s => ({ ...s, steps: edits.listEdit.replace(s.steps, i, next) }))}
                        onMove={d => edit(s => ({ ...s, steps: edits.listEdit.move(s.steps, i, d) }))}
                        onRemove={() => edit(s => ({ ...s, steps: edits.listEdit.remove(s.steps, i) }))} />
                ))}
                <div><Button size="sm" variant="ghost" icon={<Plus />} onClick={() => edit(s => ({ ...s, steps: [...s.steps, newStep(`Step ${s.steps.length + 1}`)] }))}>Add setup step</Button></div>

                <Text size="caption" weight="semibold" tone="muted">Check, on every page</Text>
                {setup.check ? (
                    <div className="flex flex-col gap-2" data-testid="pro-setup-check">
                        <TextField size="sm" label="Its text must contain" value={setup.check.contains} placeholder="{zip}"
                            onChange={e => edit(s => ({ ...s, check: { ...s.check!, contains: e.target.value } }))} />
                        <Ways ways={setup.check.ways} title="The element to read" {...wayEdits(setup.check.ways, ways => edit(s => ({ ...s, check: { ...s.check!, ways } })))} />
                        <div className="flex gap-1.5">
                            <Button size="sm" variant="ghost" icon={<Crosshair />} loading={picker.picking === 'check'}
                                onClick={() => picker.pick('check', selectors => edit(s => ({ ...s, check: { ...s.check!, ways: withSelectors(s.check!.ways, selectors) } })))}>Pick on page</Button>
                            <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={() => edit(({ check: _, ...s }) => s)}>Remove the check</Button>
                        </div>
                    </div>
                ) : (
                    <div><Button size="sm" variant="ghost" icon={<Plus />} onClick={() => edit(s => ({ ...s, check: { ways: [], contains: '' } }))}>Add a check</Button></div>
                )}

                <Text size="caption" weight="semibold" tone="muted">Dismiss whenever they show</Text>
                <Text size="caption" tone="faint">The close control of a cookie banner, a promo pop-up, an "Is this your location?" prompt.</Text>
                {(setup.dismiss ?? []).map((c, i) => (
                    <StepRow key={c.id} click={c} index={i} count={setup.dismiss!.length} picker={picker} label="Dismissal" clickOnly
                        onChange={({ do: _, ...next }) => edit(s => ({ ...s, dismiss: edits.listEdit.replace(s.dismiss ?? [], i, next) }))}
                        onMove={d => edit(s => ({ ...s, dismiss: edits.listEdit.move(s.dismiss ?? [], i, d) }))}
                        onRemove={() => edit(s => ({ ...s, dismiss: edits.listEdit.remove(s.dismiss ?? [], i) }))} />
                ))}
                <div><Button size="sm" variant="ghost" icon={<Plus />} onClick={() => edit(s => ({ ...s, dismiss: [...(s.dismiss ?? []), newStep(`Dismissal ${(s.dismiss?.length ?? 0) + 1}`)] }))}>Add dismissal</Button></div>

                {variables.length > 0 && (
                    <div className="flex flex-col gap-2" data-testid="pro-test-values">
                        <Text size="caption" weight="semibold" tone="muted">Test values</Text>
                        <Text size="caption" tone="faint">Used by Try setup and the tests here. Each crawl job brings its own.</Text>
                        {variables.map(v => (
                            <TextField key={v} size="sm" label={`{${v}}`} value={context[v] ?? ''} onChange={e => onContext({ ...context, [v]: e.target.value })} />
                        ))}
                    </div>
                )}

                <div><Button size="sm" variant="secondary" icon={<FlaskConical />} loading={trying} disabled={!setup.steps.length || trying} onClick={trySetup}>Try setup on this page</Button></div>
                {tried && (
                    <div data-testid="pro-try-setup"><Notice tone={tried.ok ? 'success' : 'danger'} title={tried.ok ? 'The setup worked on this page' : 'The setup stopped'}>
                        <span className="flex flex-col gap-0.5">
                            {tried.steps.map((s, i) => <span key={i}>{i + 1}. {s.name}: {s.status === 'done' ? 'done' : 'skipped (not there)'}</span>)}
                            {tried.error && <span>{tried.error}</span>}
                        </span>
                    </Notice></div>
                )}
            </div>
        </Disclosure></div>
    );
}

/** An action step among the fields. */
export function PageAction({ spec, click, index, onChange, picker }: {
    spec: PageRecipeSpec; click: Click; index: number; onChange: (spec: PageRecipeSpec) => void; picker: ReturnType<typeof usePicker>;
}) {
    return (
        <div key={click.id} data-testid="pro-page-action">
            <StepRow click={click} index={index} count={spec.steps.length} picker={picker} label="Step" allowEach
                onChange={next => onChange(edits.updateClick(spec, click.id, () => next))}
                onMove={d => onChange(edits.moveStep(spec, index, d))}
                onRemove={() => onChange(edits.removeStep(spec, index))} />
        </div>
    );
}
