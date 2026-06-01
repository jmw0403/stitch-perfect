// ui/annotation-tool.js — Text boxes and dimension lines
// These are canvas-level annotations: not stitch objects, not exported as cut lines.
// They ARE included in SVG export as <text> and <line> elements.

import { px, toMm } from './render.js';
import { getParams } from './controls.js';

// ── State ─────────────────────────────────────────────────────────────────────

const _annotations = []; // all placed annotations
let _annTool  = null;
let _layers   = null;
let _onChange = () => {};

let _annMode  = null;   // 'text' | 'dim'
let _drawState = null;  // for dim: { startPt }
let _selected  = null;
let _dragState = null;  // { startPt, origX, origY }

// ── Init ──────────────────────────────────────────────────────────────────────

export function initAnnotationTool(layers, onChangeFn) {
  _layers   = layers;
  if (onChangeFn) _onChange = onChangeFn;

  _annTool = new paper.Tool();

  _annTool.onMouseDown = (event) => {
    // Click existing annotation to select / drag
    const hit = _hitAny(event.point);
    if (hit && _annMode === null) {
      _selected = hit;
      _dragState = { startPt: event.point, origX: hit.x, origY: hit.y };
      return;
    }

    // Text box: click to place
    if (_annMode === 'text') {
      const x = toMm(event.point.x), y = toMm(event.point.y);
      const ann = { type: 'text', x, y, text: 'Label', fontSize: 11, items: [] };
      ann.items = _renderAnn(ann);
      _annotations.push(ann);
      _selected = ann;
      _annMode = null;
      activateAnnotationMode(null); // go back to select mode
      _onChange();
      // Prompt for text
      const t = window.prompt('Enter text:', ann.text);
      if (t !== null) { ann.text = t; ann.items.forEach(i=>i.remove()); ann.items = _renderAnn(ann); _onChange(); }
      return;
    }

    // Dimension: click first point
    if (_annMode === 'dim') {
      if (!_drawState) {
        _drawState = { startPt: { x: toMm(event.point.x), y: toMm(event.point.y) } };
      } else {
        const ex = toMm(event.point.x), ey = toMm(event.point.y);
        const sx = _drawState.startPt.x, sy = _drawState.startPt.y;
        const dx = ex-sx, dy = ey-sy;
        const dist = Math.sqrt(dx*dx + dy*dy);
        const ann = { type: 'dim', x1: sx, y1: sy, x2: ex, y2: ey,
                      label: `${dist.toFixed(1)} mm`, items: [] };
        ann.items = _renderAnn(ann);
        _annotations.push(ann);
        _drawState = null;
        _selected = ann;
        _annMode = null;
        activateAnnotationMode(null);
        _onChange();
      }
      return;
    }

    // Click empty — deselect
    _selected = null;
    _dragState = null;
  };

  _annTool.onMouseDrag = (event) => {
    if (_dragState && _selected) {
      const dx = toMm(event.point.x - _dragState.startPt.x);
      const dy = toMm(event.point.y - _dragState.startPt.y);
      _selected.x = _dragState.origX + dx;
      _selected.y = _dragState.origY + dy;
      if (_selected.type === 'dim') {
        _selected.x1 = _dragState.origX + dx;
        _selected.y1 = _dragState.origY + dy;
        _selected.x2 = (_dragState.origX2||_selected.x2) + dx;
        _selected.y2 = (_dragState.origY2||_selected.y2) + dy;
      }
      _selected.items.forEach(i=>i.remove());
      _selected.items = _renderAnn(_selected);
    }
  };

  _annTool.onMouseUp = () => { _dragState = null; };

  _annTool.onKeyDown = (event) => {
    if ((event.key==='delete'||event.key==='backspace') && _selected) {
      _selected.items.forEach(i=>i.remove());
      _annotations.splice(_annotations.indexOf(_selected),1);
      _selected = null;
      _onChange();
    }
    if (event.key==='escape') { _drawState=null; _annMode=null; _selected=null; }
  };
}

export function activateAnnotationMode(mode) {
  // mode: 'text' | 'dim' | null (select existing)
  _annMode   = mode;
  _drawState = null;
  if (_annTool) _annTool.activate();
}

