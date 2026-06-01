# StitchPerfect — Project Plan

**App name:** StitchPerfect  
**Domain:** stitchperfect.app (live ✅)  
**GitHub:** github.com/jmw0403/stitch-perfect  
**Local folder:** C:\Users\John Wilkerson\Projects\leather-stitch-tool

---

## Product Thesis

Traditional leatherwork cuts the piece first, then hopes the stitches space evenly — they
rarely do. **This tool inverts the process: pitch is sacred; piece dimensions flex to absorb
the remainder.** A fraction-of-a-millimeter adjustment is invisible to the eye. Because every
mating piece is adjusted by the same rule, parts still fit each other.

> **Move the leather, never the stitch.**

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Language | JavaScript ES modules | Browser, no build step |
| Canvas | paper.js | Bézier, hit-testing, node editing |
| Polygon offset | Clipper2-wasm | Industry-standard, handles corners |
| Styling | Plain CSS | No framework needed |
| Testing | Node + assertions | Engine testable without browser |
| Hosting | Vercel → stitchperfect.app | Static, push-to-deploy |

---

## Status Overview (as of 2026-06-01)

| Phase | Status | What |
|---|---|---|
| 1 | ✅ Done | Geometry engine (stitch, flatten, offset) |
| 2 | ✅ Done | Canvas shell (paper.js, basic drawing) |
| 3 | ✅ Done | Parameter panel (pitch, margin, mark type) |
| 3.5 | ✅ Done | Rect tool, snap, dim labels, corner dedup |
| 3.52 | ✅ Done | Four-tab panel (Shapes/Stitch/Piece/View) |
| 3.55a | ✅ Done | Copy/paste (Ctrl+C/V/D), flip H/V |
| 3.55b | ✅ Done | Multi-select, Group/Ungroup (Ctrl+G) |
| 3.55c | ✅ Done | Z-order (Alt+click, Fwd/Back) |
| 3.6 | ✅ Done | Polygon tool, Oval, Trap, per-edge states |
| 3.65 | ✅ Done | T-Pocket template (5 constrained handles) |
| 3.7 | ✅ Done | Bezier pen, shift angle-snap, align tools, image trace |
| 4 | ✅ Done | SVG export (1mm=1mm, all types, scale bar) |
| 4.6 | ✅ Done | Oval/Trap fixes, page overlay, grid, solid outline |
| Fixes | ✅ Done | Select tool default, poly cut outside, sharp corners, fuse |
| 5 | ✅ Done | GitHub + Vercel → stitchperfect.app live |

---

## Core Geometric Rules

1. Marks are source of truth. A stitch = span between two adjacent marks.
2. Every run starts and ends on a mark.
3. No partial stitches. Open run N stitches → N+1 marks, length = N × pitch.
4. **Pitch fixed, dimension flexes.** Snap to nearest whole stitch; never alter pitch.
5. Corners get marks. Each edge is an independent run.
6. Curves spaced by arc length (flatten.js → polyline before mark placement).
7. Cut line = stitch line offset outward by margin (Clipper2).
8. Stitch line is master. Any change re-derives cut line and marks.
9. Mated seams carry equal stitch counts.

---

## Build Order — Remaining Work

### Phase 3.7 — Remaining Workflow Improvements *(partial — see accomplished above)*

**Per-object visibility toggles** *(NEW — requested 2026-06-01)*
Currently Stitch/Cut outline/Dimensions toggles in View tab apply to ALL objects globally.
Need per-object overrides so a single piece can be set differently from others.

- [ ] Each piece stores `{ showStitch, showCut, showDims }` — defaults to `null` (= use global)
- [ ] Piece tab shows 3 small toggles: "Override" → when on, per-piece setting overrides global
- [ ] Use case: hide cut outline on a construction-line freehand piece while showing it on all rects
- [ ] SVG export respects per-piece settings

