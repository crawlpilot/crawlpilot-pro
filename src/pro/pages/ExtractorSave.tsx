/** The save step for each extractor, so the upstream pages only pass what they hold. */
import type { RunElement } from '../../shared/recipes/spec';
import type { ListPick, PaginationMode } from '../../shared/types/extraction';
import { pageDraftSpec, saveListVersion, savePageVersion, siteOfUrl, type ProEdit } from '../edit';
import { proposeFields } from '../recipe/naming';
import type { RunSettings } from '../recipe/types';
import { plural, SaveVersionStep, type NamedField } from './SaveVersionStep';

interface Common {
    edit: ProEdit;
    onBack: () => void;
    onDone: () => void;
}

/** Each picked field with a proposed name and output type (`recipe/naming.ts`); a field picked again keeps its own. */
function namedFields(edit: ProEdit, elements: RunElement[], settings: RunSettings): NamedField[] {
    const { spec } = pageDraftSpec(edit, elements, settings);
    const typeOf = new Map(spec.steps.flatMap(s => s.kind === 'field' ? [[s.field.id, s.field.type] as const] : []));
    const picked = elements.filter(e => e.action !== 'click');
    const proposals = proposeFields(picked.map(e => ({ name: e.name, type: e.type, selectors: e.selectors, ...(e.data ? { data: e.data } : {}), ...(e.shape ? { shape: e.shape } : {}), value: e.value })),
        picked.map(e => typeOf.get(e.id) ?? 'text'));
    return picked.map((e, i) => ({ id: e.id, value: e.value, ...proposals[i] }));
}

export function PageSave({ edit, elements, urls, settings, ...rest }: Common & { elements: RunElement[]; urls: string[]; settings: RunSettings }) {
    const fields = elements.filter(e => e.action !== 'click').length;
    return (
        <SaveVersionStep {...rest} edit={edit}
            site={edit.recipe?.site ?? siteOfUrl(urls[0])}
            summary={`${plural(fields, 'field')} · ${plural(elements.length - fields, 'click')} · ${plural(urls.length, 'page')}`}
            canSave={fields > 0}
            fields={namedFields(edit, elements, settings)}
            save={(name, note, named) => savePageVersion(edit, { name, elements, urls, settings, note, ...(named ? { fields: named } : {}) })} />
    );
}

export function ListSave({ edit, picks, mode, next, url, ...rest }: Common & { picks: ListPick[]; mode: PaginationMode; next: string[]; url?: string }) {
    const fields = picks.reduce((n, p) => n + (p.data?.columns?.length ?? 0), 0);
    const paging = mode === 'auto' ? 'scrolls' : mode === 'loadMore' ? 'Load more' : 'Next pages';
    return (
        <SaveVersionStep {...rest} edit={edit}
            site={edit.recipe?.site ?? siteOfUrl(url)}
            summary={`${plural(picks.length, 'list')} · ${plural(fields, 'field')} · ${paging}`}
            canSave={picks.length > 0}
            save={(name, note) => saveListVersion(edit, { name, picks, mode, next, url, note })} />
    );
}
