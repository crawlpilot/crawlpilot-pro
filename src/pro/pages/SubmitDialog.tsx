/**
 * Submit a ready version: its pages, a schedule, then the backend creates (once), takes the version,
 * starts the crawl and makes it live. A refusal or an error is said as the backend or the gate said it.
 */
import { useState } from 'react';
import { Button, Dialog, Notice, Segmented, Text } from '../../sidepanel/ui';
import { backendApi } from '../backend/settings';
import { submitVersion } from '../backend/submit';
import { BackendError, type Schedule } from '../backend/types';
import { LOCAL_AUTHOR } from '../edit';
import type { ProRecipe, Version } from '../recipe/types';

interface Props {
    recipe: ProRecipe;
    version: Version | null;
    onClose: () => void;
    onSubmitted: () => void;
}

const pagesText = (v: Version) => v.pages.kind === 'urls' ? `${v.pages.urls.length} page${v.pages.urls.length === 1 ? '' : 's'}`
    : v.pages.kind === 'start' ? `from ${v.pages.url}` : `sitemap ${v.pages.sitemap}`;

export function SubmitDialog({ recipe, version, onClose, onSubmitted }: Props) {
    const [schedule, setSchedule] = useState<Schedule>('once');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<{ message: string; details?: string[] } | null>(null);

    const submit = async () => {
        if (!version) return;
        setBusy(true);
        setError(null);
        try {
            const api = await backendApi();
            if (!api) throw new BackendError('auth', 'Set the backend address and token first (Backend, on the Recipes screen).');
            await submitVersion(api, recipe, version, schedule, LOCAL_AUTHOR);
            onSubmitted();
            onClose();
        } catch (e) {
            setError({ message: e instanceof Error ? e.message : String(e), ...(e instanceof BackendError && e.details ? { details: e.details } : {}) });
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={!!version} onClose={onClose} size="sm" persistent={busy}
            title={version ? `Submit v${version.version}` : ''}
            description="The backend crawls these pages on the schedule, and this version becomes live."
            actions={<>
                <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
                <Button variant="primary" loading={busy} onClick={submit}>Submit</Button>
            </>}>
            {version && (
                <div className="flex flex-col gap-3">
                    <Text size="small">{recipe.name} · {pagesText(version)}</Text>
                    <Segmented<Schedule> aria-label="Schedule" value={schedule} onChange={setSchedule}
                        options={[{ value: 'once', label: 'Once' }, { value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }]} />
                    {error && <Notice tone="danger">{error.message}{error.details?.length ? ` (${error.details.join('; ')})` : ''}</Notice>}
                </div>
            )}
        </Dialog>
    );
}
