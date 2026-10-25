/**
 * The design rules (docs/plans/design-system-plan.md §3), checked on every test run: screens build
 * from the kit and token classes, so a redesign is an edit to src/sidepanel/ui and index.css only.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');
const SIDEPANEL = join(ROOT, 'src', 'sidepanel');
const KIT = join(SIDEPANEL, 'ui');

function files(dir: string, ext: RegExp): string[] {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? files(path, ext) : ext.test(name) ? [path] : [];
    });
}

/** Each line of the side panel's screens (not the kit) that breaks a rule. */
function offences(rule: RegExp): string[] {
    return files(SIDEPANEL, /\.tsx$/)
        .filter(f => !f.startsWith(KIT))
        .flatMap(f => readFileSync(f, 'utf8').split('\n')
            .map((line, i) => (rule.test(line) ? `${relative(ROOT, f)}:${i + 1}: ${line.trim().slice(0, 100)}` : ''))
            .filter(Boolean));
}

describe('design rules', () => {
    it('no MUI or Emotion anywhere', () => {
        const used = files(join(ROOT, 'src'), /\.(ts|tsx)$/)
            .filter(f => /from '@(mui|emotion)\//.test(readFileSync(f, 'utf8')))
            .map(f => relative(ROOT, f));
        expect(used).toEqual([]);
        const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
        expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter(d => /^@(mui|emotion)\//.test(d))).toEqual([]);
    });

    it('screens set no colours of their own: no hex, no rgb() or rgba() outside a token', () => {
        expect(offences(/#[0-9a-fA-F]{3,8}\b(?![\w-])|rgba?\((?!var\(--cp-)/)).toEqual([]);
    });

    it('screens use no sx props or old component classes', () => {
        expect(offences(/\bsx=\{|className="[^"]*\b(btn|btn-primary|input-field|text-text-(primary|secondary|muted)|bg-background-(app|panel|card))\b/)).toEqual([]);
    });
});
