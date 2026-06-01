// ui/canvas.js — paper.js canvas + geometry engine wiring
// `paper` is available as a global (loaded via <script> before this module)

import { placeMarks, snapToStitches } from '../engine/stitch.js';
import { initOffset, offsetPolyline } from '../engine/offset.js';
import Clipper2Factory from '../vendor/clipper2z.js';
import { initControls, getParams, onParamsChange } from './controls.js';
import { initPolyTool, activatePolyMode, activateTrapMode, deactivatePolyMode,
         redrawAllPolys, getPolyStats, getAllPolys,
         getSelectedPoly, rerenderPoly, selectPoly } from './poly-tool.js';
import { tpocketVertices, tpocketEdges, translatePts,
         clampParams, DEFAULT_PARAMS } from './tpocket.js';
import { initOvalTool, activateOvalMode, deactivateOvalMode,
         redrawAllOvals, getOvalStats, getAllOvals } from './oval-tool.js';
import { initBezierTool, initBezierToolLayers, activateBezierMode, deactivateBezierMode,
         redrawAllBeziers, getBezierStats, getAllBeziers } from './bezier-tool.js';
import { downloadSVG } from './export.js';
import { initRectTool, activateRectMode, deactivateRectMode,
         redrawAllRects, getRectStats, getSelectedRect, toggleSelectedEdge,
         copySelectedRect, pasteRect, flipSelectedRect,
         getAllRects, moveRectTo, deleteRect as _deleteRectItem,
         getRectSnapPoints } from './rect-tool.js';
import { px, toMm, createMark } from './render.js';

// ── Init ──────────────────────────────────────────────────────────────────────

await initOffset(Clipper2Factory);
initControls();

const canvasEl = document.getElementById('canvas');
const wrap     = document.getElementById('canvas-wrap');

function syncSize() {
  // Paper.js reads offsetWidth/offsetHeight and handles devicePixelRatio internally
  // in paper.setup(). We only need to keep the canvas CSS dimensions correct.
  canvasEl.style.width  = wrap.offsetWidth  + 'px';
  canvasEl.style.height = wrap.offsetHeight + 'px';
  // Set the pixel buffer at physical resolution for crisp rendering on HiDPI displays
  const dpr = window.devicePixelRatio || 1;
  canvasEl.width  = Math.round(wrap.offsetWidth  * dpr);
  canvasEl.height = Math.round(wrap.offsetHeight * dpr);
}
syncSize();
paper.setup(canvasEl);
// After setup, keep the logical coordinate space in CSS pixels regardless of DPR
paper.view.viewSize = new paper.Size(wrap.offsetWidth, wrap.offsetHeight);
window.addEventListener('resize', () => {
  syncSize();
  paper.view.viewSize = new paper.Size(wrap.offsetWidth, wrap.offsetHeight);
});

// ── Layers (bottom → top) ─────────────────────────────────────────────────────

const pageLayer   = new paper.Layer(); // page border — below everything
const gridLayer   = new paper.Layer(); // grid — below cut layer
const cutLayer    = new paper.Layer();
const stitchLayer = new paper.Layer();
const markLayer   = new paper.Layer();
const handleLayer = new paper.Layer(); // always on top — resize handles

// ── Trace image background ────────────────────────────────────────────────────
// A PNG/JPG imported as a semi-transparent guide layer. Not included in SVG.
// The user can move it (drag) and scale it (drag corners).

let _traceRaster = null;   // paper.Raster on pageLayer
let _traceScale  = 1;      // current scale factor
let _traceDragState = null;// { startPt, origPos }

function _initTraceControls() {
  const loadBtn    = document.getElementById('btn-trace-load');
  const clearBtn   = document.getElementById('btn-trace-clear');
  const fileInput  = document.getElementById('trace-file-input');
  const opacityEl  = document.getElementById('trace-opacity');
  const ctrlsRow   = document.getElementById('trace-controls');

  loadBtn?.addEventListener('click', () => fileInput?.click());

  fileInput?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      _loadTraceImage(ev.target.result);
      if (clearBtn) clearBtn.disabled = false;
      if (ctrlsRow) ctrlsRow.style.display = 'flex';
    };
    reader.readAsDataURL(file);
    fileInput.value = ''; // allow re-loading same file
  });

  clearBtn?.addEventListener('click', () => {
    if (_traceRaster) { _traceRaster.remove(); _traceRaster = null; }
    if (clearBtn) clearBtn.disabled = true;
    if (ctrlsRow) ctrlsRow.style.display = 'none';
  });

  opacityEl?.addEventListener('input', () => {
    if (_traceRaster) _traceRaster.opacity = parseFloat(opacityEl.value) / 100;
  });
}

function _loadTraceImage(dataUrl) {
  if (_traceRaster) _traceRaster.remove();
  pageLayer.activate();
  const img = new Image();
  img.onload = () => {
    pageLayer.activate();
    _traceRaster = new paper.Raster(img);
    _traceRaster.position = paper.view.center;
    // Scale so image fits within view at ~70% of smaller dimension
    const viewW = toMm(canvasEl.width / (window.devicePixelRatio || 1));
    const viewH = toMm(canvasEl.height / (window.devicePixelRatio || 1));
    const fitScale = Math.min((viewW * 0.7 * 3.78) / img.width, (viewH * 0.7 * 3.78) / img.height);
    _traceRaster.scale(fitScale);
    _traceScale = fitScale;
    _traceRaster.opacity = 0.4;
    _traceRaster.locked  = false; // allow drag moves via our custom handler
  };
  img.src = dataUrl;
}

// Handle trace image move (click+drag when no other tool interaction)
// Called from the freehand tool's mousedown before normal handling
export function handleTraceMouseDown(point) {
  if (!_traceRaster) return false;
  const local = _traceRaster.globalToLocal(point);
  const hw = _traceRaster.width / 2, hh = _traceRaster.height / 2;
  if (Math.abs(local.x) < hw && Math.abs(local.y) < hh) {
    _traceDragState = { startPt: point, origPos: _traceRaster.position.clone() };
    return true;
  }
  return false;
}

export function handleTraceMouseDrag(point) {
  if (!_traceDragState || !_traceRaster) return false;
  const delta = point.subtract(_traceDragState.startPt);
  _traceRaster.position = _traceDragState.origPos.add(delta);
  return true;
}

export function handleTraceMouseUp() {
  if (_traceDragState) { _traceDragState = null; return true; }
  return false;
}

// ── Grid overlay (CSS background — no paper.js objects, excluded from SVG) ───

function updateGridOverlay() {
  const { showGrid, gridSize, snapGrid } = getParams();
  const el = document.getElementById('grid-size-row');
  if (el) el.style.display = showGrid ? 'flex' : 'none';

  if (!showGrid) {
    wrap.style.backgroundImage = 'none';
    return;
  }
  const pxSize = px(gridSize);
  const col = snapGrid ? 'rgba(44,123,182,0.12)' : 'rgba(0,0,0,0.06)';
  wrap.style.backgroundImage =
    `linear-gradient(to right, ${col} 1px, transparent 1px),
     linear-gradient(to bottom, ${col} 1px, transparent 1px)`;
  wrap.style.backgroundSize = `${pxSize}px ${pxSize}px`;
}

