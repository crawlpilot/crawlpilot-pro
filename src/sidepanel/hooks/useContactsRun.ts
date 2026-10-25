/**
 * A background run followed from the side panel (progress, stop, the table it wrote): "Contacts from
 * websites" (`useContactsRun`) and API recipes (`useApiRun`).
 */
import { useCallback, useEffect, useState } from 'react';
import { on, send } from '../../shared/messages';
import type { ApiStart, ContactsStart } from '../../shared/messages';
import { hasAllUrlsPermission, openSiteAccessSettings, requestAllUrlsPermission } from '../../shared/utils/hostPermissions';

export interface ContactsRunState {
    running: boolean;
    stopping: boolean;
    done: number;
    total: number;
    failed: number;
    activeTabs: number;
    /** Rows read so far. */
    rows: number;
    /** The table: the live preview while running, then the final one. */
    tableId: number | null;
    finished: 'completed' | 'stopped' | 'failed' | null;
    error: string | null;
}

const IDLE: ContactsRunState = { running: false, stopping: false, done: 0, total: 0, failed: 0, activeTabs: 0, rows: 0, tableId: null, finished: null, error: null };

const RUNS = {
    contacts: { start: 'CONTACTS_START', stop: 'CONTACTS_STOP', progress: 'CONTACTS_PROGRESS', complete: 'CONTACTS_COMPLETE' },
    api: { start: 'API_START', stop: 'API_STOP', progress: 'API_PROGRESS', complete: 'API_COMPLETE' },
} as const;

interface Starts { contacts: ContactsStart; api: ApiStart }

function useBackgroundRun<K extends keyof typeof RUNS>(kind: K, units: (input: Starts[K]) => number) {
    const names = RUNS[kind];
    const [state, setState] = useState<ContactsRunState>(IDLE);

    useEffect(() => {
        const offs = [
            on(names.progress, p => setState(s => ({
                ...s, done: p.completedUrls, total: p.totalUrls, activeTabs: p.activeTabs, rows: p.rows ?? s.rows,
                failed: (p.urlStatuses ?? []).filter(u => u.status === 'error').length,
                tableId: p.previewTableId ?? s.tableId,
            }))),
            on(names.complete, c => setState(s => ({
                ...s, running: false, stopping: false, activeTabs: 0, rows: c.totalItems ?? s.rows, tableId: c.tableId ?? s.tableId,
                finished: c.stoppedByUser ? 'stopped' : c.success ? 'completed' : 'failed', error: c.success || c.stoppedByUser ? null : c.error ?? null,
            }))),
        ];
        return () => offs.forEach(off => off());
    }, [names]);

    const start = useCallback(async (input: Starts[K]) => {
        const total = units(input);
        if (total === 0) return;
        // Reading the sites needs access to them.
        if (!(await hasAllUrlsPermission())) {
            const result = await requestAllUrlsPermission();
            if (result === 'unavailable') openSiteAccessSettings();
            if (result !== 'granted') return;
        }
        setState({ ...IDLE, running: true, total });
        const res = await send(names.start, input as any);
        if (!res?.success) setState(s => ({ ...s, running: false, finished: 'failed', error: res && !res.success ? res.error : 'The background is not reachable.' }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [names]);

    const stop = useCallback(() => {
        setState(s => ({ ...s, stopping: true }));
        void send(names.stop).then(res => {
            if (!res || (res.success && !res.running)) setState(s => ({ ...s, running: false, stopping: false, finished: 'stopped' }));
        });
    }, [names]);

    const reset = useCallback(() => setState(IDLE), []);
    return { ...state, start, stop, reset };
}

export const useContactsRun = () => useBackgroundRun('contacts', input => input.urls.length);

/** Units: one series of pages per input value (or the call as recorded). */
export const useApiRun = () => useBackgroundRun('api', input => Math.max(1, input.units?.length ?? input.values?.length ?? 1));
