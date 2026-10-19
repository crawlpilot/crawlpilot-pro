/**
 * Schema extraction with Chrome's on-device model: page view with element refs → constrained prompt
 * (through `modelHost`) → every answer checked against the page and compiled to selectors. The model
 * runs once, to author the fields; the Page Extractor then runs them with no model.
 */
import { modelHost, CALL_ERROR_MESSAGES, type CallResult } from './modelHost';
import { buildExtractPrompt, buildResponseSchema, EXTRACT_SYSTEM_PROMPT, parseModelOutput, type FieldAnswer } from '../../../shared/ai/extractPrompt';
import { compileConstraint, relax, RELAXATIONS } from '../../../shared/ai/constraint';
import type { SchemaField } from '../../../shared/ai/schemaIntake';
import type { VerifiedField } from '../../../content/services/ai-view/ReferencedView';
import { sendToActiveTab } from '../../../shared/messages';

export interface SchemaExtractionResult {
    fields: VerifiedField[];
    /** The page view was cut to fit the model's input. */
    truncated: boolean;
    refs: number;
    /** Schema features given up because Chrome couldn't enforce them. */
    relaxed: string[];
}

/** Room kept for the answer: about 40 tokens per field ({"value": …, "ref": …}). */
const reserveFor = (fields: SchemaField[]) => 200 + fields.length * 40;
/** Characters of the prompt around the page view (instructions and the field list). */
const PROMPT_OVERHEAD_CHARS = 600;

export async function runSchemaExtraction(
    fields: SchemaField[],
    opts: { onStatus?: (s: string) => void; onDownloadProgress?: (f: number) => void; signal?: AbortSignal } = {},
): Promise<SchemaExtractionResult> {
    const fail = (r: { code: keyof typeof CALL_ERROR_MESSAGES; detail?: string }): never => {
        throw new Error(r.code === 'model_unavailable' && r.detail ? r.detail : CALL_ERROR_MESSAGES[r.code]);
    };

    opts.onStatus?.('Starting the on-device model…');
    const ready = await modelHost.prepare(EXTRACT_SYSTEM_PROMPT, 'exact', opts.onDownloadProgress);
    if (!ready.ok) fail(ready);

    // The constraint, checked once: a feature Chrome can't enforce is given up before the run.
    let schema = compileConstraint(buildResponseSchema(fields));
    const relaxed: string[] = [];
    let step = 0;
    for (;;) {
        const probe = await modelHost.fits({ system: EXTRACT_SYSTEM_PROMPT, sampling: 'exact', prompt: 'x', schema });
        if (!('code' in probe)) break;
        if (probe.code !== 'schema_unsupported') fail(probe);
        const next = relax(schema, step);
        if (!next) fail(probe);
        relaxed.push(RELAXATIONS[step]);
        schema = next!;
        step++;
    }

    opts.onStatus?.('Reading the page…');
    const reserve = reserveFor(fields);
    const room = await modelHost.room(EXTRACT_SYSTEM_PROMPT, 'exact', fields.map(f => `${f.name}: ${f.description ?? ''}`).join('\n'), reserve);
    if ('code' in room) return fail(room);
    const schemaChars = JSON.stringify(schema).length;
    let maxChars = Math.max(1500, Math.floor(room.tokens * room.charsPerToken * 0.9) - PROMPT_OVERHEAD_CHARS - schemaChars);

    // Measured, then sent; a view that still doesn't fit is rebuilt smaller (at most twice).
    for (let attempt = 0; attempt < 3; attempt++) {
        const view = await sendToActiveTab('AI_BUILD_VIEW', { maxChars });
        if (!view.view) throw new Error('No readable text found on this page.');

        opts.onStatus?.(`Asking the model for ${fields.length} field${fields.length !== 1 ? 's' : ''}…`);
        const prompt = buildExtractPrompt(view.view, fields);
        let res: CallResult<Record<string, FieldAnswer>> = await modelHost.run({
            system: EXTRACT_SYSTEM_PROMPT, sampling: 'exact', prompt, schema, reserve,
            parse: raw => parseModelOutput(raw, fields),
        }, opts.signal);

        // The output couldn't satisfy the constraint: one retry with it relaxed a step.
        if (!res.ok && res.code === 'unsatisfiable') {
            const next = relax(schema, step);
            if (next) {
                relaxed.push(RELAXATIONS[step]);
                res = await modelHost.run({ system: EXTRACT_SYSTEM_PROMPT, sampling: 'exact', prompt, schema: next, reserve, parse: raw => parseModelOutput(raw, fields) }, opts.signal);
            }
        }
        if (!res.ok && res.code === 'too_large' && attempt < 2) {
            const ratio = res.need && res.available ? res.available / res.need : 0.6;
            maxChars = Math.max(1000, Math.floor(maxChars * Math.min(ratio, 0.9) * 0.9));
            continue;
        }
        if (!res.ok) return fail(res);

        opts.onStatus?.('Checking every value against the page…');
        const answers = res.value;
        const verified = await sendToActiveTab('AI_VERIFY', {
            answers: fields.map(f => ({ name: f.name, value: answers[f.name].value, ref: answers[f.name].ref, wantType: f.type })),
        });
        return { fields: verified.fields, truncated: view.truncated, refs: view.refs, relaxed };
    }
    return fail({ code: 'too_large' });
}