// ── Page border overlay (paper.js layer) ──────────────────────────────────────

const PAGE_SIZES_MM = { a4: [210, 297], letter: [216, 279], a3: [297, 420] };

function updatePageOverlay() {
  pageLayer.activate();
  pageLayer.removeChildren();

  const { showPageBorder, pageSize } = getParams();
  if (!showPageBorder || pageSize === 'none') return;

  const dims = PAGE_SIZES_MM[pageSize];
  if (!dims) return;
  const [w, h] = dims;

  // Page shadow
  const shadow = new paper.Path.Rectangle(
    new paper.Point(px(2), px(2)),
    new paper.Size(px(w), px(h)));
  shadow.fillColor = 'rgba(0,0,0,0.08)';
  shadow.strokeWidth = 0;

  // Page rectangle
  const page = new paper.Path.Rectangle(
    new paper.Point(0, 0),
    new paper.Size(px(w), px(h)));
  page.fillColor   = 'white';
  page.strokeColor = '#bbb';
  page.strokeWidth = 0.75;

  // Page label
  const label = new paper.PointText({
    point: new paper.Point(px(w) - 2, px(h) - 2),
    content: pageSize === 'a4' ? 'A4' : pageSize === 'a3' ? 'A3' : 'Letter',
    fontSize: 8,
    fillColor: '#ccc',
    justification: 'right',
  });
}

// Snap a mm point to the grid if snapGrid is active
function _snapToGridMm(xMm, yMm) {
  const { snapGrid, gridSize } = getParams();
  if (!snapGrid) return { x: xMm, y: yMm };
  return {
    x: Math.round(xMm / gridSize) * gridSize,
    y: Math.round(yMm / gridSize) * gridSize,
  };
}

initRectTool(
  { cutLayer, stitchLayer, markLayer, handleLayer },
  () => { updateStatus(); updateSelInfo(); },
  (rect) => { _zAdd('rect', rect); },
  (rect) => { _zRemove(rect); },
);
initPolyTool(
  { cutLayer, stitchLayer, markLayer, handleLayer },
  () => { updateStatus(); updateSelInfo(); },
  (poly) => { _zAdd('poly', poly); },
  (poly) => { _zRemove(poly); },
);
initOvalTool(
  { cutLayer, stitchLayer, markLayer, handleLayer },
  () => { updateStatus(); updateSelInfo(); },
  (oval) => { _zAdd('oval', oval); },
  (oval) => { _zRemove(oval); },
);
_initTraceControls();

initBezierTool(
  { cutLayer, stitchLayer, markLayer, handleLayer },
  () => { updateStatus(); updateSelInfo(); },
  (bz) => { _zAdd('bezier', bz); },
  (bz) => { _zRemove(bz); },
);
initBezierToolLayers({ cutLayer, stitchLayer, markLayer, handleLayer });

// ── Freehand pieces ───────────────────────────────────────────────────────────
// { pts: [{x,y}], items: paper.Item[], count: number, markCount: number }

const pieces = [];

// ── Freehand piece rendering ──────────────────────────────────────────────────

// Scale a polyline uniformly from its start point to a target arc-length.
// This makes the rendered line match the snapped piece dimension.
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

function renderPiece(pts) {
  const { pitch, margin, markType, showDimensions, showStitchLine, showCutOutline } = getParams();
  const items = [];

  let rawLen = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i-1].x, dy = pts[i].y - pts[i-1].y;
    rawLen += Math.sqrt(dx*dx + dy*dy);
  }
  const { snappedLength } = snapToStitches(rawLen, pitch);
  const snappedPts = snapPolyline(pts, snappedLength);

  // Stitch line (gated by showStitchLine)
  if (showStitchLine) {
    stitchLayer.activate();
    items.push(new paper.Path({
      segments: snappedPts.map(p => new paper.Point(px(p.x), px(p.y))),
      strokeColor: '#2c7bb6',
      strokeWidth: 1,
    }));
  }

  // Marks always shown (they are what matters for punching)
  markLayer.activate();
  const { marks, count } = placeMarks(snappedPts, pitch);
  for (const m of marks) items.push(createMark(m, markType));

  // Cut outline (gated by showCutOutline)
  if (showCutOutline) {
    cutLayer.activate();
    for (const ring of offsetPolyline(snappedPts, margin, false)) {
      items.push(new paper.Path({
        segments: ring.map(p => new paper.Point(px(p.x), px(p.y))),
        closed: true,
        strokeColor: '#aaa',
        strokeWidth: 0.75,
        dashArray: [4, 3],
      }));
    }
  }

  // Dimension label — shown only when showDimensions is on
  if (showDimensions) {
    const p0 = snappedPts[0];
    const p1 = snappedPts[snappedPts.length - 1];
    const perpAngle = Math.atan2(p1.y - p0.y, p1.x - p0.x) - Math.PI / 2;
    const labelOffset = px(margin) + 9;
    stitchLayer.activate();
    items.push(new paper.PointText({
      point: new paper.Point(
        px((p0.x + p1.x) / 2) + Math.cos(perpAngle) * labelOffset,
        px((p0.y + p1.y) / 2) + Math.sin(perpAngle) * labelOffset,
      ),
      content: `${(count * pitch).toFixed(1)} mm`,
      fontSize: 9,
      fillColor: '#4a8ab5',
      justification: 'center',
    }));
  }

  return { items, count, markCount: marks.length, snappedPts };
}

// ── Live redraw on parameter change ──────────────────────────────────────────

function redrawAll() {
  pieces.forEach(piece => piece.items.forEach(item => item.remove()));
  pieces.forEach(piece => {
    const { items, count, markCount, snappedPts } = renderPiece(piece.pts);
    piece.items      = items;
    piece.count      = count;
    piece.markCount  = markCount;
    piece.snappedPts = snappedPts;
  });
  redrawAllRects();
  redrawAllPolys();
  redrawAllOvals();
  redrawAllBeziers();
  deduplicateCorners();
  updateGridOverlay();
  updatePageOverlay();
  updateStatus();
  updateSelInfo();
}

onParamsChange(redrawAll);

// ── Status bar ────────────────────────────────────────────────────────────────

function updateStatus() {
  const statusEl = document.getElementById('status');
  const pitchEl  = document.getElementById('status-pitch');
  const rs = getRectStats();
  const ps = getPolyStats();
  const os = getOvalStats();
  const bs = getBezierStats();
  const totalPieces   = pieces.length + rs.count + ps.count + os.count + bs.count;

  if (totalPieces === 0) {
    statusEl.textContent = '';
  } else {
    const totalStitches = pieces.reduce((s, p) => s + p.count, 0)    + rs.stitches + ps.stitches + os.stitches + bs.stitches;
    const totalMarks    = pieces.reduce((s, p) => s + p.markCount, 0) + rs.marks   + ps.marks   + os.marks   + bs.marks;
    statusEl.textContent = (totalPieces === 1 && pieces.length === 1)
      ? `Line – ${pieces[0].count} stitches`
      : `${totalPieces} piece${totalPieces > 1 ? 's' : ''} · ${totalStitches} stitches`;
  }

  // Right side: always shows current pitch
  const { pitch } = getParams();
  if (pitchEl) pitchEl.textContent = `pitch ${pitch} mm`;
}

