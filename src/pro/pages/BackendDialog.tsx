/** Who you are in Pro, and the backend's address and token, from the Recipes screen. */
import { useEffect, useState } from 'react';
import { Button, Dialog, TextField } from '../../sidepanel/ui';
import { loadBackend, saveBackend } from '../backend/settings';
import { currentUser, LOCAL_AUTHOR, setCurrentUser } from '../identity';

export function BackendDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    const [baseUrl, setBaseUrl] = useState('');
    const [token, setToken] = useState('');
    const [name, setName] = useState('');
    useEffect(() => {
        if (open) void Promise.all([loadBackend(), currentUser()]).then(([s, user]) => { setBaseUrl(s.baseUrl); setToken(s.token); setName(user === LOCAL_AUTHOR ? '' : user); });
    }, [open]);

    // The backend may be left unset (both empty) while only the name is changed.
    const backendSet = /^https?:\/\/\S+$/.test(baseUrl.trim()) && token.trim() !== '';
    const valid = backendSet || (!baseUrl.trim() && !token.trim());
    return (
        <Dialog open={open} onClose={onClose} size="sm" title="Crawler backend"
            description="Where submitted recipes go. Sign-in with the company login replaces the token later."
            actions={<>
                <Button variant="ghost" onClick={onClose}>Cancel</Button>
                <Button variant="primary" disabled={!valid} onClick={async () => { await Promise.all([saveBackend({ baseUrl, token }), setCurrentUser(name)]); onClose(); }}>Save</Button>
            </>}>
            <div className="flex flex-col gap-3">
                <TextField label="Your name" value={name} onChange={e => setName(e.target.value)} placeholder="priya"
                    hint="Kept on what you save and review. Someone else reviews a version you saved." />
                <TextField label="Address" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://crawler.example.com/api" />
                <TextField label="Access token" type="password" hint="Kept until the browser closes." value={token} onChange={e => setToken(e.target.value)} />
            </div>
        </Dialog>
    );
}
