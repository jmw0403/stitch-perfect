// ui/print.js — Multi-page tiling export with registration marks
// Splits the canvas content across A4/Letter/A3 pages with overlap margins,
// registration crosshairs, and cut-here lines between pages.

import { exportSVG } from './export.js';
import { getParams } from './controls.js';

const PAGE_SIZES = {
  a4:     { w: 210, h: 297 },
  letter: { w: 216, h: 279 },
  a3:     { w: 297, h: 420 },
};

// Compute how many pages are needed to tile the content area
export function computePageLayout(contentW, contentH, pageSize, landscape, overlapMm) {
  if (!PAGE_SIZES[pageSize]) return { cols: 1, rows: 1, pageW: contentW, pageH: contentH };
  let { w, h } = PAGE_SIZES[pageSize];
  if (landscape) { [w, h] = [h, w]; }

  // Printable area = page minus 10mm margins on each side
  const printW = w - 20;
  const printH = h - 20;

  // Effective stride per page (printable - overlap for tape alignment)
  const strideW = printW - overlapMm;
  const strideH = printH - overlapMm;

  const cols = Math.max(1, Math.ceil(contentW / strideW));
  const rows = Math.max(1, Math.ceil(contentH / strideH));

  return { cols, rows, pageW: w, pageH: h, printW, printH, strideW, strideH };
}

