import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dialog, Menu, MenuItem, Segmented, Select } from '.';
import { placePopover } from './Menu';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ''; });

const render = (ui: React.ReactNode) => act(() => root.render(ui));
const key = (el: Element, k: string) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });

describe('placePopover', () => {
    const view = { w: 400, h: 800 };
    const rect = (left: number, top: number, w = 40, h = 30) => ({ left, top, right: left + w, bottom: top + h, width: w, height: h } as DOMRect);

    it('opens below the anchor, lined up with its start', () => {
        expect(placePopover(rect(20, 100), 200, 150, 'start', view)).toEqual({ left: 20, top: 134 });
    });
    it('lines up with the end and stays on screen', () => {
        expect(placePopover(rect(340, 100), 200, 150, 'end', view)).toEqual({ left: 180, top: 134 });
        expect(placePopover(rect(300, 100), 200, 150, 'start', view).left).toBe(196);
    });
    it('opens above when there is no room below', () => {
        expect(placePopover(rect(20, 700), 200, 150, 'start', view).top).toBe(546);
    });
});

describe('Segmented', () => {
    function Harness({ onChange }: { onChange: (v: string) => void }) {
        const [v, setV] = useState('a');
        return <Segmented aria-label="pick" value={v} onChange={x => { setV(x); onChange(x); }}
            options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B', disabled: true }, { value: 'c', label: 'C' }]} />;
    }

    it('marks the choice and moves with the arrow keys, skipping disabled ones', () => {
        const onChange = vi.fn();
        render(<Harness onChange={onChange} />);
        const group = host.querySelector('[role="radiogroup"]')!;
        expect(host.querySelector('[aria-checked="true"]')!.textContent).toBe('A');
        key(group, 'ArrowRight');
        expect(onChange).toHaveBeenLastCalledWith('c');
        key(group, 'ArrowRight');
        expect(onChange).toHaveBeenLastCalledWith('a');
        key(group, 'ArrowLeft');
        expect(host.querySelector('[aria-checked="true"]')!.textContent).toBe('C');
    });
});

describe('Select', () => {
    it('gives numbers back as numbers', () => {
        const onChange = vi.fn();
        render(<Select value={5} onChange={onChange} options={[1, 5, 10].map(n => ({ value: n, label: String(n) }))} />);
        const select = host.querySelector('select')!;
        act(() => { select.value = '10'; select.dispatchEvent(new Event('change', { bubbles: true })); });
        expect(onChange).toHaveBeenCalledWith(10);
    });
});

describe('Dialog', () => {
    it('shows its content only while open, and the close button closes it', () => {
        const onClose = vi.fn();
        render(<Dialog open={false} onClose={onClose} title="Remove?">body</Dialog>);
        expect(document.body.textContent).not.toContain('body');
        render(<Dialog open onClose={onClose} title="Remove?">body</Dialog>);
        expect(document.body.textContent).toContain('body');
        expect(host.querySelector('dialog')!.getAttribute('aria-labelledby')).toBeTruthy();
        act(() => (host.querySelector('button[aria-label="Close"]') as HTMLButtonElement).click());
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('a persistent dialog has no close button', () => {
        render(<Dialog open persistent onClose={() => undefined} title="Saving">body</Dialog>);
        expect(host.querySelector('button[aria-label="Close"]')).toBeNull();
    });
});

describe('Menu', () => {
    it('focuses the first item, moves with arrows, picks with Enter, closes on Escape', () => {
        const anchor = document.createElement('button');
        document.body.append(anchor);
        const onClose = vi.fn();
        const picked = vi.fn();
        render(
            <Menu anchor={anchor} onClose={onClose}>
                <MenuItem onClick={() => picked('one')}>One</MenuItem>
                <MenuItem onClick={() => picked('off')} disabled>Off</MenuItem>
                <MenuItem onClick={() => picked('two')}>Two</MenuItem>
            </Menu>,
        );
        const menu = document.querySelector('[role="menu"]')!;
        expect(document.activeElement?.textContent).toBe('One');
        key(menu, 'ArrowDown');
        expect(document.activeElement?.textContent).toBe('Two');
        key(document.activeElement!, 'Enter');
        expect(picked).toHaveBeenCalledWith('two');
        key(menu, 'Escape');
        expect(onClose).toHaveBeenCalled();
    });

    it('closes on a click outside', () => {
        const anchor = document.createElement('button');
        document.body.append(anchor);
        const onClose = vi.fn();
        render(<Menu anchor={anchor} onClose={onClose}><MenuItem onClick={() => undefined}>One</MenuItem></Menu>);
        act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
        expect(onClose).toHaveBeenCalled();
    });
});