**Horizontal / Vertical midpoint marks** *(NEW — requested 2026-06-01)*
- [ ] When a piece is selected, show cross-hair guide lines at the piece's horizontal and
      vertical centre — thin light lines (not printed) that extend across the canvas
- [ ] Helps with positioning: user can visually align centres without needing a grid
- [ ] Toggle in View → Show (alongside Dimensions, Cut outline, Stitch line)

**Arc tool**
- [ ] Draw circular arcs: click centre, click radius point, drag to set angle
- [ ] Arc-length mark spacing via flatten.js (already supported)

**Layer system**
- [ ] Named layers (Body, Pockets, Construction lines)
- [ ] Toggle visibility; lock layer to prevent edits
- [ ] Objects assigned to a layer via Piece tab

**Coordinate input**
- [ ] Piece tab X/Y fields are editable — type exact mm to jump piece to position
- [ ] Tab key moves between X and Y

### Phase 3.55 — Remaining Manipulation

**Rubber-band multi-select**
- [ ] Click-drag on empty canvas to rubber-band select all enclosed pieces

**Boolean Fuse (Union)** *(partially done — button exists but needs refinement)*
- [x] Basic Clipper2 Union implemented for rect+rect and poly+poly
- [ ] Support fusing bezier + poly, freehand + poly (flatten first then union)
- [ ] After fuse: edge states inferred from original piece edges at each segment
- [ ] "Subtract" operation: cut one shape out of another (Clipper2 Difference)
- [ ] "Intersect" operation: keep only the overlapping area

**Click-near-endpoint UX fix**
- [ ] When snap is active and user clicks within snap threshold of existing endpoint,
      start a new snapped line rather than selecting the existing piece

### Phase 3.6 — Polygon / Shape Improvements

**Corner radius** *(already in plan)*
- [ ] Slider 0–N mm rounds cut outline corners; stitches follow the arc via flatten.js
- [ ] Per-piece setting (stored in piece data, not global)

**Cut-only / no-stitch mode refinement**
- [ ] When all edges are hidden: cut outline shown as solid line (done ✅)
- [ ] Toggle per piece: "This is a cut-only template piece" — no stitch math at all

**Polygon improvements**
- [ ] Snap polygon vertex to existing piece endpoints when drawing
- [ ] Close polygon by clicking within CLOSE_PX of first vertex (done ✅ for poly)

### Phase 3.65 — T-Pocket + Template Improvements

**T-Pocket**
- [x] 5-parameter prebuilt with constrained named handles
- [x] Top edge permanently locked (pocket mouth, never stitchable)
- [x] Cut-first rendering: pts = cut edge, stitch inset by margin
- [ ] Visual angle readout for the angled sides (matches the Phase 3.55 angle readout plan)
- [ ] "Flip H" produces mirror copy for right-side pocket

**More prebuilt templates** *(from original plan)*
- [ ] Gusset strip (long narrow rect, 2-side or 4-side stitch)
- [ ] D-ring slot (small rect with one stitched end)
- [ ] Bill divider (flat trapezoid, no stitching)
- [ ] Card window (rectangular cutout with stitched surround)
- [ ] Zipper pocket (rect with zipper-edge treatment)

### Phase 4 — Export Improvements

**SVG export** *(done ✅ — basic version)*
- [ ] Export includes per-piece visibility overrides (when per-object toggles done)
- [ ] Layer-aware export (separate SVG groups per layer)

**DXF export** *(for laser cutters)*
- [ ] Generate DXF from the same geometry pipeline as SVG
- [ ] Include stitch line, cut line, and mark positions

**Page layout overlay** *(done ✅ — basic)*
- [ ] Page border toggle shows A4/Letter/A3 on canvas
- [ ] Pieces arranged inside; export to scale within page

### Phase 4.5 — Annotations

**Dimension annotation tool**
- [ ] Click two points → dimension line with arrows and mm label
- [ ] Two modes: Pattern piece (outside cut outline) and Stitch line (inside)
- [ ] Included in SVG export as `<g>` (lines + text)

