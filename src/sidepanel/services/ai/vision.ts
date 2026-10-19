/**
 * Questions about what is on screen (docs/plans/summarize-ask-plan.md A5): a capture of the page's
 * tab, cropped to what the user picked (an image, a chart, a table) or the whole visible page, given
 * to the on-device model as an image.
 */
import { modelHost, CALL_ERROR_MESSAGES, type CallResult } from './modelHost';
import { parseTable, tableSchema, type AnswerTable } from '../../../shared/ai/brief';
import type { PickedRegion } from '../../../shared/ai/page';
import { sendToPage } from '../../../shared/messages';

export const IMAGE_SYSTEM =
    'You answer questions about an image from a web page: a photo, a chart, a table, a label or a screenshot. ' +
    'Answer briefly from what the image shows. If it doesn\'t show the answer, say "The image doesn\'t show that."';

/** Longest side of the image given to the model: larger costs time and context, not detail it can use. */
const MAX_SIDE = 1024;

export interface PageImage {
    blob: Blob;
    /** For showing it in the conversation. */
    url: string;
    label: string;
}

/** The user points at something on the page (null: cancelled). */
export async function pickOnPage(tabId: number): Promise<PickedRegion | null> {
    const tab = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { active: true }).catch(() => undefined);
    if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
    return (await sendToPage(tab, 'AI_PICK_REGION')).region;
}

/** The tab's visible page as an image, cropped to `region` when given. */
export async function capturePage(tabId: number, region?: PickedRegion | null): Promise<PageImage> {
    const tab = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { active: true }).catch(() => undefined);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    const shot = await createImageBitmap(await (await fetch(dataUrl)).blob());
    // Capture pixels per CSS pixel (the screen's density, and any zoom).
    const scale = region ? shot.width / region.viewportWidth : 1;
    const sx = region ? Math.round(region.x * scale) : 0;
    const sy = region ? Math.round(region.y * scale) : 0;
    const sw = region ? Math.max(1, Math.round(region.width * scale)) : shot.width;
    const sh = region ? Math.max(1, Math.round(region.height * scale)) : shot.height;
    const fit = Math.min(1, MAX_SIDE / Math.max(sw, sh));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(sw * fit)), Math.max(1, Math.round(sh * fit)));
    canvas.getContext('2d')!.drawImage(shot, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    shot.close();
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return { blob, url: URL.createObjectURL(blob), label: region?.label ?? 'The visible page' };
}

export async function askImage(question: string, image: Blob, onText: (text: string) => void, signal?: AbortSignal): Promise<string> {
    const res = await modelHost.run({ system: IMAGE_SYSTEM, prompt: question, image, onText, timeoutMs: 90_000 }, signal);
    if (!res.ok) throw new Error(res.code === 'model_unavailable' && res.detail ? res.detail : CALL_ERROR_MESSAGES[res.code]);
    return res.value;
}

export function imageTable(question: string, image: Blob, signal?: AbortSignal): Promise<CallResult<AnswerTable>> {
    return modelHost.run({
        system: IMAGE_SYSTEM, sampling: 'exact', image, schema: tableSchema(), parse: parseTable, timeoutMs: 90_000,
        prompt: `Make a table of what the image shows${question ? `, for: "${question}"` : ''}. Choose short column names; one row per item; copy values exactly as the image shows them. Use an empty string for each row's ref.`,
    }, signal);
}