// ── Shared-corner deduplication ──────────────────────────────────────────────
// When two freehand pieces have endpoints within tolerance, they share a corner.
// The "secondary" piece (higher index) has its terminal mark hidden so only
// one hole is punched at the junction.

const CORNER_TOL_MM = 0.15;

function deduplicateCorners() {
  // Respect the cornerDedup toggle
  const reset = (p) => {
    if (p.items[1])           p.items[1].visible           = true;
    if (p.items[p.markCount]) p.items[p.markCount].visible = true;
  };

  if (!getParams().cornerDedup) {
    pieces.forEach(reset);
    return;
  }

  // Reset all endpoint marks to visible first
  pieces.forEach(reset);

  for (let i = 0; i < pieces.length; i++) {
    const pi  = pieces[i];
    const piS = pi.snappedPts?.[0];
    const piE = pi.snappedPts?.[pi.snappedPts.length - 1];
    if (!piS || !piE) continue;

    for (let j = i + 1; j < pieces.length; j++) {
      const pj  = pieces[j];
      const pjS = pj.snappedPts?.[0];
      const pjE = pj.snappedPts?.[pj.snappedPts.length - 1];
      if (!pjS || !pjE) continue;

      const near = (a, b) => {
        const dx = a.x - b.x, dy = a.y - b.y;
        return Math.sqrt(dx * dx + dy * dy) < CORNER_TOL_MM;
      };

      // Hide j's mark at any endpoint it shares with i
      if (near(piS, pjS) || near(piE, pjS)) {
        if (pj.items[1]) pj.items[1].visible = false;
      }
      if (near(piS, pjE) || near(piE, pjE)) {
        if (pj.items[pj.markCount]) pj.items[pj.markCount].visible = false;
      }
    }
  }
}

// ── Piece tab ─────────────────────────────────────────────────────────────────

function _edgeBtnClass(state) {
  return `edge-btn ${state}`;
}

function updateSelInfo() {
  const el = document.getElementById('piece-content');
  if (!el) return;
  const { margin, pitch } = getParams();

  // ── Rect selected ──────────────────────────────────────────────────────────
  const ri = getSelectedRect();
  if (ri) {
    const { count: wCount } = _stitchCount(ri.w, pitch);
    const { count: hCount } = _stitchCount(ri.h, pitch);
    const e = ri.edges;

    el.innerHTML = `
      <div class="piece-section">
        <div class="piece-section-label">Stitch area</div>
        <div class="piece-grid">
          <div class="piece-field"><div class="piece-field-label">W</div><div class="piece-field-val">${ri.w.toFixed(1)} mm</div></div>
          <div class="piece-field"><div class="piece-field-label">H</div><div class="piece-field-val">${ri.h.toFixed(1)} mm</div></div>
          <div class="piece-field"><div class="piece-field-label">Stitches W</div><div class="piece-field-val secondary">${wCount}</div></div>
          <div class="piece-field"><div class="piece-field-label">Stitches H</div><div class="piece-field-val secondary">${hCount}</div></div>
        </div>
      </div>
      <div class="piece-section">
        <div class="piece-section-label">Cut piece</div>
        <div class="piece-grid">
          <div class="piece-field"><div class="piece-field-label">W</div><div class="piece-field-val secondary">${(ri.w + 2*margin).toFixed(1)} mm</div></div>
          <div class="piece-field"><div class="piece-field-label">H</div><div class="piece-field-val secondary">${(ri.h + 2*margin).toFixed(1)} mm</div></div>
        </div>
      </div>
      <div class="piece-section">
        <div class="piece-section-label">Edges &nbsp;<small style="color:#444;font-size:9px">click to cycle state</small></div>
        <div class="edge-grid">
          <div class="edge-spacer"></div>
          <button class="${_edgeBtnClass(e.top)}"    data-piece-edge="top">↑ Top</button>
          <div class="edge-spacer"></div>
          <button class="${_edgeBtnClass(e.left)}"   data-piece-edge="left">← Left</button>
          <div class="edge-spacer"></div>
          <button class="${_edgeBtnClass(e.right)}"  data-piece-edge="right">→ Right</button>
          <div class="edge-spacer"></div>
          <button class="${_edgeBtnClass(e.bottom)}" data-piece-edge="bottom">↓ Bottom</button>
          <div class="edge-spacer"></div>
        </div>
        <div class="edge-legend">
          <span><div class="legend-dot stitched"></div> stitched</span>
          <span><div class="legend-dot open"></div> open</span>
          <span><div class="legend-dot hidden"></div> hidden</span>
        </div>
      </div>
      <div class="piece-section">
        <div class="piece-section-label">Position</div>
        <div class="piece-grid">
          <div class="piece-field"><div class="piece-field-label">X</div><div class="piece-field-val secondary">${ri.x.toFixed(1)} mm</div></div>
          <div class="piece-field"><div class="piece-field-label">Y</div><div class="piece-field-val secondary">${ri.y.toFixed(1)} mm</div></div>
        </div>
      </div>
      <div class="piece-section">
        <div class="piece-section-label">Mate</div>
        <div class="mate-placeholder">No mate assigned</div>
        <button class="mate-assign-btn" disabled>Assign mate edge…</button>
      </div>`;

    // Wire edge buttons
    el.querySelectorAll('[data-piece-edge]').forEach(btn => {
      btn.addEventListener('click', () => {
        toggleSelectedEdge(btn.dataset.pieceEdge);
      });
    });
    return;
  }

  // ── Polygon (T-pocket or generic) selected ────────────────────────────────
  const selPoly = getSelectedPoly();
  if (selPoly) {
    if (selPoly.tpocketParams) {
      // ── T-Pocket template ──────────────────────────────────────────────────
      const p = selPoly.tpocketParams;
      const fieldHtml = (label, key, val, min = 5) =>
        `<div class="piece-field">
           <div class="piece-field-label">${label}</div>
           <div style="display:flex;align-items:center;gap:3px">
             <input class="tp-input" data-param="${key}" type="number"
                    value="${val}" min="${min}" step="1"
                    style="width:52px;background:#252525;color:#ddd;border:1px solid #333;
                           border-radius:4px;padding:2px 5px;font-size:13px;font-weight:600">
             <span style="font-size:10px;color:#555">mm</span>
           </div>
         </div>`;
      el.innerHTML = `
        <div class="piece-section">
          <div class="piece-section-label" style="color:#f39c12">T-Pocket Template</div>
          <div style="font-size:10px;color:#555;margin-bottom:4px">
            Angled sides auto-adjust
          </div>
          <div class="piece-grid" style="gap:10px 8px">
            ${fieldHtml('Total height', 'h',  p.h,  20)}
            ${fieldHtml('T width',      'tw', p.tw, 20)}
            ${fieldHtml('T height (ear)', 'th', p.th, 5)}
            ${fieldHtml('T tab length', 'tt', p.tt, 5)}
            ${fieldHtml('Base width',   'bw', p.bw, 10)}
          </div>
        </div>
        <div class="piece-section">
          <div class="piece-section-label">Position</div>
          <div class="piece-grid">
            <div class="piece-field"><div class="piece-field-label">X</div>
              <div class="piece-field-val secondary">${selPoly.pts[0].x.toFixed(1)} mm</div></div>
            <div class="piece-field"><div class="piece-field-label">Y</div>
              <div class="piece-field-val secondary">${selPoly.pts[0].y.toFixed(1)} mm</div></div>
          </div>
        </div>`;

      // Wire param inputs
      el.querySelectorAll('.tp-input').forEach(input => {
        input.addEventListener('change', () => {
          const v = parseFloat(input.value);
          if (!isNaN(v) && v > 0) _updateTPocketParams(selPoly, input.dataset.param, v);
        });
      });
    } else {
      // ── Generic polygon ────────────────────────────────────────────────────
      const xs = selPoly.pts.map(p => p.x), ys = selPoly.pts.map(p => p.y);
      const bw = (Math.max(...xs) - Math.min(...xs)).toFixed(1);
      const bh = (Math.max(...ys) - Math.min(...ys)).toFixed(1);
      el.innerHTML = `
        <div class="piece-section">
          <div class="piece-section-label">Polygon</div>
          <div class="piece-grid">
            <div class="piece-field"><div class="piece-field-label">Vertices</div>
              <div class="piece-field-val">${selPoly.pts.length}</div></div>
            <div class="piece-field"><div class="piece-field-label">Bbox</div>
              <div class="piece-field-val secondary">${bw} × ${bh} mm</div></div>
          </div>
          <div style="font-size:10px;color:#555;margin-top:4px">
            Click edges on canvas to cycle state
          </div>
        </div>`;
    }
    return;
  }

  // ── Oval selected ─────────────────────────────────────────────────────────
  // (Handled by oval-tool's own selection; getSelectedOval in canvas updateSelInfo)
  // Oval selection info is shown via the _onChange callback updating the piece tab.
  // For now show a simple summary when an oval is the last-known selection.

  // ── Freehand selected ──────────────────────────────────────────────────────
  if (_selFreehand) {
    const p   = _selFreehand;
    const len = (p.count * pitch).toFixed(1);
    const p0  = p.pts[0], p1 = p.pts[p.pts.length - 1];
    const angle = (Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180 / Math.PI).toFixed(1);
    el.innerHTML = `
      <div class="piece-section">
        <div class="piece-section-label">Line</div>
        <div class="piece-grid">
          <div class="piece-field"><div class="piece-field-label">Length</div><div class="piece-field-val">${len} mm</div></div>
          <div class="piece-field"><div class="piece-field-label">Stitches</div><div class="piece-field-val">${p.count}</div></div>
          <div class="piece-field"><div class="piece-field-label">Angle</div><div class="piece-field-val secondary">${angle}°</div></div>
          <div class="piece-field"><div class="piece-field-label">Marks</div><div class="piece-field-val secondary">${p.markCount}</div></div>
        </div>
      </div>`;
    return;
  }

  el.innerHTML = '<div class="piece-empty">Select a piece to see its properties</div>';
}

