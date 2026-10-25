/** The backend's address and token, from the Recipes screen. */
import { useEffect, useState } from 'react';
import { Button, Dialog, TextField } from '../../sidepanel/ui';
import { loadBackend, saveBackend } from '../backend/settings';

export function BackendDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    const [baseUrl, setBaseUrl] = useState('');
    const [token, setToken] = useState('');
    useEffect(() => {
        if (open) void loadBackend().then(s => { setBaseUrl(s.baseUrl); setToken(s.token); });
    }, [open]);

    const valid = /^https?:\/\/\S+$/.test(baseUrl.trim()) && token.trim() !== '';
    return (
        <Dialog open={open} onClose={onClose} size="sm" title="Crawler backend"
            description="Where submitted recipes go. Sign-in with the company login replaces the token later."
            actions={<>
                <Button variant="ghost" onClick={onClose}>Cancel</Button>
                <Button variant="primary" disabled={!valid} onClick={async () => { await saveBackend({ baseUrl, token }); onClose(); }}>Save</Button>
            </>}>
            <div className="flex flex-col gap-3">
                <TextField label="Address" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://crawler.example.com/api" />
                <TextField label="Access token" type="password" hint="Kept until the browser closes." value={token} onChange={e => setToken(e.target.value)} />
            </div>
        </Dialog>
    );
}
