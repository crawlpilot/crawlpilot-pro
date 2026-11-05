import { describe, expect, it } from 'vitest';
import { segments } from '../recipe/actions';
import { problems } from '../recipe/editSpec';
import type { Click, PageRecipeSpec } from '../recipe/types';
import type { TargetRequest } from './inPageSteps';
import { DEFAULT_STEP_OPTIONS, runPageSteps, StepFailed, type StepDriver } from './runner';

const sel = (selector: string) => ({ kind: 'selector' as const, selector });
const field = (id: string) => ({ kind: 'field' as const, field: { id, name: id, type: 'text' as const, read: 'text', ops: [], ways: [sel(`.${id}`)] } });
const tiles: Click = { id: 'tiles', name: 'Fulfilment', ways: [sel('.tile')], do: 'choose', forEach: {} };
const spec: PageRecipeSpec = { kind: 'page', steps: [field('title'), { kind: 'click', click: tiles }, field('detail'), field('price')] };
const options = { ...DEFAULT_STEP_OPTIONS, timeoutMs: 50, optionalWaitMs: 10, navigationWaitMs: 0, settleMs: 0 };

/** A page of tiles: choosing one shows its detail; the price is the same whichever is chosen. */
function fakePage(items: string[]) {
    let chosen = '';
    let marked = '';
    const driver: StepDriver = {
        async find(r: TargetRequest) {
            const pick = r.choose?.text !== undefined ? items.find(i => i.includes(r.choose!.text!)) : items[r.choose?.index ?? 0];
            marked = pick ?? '';
            return { found: !!pick, used: pick ? 0 : -1, matches: [!!pick], ...(pick ? { text: pick } : {}) };
        },
        isShown: async () => true,
        listItems: async () => items,
        async act() { chosen = marked; },
        pressKey: async () => {}, scrollToEnd: async () => {}, dismissNow: async () => {}, sleep: async () => {},
    };
    const read = async (s: PageRecipeSpec) => ({
        item: Object.fromEntries(s.steps.flatMap(st => st.kind === 'field' ? [[st.field.id, st.field.id === 'detail' ? `${chosen} detail` : st.field.id === 'price' ? '$9' : 'Lamp']] : [])),
        steps: [], ways: [],
    });
    return { driver, read };
}

describe('for each item', () => {
    it('repeats the fields after the step, up to the next action', () => {
        const next: PageRecipeSpec = { ...spec, steps: [...spec.steps, { kind: 'click', click: { id: 'x', name: 'x', ways: [sel('.x')], do: 'type', value: 'a' } }, field('after')] };
        expect(segments(next).map(s => s.kind === 'act' ? 'act' : `${s.kind}:${s.spec.steps.map(st => st.kind === 'field' ? st.field.id : '')}`))
            .toEqual(['read:title', 'each:detail,price', 'act', 'read:after']);
    });

    it('reads each item\'s fields, in the page\'s order, with the other fields shared', async () => {
        const { driver, read } = fakePage(['Pickup', 'Delivery', 'Shipping']);
        const r = await runPageSteps(driver, spec, {}, options, read);
        expect(r.item).toEqual({ title: 'Lamp' });
        expect(r.options).toEqual([
            { step: 'Fulfilment', label: 'Pickup', item: { detail: 'Pickup detail', price: '$9' } },
            { step: 'Fulfilment', label: 'Delivery', item: { detail: 'Delivery detail', price: '$9' } },
            { step: 'Fulfilment', label: 'Shipping', item: { detail: 'Shipping detail', price: '$9' } },
        ]);
    });

    it('goes through only the items it names, in that order, and at most `max`', async () => {
        const { driver, read } = fakePage(['Pickup', 'Delivery', 'Shipping']);
        const named: PageRecipeSpec = { ...spec, steps: spec.steps.map(s => s.kind === 'click' ? { kind: 'click', click: { ...tiles, forEach: { values: ['Shipping', 'Pickup'] } } } : s) };
        expect((await runPageSteps(driver, named, {}, options, read)).options!.map(o => o.label)).toEqual(['Shipping', 'Pickup']);
        const capped: PageRecipeSpec = { ...spec, steps: spec.steps.map(s => s.kind === 'click' ? { kind: 'click', click: { ...tiles, forEach: { max: 2 } } } : s) };
        expect((await runPageSteps(driver, capped, {}, options, read)).options!.map(o => o.label)).toEqual(['Pickup', 'Delivery']);
    });

    it('fails, naming the step, when there is nothing to go through; skips it when optional', async () => {
        const { driver, read } = fakePage([]);
        await expect(runPageSteps(driver, spec, {}, options, read)).rejects.toThrow(StepFailed);
        const optional: PageRecipeSpec = { ...spec, steps: spec.steps.map(s => s.kind === 'click' ? { kind: 'click', click: { ...tiles, optional: true } } : s) };
        expect((await runPageSteps(driver, optional, {}, options, read)).options).toBeUndefined();
    });

    it('is a choice, and one per recipe', () => {
        const two: PageRecipeSpec = { ...spec, steps: [...spec.steps, { kind: 'click', click: { ...tiles, id: 't2', name: 'Size' } }] };
        expect(problems(two)).toContain('Only one step can go through each item.');
        const notChoose: PageRecipeSpec = { ...spec, steps: spec.steps.map(s => s.kind === 'click' ? { kind: 'click', click: { ...tiles, do: 'click' } } : s) };
        expect(problems(notChoose)).toContain('Step "Fulfilment" goes through each item, so it must choose from a list.');
    });
});

describe('a page rule', () => {
    it('stops the page: no step runs after the read where it held, and the rule comes back', async () => {
        const acted: string[] = [];
        const { driver } = fakePage(['Pickup']);
        driver.act = async () => { acted.push('act'); };
        const typed: PageRecipeSpec = { kind: 'page', steps: [field('title'), { kind: 'click', click: { id: 'zip', name: 'ZIP', ways: [sel('#zip')], do: 'type', value: '10001' } }, field('price')] };
        const r = await runPageSteps(driver, typed, {}, options, async () => ({ item: {}, steps: [], ways: [], rule: { name: '404', status: 'not_found' as const } }));
        expect(r.rule).toEqual({ name: '404', status: 'not_found' });
        expect(acted).toEqual([]);
    });
});