// Helper: stitch count for a dimension
function _stitchCount(dim, pitch) {
  const count = Math.max(1, Math.round(dim / pitch));
  return { count };
}

// ── Snap helpers ─────────────────────────────────────────────────────────────

const SNAP_MM = 3; // snap threshold in mm

function _freehandSnapPoints(piece, { vertices, midpoints }) {
  const p0 = piece.pts[0];
  const p1 = piece.pts[piece.pts.length - 1];
  const pts = [];
  if (vertices)  { pts.push(p0, p1); }
  if (midpoints) { pts.push({ x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }); }
  return pts;
}

// Returns { dx, dy } adjustment (in mm) to snap `movingPts` onto nearest target
function _computeSnap(movingPts, targetPts) {
  let bestDx = 0, bestDy = 0, bestDist = SNAP_MM;
  for (const m of movingPts) {
    for (const t of targetPts) {
      const dx = t.x - m.x, dy = t.y - m.y;
      const d  = Math.sqrt(dx * dx + dy * dy);
      if (d < bestDist) { bestDist = d; bestDx = dx; bestDy = dy; }
    }
  }
  return { dx: bestDx, dy: bestDy };
}

let _fhSnapIndicator = null;

function _showFhSnapAt(mmPt) {
  if (_fhSnapIndicator) _fhSnapIndicator.remove();
  if (!mmPt) { _fhSnapIndicator = null; return; }
  handleLayer.activate();
  _fhSnapIndicator = new paper.Path.Circle(
    new paper.Point(px(mmPt.x), px(mmPt.y)), 5);
  _fhSnapIndicator.strokeColor = '#f39c12';
  _fhSnapIndicator.strokeWidth = 2;
  _fhSnapIndicator.fillColor   = null;
}

// ── Z-order ───────────────────────────────────────────────────────────────────
// _zOrder is a flat array in draw order: index 0 = bottommost, last = topmost.
// When a piece is committed it's appended (goes to top).

const _zOrder = []; // Array<{kind:'freehand'|'rect', ref}>

function _zAdd(kind, ref)   { _zOrder.push({ kind, ref }); }
function _zRemove(ref)      { const i = _zOrder.findIndex(z => z.ref === ref); if (i !== -1) _zOrder.splice(i, 1); }
function _zIndexOf(ref)     { return _zOrder.findIndex(z => z.ref === ref); }

// Bring a piece one step forward (toward top of stack)
function _zBringForward(ref) {
  const i = _zIndexOf(ref);
  if (i < _zOrder.length - 1) {
    [_zOrder[i], _zOrder[i + 1]] = [_zOrder[i + 1], _zOrder[i]];
  }
}

// Send a piece one step back (toward bottom of stack)
function _zSendBack(ref) {
  const i = _zIndexOf(ref);
  if (i > 0) {
    [_zOrder[i], _zOrder[i - 1]] = [_zOrder[i - 1], _zOrder[i]];
  }
}

// Find all pieces hit by point, sorted top→bottom (highest z-index first)
function _zHitAll(point) {
  const hits = [];
  for (const { kind, ref } of _zOrder) {
    let hit = false;
    if (kind === 'freehand') {
      hit = !!ref.items[0]?.hitTest(point, { stroke: true, tolerance: 8 });
    } else {
      // For rects, check if point is near any edge
      const { x, y, w, h } = ref;
      const { margin } = getParams();
      hit = point.x >= px(x - margin) - 8 && point.x <= px(x + w + margin) + 8 &&
            point.y >= px(y - margin) - 8 && point.y <= px(y + h + margin) + 8;
    }
    if (hit) hits.push({ kind, ref, z: _zIndexOf(ref) });
  }
  return hits.sort((a, b) => b.z - a.z); // topmost first
}

// Cycle variable — tracks which index in the hit list was last selected
let _zCyclePoint = null;
let _zCycleIdx   = 0;