**Text box**
- [ ] Click to place; type inline
- [ ] Font size selector (8 / 11 / 14 pt at print scale)
- [ ] Included in SVG as `<text>` element
- [ ] Move like any object; resize bounding box

**Sheet header / footer**
- [ ] Project name, designer name, date (left/centre/right)
- [ ] Footer: page number + scale bar
- [ ] Toggled on/off independently

**Scale bar**
- [ ] Fixed-length reference (50 mm) rendered on canvas and in export
- [ ] Calibrates printer output (same function as Atelier Grinda "1 inch Scale" box)

### Phase 4.7 — Print / Export Tab + Multi-Page

**Dedicated Print tab** *(replaces export section in View tab)*
- [ ] Page size: A4 / Letter / A3 / Custom W×H
- [ ] Orientation: Portrait / Landscape
- [ ] Scale: 100% (1:1) / Fit / Custom %
- [ ] Margins: T/R/B/L in mm

**Multi-page tiling**
- [ ] When layout exceeds one page, tile across multiple pages automatically
- [ ] Preview: all pages shown as a grid thumbnail
- [ ] **Registration marks** at every page corner: crosshair (+) for alignment
- [ ] **Cut line** at page overlap: dashed line + ½ scissor icon ("——✂——")
- [ ] Overlap margin user-set (default 10mm) for taping pages together
- [ ] Export: one SVG per page (page-1.svg, page-2.svg …) or multi-page PDF

**Title block / watermark**
- [ ] Project name, designer, date, notes
- [ ] Optional "DRAFT" / "SAMPLE" watermark with opacity

**Template save / load**
- [ ] Save current canvas layout as a named template (localStorage)
- [ ] Export template as JSON; import from JSON

### Phase 5 — Deploy ✅

- [x] GitHub: github.com/jmw0403/stitch-perfect
- [x] Vercel: stitchperfect.app (live)
- [ ] Vercel auto-deploys on every push ✅

### Phase 6 — Help & Documentation *(NEW)*

**Comprehensive help page**
- [ ] Dedicated `/help` page at stitchperfect.app/help (or modal within the app)
- [ ] Table of contents with sections matching each tool/feature

**How-to videos** (screen recordings hosted on YouTube)
- [ ] Getting started: what pitch is, why dimensions flex, how to read the canvas
- [ ] Drawing tools: Line, Bezier, Rect, Oval, Trap, Poly — one video each
- [ ] T-Pocket template: drop, resize with handles, flip for mirror copy
- [ ] Edge states: stitched → open → hidden and when to use each
- [ ] Fusing shapes: combine Trap + Rect to make a T-pocket manually
- [ ] Exporting to SVG and printing at correct scale
- [ ] Assembly: overlaying pieces to verify seam alignment

**In-app help hints**
- [ ] "?" icon on each panel section → short tooltip explaining the control
- [ ] First-run walkthrough: a brief 5-step overlay for new users

**Reference card** (printable PDF)
- [ ] All keyboard shortcuts
- [ ] All tool interactions (click=corner, drag=smooth, etc.)
- [ ] Stitch math cheat-sheet (open run = N+1 marks, closed = N marks)

### Phase 7 — Mating Pieces + Assembled View *(was Phase 6)*

Inspired by Atelier Grinda bifold pattern (assembly pages):

**Assembled view**
- [ ] "Snap to mate" — drag one piece's edge onto another's, they lock
- [ ] Stitch count on both sides of a seam must match (engine enforces)
- [ ] Toggle assembled ↔ individual view
- [ ] Visual diff if counts don't match

**Mating engine**
- [ ] Master / dependent model (straight = master, curved = dependent)
- [ ] Uniform scale solver: k = L_target / L_current
- [ ] Chain-of-mates resolution (gusset → panel A → panel B)

---

## Open Decisions

