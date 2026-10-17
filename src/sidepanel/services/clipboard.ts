export async function copyText(text: string) {
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard blocked: ignore */ }
}