function _zAltClick(point) {
  const hits = _zHitAll(point);
  if (hits.length === 0) return;

  // If same point as last alt-click, advance the cycle; otherwise restart
  const samePoint = _zCyclePoint &&
    Math.abs(point.x - _zCyclePoint.x) < 5 &&
    Math.abs(point.y - _zCyclePoint.y) < 5;
  if (!samePoint) _zCycleIdx = 0;
  else _zCycleIdx = (_zCycleIdx + 1) % hits.length;
  _zCyclePoint = point;

  const target = hits[_zCycleIdx];
  _msClear();
  _deselectFreehand();
  if (target.kind === 'freehand') { _selectFreehand(target.ref); }
  else {
    // Select the rect — mimic clicking on it inside rect-tool
    // We do this by delegating to the rect tool; for now just show in piece tab
    updateSelInfo();
  }
}

// Wire Bring Fwd / Send Back buttons
document.getElementById('btn-fwd') ?.addEventListener('click', () => {
  const ri = getSelectedRect(); if (ri) _zBringForward(ri); // ref is the rect object
  if (_selFreehand) _zBringForward(_selFreehand);
});
document.getElementById('btn-back')?.addEventListener('click', () => {
  const ri = getSelectedRect(); if (ri) _zSendBack(ri);
  if (_selFreehand) _zSendBack(_selFreehand);
});

// ── Multi-select + Group ──────────────────────────────────────────────────────
//
// _multiSel  : Array<{kind:'freehand'|'rect', ref, origX, origY}>
//              origX/Y store the position at drag-start for group move.
// _groups    : Array<{id, members:Array<{kind,ref}>}>
//              Groups are resolved at interaction time (pieces inside move together).

let _multiSel   = [];
let _groups     = [];
let _selBoxItem = null; // paper item showing the multi-selection bounding box

function _msIn(ref) { return _multiSel.some(s => s.ref === ref); }

function _msAdd(kind, ref) {
  if (!_msIn(ref)) _multiSel.push({ kind, ref });
  _drawSelBox();
  _syncEditBtns();
}

function _msRemove(ref) {
  _multiSel = _multiSel.filter(s => s.ref !== ref);
  _drawSelBox();
  _syncEditBtns();
}

function _msClear() {
  _multiSel = [];
  if (_selBoxItem) { _selBoxItem.remove(); _selBoxItem = null; }
  _syncEditBtns();
}

// Bounding box for a piece {kind, ref}
function _pieceBBox({ kind, ref }) {
  if (kind === 'freehand') {
    const pts = ref.pts;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pts.forEach(p => { minX=Math.min(minX,p.x); minY=Math.min(minY,p.y);
                       maxX=Math.max(maxX,p.x); maxY=Math.max(maxY,p.y); });
    return { x: minX, y: minY, w: maxX-minX, h: maxY-minY };
  }
  const { margin } = getParams();
  return { x: ref.x - margin, y: ref.y - margin,
           w: ref.w + 2*margin, h: ref.h + 2*margin };
}

function _drawSelBox() {
  if (_selBoxItem) { _selBoxItem.remove(); _selBoxItem = null; }
  if (_multiSel.length < 2) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  _multiSel.forEach(s => {
    const b = _pieceBBox(s);
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
  });

  handleLayer.activate();
  _selBoxItem = new paper.Path.Rectangle(
    new paper.Point(px(minX) - 6, px(minY) - 6),
    new paper.Size(px(maxX - minX) + 12, px(maxY - minY) + 12),
  );
  _selBoxItem.strokeColor = '#5bb3f5';
  _selBoxItem.strokeWidth = 1;
  _selBoxItem.dashArray   = [4, 3];
  _selBoxItem.fillColor   = null;
}

// Group helpers
function _groupOf(ref) { return _groups.find(g => g.members.some(m => m.ref === ref)); }

function _selectGroup(group) {
  _msClear();
  group.members.forEach(m => _msAdd(m.kind, m.ref));
}

// Delete all multi-selected pieces
function _msDeleteAll() {
  if (_multiSel.length === 0) return;
  const toDelete = [..._multiSel];
  _msClear();
  _deselectFreehand();

  toDelete.forEach(({ kind, ref }) => {
    if (kind === 'freehand') {
      ref.items.forEach(i => i.remove());
      pieces.splice(pieces.indexOf(ref), 1);
    } else {
      _deleteRectItem(ref);
    }
    // Remove any group containing this piece
    _groups = _groups.filter(g => !g.members.some(m => m.ref === ref));
  });

  deduplicateCorners();
  updateStatus();
  updateSelInfo();
}

// Move all multi-selected pieces by dx,dy (mm), called during group drag
function _msMoveAll(dx, dy) {
  _multiSel.forEach(({ kind, ref, origX, origY }) => {
    if (kind === 'freehand') {
      const newPts = ref.pts.map(p => ({ x: p.x + dx, y: p.y + dy }));
      ref.items.forEach(i => i.remove());
      const { items, count, markCount, snappedPts } = renderPiece(newPts);
      if (_selFreehand === ref) { items[0].strokeColor = '#5bb3f5'; items[0].strokeWidth = 1.5; }
      ref.pts = newPts; ref.items = items; ref.count = count;
      ref.markCount = markCount; ref.snappedPts = snappedPts;
    } else {
      moveRectTo(ref, origX + dx, origY + dy);
    }
  });
  _drawSelBox();
}

// Ctrl+G — group current multi-selection
function _groupSelected() {
  if (_multiSel.length < 2) return;
  const id = Date.now();
  const members = _multiSel.map(({ kind, ref }) => ({ kind, ref }));
  // Remove any existing groups whose members overlap
  _groups = _groups.filter(g => !g.members.some(m => members.some(n => n.ref === m.ref)));
  _groups.push({ id, members });
  updateStatus();
}

// Ctrl+Shift+G — ungroup
function _ungroupSelected() {
  const refs = new Set(_multiSel.map(s => s.ref));
  _groups = _groups.filter(g => !g.members.some(m => refs.has(m.ref)));
  updateStatus();
}

// Keyboard shortcuts for group
document.addEventListener('keydown', ev => {
  if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && ev.key === 'g') {
    _groupSelected(); ev.preventDefault();
  }
  if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && ev.key === 'G') {
    _ungroupSelected(); ev.preventDefault();
  }
  if (ev.key === 'Delete' || ev.key === 'Backspace') {
    if (_multiSel.length > 1) { _msDeleteAll(); ev.preventDefault(); }
  }
});

// Wire Shapes tab Group buttons
document.getElementById('btn-group')  ?.addEventListener('click', _groupSelected);
document.getElementById('btn-ungroup')?.addEventListener('click', _ungroupSelected);

// ── Freehand selection + move ────────────────────────────────────────────────

let _selFreehand       = null; // selected freehand piece
let _fhDragPiece       = null; // piece being dragged
let _fhDragStart       = null; // paper.Point where drag began
let _fhDragOrigPts     = null; // original pts snapshot

function _selectFreehand(piece) {
  _deselectFreehand();
  _selFreehand = piece;
  piece.items[0].strokeColor = '#5bb3f5';
  piece.items[0].strokeWidth = 1.5;
  updateSelInfo();
  _syncEditBtns();
}