// Build a single page SVG at page coordinate offset (tx, ty)
function buildPageSVG(allSvgContent, tx, ty, printW, printH, pageW, pageH,
                       title, designer, pitch, pageNum, totalPages, regMarks, overlapMm) {
  const margin = 10; // page margin in mm

  // Clip rect shows only the portion of the canvas for this tile
  const clipId = `clip-${pageNum}`;

  // Registration marks: crosshair at each corner of the printable area
  function regMark(x, y) {
    const L = 5; // arm length mm
    return `<g stroke="#000" stroke-width="0.3" fill="none">
      <line x1="${x-L}" y1="${y}" x2="${x+L}" y2="${y}"/>
      <line x1="${x}" y1="${y-L}" x2="${x}" y2="${y+L}"/>
      <circle cx="${x}" cy="${y}" r="1" fill="none" stroke="#000" stroke-width="0.3"/>
    </g>`;
  }

  // Overlap edge: dashed cut line + scissor hint
  function cutLine(x1, y1, x2, y2) {
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
               stroke="#888" stroke-width="0.4" stroke-dasharray="3 2"/>`;
  }

  const px = margin, py = margin;
  const qx = margin + printW, qy = margin + printH;

  let marks = '';
  if (regMarks) {
    marks += regMark(px, py);
    marks += regMark(qx, py);
    marks += regMark(px, qy);
    marks += regMark(qx, qy);
    // Cut lines on overlap edges (not outer edges of the full layout)
    marks += cutLine(px, py, qx, py);   // top
    marks += cutLine(qx, py, qx, qy);   // right
    marks += cutLine(px, qy, qx, qy);   // bottom
    marks += cutLine(px, py, px, qy);   // left
  }

  // Footer bar
  const footerY = qy + 4;
  const footer = `
    <text x="${px}" y="${footerY}" font-size="3" fill="#888" font-family="system-ui,sans-serif">
      ${title || 'StitchPerfect'}${designer ? ' · ' + designer : ''} · pitch ${pitch} mm
    </text>
    <text x="${qx}" y="${footerY}" font-size="3" fill="#888"
          font-family="system-ui,sans-serif" text-anchor="end">
      Page ${pageNum}/${totalPages}
    </text>`;

  // Scale bar (50mm)
  const sbX = px, sbY = footerY + 4;
  const scaleBar = `
    <line x1="${sbX}" y1="${sbY}" x2="${sbX+50}" y2="${sbY}" stroke="#888" stroke-width="0.4"/>
    <line x1="${sbX}" y1="${sbY-1.5}" x2="${sbX}" y2="${sbY+1.5}" stroke="#888" stroke-width="0.4"/>
    <line x1="${sbX+50}" y1="${sbY-1.5}" x2="${sbX+50}" y2="${sbY+1.5}" stroke="#888" stroke-width="0.4"/>
    <text x="${sbX+25}" y="${sbY-1}" font-size="2.5" fill="#888"
          font-family="system-ui,sans-serif" text-anchor="middle">50 mm</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${pageW}mm" height="${pageH}mm"
     viewBox="0 0 ${pageW} ${pageH}" version="1.1">
  <defs>
    <clipPath id="${clipId}">
      <rect x="${px}" y="${py}" width="${printW}" height="${printH}"/>
    </clipPath>
  </defs>
  <!-- Page background -->
  <rect width="${pageW}" height="${pageH}" fill="white"/>
  <!-- Content clipped to printable area, translated to page coordinates -->
  <g clip-path="url(#${clipId})">
    <g transform="translate(${px - tx} ${py - ty})">
      ${allSvgContent}
    </g>
  </g>
  ${marks}
  ${footer}
  ${scaleBar}
</svg>`;
}

// Generate all page SVGs and trigger ZIP download
export async function downloadTiledPages(pieces, rects, polys) {
  const p = getParams();
  const pageSize   = p.printPageSize;
  const landscape  = p.printLandscape;
  const overlapMm  = p.printOverlap || 10;
  const regMarks   = p.printRegMarks !== false;
  const title      = p.printTitle    || '';
  const designer   = p.printDesigner || '';

  if (!PAGE_SIZES[pageSize]) {
    // No page size set — just download single SVG
    const svg = exportSVG(pieces, rects, polys);
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'stitchperfect-pattern.svg'; a.click();
    return;
  }

  // Get the inner SVG body (without the outer <svg> wrapper)
  const fullSvg = exportSVG(pieces, rects, polys);
  const bodyMatch = fullSvg.match(/<g transform="translate\(0,0\)">([\s\S]*?)<\/g>\s*<\/svg>/);
  const svgBody = bodyMatch ? bodyMatch[1] : '';

  // Extract viewBox to know content dimensions
  const vbMatch = fullSvg.match(/viewBox="([^"]+)"/);
  const [ox, oy, contentW, contentH] = vbMatch
    ? vbMatch[1].split(/\s+/).map(Number)
    : [0, 0, 210, 297];

  const layout = computePageLayout(contentW, contentH, pageSize, landscape, overlapMm);
  const { cols, rows, pageW, pageH, printW, printH, strideW, strideH } = layout;
  const totalPages = cols * rows;

  // If only 1 page, just do a single SVG
  if (totalPages === 1) {
    const pageSvg = buildPageSVG(svgBody, ox, oy, printW, printH, pageW, pageH,
                                   title, designer, p.pitch, 1, 1, regMarks, overlapMm);
    const blob = new Blob([pageSvg], { type: 'image/svg+xml' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'stitchperfect-p1.svg'; a.click();
    return;
  }

  // Multiple pages — use JSZip if available, else download individually
  const pages = [];
  let n = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      n++;
      const tx = ox + col * strideW;
      const ty = oy + row * strideH;
      const svg = buildPageSVG(svgBody, tx, ty, printW, printH, pageW, pageH,
                                 title, designer, p.pitch, n, totalPages, regMarks, overlapMm);
      pages.push({ name: `stitchperfect-p${n}.svg`, svg });
    }
  }

  // Try JSZip (if loaded), else download individually
  if (typeof JSZip !== 'undefined') {
    const zip = new JSZip();
    pages.forEach(({ name, svg }) => zip.file(name, svg));
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'stitchperfect-pages.zip'; a.click();
  } else {
    // Fall back: download each page file individually
    for (const { name, svg } of pages) {
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = name; a.click();
      await new Promise(r => setTimeout(r, 200)); // small delay between downloads
    }
  }
}

// Update the page count preview string
export function getPagePreview(contentW, contentH, pageSize, landscape, overlapMm) {
  if (!PAGE_SIZES[pageSize]) return 'Set a page size to see tiling preview';
  const { cols, rows, printW, printH } = computePageLayout(
    contentW, contentH, pageSize, landscape, overlapMm);
  const total = cols * rows;
  let { w, h } = PAGE_SIZES[pageSize];
  if (landscape) [w, h] = [h, w];
  return total === 1
    ? `Fits on 1 page (${w}×${h} mm)`
    : `${total} pages (${cols}×${rows} grid) — ${w}×${h} mm each`;
}
