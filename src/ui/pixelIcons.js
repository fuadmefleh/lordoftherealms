// Pixel icons in place of emoji. The art is made with PixelLab
// (scripts/pixel_icons/: make_list.py picks the emoji, generate.py makes them,
// build_sheet.py packs assets/icons/pixel/icons.png and data/pixelIcons.json).
//
// Rather than touch the thousands of strings that carry an emoji, the swap is
// made where they reach the screen:
//   • the DOM: text nodes holding a mapped emoji get it replaced by a
//     <span class="px-ico"> drawing that cell of the sheet (a MutationObserver
//     keeps up with panels as they are rebuilt). Text React owns is left alone
//     (React keeps hold of its text nodes), as are inputs, selects and scripts.
//   • the canvas: CanvasRenderingContext2D fillText / strokeText draw a mapped
//     emoji as its icon, the words around it as before.
// An emoji with no icon stays an emoji. Settings → Pixel Icons turns it off
// (propertiesSettings.js `pixelIcons`).

import { DataLoader } from '../core/dataLoader.js';

const FE0F = '️';

/** The emoji → sheet cell manifest (data/pixelIcons.json via gamedata). */
function manifest() {
    const g = DataLoader._gamedata;
    return (g && g.pixelIcons) || null;
}

export const PixelIcons = {
    enabled: false,
    _re: null,
    _map: null,
    _img: null,
    _ready: false,
    _observer: null,
    _patched: false,
    _orig: null,

    /** Build the matcher from the manifest. → true when there are icons. */
    _build() {
        if (this._map) return this._map.size > 0;
        const m = manifest();
        this._map = new Map();
        if (!m || !m.icons) return false;
        for (const [e, cell] of Object.entries(m.icons)) this._map.set(e.split(FE0F).join(''), cell);
        if (!this._map.size) return false;
        // Longest first (a joined sequence before its first part); FE0F and skin tones optional
        const keys = [...this._map.keys()].sort((a, b) => b.length - a.length);
        const alt = keys.map(k => [...k].map(ch => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\uFE0F?') + '\\uFE0F?').join('|');
        this._re = new RegExp(`(?:${alt})(?:\\p{Emoji_Modifier})?`, 'gu');
        return true;
    },

    /** The cell of a matched emoji (FE0F and skin tone stripped), or undefined. */
    cellOf(match) {
        const key = String(match).split(FE0F).join('').replace(/\p{Emoji_Modifier}/gu, '');
        return this._map ? this._map.get(key) : undefined;
    },

    /** Does `text` hold an emoji that has an icon? */
    has(text) {
        if (!this._re || typeof text !== 'string' || !text) return false;
        this._re.lastIndex = 0;
        return this._re.test(text);
    },

    /** Split text into runs: strings and { emoji, cell }. */
    split(text) {
        const out = [];
        if (!this._re) return [text];
        this._re.lastIndex = 0;
        let last = 0;
        let m;
        while ((m = this._re.exec(text))) {
            if (m.index > last) out.push(text.slice(last, m.index));
            out.push({ emoji: m[0], cell: this.cellOf(m[0]) });
            last = m.index + m[0].length;
        }
        if (last < text.length) out.push(text.slice(last));
        return out;
    },

    /** Turn the swap on or off (loads the sheet the first time). */
    setEnabled(on) {
        on = !!on;
        if (on && !this._build()) on = false;
        this.enabled = on;
        if (typeof document === 'undefined') return on;
        if (on) {
            this._loadSheet();
            this._styleSheet();
            this._patchCanvas();
            this._startDom();
        } else {
            this._stopDom();
        }
        return on;
    },

    _loadSheet() {
        if (this._img || typeof Image === 'undefined') return;
        const m = manifest();
        const img = new Image();
        img.onload = () => { this._ready = true; };
        img.src = m.sheet;
        this._img = img;
    },

    _styleSheet() {
        if (document.getElementById('pxIconStyle')) return;
        const m = manifest();
        const cols = m.cols;
        const rows = Math.ceil(Object.keys(m.icons).length / cols) || 1;
        const st = document.createElement('style');
        st.id = 'pxIconStyle';
        st.textContent = `.px-ico{display:inline-block;width:1.2em;height:1.2em;vertical-align:-0.22em;`
            + `background-image:url("${m.sheet}");background-size:${cols * 100}% ${rows * 100}%;`
            + `background-repeat:no-repeat;image-rendering:pixelated;image-rendering:crisp-edges;}`;
        st.dataset.rows = String(rows);
        document.head.appendChild(st);
    },

    /** background-position for a cell. */
    _pos(cell) {
        const m = manifest();
        const cols = m.cols;
        // (the sheet's rows counted once per manifest: this runs for every icon swapped in)
        if (this._rowsOf !== m) { this._rowsOf = m; this._rows = Math.ceil(Object.keys(m.icons).length / cols) || 1; }
        const rows = this._rows;
        const c = cell % cols, r = Math.floor(cell / cols);
        const x = cols > 1 ? (c / (cols - 1)) * 100 : 0;
        const y = rows > 1 ? (r / (rows - 1)) * 100 : 0;
        return `${x}% ${y}%`;
    },

    // ── The DOM ──

    _skipEl(el) {
        for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
            const t = e.tagName;
            if (t === 'SCRIPT' || t === 'STYLE' || t === 'TEXTAREA' || t === 'INPUT' || t === 'SELECT' || t === 'OPTION'
                || t === 'TITLE' || t === 'CANVAS' || t === 'svg' || t === 'SVG' || e.isContentEditable) return true;
            if (e.classList && e.classList.contains('px-ico-off')) return true;
            if (e === el) {
                // text React renders is React's to update: leave it be
                // (React's markers are own expando keys, so Object.keys stays cheap)
                for (const k of Object.keys(e)) if (k.startsWith('__reactFiber') || k.startsWith('__reactProps')) return true;
            }
        }
        return false;
    },

    /** Replace the mapped emoji in one text node with icon spans. */
    _swapText(node) {
        const text = node.nodeValue;
        if (!this.has(text)) return;
        const parent = node.parentNode;
        if (!parent || this._skipEl(parent)) return;
        const frag = document.createDocumentFragment();
        for (const part of this.split(text)) {
            if (typeof part === 'string') { frag.appendChild(document.createTextNode(part)); continue; }
            if (part.cell === undefined) { frag.appendChild(document.createTextNode(part.emoji)); continue; }
            const s = document.createElement('span');
            s.className = 'px-ico';
            s.dataset.e = part.emoji;
            s.setAttribute('role', 'img');
            s.setAttribute('aria-label', part.emoji);
            s.style.backgroundPosition = this._pos(part.cell);
            frag.appendChild(s);
        }
        parent.replaceChild(frag, node);
    },

    _walk(root) {
        if (!root) return;
        if (root.nodeType === 3) { this._swapText(root); return; }
        if (root.nodeType !== 1 && root.nodeType !== 11) return;
        if (root.nodeType === 1 && this._skipEl(root)) return;
        const walker = document.createTreeWalker(root, 4 /* SHOW_TEXT */);
        const hits = [];
        for (let n = walker.nextNode(); n; n = walker.nextNode()) if (this.has(n.nodeValue)) hits.push(n);
        for (const n of hits) this._swapText(n);
    },

    _startDom() {
        if (this._observer || typeof MutationObserver === 'undefined' || !document.body) return;
        this._walk(document.body);
        this._pending = new Set();
        this._observer = new MutationObserver((list) => {
            for (const rec of list) {
                if (rec.type === 'characterData') this._pending.add(rec.target);
                else for (const n of rec.addedNodes) this._pending.add(n);
            }
            if (this._flushQueued) return;
            this._flushQueued = true;
            Promise.resolve().then(() => {
                this._flushQueued = false;
                const nodes = [...this._pending];
                this._pending.clear();
                for (const n of nodes) if (n.isConnected) this._walk(n);
            });
        });
        this._observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    },

    _stopDom() {
        if (this._observer) { this._observer.disconnect(); this._observer = null; }
        if (typeof document === 'undefined' || !document.querySelectorAll) return;
        for (const s of document.querySelectorAll('span.px-ico')) s.replaceWith(document.createTextNode(s.dataset.e || ''));
    },

    // ── The canvas ──

    /** Lay out a line: runs with their x offsets and the whole width, at the ctx's font. */
    _layout(ctx, text, fontPx) {
        const runs = [];
        let w = 0;
        for (const part of this.split(text)) {
            if (typeof part === 'string') {
                const pw = this._orig.measureText.call(ctx, part).width;
                runs.push({ text: part, x: w, w: pw });
                w += pw;
            } else if (part.cell === undefined) {
                const pw = this._orig.measureText.call(ctx, part.emoji).width;
                runs.push({ text: part.emoji, x: w, w: pw });
                w += pw;
            } else {
                const s = fontPx * 1.1;
                runs.push({ cell: part.cell, x: w, w: s });
                w += s;
            }
        }
        return { runs, w };
    },

    _fontPx(ctx) {
        const m = /(\d+(?:\.\d+)?)px/.exec(ctx.font || '');
        return m ? Number(m[1]) : 10;
    },

    /** Where the line starts (x) and the icons' top (y), by the ctx's alignment. */
    _anchor(ctx, x, y, w, fontPx) {
        const a = ctx.textAlign;
        const rtl = ctx.direction === 'rtl';
        let x0 = x;
        if (a === 'center') x0 = x - w / 2;
        else if (a === 'right' || (a === 'end' && !rtl) || (a === 'start' && rtl)) x0 = x - w;
        const b = ctx.textBaseline;
        const s = fontPx * 1.1;
        let top;
        if (b === 'top' || b === 'hanging') top = y;
        else if (b === 'middle') top = y - s / 2;
        else if (b === 'bottom' || b === 'ideographic') top = y - s;
        else top = y - s * 0.82; // alphabetic
        return { x0, top, s };
    },

    _drawLine(ctx, text, x, y, stroke) {
        const fontPx = this._fontPx(ctx);
        const { runs, w } = this._layout(ctx, text, fontPx);
        const { x0, top, s } = this._anchor(ctx, x, y, w, fontPx);
        const m = manifest();
        const cell = m.cell;
        const align = ctx.textAlign;
        ctx.textAlign = 'left';
        try {
            for (const r of runs) {
                if (r.text != null) {
                    (stroke ? this._orig.strokeText : this._orig.fillText).call(ctx, r.text, x0 + r.x, y);
                } else if (!stroke) {
                    const smooth = ctx.imageSmoothingEnabled;
                    ctx.imageSmoothingEnabled = false;
                    const sx = (r.cell % m.cols) * cell, sy = Math.floor(r.cell / m.cols) * cell;
                    ctx.drawImage(this._img, sx, sy, cell, cell, x0 + r.x, top, s, s);
                    ctx.imageSmoothingEnabled = smooth;
                }
            }
        } finally {
            ctx.textAlign = align;
        }
    },

    _patchCanvas() {
        if (this._patched || typeof CanvasRenderingContext2D === 'undefined') return;
        const P = CanvasRenderingContext2D.prototype;
        this._orig = { fillText: P.fillText, strokeText: P.strokeText, measureText: P.measureText };
        const self = this;
        // (a maxWidth squeezes the line: left to the browser, with the emoji as they are)
        P.fillText = function (text, x, y, maxWidth) {
            if (self.enabled && self._ready && maxWidth === undefined && self.has(text)) return self._drawLine(this, String(text), x, y, false);
            return maxWidth === undefined ? self._orig.fillText.call(this, text, x, y) : self._orig.fillText.call(this, text, x, y, maxWidth);
        };
        P.strokeText = function (text, x, y, maxWidth) {
            if (self.enabled && self._ready && maxWidth === undefined && self.has(text)) return self._drawLine(this, String(text), x, y, true);
            return maxWidth === undefined ? self._orig.strokeText.call(this, text, x, y) : self._orig.strokeText.call(this, text, x, y, maxWidth);
        };
        this._patched = true;
    },

    /** For tests: forget the manifest so a new one is read. */
    _reset() {
        this._map = null; this._re = null;
    },
};
