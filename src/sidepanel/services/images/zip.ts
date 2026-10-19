/**
 * A zip written as files arrive, so a large gallery never sits in memory whole: each file is stored
 * (images are already compressed), and the zip's output is moved into Blobs every 16 MB. Chrome keeps
 * big Blobs on disk, so memory stays near one file plus 16 MB whatever the total.
 */
import { Zip, ZipPassThrough } from 'fflate';

const FLUSH_BYTES = 16 * 1024 * 1024;

export class ZipWriter {
    private readonly zip: Zip;
    private readonly parts: Blob[] = [];
    private pending: Uint8Array[] = [];
    private pendingBytes = 0;
    private readonly finished: Promise<void>;

    constructor() {
        let resolve!: () => void;
        let reject!: (e: Error) => void;
        this.finished = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
        this.zip = new Zip((error, chunk, final) => {
            if (error) { reject(error); return; }
            this.pending.push(chunk);
            this.pendingBytes += chunk.length;
            if (this.pendingBytes >= FLUSH_BYTES || final) this.flush();
            if (final) resolve();
        });
    }

    private flush() {
        if (!this.pending.length) return;
        this.parts.push(new Blob(this.pending as BlobPart[]));
        this.pending = [];
        this.pendingBytes = 0;
    }

    add(path: string, bytes: Uint8Array) {
        const file = new ZipPassThrough(path);
        this.zip.add(file);
        file.push(bytes, true);
    }

    async finish(): Promise<Blob> {
        this.zip.end();
        await this.finished;
        return new Blob(this.parts, { type: 'application/zip' });
    }
}
