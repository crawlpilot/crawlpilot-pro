/**
 * Schema extraction with Chrome's on-device model (Prompt API): page view with element refs →
 * constrained prompt → every answer checked against the page and compiled to selectors. The model
 * runs once, to author the fields; the Page Extractor then runs them with no model.
 */
import { getLanguageModel, docCharBudget, progressFraction } from './promptSession';
import { buildExtractPrompt, buildResponseSchema, EXTRACT_SYSTEM_PROMPT, parseModelOutput } from '../../../shared/ai/extractPrompt';
import type { SchemaField } from '../../../shared/ai/schemaIntake';
import type { VerifiedField } from '../../../content/services/ai-view/ReferencedView';
import { sendToActiveTab } from '../../../shared/messages';

export interface SchemaExtractionResult {
    fields: VerifiedField[];
    /** The page view was cut to fit the model's input. */
    truncated: boolean;
    refs: number;
}

const PROMPT_TIMEOUT_MS = 90_000;

export async function runSchemaExtraction(
    fields: SchemaField[],
    opts: { onStatus?: (s: string) => void; onDownloadProgress?: (f: number) => void; signal?: AbortSignal } = {},
): Promise<SchemaExtractionResult> {
    const LanguageModel = getLanguageModel();
    if (!LanguageModel) throw new Error("Chrome's built-in AI (Prompt API) is not available in this browser.");

    opts.onStatus?.('Starting the on-device model…');
    const session = await LanguageModel.create({
        initialPrompts: [{ role: 'system', content: EXTRACT_SYSTEM_PROMPT }],
        ...(opts.signal ? { signal: opts.signal } : {}),
        monitor(m: any) {
            m.addEventListener('downloadprogress', (e: any) => opts.onDownloadProgress?.(progressFraction(e)));
        },
    });

    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), PROMPT_TIMEOUT_MS);
    const onAbort = () => timeout.abort();
    opts.signal?.addEventListener('abort', onAbort);

    try {
        opts.onStatus?.('Reading the page…');
        // Leave room for the field list and the answer.
        const budget = Math.max(3000, docCharBudget(session) - 1500);
        const view = await sendToActiveTab('AI_BUILD_VIEW', { maxChars: budget });
        if (!view.view) throw new Error('No readable text found on this page.');

        opts.onStatus?.(`Asking the model for ${fields.length} field${fields.length !== 1 ? 's' : ''}…`);
        const prompt = buildExtractPrompt(view.view, fields);
        let raw: string;
        try {
            raw = await session.prompt(prompt, { responseConstraint: buildResponseSchema(fields), signal: timeout.signal });
        } catch (e: any) {
            if (timeout.signal.aborted) throw new Error(opts.signal?.aborted ? 'Stopped.' : 'The model took too long. Try fewer fields.');
            // Older Chrome without responseConstraint: ask for JSON in plain text.
            raw = await session.prompt(`${prompt}\n\nReturn ONLY the JSON object, nothing else.`, { signal: timeout.signal });
        }
        const answers = parseModelOutput(raw, fields);

        opts.onStatus?.('Checking every value against the page…');
        const res = await sendToActiveTab('AI_VERIFY', {
            answers: fields.map(f => ({ name: f.name, value: answers[f.name].value, ref: answers[f.name].ref, wantType: f.type })),
        });
        return { fields: res.fields, truncated: view.truncated, refs: view.refs };
    } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
        session.destroy?.();
    }
}