function _deselectFreehand() {
  if (!_selFreehand) return;
  _selFreehand.items[0].strokeColor = '#2c7bb6';
  _selFreehand.items[0].strokeWidth = 1;
  _selFreehand = null;
  updateSelInfo();
  _syncEditBtns();
}

function _findFreehandAt(point) {
  for (let i = pieces.length - 1; i >= 0; i--) {
    const hit = pieces[i].items[0].hitTest(point, { stroke: true, tolerance: 8 });
    if (hit) return pieces[i];
  }
  return null;
}

// ── Finalize a freehand path ──────────────────────────────────────────────────

function finalizePath(path) {
  const pts = path.segments.map(s => ({ x: toMm(s.point.x), y: toMm(s.point.y) }));
  path.remove();
  if (pts.length < 2) return;

  const { items, count, markCount, snappedPts } = renderPiece(pts);
  const piece = { pts, items, count, markCount, snappedPts };
  pieces.push(piece);
  _zAdd('freehand', piece);
  deduplicateCorners();
  updateStatus();
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

const hintEl = document.getElementById('hint');
const HINTS = {
  freehand: 'Click to place points &nbsp;·&nbsp; Shift = angle-snap &nbsp;·&nbsp; Double-click to finish &nbsp;·&nbsp; Esc to cancel',
  rect:     'Drag to draw &nbsp;·&nbsp; Click edge to toggle stitch/open &nbsp;·&nbsp; Drag corner to resize &nbsp;·&nbsp; Delete to remove',
  poly:     'Click to place vertices &nbsp;·&nbsp; Shift = angle-snap &nbsp;·&nbsp; Click start or Enter to close &nbsp;·&nbsp; Click edge to cycle &nbsp;·&nbsp; Drag vertex to reshape',
  trap:     'Drag to draw trapezoid &nbsp;·&nbsp; Click edge to cycle state &nbsp;·&nbsp; Drag corner to reshape',
  oval:     'Drag to draw oval &nbsp;·&nbsp; Click oval to select &nbsp;·&nbsp; Drag cardinal handle to resize',
  bezier:   'Click = corner &nbsp;·&nbsp; Click+drag = smooth curve &nbsp;·&nbsp; Shift = angle-snap &nbsp;·&nbsp; Click start or Enter to close &nbsp;·&nbsp; Backspace = undo last anchor',
};

let _activeTool = 'freehand';

function setTool(name) {
  _activeTool = name;
  document.querySelectorAll('#tool-btns [data-tool]')
    .forEach(b => b.classList.toggle('active', b.dataset.tool === name));
  hintEl.innerHTML = HINTS[name];
}

document.querySelectorAll('#tool-btns [data-tool]').forEach(btn => {
  btn.addEventListener('click', () => {
    const name = btn.dataset.tool;
    if (name === _activeTool) return;
    if (name === 'rect') {
      clearGhost(); if (activePath) { activePath.remove(); activePath = null; }
      _deselectFreehand(); deactivatePolyMode(); deactivateOvalMode();
      activateRectMode();
    } else if (name === 'poly') {
      clearGhost(); if (activePath) { activePath.remove(); activePath = null; }
      _deselectFreehand(); deactivateRectMode(); deactivateOvalMode();
      activatePolyMode();
    } else if (name === 'trap') {
      clearGhost(); if (activePath) { activePath.remove(); activePath = null; }
      _deselectFreehand(); deactivateRectMode(); deactivateOvalMode();
      activateTrapMode();
    } else if (name === 'oval') {
      clearGhost(); if (activePath) { activePath.remove(); activePath = null; }
      _deselectFreehand(); deactivateRectMode(); deactivatePolyMode(); deactivateBezierMode();
      activateOvalMode();
    } else if (name === 'bezier') {
      clearGhost(); if (activePath) { activePath.remove(); activePath = null; }
      _deselectFreehand(); deactivateRectMode(); deactivatePolyMode(); deactivateOvalMode();
      activateBezierMode();
    } else { // freehand
      deactivateRectMode(); deactivatePolyMode(); deactivateOvalMode(); deactivateBezierMode();
      freehandTool.activate();
    }
    setTool(name);
  });
});

// ── Copy / Paste / Flip ───────────────────────────────────────────────────────

let _clipboard = null; // { type: 'rect'|'freehand', data }

function _copySelected() {
  const ri = getSelectedRect();
  if (ri) { _clipboard = { type: 'rect', data: ri }; return; }
  if (_selFreehand) {
    _clipboard = { type: 'freehand', data: _selFreehand.pts.map(p => ({...p})) };
  }
}

function _pasteClipboard() {
  if (!_clipboard) return;
  const { pitch } = getParams();
  if (_clipboard.type === 'rect') {
    pasteRect(_clipboard.data, pitch);
    updateStatus();
    updateSelInfo();
  } else if (_clipboard.type === 'freehand') {
    const offsetPts = _clipboard.data.map(p => ({ x: p.x + pitch, y: p.y + pitch }));
    const { items, count, markCount, snappedPts } = renderPiece(offsetPts);
    _deselectFreehand();
    const newPiece = { pts: offsetPts, items, count, markCount, snappedPts };
    pieces.push(newPiece);
    _selectFreehand(newPiece);
    deduplicateCorners();
    updateStatus();
  }
}

function _flipSelected(axis) {
  const ri = getSelectedRect();
  if (ri) { flipSelectedRect(axis); updateSelInfo(); return; }
  if (_selFreehand) {
    const p = _selFreehand;
    // Mirror freehand pts across the piece's own centre
    const cx = (p.pts[0].x + p.pts[p.pts.length - 1].x) / 2;
    const cy = (p.pts[0].y + p.pts[p.pts.length - 1].y) / 2;
    const flipped = p.pts.map(pt => axis === 'h'
      ? { x: 2 * cx - pt.x, y: pt.y }
      : { x: pt.x, y: 2 * cy - pt.y });
    p.items.forEach(item => item.remove());
    const { items, count, markCount, snappedPts } = renderPiece(flipped);
    if (_selFreehand === p) { items[0].strokeColor = '#5bb3f5'; items[0].strokeWidth = 1.5; }
    p.pts = flipped; p.items = items; p.count = count;
    p.markCount = markCount; p.snappedPts = snappedPts;
    deduplicateCorners();
    updateStatus(); updateSelInfo();
  }
}

// ── T-Pocket template ─────────────────────────────────────────────────────────

function _createTPocket(params = DEFAULT_PARAMS) {
  const clamped = clampParams(params);
  // Center on visible canvas area
  const { margin } = getParams();
  const canvasW = toMm(canvasEl.width / (window.devicePixelRatio || 1));
  const canvasH = toMm(canvasEl.height / (window.devicePixelRatio || 1));
  const ox = Math.max(margin + 5, (canvasW - clamped.tw) / 2);
  const oy = Math.max(margin + 5, (canvasH - clamped.h)  / 2);
  const pts  = translatePts(tpocketVertices(clamped), ox, oy);
  const poly = { pts, edges: tpocketEdges(), tpocketParams: { ...clamped }, items: [] };
  return poly;
}

function _updateTPocketParams(poly, key, value) {
  const params = clampParams({ ...poly.tpocketParams, [key]: value });
  poly.tpocketParams = params;
  // Preserve translation — use first vertex (outer top-left) as anchor
  const ox = poly.pts[0].x, oy = poly.pts[0].y;
  poly.pts = translatePts(tpocketVertices(params), ox, oy);
  rerenderPoly(poly);
  updateSelInfo();
}

// Wire T-Pocket button in Shapes tab Templates section
document.getElementById('btn-tpocket')?.addEventListener('click', () => {
  deactivateRectMode(); deactivatePolyMode(); deactivateOvalMode();
  // Switch to poly mode so the T-pocket can be selected/moved via poly-tool
  activatePolyMode();
  setTool('poly');
  // Inject T-pocket into poly-tool's _polys array via poly creation API
  const poly = _createTPocket();
  // Use poly-tool's internal commit path by dispatching to poly-tool
  // We call rerenderPoly which requires poly to already be in _polys.
  // To avoid tight coupling we use poly-tool's getAllPolys() reference:
  getAllPolys().push(poly);
  _zAdd('poly', poly);
  selectPoly(poly);   // sets _selected → getSelectedPoly() works in Piece tab
  rerenderPoly(poly); // renders items + handles, triggers _onChange → status/selInfo
});

// Wire View tab Export buttons
document.getElementById('btn-export-svg')?.addEventListener('click', () => {
  downloadSVG(pieces, getAllRects(), getAllPolys());
});

// ── Alignment tools ───────────────────────────────────────────────────────────

function _getBbox(kind, ref) {
  if (kind === 'freehand') {
    const xs = ref.pts.map(p => p.x), ys = ref.pts.map(p => p.y);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  }
  if (kind === 'rect')    return { minX: ref.x, maxX: ref.x+ref.w, minY: ref.y, maxY: ref.y+ref.h };
  if (kind === 'poly' || kind === 'bezier') {
    const pts = kind === 'bezier' ? ref.segs.map(s => s.pt) : ref.pts;
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  }
  return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
}

function _movePiece(kind, ref, dx, dy) {
  if (kind === 'freehand') {
    const newPts = ref.pts.map(p => ({ x: p.x+dx, y: p.y+dy }));
    ref.items.forEach(i => i.remove());
    const { items, count, markCount, snappedPts } = renderPiece(newPts);
    ref.pts = newPts; ref.items = items; ref.count = count;
    ref.markCount = markCount; ref.snappedPts = snappedPts;
  } else if (kind === 'rect') {
    moveRectTo(ref, ref.x + dx, ref.y + dy);
  } else if (kind === 'poly' || kind === 'trap') {
    ref.pts = ref.pts.map(p => ({ x: p.x+dx, y: p.y+dy }));
    if (ref.tpocketParams) {
      ref.tpocketParams = { ...ref.tpocketParams };
    }
    rerenderPoly(ref);
  }
}

function _alignAll(axis) {
  if (_multiSel.length < 2) return;
  const boxes  = _multiSel.map(s => ({ ...s, bbox: _getBbox(s.kind, s.ref) }));
  let target;
  if (axis === 'left')    target = Math.min(...boxes.map(b => b.bbox.minX));
  if (axis === 'right')   target = Math.max(...boxes.map(b => b.bbox.maxX));
  if (axis === 'top')     target = Math.min(...boxes.map(b => b.bbox.minY));
  if (axis === 'bottom')  target = Math.max(...boxes.map(b => b.bbox.maxY));
  if (axis === 'centerH') target = (Math.min(...boxes.map(b=>b.bbox.minX)) + Math.max(...boxes.map(b=>b.bbox.maxX))) / 2;
  if (axis === 'centerV') target = (Math.min(...boxes.map(b=>b.bbox.minY)) + Math.max(...boxes.map(b=>b.bbox.maxY))) / 2;

  boxes.forEach(({ kind, ref, bbox }) => {
    let dx = 0, dy = 0;
    if (axis === 'left')    dx = target - bbox.minX;
    if (axis === 'right')   dx = target - bbox.maxX;
    if (axis === 'top')     dy = target - bbox.minY;
    if (axis === 'bottom')  dy = target - bbox.maxY;
    if (axis === 'centerH') dx = target - (bbox.minX + bbox.maxX) / 2;
    if (axis === 'centerV') dy = target - (bbox.minY + bbox.maxY) / 2;
    if (dx !== 0 || dy !== 0) _movePiece(kind, ref, dx, dy);
  });
  deduplicateCorners();
  updateStatus();
}

// Wire align buttons (wired after HTML loads; IDs match index.html)
document.getElementById('btn-align-left')   ?.addEventListener('click', () => _alignAll('left'));
document.getElementById('btn-align-right')  ?.addEventListener('click', () => _alignAll('right'));
document.getElementById('btn-align-top')    ?.addEventListener('click', () => _alignAll('top'));
document.getElementById('btn-align-bottom') ?.addEventListener('click', () => _alignAll('bottom'));
document.getElementById('btn-align-ch')     ?.addEventListener('click', () => _alignAll('centerH'));
document.getElementById('btn-align-cv')     ?.addEventListener('click', () => _alignAll('centerV'));

// Wire Shapes tab Edit buttons
document.getElementById('btn-copy')  ?.addEventListener('click', _copySelected);
document.getElementById('btn-paste') ?.addEventListener('click', _pasteClipboard);
document.getElementById('btn-flip-h')?.addEventListener('click', () => _flipSelected('h'));
document.getElementById('btn-flip-v')?.addEventListener('click', () => _flipSelected('v'));

// Enable/disable edit buttons based on selection
function _syncEditBtns() {
  const hasSel   = !!getSelectedRect() || !!_selFreehand || _multiSel.length > 0;
  const hasMulti = _multiSel.length >= 2;
  const hasCB    = !!_clipboard;
  ['btn-copy', 'btn-flip-h', 'btn-flip-v'].forEach(id => {
    const el = document.getElementById(id); if (el) el.disabled = !hasSel;
  });
  const pasteEl = document.getElementById('btn-paste');
  if (pasteEl) pasteEl.disabled = !hasCB;
  ['btn-align-left','btn-align-right','btn-align-top',
   'btn-align-bottom','btn-align-ch','btn-align-cv'].forEach(id => {
    const el = document.getElementById(id); if (el) el.disabled = !hasMulti;
  });
}
_syncEditBtns();

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key === 'c') { _copySelected();    _syncEditBtns(); e.preventDefault(); }
  if (ctrl && e.key === 'v') { _pasteClipboard();  _syncEditBtns(); e.preventDefault(); }
  if (ctrl && e.key === 'd') { _copySelected(); _pasteClipboard(); _syncEditBtns(); e.preventDefault(); } // duplicate
});

