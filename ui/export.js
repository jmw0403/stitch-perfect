// ui/export.js — SVG export
// All coordinates are in mm; SVG user units = mm so output prints 1:1 at any DPI.

import { placeMarks, snapToStitches } from '../engine/stitch.js';
import { offsetPolyline } from '../engine/offset.js';
import { getParams } from './controls.js';

// ── SVG helpers ───────────────────────────────────────────────────────────────

function pt(x, y) { return `${x.toFixed(3)},${y.toFixed(3)}`; }

function polylineD(pts, closed = false) {
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${pt(p.x, p.y)}`).join(' ');
  return closed ? d + ' Z' : d;
}

function circle(cx, cy, r, stroke, fill, sw) {
  return `<circle cx="${cx.toFixed(3)}" cy="${cy.toFixed(3)}" r="${r.toFixed(3)}" `+
         `stroke="${stroke}" fill="${fill}" stroke-width="${sw.toFixed(3)}"/>`;
}

function line(x1, y1, x2, y2, stroke, sw, dasharray = '') {
  const da = dasharray ? ` stroke-dasharray="${dasharray}"` : '';
  return `<line x1="${x1.toFixed(3)}" y1="${y1.toFixed(3)}" x2="${x2.toFixed(3)}" y2="${y2.toFixed(3)}" `+
         `stroke="${stroke}" stroke-width="${sw.toFixed(3)}"${da} fill="none"/>`;
}

function path(d, stroke, sw, fill = 'none', dasharray = '') {
  const da = dasharray ? ` stroke-dasharray="${dasharray}"` : '';
  return `<path d="${d}" stroke="${stroke}" stroke-width="${sw.toFixed(3)}" fill="${fill}"${da}/>`;
}

function text(x, y, content, fontSize, fill, anchor = 'middle') {
  return `<text x="${x.toFixed(3)}" y="${y.toFixed(3)}" font-size="${fontSize}" `+
         `fill="${fill}" text-anchor="${anchor}" font-family="system-ui,sans-serif">`+
         `${content}</text>`;
}

// ── Mark rendering to SVG ─────────────────────────────────────────────────────

function markSvg(mark, markType) {
  const { x, y, angle } = mark;
  const R = 0.5; // 1mm diameter

  if (markType === 'hole') {
    return circle(x, y, R, '#c0392b', 'none', 0.2);
  }
  if (markType === 'dot') {
    return circle(x, y, R, 'none', '#c0392b', 0);
  }
  // slash-fwd / slash-back
  const a = markType === 'slash-fwd' ? angle + Math.PI / 4 : angle - Math.PI / 4;
  const L = 1; // 2mm slash (1mm each side)
  return line(
    x - Math.cos(a) * L, y - Math.sin(a) * L,
    x + Math.cos(a) * L, y + Math.sin(a) * L,
    '#c0392b', 0.2,
  );
}

// ── Snapped polyline helper ───────────────────────────────────────────────────

function snapPolyline(pts, targetLength) {
  let rawLen = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i-1].x, dy = pts[i].y - pts[i-1].y;
    rawLen += Math.sqrt(dx*dx + dy*dy);
  }
  if (rawLen === 0) return pts;
  const k = targetLength / rawLen;
  return pts.map(p => ({
    x: pts[0].x + (p.x - pts[0].x) * k,
    y: pts[0].y + (p.y - pts[0].y) * k,
  }));
}

// ── Freehand piece to SVG ─────────────────────────────────────────────────────

function freehandToSvg(piece, params) {
  const { pitch, margin, markType, showDimensions, showStitchLine, showCutOutline } = params;
  const els = [];

  let rawLen = 0;
  for (let i = 1; i < piece.pts.length; i++) {
    const dx = piece.pts[i].x - piece.pts[i-1].x, dy = piece.pts[i].y - piece.pts[i-1].y;
    rawLen += Math.sqrt(dx*dx + dy*dy);
  }
  const { snappedLength } = snapToStitches(rawLen, pitch);
  const snappedPts = snapPolyline(piece.pts, snappedLength);

  if (showCutOutline) {
    const rings = offsetPolyline(snappedPts, margin, false);
    for (const ring of rings) {
      els.push(path(polylineD(ring, true), '#aaaaaa', 0.2, 'none', '1 0.8'));
    }
  }

  if (showStitchLine) {
    els.push(path(polylineD(snappedPts), '#2c7bb6', 0.25));
  }

  const { marks } = placeMarks(snappedPts, pitch);
  for (const m of marks) els.push(markSvg(m, markType));

  if (showDimensions && snappedPts.length >= 2) {
    const p0 = snappedPts[0], p1 = snappedPts[snappedPts.length - 1];
    const perpAngle = Math.atan2(p1.y - p0.y, p1.x - p0.x) - Math.PI / 2;
    const offset = margin + 2.5;
    const tx = (p0.x + p1.x) / 2 + Math.cos(perpAngle) * offset;
    const ty = (p0.y + p1.y) / 2 + Math.sin(perpAngle) * offset;
    const { count } = placeMarks(snappedPts, pitch);
    els.push(text(tx, ty, `${(count * pitch).toFixed(1)} mm`, '2.5', '#4a8ab5'));
  }

  return els.join('\n');
}

// ── Rect piece to SVG ─────────────────────────────────────────────────────────

function rectToSvg(rect, params) {
  const { pitch, margin, markType, showDimensions, showStitchLine, showCutOutline } = params;
  const { x, y, w, h, edges } = rect;
  const els = [];

  if (showCutOutline) {
    const closedPts = [
      { x, y }, { x: x+w, y }, { x: x+w, y: y+h }, { x, y: y+h }, { x, y },
    ];
    const rings = offsetPolyline(closedPts, margin, true, { joinType: 'miter' });
    for (const ring of rings) {
      els.push(path(polylineD(ring, true), '#aaaaaa', 0.2, 'none', '1 0.8'));
    }
  }

  const SIDES = [
    { key: 'top',    pts: [{ x, y }, { x: x+w, y }] },
    { key: 'right',  pts: [{ x: x+w, y }, { x: x+w, y: y+h }] },
    { key: 'bottom', pts: [{ x: x+w, y: y+h }, { x, y: y+h }] },
    { key: 'left',   pts: [{ x, y: y+h }, { x, y }] },
  ];

  for (const { key, pts } of SIDES) {
    const state = edges[key];
    if (state === 'stitched') {
      if (showStitchLine) {
        els.push(path(polylineD(pts), '#2c7bb6', 0.25));
      }
      const { marks } = placeMarks(pts, pitch);
      for (const m of marks) els.push(markSvg(m, markType));
    } else if (state === 'open') {
      els.push(path(polylineD(pts), '#666666', 0.2, 'none', '0.8 0.8'));
    }
  }

  if (showDimensions) {
    // Top label
    els.push(text(x + w/2, y - margin - 2, `${w.toFixed(1)} mm`, '2.5', '#4a8ab5'));
    // Bottom label
    els.push(text(x + w/2, y + h + margin + 4, `${w.toFixed(1)} mm`, '2.5', '#4a8ab5'));
    // Left label
    els.push(text(x - margin - 2, y + h/2 + 1, `${h.toFixed(1)} mm`, '2.5', '#4a8ab5', 'end'));
    // Right label
    els.push(text(x + w + margin + 2, y + h/2 + 1, `${h.toFixed(1)} mm`, '2.5', '#4a8ab5', 'start'));
  }

  return els.join('\n');
}

// ── Polygon piece to SVG ──────────────────────────────────────────────────────

function polyToSvg(poly, params) {
  const { pitch, margin, markType, showDimensions, showStitchLine, showCutOutline } = params;
  const { pts, edges } = poly;
  const n = pts.length;
  const els = [];

  if (showCutOutline) {
    // Build per-edge mixed cut outline
    const outPts = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i+1) % n];
      const state = edges[i];
      if (state === 'stitched') {
        const dx = b.x-a.x, dy = b.y-a.y;
        const len = Math.sqrt(dx*dx+dy*dy) || 1;
        const nx = -dy/len*margin, ny = dx/len*margin;
        outPts.push({ x: a.x+nx, y: a.y+ny }, { x: b.x+nx, y: b.y+ny });
      } else {
        outPts.push({ x: a.x, y: a.y }, { x: b.x, y: b.y });
      }
    }
    const clean = [outPts[0]];
    for (let i = 1; i < outPts.length; i++) {
      const p = outPts[i], q = clean[clean.length-1];
      if (Math.abs(p.x-q.x) > 0.001 || Math.abs(p.y-q.y) > 0.001) clean.push(p);
    }
    els.push(path(polylineD(clean, true), '#aaaaaa', 0.2, 'none', '1 0.8'));
  }

  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i+1) % n];
    const state = edges[i];
    if (state === 'stitched') {
      if (showStitchLine) els.push(path(polylineD([a, b]), '#2c7bb6', 0.25));
      const { marks } = placeMarks([a, b], pitch);
      for (const m of marks) els.push(markSvg(m, markType));
      if (showDimensions) {
        const edgeLen = Math.sqrt((b.x-a.x)**2+(b.y-a.y)**2);
        const { snappedLength } = snapToStitches(edgeLen, pitch);
        const angle = Math.atan2(b.y-a.y, b.x-a.x);
        const perpAngle = angle - Math.PI/2;
        const offset = margin + 2.5;
        const tx = (a.x+b.x)/2 + Math.cos(perpAngle)*offset;
        const ty = (a.y+b.y)/2 + Math.sin(perpAngle)*offset;
        els.push(text(tx, ty, `${snappedLength.toFixed(1)} mm`, '2.5', '#4a8ab5'));
      }
    } else if (state === 'open') {
      els.push(path(polylineD([a, b]), '#666666', 0.2, 'none', '0.8 0.8'));
    }
  }

  return els.join('\n');
}

// ── Bounding box of all pieces ────────────────────────────────────────────────

function computeBbox(pieces, rects, polys, margin) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  const expand = (x, y) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };

  pieces.forEach(p => p.pts.forEach(pt => expand(pt.x - margin - 5, pt.y - margin - 5)));
  pieces.forEach(p => p.pts.forEach(pt => expand(pt.x + margin + 5, pt.y + margin + 5)));
  rects.forEach(r => {
    expand(r.x - margin - 5, r.y - margin - 5);
    expand(r.x + r.w + margin + 5, r.y + r.h + margin + 5);
  });
  polys.forEach(po => {
    po.pts.forEach(pt => { expand(pt.x - margin - 5, pt.y - margin - 5); expand(pt.x + margin + 5, pt.y + margin + 5); });
  });

  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  return { minX, minY, maxX, maxY };
}

// ── Main export ───────────────────────────────────────────────────────────────

let _getAnnotationsSVG = () => '';
export function setAnnotationExporter(fn) { _getAnnotationsSVG = fn; }

export function exportSVG(pieces, rects, polys) {
  const params = getParams();
  const { margin } = params;
  const PAD = 5; // mm padding around content

  const { minX, minY, maxX, maxY } = computeBbox(pieces, rects, polys, margin);
  const W = maxX - minX + 2 * PAD;
  const H = maxY - minY + 2 * PAD;
  const ox = minX - PAD; // origin offset
  const oy = minY - PAD;

  const bodyEls = [];

  // Scale bar (50mm reference)
  const sbY = H - 2; // near bottom
  bodyEls.push(`<g id="scale-bar">`);
  bodyEls.push(line(5, sbY, 55, sbY, '#666', 0.3));
  bodyEls.push(line(5, sbY - 1, 5, sbY + 1, '#666', 0.3));
  bodyEls.push(line(55, sbY - 1, 55, sbY + 1, '#666', 0.3));
  bodyEls.push(text(30, sbY - 1.5, '50 mm', '2.5', '#666'));
  bodyEls.push(`</g>`);

  // Freehand pieces
  bodyEls.push('<g id="freehand">');
  pieces.forEach(p => bodyEls.push(freehandToSvg(p, params)));
  bodyEls.push('</g>');

  // Rect pieces
  bodyEls.push('<g id="rects">');
  rects.forEach(r => bodyEls.push(rectToSvg(r, params)));
  bodyEls.push('</g>');

  // Polygon pieces
  bodyEls.push('<g id="polys">');
  polys.forEach(p => bodyEls.push(polyToSvg(p, params)));
  bodyEls.push('</g>');

  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg"`,
    `     width="${W.toFixed(2)}mm" height="${H.toFixed(2)}mm"`,
    `     viewBox="${ox.toFixed(3)} ${oy.toFixed(3)} ${W.toFixed(3)} ${H.toFixed(3)}"`,
    `     version="1.1">`,
    `  <title>StitchPerfect pattern</title>`,
    `  <desc>Generated by StitchPerfect — stitchperfect.app</desc>`,
    `  <g transform="translate(0,0)">`,
    bodyEls.join('\n'),
    `<g id="annotations">${_getAnnotationsSVG()}</g>`,
    `  </g>`,
    `</svg>`,
  ].join('\n');

  return svg;
}

export function downloadSVG(pieces, rects, polys) {
  const svg  = exportSVG(pieces, rects, polys);
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'stitchperfect-pattern.svg';
  a.click();
  URL.revokeObjectURL(url);
}
