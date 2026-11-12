// ============================================
// LABEL LAYOUT — names that don't sit on each other
// ============================================
// Pure: given the labels a frame wants to draw (canvas px, centred on x, top
// at y), place the most important first; each later one keeps its spot if it
// is clear, else steps a line down, then up, then further, and is left out
// when every step is taken. A label marked `always` (the one under the mouse)
// is never left out — it keeps its own spot if nothing clears. No DOM, no
// canvas: the caller measures the text (ui/innerMapLayers/entities.js).

/** Do two boxes {x0, y0, x1, y1} overlap (touching edges do not)? */
function _hit(a, b) {
    return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/**
 * labels: [{ x, y, w, h, priority?, always? , ...anything }] — x the centre,
 * y the top, w/h the box. opts: { gap = 1 (px between stacked lines),
 * steps = 2 (lines tried each way), pad = 1 (px kept clear round a box) }.
 * Returns a new array, in the input order, of { ...label, dy, hidden }:
 * draw at y + dy unless hidden.
 */
export function layoutLabels(labels, opts = {}) {
    const list = Array.isArray(labels) ? labels : [];
    const gap = Number.isFinite(opts.gap) ? opts.gap : 1;
    const steps = Number.isFinite(opts.steps) ? Math.max(0, opts.steps) : 2;
    const pad = Number.isFinite(opts.pad) ? opts.pad : 1;
    const order = list.map((l, i) => i).sort((a, b) => {
        const A = list[a], B = list[b];
        return ((B.always ? 1 : 0) - (A.always ? 1 : 0))
            || ((Number(B.priority) || 0) - (Number(A.priority) || 0))
            || (a - b);
    });
    const placed = [];
    const out = new Array(list.length);
    for (const i of order) {
        const l = list[i];
        const w = Math.max(0, Number(l.w) || 0), h = Math.max(0, Number(l.h) || 0);
        const box = dy => ({ x0: l.x - w / 2 - pad, x1: l.x + w / 2 + pad, y0: l.y + dy - pad, y1: l.y + dy + h + pad });
        // Its own spot, then a line below, a line above, two below, two above…
        const tries = [0];
        for (let k = 1; k <= steps; k++) tries.push(k * (h + gap), -k * (h + gap));
        let dy = null;
        for (const t of tries) {
            const b = box(t);
            if (!placed.some(p => _hit(p, b))) { dy = t; break; }
        }
        if (dy == null && l.always) dy = 0;
        if (dy == null) { out[i] = { ...l, dy: 0, hidden: true }; continue; }
        placed.push(box(dy));
        out[i] = { ...l, dy, hidden: false };
    }
    return out;
}

/**
 * A label's priority: under the mouse first, then whoever stands nearest the
 * player, a little more for someone at a stall or the player is speaking with.
 * distTiles: tiles from the player; flags: { hovered, keeper, engaged }.
 */
export function labelPriority(distTiles, flags = {}) {
    let p = 100 - Math.min(100, Math.max(0, Number(distTiles) || 0) * 4);
    if (flags.keeper) p += 15;
    if (flags.engaged) p += 40;
    if (flags.hovered) p += 1000;
    return p;
}
