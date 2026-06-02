// ui/render.js — shared rendering utilities used by both canvas.js and rect-tool.js

// 1 mm = 3.7795 px at 96 DPI — matches browser print scale so screen ≈ real size
export const PX_PER_MM = 3.78;
export const px   = mm  => mm  * PX_PER_MM;
export const toMm = pxV => pxV / PX_PER_MM;

/**
 * Create a single stitch mark as a paper.js item.
 * Caller must activate the correct layer before calling.
 * @param {{ x, y, angle }} mark
 * @param {'hole'|'dot'|'slash-fwd'|'slash-back'} markType
 * @returns {paper.Item}
 */
export function createMark(mark, markType) {
  const c = new paper.Point(px(mark.x), px(mark.y));
  const r = Math.max(px(0.5), 2); // 1 mm diameter, min 2px so marks stay visible

  if (markType === 'hole') {
    const circle = new paper.Path.Circle(c, r);
    circle.strokeColor = '#c0392b';
    circle.strokeWidth = 0.8;
    circle.data = { isMark: true };
    return circle;
  }

  if (markType === 'dot') {
    const circle = new paper.Path.Circle(c, r);
    circle.fillColor = '#c0392b';
    circle.data = { isMark: true };
    return circle;
  }

  // slash-fwd / slash-back — 2 mm line rotated to local tangent ± 45°
  const angle = markType === 'slash-fwd'
    ? mark.angle + Math.PI / 4
    : mark.angle - Math.PI / 4;
  const len = px(1);
  const dx  = Math.cos(angle) * len;
  const dy  = Math.sin(angle) * len;
  const slash = new paper.Path({
    segments: [
      new paper.Point(c.x - dx, c.y - dy),
      new paper.Point(c.x + dx, c.y + dy),
    ],
    strokeColor: '#c0392b',
    strokeWidth: 1,
  });
  slash.data = { isMark: true };
  return slash;
}
