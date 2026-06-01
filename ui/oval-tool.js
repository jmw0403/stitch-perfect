// ui/oval-tool.js — Oval (ellipse) shape tool
// `paper` is a global set by the paper.js script tag.

import { placeMarks } from '../engine/stitch.js';
import { offsetPolyline } from '../engine/offset.js';
import { getParams } from './controls.js';
import { px, toMm, createMark } from './render.js';

const HANDLE_PX = 8;

let _layers   = null;
let _ovalTool = null;
let _onChange = () => {};
let _onAdded  = () => {};
let _onDeleted = () => {};

// ── State ─────────────────────────────────────────────────────────────────────

const _ovals  = []; // committed OvalPiece[]
let _selected = null;
let _handles  = []; // cardinal resize handles

let _drawState = null; // { start: {x,y}mm, draft: paper item }
let _moveState = null; // { startPt: paper.Point, origCx, origCy }
let _resizeState = null; // { handle: 'n'|'e'|'s'|'w', origOval }

// ── Parametric ellipse helpers ─────────────────────────────────────────────────

const ELLIPSE_STEPS = 72; // polyline resolution

function ellipsePolyline(cx, cy, rx, ry) {
  const pts = [];
  for (let i = 0; i < ELLIPSE_STEPS; i++) {
    const t = (2 * Math.PI * i) / ELLIPSE_STEPS;
    pts.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
  }
  pts.push({ ...pts[0] }); // close
  return pts;
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initOvalTool(layers, onChangeFn, onAddedFn, onDeletedFn) {
  _layers = layers;
  if (onChangeFn)  _onChange  = onChangeFn;
  if (onAddedFn)   _onAdded   = onAddedFn;
  if (onDeletedFn) _onDeleted = onDeletedFn;

  _ovalTool = new paper.Tool();

  _ovalTool.onMouseDown = (event) => {
    if (_resizeState || _moveState) return;

    // Check resize handle hit
    if (_selected) {
      const h = _hitHandle(event.point);
      if (h) { _startResize(h, event.point); return; }
    }

    // Click selected oval — start move
    if (_selected && _hitOval(_selected, event.point)) {
      _moveState = { startPt: event.point, origCx: _selected.cx, origCy: _selected.cy };
      return;
    }

    // Click any oval to select
    const hit = _hitAnyOval(event.point);
    if (hit) {
      if (hit !== _selected) { _deselect(); _select(hit); }
      return;
    }

    // Empty canvas: deselect and start drawing
    _deselect();
    _startDraw(event.point);
  };

  _ovalTool.onMouseDrag = (event) => {
    if (_drawState)   { _updateDraw(event.point);   return; }
    if (_moveState)   { _updateMove(event.point);   return; }
    if (_resizeState) { _updateResize(event.point); return; }
  };

  _ovalTool.onMouseUp = () => {
    if (_drawState)   _commitDraw();
    if (_moveState)   { _moveState = null; _onChange(); }
    if (_resizeState) { _resizeState = null; _onChange(); }
  };

  _ovalTool.onKeyDown = (event) => {
    if ((event.key === 'delete' || event.key === 'backspace') && _selected) {
      _deleteSelected();
    }
    if (event.key === 'escape') _deselect();
  };
}

export function activateOvalMode() { if (_ovalTool) _ovalTool.activate(); }
export function deactivateOvalMode() { _deselect(); }

export function redrawAllOvals() {
  _ovals.forEach(oval => {
    oval.items.forEach(i => i.remove());
    oval.items = _renderOval(oval);
  });
  if (_selected) _showHandles(_selected);
}

export function getOvalStats() {
  const { pitch } = getParams();
  let stitches = 0, marks = 0;
  _ovals.forEach(oval => {
    if (oval.edge !== 'stitched') return;
    const pts = ellipsePolyline(oval.cx, oval.cy, oval.rx, oval.ry);
    const { count } = placeMarks(pts, pitch, true);
    stitches += count; marks += count;
  });
  return { count: _ovals.length, stitches, marks };
}

export function getAllOvals() { return _ovals; }

// ── Rendering ─────────────────────────────────────────────────────────────────

function _renderOval(oval) {
  const { pitch, margin, markType, showStitchLine, showCutOutline, showDimensions } = getParams();
  const { cx, cy, rx, ry, edge } = oval;
  const items = [];
  const polyPts = ellipsePolyline(cx, cy, rx, ry);

  // Cut outline
  if (showCutOutline) {
    const rings = offsetPolyline(polyPts, margin, true);
    _layers.cutLayer.activate();
    for (const ring of rings) {
      items.push(new paper.Path({
        segments: ring.map(p => new paper.Point(px(p.x), px(p.y))),
        closed: true,
        strokeColor: '#aaa',
        strokeWidth: 0.75,
        dashArray: [4, 3],
      }));
    }
  }

  if (edge === 'stitched') {
    // Stitch outline (ellipse path)
    if (showStitchLine) {
      _layers.stitchLayer.activate();
      const ep = new paper.Path.Ellipse({
        center: new paper.Point(px(cx), px(cy)),
        radius: new paper.Size(px(rx), px(ry)),
      });
      ep.strokeColor = '#2c7bb6';
      ep.strokeWidth = 1;
      ep.fillColor   = null;
      items.push(ep);
    }

    // Marks (arc-length spaced)
    _layers.markLayer.activate();
    const { marks } = placeMarks(polyPts, pitch, true);
    for (const m of marks) items.push(createMark(m, markType));

    // Dimension label
    if (showDimensions) {
      _layers.stitchLayer.activate();
      items.push(new paper.PointText({
        point: new paper.Point(px(cx), px(cy - ry) - px(margin) - 8),
        content: `${(2*rx).toFixed(1)} × ${(2*ry).toFixed(1)} mm`,
        fontSize: 9,
        fillColor: '#4a8ab5',
        justification: 'center',
      }));
    }
  } else if (edge === 'open') {
    _layers.stitchLayer.activate();
    const ep = new paper.Path.Ellipse({
      center: new paper.Point(px(cx), px(cy)),
      radius: new paper.Size(px(rx), px(ry)),
    });
    ep.strokeColor = '#666';
    ep.strokeWidth = 0.75;
    ep.dashArray   = [3, 3];
    ep.fillColor   = null;
    items.push(ep);
  }
  // hidden — nothing drawn

  return items;
}

// ── Handles ───────────────────────────────────────────────────────────────────

const CARDINAL = ['n', 'e', 's', 'w'];

function _handlePos(oval, dir) {
  const { cx, cy, rx, ry } = oval;
  return ({
    n: new paper.Point(px(cx),      px(cy - ry)),
    e: new paper.Point(px(cx + rx), px(cy)),
    s: new paper.Point(px(cx),      px(cy + ry)),
    w: new paper.Point(px(cx - rx), px(cy)),
  })[dir];
}

function _showHandles(oval) {
  _clearHandles();
  _layers.handleLayer.activate();
  for (const dir of CARDINAL) {
    const c = _handlePos(oval, dir);
    const h = HANDLE_PX / 2;
    const sq = new paper.Path.Rectangle(
      new paper.Point(c.x - h, c.y - h), new paper.Size(HANDLE_PX, HANDLE_PX));
    sq.fillColor   = 'white';
    sq.strokeColor = '#2c7bb6';
    sq.strokeWidth = 1;
    sq.data = { dir };
    _handles.push(sq);
  }
}

function _clearHandles() { _handles.forEach(h => h.remove()); _handles = []; }

function _hitHandle(point) {
  for (const h of _handles) {
    if (point.getDistance(h.position) <= HANDLE_PX + 2) return h.data.dir;
  }
  return null;
}

// ── Selection ─────────────────────────────────────────────────────────────────

function _select(oval) {
  _selected = oval;
  _showHandles(oval);
  _onChange();
}

function _deselect() {
  _clearHandles();
  _selected = null;
  _onChange();
}

// ── Hit testing ───────────────────────────────────────────────────────────────

function _hitOval(oval, point) {
  const { cx, cy, rx, ry } = oval;
  const dx = toMm(point.x) - cx, dy = toMm(point.y) - cy;
  const dist = Math.sqrt((dx/rx)**2 + (dy/ry)**2);
  return Math.abs(dist - 1) < (8 / px(Math.max(rx, ry)));
}

function _hitAnyOval(point) {
  for (let i = _ovals.length - 1; i >= 0; i--) {
    if (_hitOval(_ovals[i], point)) return _ovals[i];
  }
  return null;
}

// ── Draw ──────────────────────────────────────────────────────────────────────

function _startDraw(point) {
  _drawState = { start: { x: toMm(point.x), y: toMm(point.y) } };
}

function _updateDraw(point) {
  if (!_drawState) return;
  const { start } = _drawState;
  const cx = (start.x + toMm(point.x)) / 2;
  const cy = (start.y + toMm(point.y)) / 2;
  const rx = Math.abs(toMm(point.x) - start.x) / 2;
  const ry = Math.abs(toMm(point.y) - start.y) / 2;

  if (_drawState.draft) _drawState.draft.remove();
  _layers.stitchLayer.activate();
  const draft = new paper.Path.Ellipse({
    center: new paper.Point(px(cx), px(cy)),
    radius: new paper.Size(px(rx), px(ry)),
  });
  draft.strokeColor = '#2c7bb6';
  draft.strokeWidth = 1;
  draft.opacity = 0.45;
  draft.fillColor = null;
  _drawState.draft = draft;
  _drawState.current = { cx, cy, rx, ry };
}

function _commitDraw() {
  if (!_drawState) return;
  if (_drawState.draft) _drawState.draft.remove();
  const cur = _drawState.current;
  _drawState = null;

  if (!cur || cur.rx < 2 || cur.ry < 2) return;

  const oval = { cx: cur.cx, cy: cur.cy, rx: cur.rx, ry: cur.ry,
                 edge: 'stitched', items: [] };
  oval.items = _renderOval(oval);
  _ovals.push(oval);
  _deselect();
  _select(oval);
  _onAdded(oval);
  _onChange();
}

// ── Move ──────────────────────────────────────────────────────────────────────

function _updateMove(point) {
  if (!_moveState || !_selected) return;
  const dx = toMm(point.x - _moveState.startPt.x);
  const dy = toMm(point.y - _moveState.startPt.y);
  _selected.cx = _moveState.origCx + dx;
  _selected.cy = _moveState.origCy + dy;
  _selected.items.forEach(i => i.remove());
  _selected.items = _renderOval(_selected);
  _showHandles(_selected);
}

// ── Resize ────────────────────────────────────────────────────────────────────

function _startResize(dir, point) {
  _resizeState = {
    dir,
    startPt: point,
    orig: { cx: _selected.cx, cy: _selected.cy,
            rx: _selected.rx, ry: _selected.ry },
  };
}

function _updateResize(point) {
  if (!_resizeState || !_selected) return;
  const { dir, startPt, orig } = _resizeState;
  const dmm = { x: toMm(point.x - startPt.x), y: toMm(point.y - startPt.y) };

  if (dir === 'e' || dir === 'w') {
    _selected.rx = Math.max(2, orig.rx + (dir === 'e' ? dmm.x : -dmm.x));
  } else {
    _selected.ry = Math.max(2, orig.ry + (dir === 's' ? dmm.y : -dmm.y));
  }

  _selected.items.forEach(i => i.remove());
  _selected.items = _renderOval(_selected);
  _showHandles(_selected);
}

// ── Edge cycle ────────────────────────────────────────────────────────────────

const _CYCLE = { stitched: 'open', open: 'hidden', hidden: 'stitched' };

export function cycleOvalEdge(oval) {
  oval.edge = _CYCLE[oval.edge] ?? 'open';
  oval.items.forEach(i => i.remove());
  oval.items = _renderOval(oval);
  if (_selected === oval) _showHandles(oval);
  _onChange();
}

export function getSelectedOval() {
  if (!_selected) return null;
  return { cx: _selected.cx, cy: _selected.cy, rx: _selected.rx, ry: _selected.ry,
           edge: _selected.edge };
}

// ── Delete ────────────────────────────────────────────────────────────────────

function _deleteSelected() {
  if (!_selected) return;
  _selected.items.forEach(i => i.remove());
  _clearHandles();
  _ovals.splice(_ovals.indexOf(_selected), 1);
  _onDeleted(_selected);
  _selected = null;
  _onChange();
}
