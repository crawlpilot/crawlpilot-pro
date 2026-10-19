/** A "Contacts from websites" run, followed from the side panel (progress, stop, the table it wrote). */
import { useCallback, useEffect, useState } from 'react';
import { on, send } from '../../shared/messages';
import type { ContactsStart } from '../../shared/messages';
import { hasAllUrlsPermission, openSiteAccessSettings, requestAllUrlsPermission } from '../../shared/utils/hostPermissions';

export interface ContactsRunState {
    running: boolean;
    stopping: boolean;
    done: number;
    total: number;
    failed: number;
    activeTabs: number;
    /** The table: the live preview while running, then the final one. */
    tableId: number | null;
    finished: 'completed' | 'stopped' | 'failed' | null;
    error: string | null;
}

const IDLE: ContactsRunState = { running: false, stopping: false, done: 0, total: 0, failed: 0, activeTabs: 0, tableId: null, finished: null, error: null };

export function useContactsRun() {
    const [state, setState] = useState<ContactsRunState>(IDLE);

    useEffect(() => {
        const offs = [
            on('CONTACTS_PROGRESS', p => setState(s => ({
                ...s, done: p.completedUrls, total: p.totalUrls, activeTabs: p.activeTabs,
                failed: (p.urlStatuses ?? []).filter(u => u.status === 'error').length,
                tableId: p.previewTableId ?? s.tableId,
            }))),
            on('CONTACTS_COMPLETE', c => setState(s => ({
                ...s, running: false, stopping: false, activeTabs: 0, tableId: c.tableId ?? s.tableId,
                finished: c.stoppedByUser ? 'stopped' : c.success ? 'completed' : 'failed', error: c.success || c.stoppedByUser ? null : c.error ?? null,
            }))),
        ];
        return () => offs.forEach(off => off());
    }, []);

    const start = useCallback(async (input: ContactsStart) => {
        if (input.urls.length === 0) return;
        // Reading each company's site needs access to all sites.
        if (!(await hasAllUrlsPermission())) {
            const result = await requestAllUrlsPermission();
            if (result === 'unavailable') openSiteAccessSettings();
            if (result !== 'granted') return;
        }
        setState({ ...IDLE, running: true, total: input.urls.length });
        const res = await send('CONTACTS_START', input);
        if (!res?.success) setState(s => ({ ...s, running: false, finished: 'failed', error: res && !res.success ? res.error : 'The background is not reachable.' }));
    }, []);

    const stop = useCallback(() => {
        setState(s => ({ ...s, stopping: true }));
        void send('CONTACTS_STOP').then(res => {
            if (!res || (res.success && !res.running)) setState(s => ({ ...s, running: false, stopping: false, finished: 'stopped' }));
        });
    }, []);

    const reset = useCallback(() => setState(IDLE), []);
    return { ...state, start, stop, reset };
}
