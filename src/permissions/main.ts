import { hasAllUrlsPermission, requestAllUrlsPermission } from '../shared/utils/hostPermissions';

const grantBtn = document.getElementById('grant') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLParagraphElement;

function showStatus(kind: 'success' | 'error', text: string) {
    statusEl.textContent = text;
    statusEl.className = `status visible ${kind}`;
}

function markGranted() {
    grantBtn.disabled = true;
    grantBtn.textContent = 'Access granted ✓';
    showStatus('success', 'You’re all set — open the Crawl Pilot side panel on any page to start extracting. This tab will close shortly.');
    // Content-script injection into already-open tabs is handled by the background
    // service worker's chrome.permissions.onAdded listener.
    setTimeout(() => window.close(), 3500);
}

// Handles reopening the page after access was already granted (e.g. from a bookmark).
void hasAllUrlsPermission().then((has) => {
    if (has) markGranted();
});

grantBtn.addEventListener('click', async () => {
    const result = await requestAllUrlsPermission();

    if (result === 'granted') {
        markGranted();
        return;
    }

    if (result === 'denied') {
        showStatus('error', 'Permission was declined. Crawl Pilot can’t read pages without it — click the button to try again.');
        return;
    }

    // 'unavailable' — Chrome couldn't show the confirmation dialog at all.
    showStatus('error', 'Chrome couldn’t show the permission dialog. Grant access manually: chrome://extensions → Crawl Pilot → Site access → "On all sites".');
});
