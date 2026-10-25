import { describe, it, expect } from 'vitest';
import { cropBox } from './vision';

const region = { x: 24, y: 114, width: 320, height: 200, viewportWidth: 1280, viewportHeight: 900, label: 'Image' };

describe('cropping a capture to what was picked', () => {
    it('maps CSS pixels to the capture at the screen density', () => {
        expect(cropBox(region, 2560, 1800)).toEqual({ sx: 48, sy: 228, sw: 640, sh: 400, outW: 640, outH: 400 });
        expect(cropBox(region, 1280, 900)).toEqual({ sx: 24, sy: 114, sw: 320, sh: 200, outW: 320, outH: 200 });
    });

    it('stays inside the capture and gives the model at most 1024 px a side', () => {
        const big = { ...region, x: 0, y: 0, width: 1280, height: 900 };
        expect(cropBox(big, 2560, 1800)).toEqual({ sx: 0, sy: 0, sw: 2560, sh: 1800, outW: 1024, outH: 720 });
        expect(cropBox({ ...region, x: 1200, width: 200 }, 1280, 900).sw).toBe(80);
        expect(cropBox(null, 1280, 900)).toEqual({ sx: 0, sy: 0, sw: 1280, sh: 900, outW: 1024, outH: 720 });
    });
});