// ── Freehand drawing tool ─────────────────────────────────────────────────────

let activePath = null;
let ghost      = null;

function clearGhost() {
  if (ghost) { ghost.remove(); ghost = null; }
}

function cancelDraw() {
  clearGhost();
  if (activePath) { activePath.remove(); activePath = null; }
}

const freehandTool = new paper.Tool();

freehandTool.onMouseDown = (event) => {
  // Alt+click: cycle through overlapping objects
  if (event.modifiers?.alt) { _zAltClick(event.point); return; }

  // Trace image move (when not drawing and no piece hit)
  if (!activePath && handleTraceMouseDown(event.point)) return;

  // If not drawing: check for piece hit first
  if (!activePath) {
    const hit = _findFreehandAt(event.point);
    if (hit) {
      // Check if it belongs to a group — select the whole group
      const grp = _groupOf(hit);
      if (event.modifiers?.shift) {
        // Shift+click: toggle piece in multi-select
        if (_msIn(hit)) _msRemove(hit);
        else { _msAdd('freehand', hit); _selectFreehand(hit); }
        return;
      }
      if (grp) {
        _msClear(); _selectGroup(grp);
      } else {
        if (_selFreehand !== hit) { _msClear(); _selectFreehand(hit); }
      }
      // Snapshot original positions for group move
      _multiSel.forEach(s => {
        if (s.kind === 'freehand') {
          s.origX = s.ref.pts[0].x; s.origY = s.ref.pts[0].y;
          s.ref._origPts = s.ref.pts.map(p => ({...p})); // full pts snapshot
        } else {
          s.origX = s.ref.x; s.origY = s.ref.y;
        }
      });
      _fhDragPiece   = hit;
      _fhDragStart   = event.point;
      _fhDragOrigPts = hit.pts.map(p => ({ x: p.x, y: p.y }));
      return;
    }
    _deselectFreehand();
    _msClear();
    _fhDragPiece = null;
  }

  // Normal drawing
  if (event.count === 2) {
    clearGhost();
    if (activePath) { finalizePath(activePath); activePath = null; }
    return;
  }
  if (!activePath) {
    stitchLayer.activate();
    activePath = new paper.Path({ strokeColor: '#2c7bb6', strokeWidth: 1, opacity: 0.5 });
  }
  // Apply grid snap and optional Shift angle-snap
  let ptMm = _snapToGridMm(toMm(event.point.x), toMm(event.point.y));
  if (event.modifiers?.shift && activePath.segments.length > 0) {
    const last = activePath.lastSegment.point;
    const lastMm = { x: toMm(last.x), y: toMm(last.y) };
    const dx = ptMm.x - lastMm.x, dy = ptMm.y - lastMm.y;
    const len = Math.sqrt(dx*dx + dy*dy);
    if (len > 0.01) {
      const snappedAngle = Math.round(Math.atan2(dy, dx) / (Math.PI/4)) * (Math.PI/4);
      ptMm = { x: lastMm.x + len * Math.cos(snappedAngle), y: lastMm.y + len * Math.sin(snappedAngle) };
    }
  }
  activePath.add(new paper.Point(px(ptMm.x), px(ptMm.y)));
};

