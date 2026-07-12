/**
 * Terrain paint worker — runs the heavy per-pixel terrain computation OFF the main thread.
 *
 * The close view evaluates dozens of noise octaves per pixel over millions of pixels (~2s).
 * On the main thread that froze the UI on every zoom-settle; here it runs in a worker and the
 * result buffer is transferred back, so the page never locks up. `computeTerrainImage` is pure
 * (no DOM/canvas), so it imports cleanly into the worker; the main thread does the cheap
 * putImageData + labels once the buffer arrives.
 */
import { computeTerrainImage, type GeoFields, type ViewBox } from './terrain';
import type { SurfaceTheme } from '../content/mapstyles';

export interface TerrainPaintRequest {
  id: number;
  geo: GeoFields;
  vb: ViewBox;
  theme: SurfaceTheme;
  W: number;
  H: number;
}
export interface TerrainPaintResponse {
  id: number;
  buf: Uint8ClampedArray;
  W: number;
  H: number;
}

self.onmessage = (e: MessageEvent<TerrainPaintRequest>) => {
  const { id, geo, vb, theme, W, H } = e.data;
  const buf = computeTerrainImage(geo, vb, theme, W, H);
  // transfer the pixel buffer (zero-copy) back to the main thread
  (self as unknown as Worker).postMessage({ id, buf, W, H } satisfies TerrainPaintResponse, [buf.buffer]);
};
