/** The save step for each extractor, so the upstream pages only pass what they hold. */
import type { RunElement } from '../../shared/recipes/spec';
import type { ListPick, PaginationMode } from '../../shared/types/extraction';
import { saveListVersion, savePageVersion, siteOfUrl, type ProEdit } from '../edit';
import type { RunSettings } from '../recipe/types';
import { plural, SaveVersionStep } from './SaveVersionStep';

interface Common {
    edit: ProEdit;
    onBack: () => void;
    onDone: () => void;
}

export function PageSave({ edit, elements, urls, settings, ...rest }: Common & { elements: RunElement[]; urls: string[]; settings: RunSettings }) {
    const fields = elements.filter(e => e.action !== 'click').length;
    return (
        <SaveVersionStep {...rest} edit={edit}
            site={edit.recipe?.site ?? siteOfUrl(urls[0])}
            summary={`${plural(fields, 'field')} · ${plural(elements.length - fields, 'click')} · ${plural(urls.length, 'page')}`}
            canSave={fields > 0}
            save={(name, note) => savePageVersion(edit, { name, elements, urls, settings, note })} />
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