freehandTool.onMouseDrag = (event) => {
  if (handleTraceMouseDrag(event.point)) return;
  if (!_fhDragPiece) return;
  let dx = toMm(event.point.x - _fhDragStart.x);
  let dy = toMm(event.point.y - _fhDragStart.y);
  const proposedPts = _fhDragOrigPts.map(p => ({ x: p.x + dx, y: p.y + dy }));

  // Snap if enabled
  const { snapVertices, snapMidpoints } = getParams();
  if (snapVertices || snapMidpoints) {
    const types = { vertices: snapVertices, midpoints: snapMidpoints };
    const movingSnap = _freehandSnapPoints({ pts: proposedPts }, types);

    // Targets: other freehand pieces + all rects
    const targetSnap = [];
    for (const p of pieces) {
      if (p !== _fhDragPiece) targetSnap.push(..._freehandSnapPoints(p, types));
    }
    targetSnap.push(...getRectSnapPoints(types));

    const { dx: sdx, dy: sdy } = _computeSnap(movingSnap, targetSnap);
    dx += sdx;  dy += sdy;

    const snappedTo = sdx !== 0 || sdy !== 0;
    _showFhSnapAt(snappedTo
      ? { x: proposedPts[0].x + sdx, y: proposedPts[0].y + sdy }
      : null);
  } else {
    _showFhSnapAt(null);
  }

  const newPts = _fhDragOrigPts.map(p => ({ x: p.x + dx, y: p.y + dy }));

  // Move all group/multi-sel members together (excluding the dragged piece itself)
  if (_multiSel.length > 1 && _msIn(_fhDragPiece)) {
    const baseDx = newPts[0].x - _fhDragOrigPts[0].x;
    const baseDy = newPts[0].y - _fhDragOrigPts[0].y;
    _multiSel.forEach(({ kind, ref, origX, origY }) => {
      if (ref === _fhDragPiece) return;
      if (kind === 'rect')      moveRectTo(ref, origX + baseDx, origY + baseDy);
      if (kind === 'freehand') {
        const movedPts = ref.pts.map((p, i) => ({
          x: (ref._origPts?.[i]?.x ?? p.x) + baseDx,
          y: (ref._origPts?.[i]?.y ?? p.y) + baseDy,
        }));
        ref.items.forEach(i => i.remove());
        const { items, count, markCount, snappedPts } = renderPiece(movedPts);
        if (_selFreehand === ref) { items[0].strokeColor = '#5bb3f5'; items[0].strokeWidth = 1.5; }
        ref.pts = movedPts; ref.items = items;
        ref.count = count; ref.markCount = markCount; ref.snappedPts = snappedPts;
      }
    });
    _drawSelBox();
  }

  _fhDragPiece.items.forEach(item => item.remove());
  const { items, count, markCount, snappedPts } = renderPiece(newPts);
  if (_selFreehand === _fhDragPiece) {
    items[0].strokeColor = '#5bb3f5';
    items[0].strokeWidth = 1.5;
  }
  _fhDragPiece.items    = items;
  _fhDragPiece.count    = count;
  _fhDragPiece.markCount = markCount;
  _fhDragPiece.snappedPts = snappedPts;
  _fhDragPiece.pts      = newPts;
  updateSelInfo();
};

freehandTool.onMouseUp = () => {
  if (handleTraceMouseUp()) return;
  if (_fhDragPiece) {
    _fhDragPiece = null;
    _showFhSnapAt(null);
    deduplicateCorners();
    updateStatus();
  }
};

freehandTool.onMouseMove = (event) => {
  if (!activePath || activePath.segments.length === 0) return;
  clearGhost();
  stitchLayer.activate();
  ghost = new paper.Path({
    segments: [activePath.lastSegment.point, event.point],
    strokeColor: '#2c7bb6',
    strokeWidth: 0.75,
    opacity: 0.35,
    dashArray: [4, 4],
  });
};

freehandTool.onKeyDown = (event) => {
  if (event.key === 'enter' && activePath) {
    clearGhost();
    finalizePath(activePath);
    activePath = null;
  }
  if (event.key === 'escape') cancelDraw();
};

// Freehand is the default active tool
freehandTool.activate();
