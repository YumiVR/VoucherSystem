import bwipjs from 'bwip-js/node';

export interface Pdf417Matrix {
  /** Width in modules, excluding quiet zone. */
  cols: number;
  /** Number of symbol rows. */
  rows: number;
  /** Row-major, 1 = dark module. */
  data: Uint8Array;
}

export interface Pdf417Options {
  /** Number of data columns (3..30). */
  columns: number;
  /** Error-correction level 0..8. */
  eclevel: number;
}

export const PDF417_ROW_HEIGHT_MODULES = 3;
export const PDF417_QUIET_MODULES = 4;

/** Encodes binary bytes (byte compaction) or ASCII text (automatic compaction) as one PDF417 symbol. */
export function encodePdf417(input: Uint8Array | string, opts: Pdf417Options): Pdf417Matrix {
  const binary = typeof input !== 'string';
  const text = binary ? Buffer.from(input).toString('latin1') : input;
  // bwip-js accepts PDF417-specific options (columns, eclevel, rowmult) that its typings omit.
  const options = {
    bcid: 'pdf417',
    text,
    ...(binary ? { binarytext: true } : {}),
    columns: opts.columns,
    eclevel: opts.eclevel,
    rowmult: 1,
  } as unknown as Parameters<typeof bwipjs.raw>[0];
  const result = bwipjs.raw(options) as unknown as { pixs: number[]; pixx: number; pixy: number }[];
  const sym = result[0];
  if (!sym) throw new Error('PDF417 encoding produced no symbol');
  if (sym.pixs.length !== sym.pixx * sym.pixy) throw new Error('Unexpected PDF417 matrix');
  return { cols: sym.pixx, rows: sym.pixy, data: Uint8Array.from(sym.pixs) };
}

export interface RenderGeometry {
  rowHeight: number;
  quiet: number;
}

const DEFAULT_GEOMETRY: RenderGeometry = { rowHeight: PDF417_ROW_HEIGHT_MODULES, quiet: PDF417_QUIET_MODULES };

export function totalModules(m: Pdf417Matrix, g: RenderGeometry = DEFAULT_GEOMETRY): { w: number; h: number } {
  return { w: m.cols + 2 * g.quiet, h: m.rows * g.rowHeight + 2 * g.quiet };
}

/** Merges horizontal runs into rectangles so the SVG stays small. */
export function matrixRects(m: Pdf417Matrix): { x: number; y: number; w: number }[] {
  const rects: { x: number; y: number; w: number }[] = [];
  for (let r = 0; r < m.rows; r++) {
    let x = 0;
    while (x < m.cols) {
      if (m.data[r * m.cols + x] === 1) {
        let w = 1;
        while (x + w < m.cols && m.data[r * m.cols + x + w] === 1) w++;
        rects.push({ x, y: r, w });
        x += w;
      } else x++;
    }
  }
  return rects;
}

export function matrixToSvg(m: Pdf417Matrix, g: RenderGeometry = DEFAULT_GEOMETRY): string {
  const { w, h } = totalModules(m, g);
  const body = matrixRects(m)
    .map((r) => `M${r.x + g.quiet} ${r.y * g.rowHeight + g.quiet}h${r.w}v${g.rowHeight}h-${r.w}z`)
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">` +
    `<rect width="${w}" height="${h}" fill="#fff"/><path d="${body}" fill="#000"/></svg>`
  );
}

export function matrixToSvgDataUrl(m: Pdf417Matrix, g: RenderGeometry = DEFAULT_GEOMETRY): string {
  return `data:image/svg+xml;base64,${Buffer.from(matrixToSvg(m, g), 'utf8').toString('base64')}`;
}

/** Rasterises the symbol (white quiet zone included) as RGBA, e.g. to feed a decoder in tests. */
export function matrixToRgba(
  m: Pdf417Matrix,
  scale: number,
  g: RenderGeometry = DEFAULT_GEOMETRY,
): { data: Uint8ClampedArray; width: number; height: number; colorSpace: 'srgb' } {
  const { w, h } = totalModules(m, g);
  const width = w * scale;
  const height = h * scale;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let r = 0; r < m.rows; r++) {
    for (let c = 0; c < m.cols; c++) {
      if (m.data[r * m.cols + c] !== 1) continue;
      for (let dy = 0; dy < g.rowHeight * scale; dy++) {
        const y = (r * g.rowHeight + g.quiet) * scale + dy;
        for (let dx = 0; dx < scale; dx++) {
          const x = (c + g.quiet) * scale + dx;
          const i = (y * width + x) * 4;
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
        }
      }
    }
  }
  return { data, width, height, colorSpace: 'srgb' };
}