| Decision | Status | Notes |
|---|---|---|
| Custom pitch beyond picklist | Open | Lock to list for v1; add free entry in v2 |
| Snapping anchor on dimension flex | Open | Pin corner, preserve aspect, or spread delta |
| Bézier flattening tolerance | Resolved | 0.1 mm default |
| Slash orientation at corners | Open | Per-segment vs. blended across vertex |
| Editing after commit (parametric?) | Open | Fully parametric preferred; frozen as fallback |
| Fold-edge allowance | Deferred v2 | Wrapped-top pockets need fold allowance ≠ stitch margin |
| Assembled view coupling UI | Phase 7 | How user snaps pieces and toggles views |
| Click-near-endpoint: select vs. new line | Open | When snap active near endpoint: new snapped line? or select? Current: selects |
| Corner stitch shared mark ownership | Open | For export: which piece owns the shared corner mark? |
| Inline editable W/H in Piece tab | Open | Type new value → snaps to nearest stitch pitch |
| Position origin for Piece tab X/Y | Open | Canvas origin vs. page-border origin when page is set |
| Grid snap size options | Open | Fixed 1mm, user-set, or equals stitch pitch |
| Per-piece vs. global visibility toggles | Open | See Phase 3.7 — per-object overrides now planned |
| PDF tracing background | Open | Requires PDF.js or server-side render; defer to v2 |
| Boolean Subtract / Intersect | Planned | Clipper2 Difference / Intersect ops alongside Union |
| STL export (3D jigs) | Open | LeatherCraft CAD has this — useful for punch jigs |

---

## Scale and Print Accuracy

- **Screen:** `PX_PER_MM = 3.78` (96 DPI). At 100% browser zoom, canvas ≈ real-world mm.
- **Canonical output = SVG/DXF export.** Export uses mm directly; dimensions exact at any DPI.
- **Calibration:** 50mm scale bar included in every SVG export (print, measure, confirm).

---

## Key Vocabulary

| Term | Definition |
|---|---|
| Pitch / stitch width | Distance between adjacent marks (mm). The sacred value. |
| Pricking iron | Toothed tool that marks evenly spaced holes. Tooth spacing = pitch. |
| Margin / edge distance | Distance from cut edge to stitch line. |
| Stitch line | The line marks sit on. Master geometry. |
| Cut line / ghost outline | Physical leather edge. Stitch line offset outward by margin. |
| Run | Continuous sequence of stitches; must be whole multiple of pitch. |
| Mark / stitch mark | Single hole, dot, or slash. Stitches span between adjacent marks. |
| Mated seam | Shared edge between two pieces that are sewn together. |
| Master piece | The piece whose stitch count is set first (usually rectilinear). |
| Dependent piece | The piece that deforms to match the master's count (usually curved). |
| Cut-first | Rendering mode where drawn pts = cut outline, stitch inset by margin (T-pocket). |
| Stitch-first | Rendering mode where drawn pts = stitch line, cut outline offset outward. |
| Boolean fuse | Combining two overlapping shapes into one via Clipper2 Union. |

---

## Completed Feature Log

*(Short record of when major features shipped)*

| Date | Feature |
|---|---|
| 2026-05-29 | Phases 1–3.5: Engine, canvas, rect tool, snap, dim labels |
| 2026-05-30 | Phase 3.52: Four-tab panel (Shapes/Stitch/Piece/View) |
| 2026-05-30 | Phase 3.55: Copy/paste, flip, multi-select, group, z-order |
| 2026-05-30 | Phase 3.6: Polygon, Oval, Trap tools |
| 2026-05-30 | Phase 3.65: T-Pocket template, constrained handles |
| 2026-05-30 | Phase 4: SVG export |
| 2026-05-30 | Phase 5: stitchperfect.app live |
| 2026-06-01 | Phase 4.6: Oval/Trap fix, page overlay, grid, solid outlines |
| 2026-06-01 | Phase 3.7: Bezier pen, shift snap, align tools, image trace |
| 2026-06-01 | Fixes: Select tool default, poly cut outside, fuse button, selection highlight |
| 2026-06-01 | T-pocket: cut-first rendering, locked top edge, sharp pattern corners |