export function deactivateAnnotationMode() {
  _annMode = null; _drawState = null; _selected = null;
}

export function getAllAnnotations() { return _annotations; }

export function redrawAllAnnotations() {
  _annotations.forEach(a => { a.items.forEach(i=>i.remove()); a.items = _renderAnn(a); });
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function _renderAnn(ann) {
  const items = [];
  _layers.stitchLayer.activate(); // annotations on stitch layer

  if (ann.type === 'text') {
    const t = new paper.PointText({
      point: new paper.Point(px(ann.x), px(ann.y)),
      content: ann.text,
      fontSize: ann.fontSize || 11,
      fillColor: '#333',
      fontFamily: 'system-ui, sans-serif',
    });
    items.push(t);
  } else if (ann.type === 'dim') {
    const { x1, y1, x2, y2, label } = ann;
    const dx = x2-x1, dy = y2-y1;
    const len = Math.sqrt(dx*dx+dy*dy);
    if (len < 0.1) return items;

    // Main line
    const line = new paper.Path({
      segments: [new paper.Point(px(x1),px(y1)), new paper.Point(px(x2),px(y2))],
      strokeColor: '#2c7bb6', strokeWidth: 0.8,
    });
    items.push(line);

    // Arrowheads
    const ang = Math.atan2(dy, dx);
    const arrowLen = 2.5; // mm
    const arrowAng = 0.4;
    for (const [ax,ay,dir] of [[x1,y1,1],[x2,y2,-1]]) {
      const arr = new paper.Path({
        segments: [
          new paper.Point(px(ax+dir*arrowLen*Math.cos(ang+arrowAng)), px(ay+dir*arrowLen*Math.sin(ang+arrowAng))),
          new paper.Point(px(ax), px(ay)),
          new paper.Point(px(ax+dir*arrowLen*Math.cos(ang-arrowAng)), px(ay+dir*arrowLen*Math.sin(ang-arrowAng))),
        ],
        strokeColor: '#2c7bb6', strokeWidth: 0.8,
      });
      items.push(arr);
    }

    // Label
    const perpAngle = ang - Math.PI/2;
    const mid = { x: (x1+x2)/2, y: (y1+y2)/2 };
    const t = new paper.PointText({
      point: new paper.Point(px(mid.x)+Math.cos(perpAngle)*10, px(mid.y)+Math.sin(perpAngle)*10),
      content: label,
      fontSize: 9,
      fillColor: '#2c7bb6',
      justification: 'center',
      fontFamily: 'system-ui, sans-serif',
    });
    items.push(t);
  }

  return items;
}

// ── Hit testing ───────────────────────────────────────────────────────────────

function _hitAny(point) {
  for (let i = _annotations.length-1; i >= 0; i--) {
    for (const item of _annotations[i].items) {
      if (item.hitTest?.(point, { fill: true, stroke: true, tolerance: 8 })) return _annotations[i];
    }
  }
  return null;
}

// ── SVG export ────────────────────────────────────────────────────────────────

export function annotationsToSVG() {
  return _annotations.map(a => {
    if (a.type === 'text') {
      return `<text x="${a.x.toFixed(2)}" y="${a.y.toFixed(2)}"
                    font-size="${a.fontSize||11}" fill="#333"
                    font-family="system-ui,sans-serif">${a.text}</text>`;
    }
    if (a.type === 'dim') {
      const { x1, y1, x2, y2, label } = a;
      const ang = Math.atan2(y2-y1, x2-x1);
      const perp = ang - Math.PI/2;
      const mx = (x1+x2)/2, my = (y1+y2)/2;
      return `<g stroke="#2c7bb6" fill="none">
        <line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke-width="0.3"/>
        <text x="${(mx+Math.cos(perp)*2.5).toFixed(2)}" y="${(my+Math.sin(perp)*2.5).toFixed(2)}"
              font-size="2.5" fill="#2c7bb6" text-anchor="middle" font-family="system-ui,sans-serif">
          ${label}
        </text>
      </g>`;
    }
    return '';
  }).join('\n');
}
