// InnerMapRenderer — the harbour and the river at work (mixed in via
// Object.assign; who is where: ui/innerMapPort.js view). Drawn over the
// living water and under the sprites (innerMapRenderer.js, after the fish
// traps), the hulls in plain canvas strokes, the people in the town's own character
// sprites (docker / harbourmaster presets, data/innerMapRenderer.json):
//   the slip      trestles and a keel, then ribs going up, planking over
//                 them, the deck, a mast with its yard; poles of scaffold and
//                 a shipwright or two at work by day
//   the beach     a hull heeled over on its side, shores propping it, a
//                 fire under the pitch pot (or the dry dock's walls round it)
//   the quay      crates stacked at the pier's foot, fish baskets in the
//                 afternoon, dockers carrying, the harbourmaster at his post
//   the boats     small hulls with a brown sail, rowed in and out
//   the river     punts with a fisherman and his rod, barges with their
//                 load and a man at the pole, the ferry's raft on its rope

import { InnerMapRenderer } from '../innerMapRenderer.js';
import { InnerMap } from '../../world/innerMap.js';
import { InnerMapPort } from '../innerMapPort.js';
import { InnerMapCharacters } from '../innerMapCharacters.js';

const WOOD = { keel: '#4a2f18', rib: '#7a5230', plank: '#8b6236', plankHi: '#a77a4a', deck: '#b08a58', mast: '#5a3a1e', sail: '#d9cfb4', sailDark: '#a89a78', rope: '#3b2a18', pole: '#6b4a26' };
const PEOPLE = ['#6b4a3a', '#4a5a6b', '#7a6a3a', '#5a4a6a', '#3a5a4a', '#6a3a3a', '#4a4a4a'];
const SKIN = '#d9b48c';

// A name's stable number in [0, 1) (which look a person wears)
const _hash = (str) => {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return (h >>> 0) / 4294967296;
};

const _seen = (q, r) => {
    const t = InnerMap.getTile(Math.floor(q), Math.floor(r));
    return !!(t && t.explored);
};

Object.assign(InnerMapRenderer, {
    _renderPortLife(ctx, camera) {
        if (!InnerMap.active || InnerMap._insideBuilding || InnerMap._underwater) return;
        const V = InnerMapPort.view;
        if (!V) return;
        const T = this.TILE_SIZE;
        const cs = T * camera.zoom;
        const art = Math.max(1, cs / 32);
        const now = this._waterFxNow ? this._waterFxNow() : performance.now() / 1000;
        const P = (x, y) => camera.worldToScreenFast(x * T, y * T);
        ctx.save();
        for (const s of V.slip) if (_seen(s.x, s.y)) this._drawSlip(ctx, P, s, cs, art, now);
        for (const c of V.careened) if (_seen(c.x, c.y)) this._drawCareened(ctx, P, c, cs, art, now);
        for (const b of V.boats) if (_seen(b.x, b.y)) this._drawBoat(ctx, P(b.x, b.y), b.dir, b.heading, b.sail, cs, art, now + b.i, b.fish);
        if (V.quay && _seen(V.quay.x, V.quay.y)) this._drawQuayGoods(ctx, P, V, cs, art);
        for (const p of V.punts) if (_seen(p.x, p.y)) this._drawPunt(ctx, P(p.x, p.y), p.fx, p.fy, cs, art, now + p.i * 1.3);
        for (const b of V.barges) if (_seen(b.x, b.y)) this._drawBarge(ctx, P(b.x, b.y), b.fx, b.fy, cs, art, now, b, camera.zoom);
        if (V.ferry && _seen(V.ferry.pos.x, V.ferry.pos.y)) this._drawFerry(ctx, P, V.ferry, cs, art, now, camera.zoom);
        ctx.restore();
    },

    /**
     * The dockers and the harbourmaster join the depth-sorted pass (innerMapLayers/entities.js)
     * — drawn over the pier they walk on, behind or before the townsfolk by where they stand.
     */
    _portLifeItems(items, ctx, camera) {
        if (!InnerMap.active || InnerMap._insideBuilding || InnerMap._underwater) return;
        const V = InnerMapPort.view;
        if (!V) return;
        const T = this.TILE_SIZE;
        const cs = T * camera.zoom;
        const art = Math.max(1, cs / 32);
        const now = this._waterFxNow ? this._waterFxNow() : performance.now() / 1000;
        const P = (x, y) => camera.worldToScreenFast(x * T, y * T);
        for (const d of V.dockers) {
            if (!_seen(d.x, d.y)) continue;
            items.push({ sortY: d.y * T, zLayer: 2, sortX: d.x, draw: () => {
                const dir = InnerMapCharacters.getDirection(d.fx || 0, d.fy || 0);
                this._drawPerson(ctx, P(d.x, d.y), cs, art, PEOPLE[d.i % PEOPLE.length], d.carry ? 'crate' : null, d.walk, false, { type: 'docker', seed: d.seed != null ? d.seed : d.i, anim: 'walk', dir, t: now + d.i * 0.31 });
            } });
        }
        const M = V.master;
        // (a real townsperson keeps the post — drawn and clicked with the street's people,
        // innerMapPort.js _keepMaster — so only his staff in his hand and his name over him
        // while he stands there, drawn just after him)
        if (M && M.npc) {
            const n = M.npc;
            if (n.q === Math.floor(M.x) && n.r === Math.floor(M.y) && n.state !== 'walking' && n.harbourmaster && _seen(M.x, M.y)) {
                items.push({ sortY: M.y * T + 1, zLayer: 2, sortX: M.x, draw: () => {
                    const p = P(M.x, M.y);
                    ctx.save();
                    this._drawStaff(ctx, p, cs, art, n.facing === InnerMapCharacters.DIR_LEFT ? -1 : 1, !!(InnerMapCharacters.isReady() && n.preset));
                    if (camera.zoom >= 0.8) this._portLabel(ctx, p.x, p.y - cs * 1.45, `${M.name} · ${n.roleTitle || 'harbourmaster'}`, art);
                    ctx.restore();
                } });
            }
        } else if (M && _seen(M.x, M.y)) {
            items.push({ sortY: M.y * T, zLayer: 2, sortX: M.x, draw: () => {
                const p = P(M.x, M.y);
                ctx.save();
                const seed = Math.floor(_hash(String(M.id || M.name)) * 99991);
                this._drawPerson(ctx, p, cs, art, '#2f3f5f', 'staff', 0, true, { type: 'harbourmaster', seed, gender: M.gender, anim: 'idle', dir: InnerMapCharacters.DIR_DOWN, t: now });
                if (camera.zoom >= 0.8) this._portLabel(ctx, p.x, p.y - cs * 1.45, `${M.name} · harbourmaster`, art);
                ctx.restore();
            } });
        }
    },

    _portLabel(ctx, x, y, text, art) {
        ctx.font = `${Math.max(9, Math.round(5 * art))}px sans-serif`;
        ctx.textAlign = 'center';
        const w = ctx.measureText(text).width + 8;
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = '#1a140c';
        ctx.fillRect(x - w / 2, y - 7 * art * 0.9, w, 10 * art * 0.9 + 2);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#f1e3c0';
        ctx.fillText(text, x, y + 1);
    },

    /** A ship on the slip at her stage (index 0 keel … 4 rigged; within: how far into it) */
    _drawSlip(ctx, P, s, cs, art, now) {
        const c = P(s.x, s.y);
        const ax = s.along.x, ay = s.along.y; // the keel runs along the shore
        const big = s.typeId === 'cog' || s.typeId === 'caravel' || s.typeId === 'galleon' || s.typeId === 'war_galley';
        const L = cs * (big ? 6 : 4.2), B = cs * (big ? 1.3 : 0.95);
        // inland a little: the hull lies up the slip from the water
        const ox = -s.out.x * cs * 0.9, oy = -s.out.y * cs * 0.9;
        ctx.save();
        ctx.translate(c.x + ox, c.y + oy);
        ctx.rotate(Math.atan2(ay, ax));
        // the slipway's ground: worn earth and timbers laid down to the water
        ctx.fillStyle = 'rgba(90,70,45,0.55)';
        ctx.fillRect(-L * 0.62, -B * 0.9, L * 1.24, B * 1.8);
        ctx.strokeStyle = 'rgba(60,40,20,0.6)';
        ctx.lineWidth = Math.max(1, art * 2);
        for (let i = -3; i <= 3; i++) {
            ctx.beginPath(); ctx.moveTo(i * L * 0.17, -B * 0.85); ctx.lineTo(i * L * 0.17, B * 0.85); ctx.stroke();
        }
        // trestles under the keel
        ctx.fillStyle = WOOD.keel;
        for (let i = -2; i <= 2; i++) ctx.fillRect(i * L * 0.2 - art * 2, -B * 0.25, art * 4, B * 0.5);
        const stage = s.index, w = s.within;
        // keel (and stem and stern post)
        const keelLen = stage === 0 ? L * (0.3 + 0.7 * w) : L;
        ctx.strokeStyle = WOOD.keel;
        ctx.lineWidth = Math.max(2, art * 4);
        ctx.beginPath(); ctx.moveTo(-keelLen / 2, 0); ctx.lineTo(keelLen / 2, 0); ctx.stroke();
        const hull = (k) => {
            // the hull's outline at k (0..1 of its beam)
            ctx.beginPath();
            ctx.moveTo(-L / 2, 0);
            ctx.quadraticCurveTo(-L * 0.35, -B * k, 0, -B * k);
            ctx.quadraticCurveTo(L * 0.38, -B * k, L / 2, 0);
            ctx.quadraticCurveTo(L * 0.38, B * k, 0, B * k);
            ctx.quadraticCurveTo(-L * 0.35, B * k, -L / 2, 0);
            ctx.closePath();
        };
        if (stage >= 1) {
            // the frames: ribs across the keel, more as the stage goes on
            const n = stage === 1 ? Math.max(2, Math.round(11 * w)) : 11;
            ctx.strokeStyle = WOOD.rib;
            ctx.lineWidth = Math.max(1.5, art * 2.5);
            for (let i = 0; i < n; i++) {
                const t = (i + 0.5) / 11 - 0.5;
                const half = B * Math.sqrt(Math.max(0, 1 - (2 * t) ** 2)) * 0.98;
                ctx.beginPath(); ctx.moveTo(t * L, -half); ctx.quadraticCurveTo(t * L + art * 2, 0, t * L, half); ctx.stroke();
            }
        }
        if (stage >= 2) {
            // planking: the hull closes from the keel up (strakes over the ribs)
            const k = stage === 2 ? 0.2 + 0.8 * w : 1;
            ctx.save();
            hull(1);
            ctx.clip();
            ctx.fillStyle = WOOD.plank;
            ctx.fillRect(-L / 2, -B * k, L, B * 2 * k);
            ctx.strokeStyle = WOOD.keel;
            ctx.lineWidth = Math.max(1, art);
            for (let j = -4; j <= 4; j++) {
                if (Math.abs(j) / 4 > k) continue;
                ctx.beginPath(); ctx.moveTo(-L / 2, j * B * 0.24); ctx.lineTo(L / 2, j * B * 0.24); ctx.stroke();
            }
            ctx.restore();
            ctx.strokeStyle = WOOD.keel;
            ctx.lineWidth = Math.max(1.5, art * 2);
            hull(1);
            ctx.stroke();
        }
        if (stage >= 3) {
            // the deck: planks laid fore and aft, the hatch
            const k = stage === 3 ? w : 1;
            ctx.save();
            hull(0.86);
            ctx.clip();
            ctx.fillStyle = WOOD.deck;
            ctx.fillRect(-L / 2, -B, L * k, B * 2);
            ctx.strokeStyle = 'rgba(80,55,30,0.6)';
            ctx.lineWidth = Math.max(1, art * 0.8);
            for (let j = -3; j <= 3; j++) { ctx.beginPath(); ctx.moveTo(-L / 2, j * B * 0.25); ctx.lineTo(-L / 2 + L * k, j * B * 0.25); ctx.stroke(); }
            ctx.restore();
            if (k > 0.6) { ctx.fillStyle = WOOD.keel; ctx.fillRect(-L * 0.08, -B * 0.22, L * 0.12, B * 0.44); }
        }
        if (stage >= 4) {
            // the mast stepped, its yard crossed, the sail furled on it; rigging run as it goes on
            ctx.fillStyle = WOOD.mast;
            ctx.beginPath(); ctx.arc(L * 0.05, 0, art * 3.5, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = WOOD.mast;
            ctx.lineWidth = Math.max(2, art * 3);
            ctx.beginPath(); ctx.moveTo(L * 0.05, -B * 1.25); ctx.lineTo(L * 0.05, B * 1.25); ctx.stroke();
            if (w > 0.4) {
                ctx.strokeStyle = WOOD.sailDark;
                ctx.lineWidth = Math.max(2, art * 3.5);
                ctx.beginPath(); ctx.moveTo(L * 0.05 + art * 3, -B * 1.15); ctx.lineTo(L * 0.05 + art * 3, B * 1.15); ctx.stroke();
            }
            ctx.strokeStyle = WOOD.rope;
            ctx.lineWidth = Math.max(1, art * 0.7);
            const lines = Math.round(4 * w);
            for (let i = 0; i < lines; i++) {
                const sx = (i % 2 ? 1 : -1) * L * (0.3 + 0.08 * i);
                ctx.beginPath(); ctx.moveTo(L * 0.05, (i < 2 ? -1 : 1) * B * 1.2); ctx.lineTo(sx, (i < 2 ? -1 : 1) * B * 0.8); ctx.stroke();
            }
        }
        // scaffold poles round her while the work goes on
        if (s.progress < 0.97) {
            ctx.strokeStyle = WOOD.pole;
            ctx.lineWidth = Math.max(1, art * 1.5);
            for (let i = -2; i <= 2; i++) {
                for (const side of [-1, 1]) {
                    ctx.beginPath(); ctx.arc(i * L * 0.22, side * B * 1.2, art * 2, 0, Math.PI * 2); ctx.stroke();
                }
            }
            ctx.beginPath(); ctx.moveTo(-L * 0.44, -B * 1.2); ctx.lineTo(L * 0.44, -B * 1.2); ctx.stroke();
        }
        ctx.restore();
        // the shipwrights at work: one with the adze at her side, one carrying timber
        if (s.working) {
            const swing = Math.sin(now * 5);
            const p1 = { x: c.x + ox + ax * L * 0.2 - s.out.x * B * 1.5, y: c.y + oy + ay * L * 0.2 - s.out.y * B * 1.5 };
            this._drawPerson(ctx, p1, cs, art, '#5a4030', swing > 0 ? 'adze' : 'adzeDown', 0, false, { type: 'docker', seed: 7919, anim: 'idle', dir: InnerMapCharacters.DIR_UP, t: now });
            const walk = (now * 0.08) % 1;
            const f = walk < 0.5 ? walk * 2 : (1 - walk) * 2;
            const p2 = { x: c.x + ox + ax * L * (f - 0.5) - s.out.x * B * 2.2, y: c.y + oy + ay * L * (f - 0.5) - s.out.y * B * 2.2 };
            this._drawPerson(ctx, p2, cs, art, '#4a3a2a', 'plank', now * 6, false, { type: 'docker', seed: 15838, anim: 'walk', dir: InnerMapCharacters.DIR_RIGHT, t: now });
        }
        if (s.waiting && this._portLabel) this._portLabel(ctx, c.x + ox, c.y + oy - B * 1.6, 'waiting for timber', art);
    },

    /** A hull careened: heeled on her side, shores propping her, the pitch pot's fire */
    _drawCareened(ctx, P, c, cs, art, now) {
        const p = P(c.x, c.y);
        const big = c.typeId === 'cog' || c.typeId === 'caravel' || c.typeId === 'galleon' || c.typeId === 'war_galley';
        const L = cs * (big ? 5.6 : 4), B = cs * (big ? 1.2 : 0.9);
        const ox = -c.out.x * cs * 0.6, oy = -c.out.y * cs * 0.6;
        ctx.save();
        ctx.translate(p.x + ox, p.y + oy);
        ctx.rotate(Math.atan2(c.along.y, c.along.x));
        if (c.dock) {
            // the dry dock: stone walls round her and steps down
            ctx.fillStyle = 'rgba(120,120,112,0.9)';
            ctx.fillRect(-L * 0.6, -B * 1.4, L * 1.2, B * 0.3);
            ctx.fillRect(-L * 0.6, B * 1.1, L * 1.2, B * 0.3);
            ctx.fillStyle = 'rgba(70,64,56,0.8)';
            ctx.fillRect(-L * 0.6, -B * 1.1, L * 1.2, B * 2.2);
        }
        // her hull, heeled over: the side up showing its bottom (weed, then fresh pitch)
        ctx.save();
        ctx.scale(1, 0.75);
        ctx.beginPath();
        ctx.moveTo(-L / 2, 0);
        ctx.quadraticCurveTo(-L * 0.35, -B * 1.3, 0, -B * 1.3);
        ctx.quadraticCurveTo(L * 0.38, -B * 1.3, L / 2, 0);
        ctx.quadraticCurveTo(L * 0.3, B * 0.5, 0, B * 0.5);
        ctx.quadraticCurveTo(-L * 0.3, B * 0.5, -L / 2, 0);
        ctx.closePath();
        ctx.fillStyle = WOOD.plank;
        ctx.fill();
        // the bottom: green weed scraped away from one end, black pitch on the clean part
        const done = (now * 0.01) % 1;
        ctx.save();
        ctx.clip();
        ctx.fillStyle = '#3e5a2e';
        ctx.fillRect(-L / 2, -B * 1.3, L, B * 0.9);
        ctx.fillStyle = '#1e1a16';
        ctx.fillRect(-L / 2, -B * 1.3, L * (0.2 + 0.6 * done), B * 0.9);
        ctx.restore();
        ctx.strokeStyle = WOOD.keel;
        ctx.lineWidth = Math.max(1.5, art * 2);
        ctx.stroke();
        ctx.restore();
        // the mast lying over to the land, shores propping her
        ctx.strokeStyle = WOOD.mast;
        ctx.lineWidth = Math.max(2, art * 3);
        ctx.beginPath(); ctx.moveTo(0, B * 0.3); ctx.lineTo(L * 0.1, B * 2.4); ctx.stroke();
        ctx.strokeStyle = WOOD.pole;
        ctx.lineWidth = Math.max(1, art * 2);
        for (const x of [-0.3, 0, 0.3]) { ctx.beginPath(); ctx.moveTo(x * L, B * 0.3); ctx.lineTo(x * L + art * 4, B * 1.4); ctx.stroke(); }
        ctx.restore();
        if (c.working) {
            // the pitch pot over its fire
            const fx = p.x + ox - c.out.x * B * 2.6 + c.along.x * L * 0.35, fy = p.y + oy - c.out.y * B * 2.6 + c.along.y * L * 0.35;
            ctx.fillStyle = '#2a2a2a';
            ctx.beginPath(); ctx.arc(fx, fy, art * 4, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = `rgba(255,${140 + Math.floor(60 * Math.sin(now * 9))},40,0.85)`;
            ctx.beginPath(); ctx.arc(fx, fy + art * 4, art * 2.5, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = 'rgba(90,90,90,0.35)';
            const k = (now * 0.5) % 1;
            ctx.beginPath(); ctx.arc(fx + art * 3 * k, fy - art * (6 + 14 * k), art * (2 + 3 * k), 0, Math.PI * 2); ctx.fill();
            const swing = Math.sin(now * 4);
            this._drawPerson(ctx, { x: p.x + ox - c.out.x * B * 1.6, y: p.y + oy - c.out.y * B * 1.6 }, cs, art, '#4a3a2a', swing > 0 ? 'adze' : 'adzeDown', 0, false, { type: 'docker', seed: 23757, anim: 'idle', dir: InnerMapCharacters.DIR_UP, t: now });
        }
    },

    /** A fishing boat: a small hull, a brown sail when under way, the nets over the side when fishing */
    _drawBoat(ctx, p, dir, heading, sail, cs, art, t, fish) {
        const ang = Math.atan2(dir.y * (heading || 1), dir.x * (heading || 1));
        const L = cs * 0.95, B = cs * 0.34;
        const bob = Math.sin(t * 1.7) * art * 0.8;
        // its wake
        if (heading) {
            ctx.strokeStyle = 'rgba(230,245,255,0.45)';
            ctx.lineWidth = Math.max(1, art);
            ctx.beginPath();
            ctx.moveTo(p.x - Math.cos(ang) * L * 0.5, p.y - Math.sin(ang) * L * 0.5);
            ctx.lineTo(p.x - Math.cos(ang) * L * 1.4 + Math.sin(ang) * B, p.y - Math.sin(ang) * L * 1.4 - Math.cos(ang) * B);
            ctx.moveTo(p.x - Math.cos(ang) * L * 0.5, p.y - Math.sin(ang) * L * 0.5);
            ctx.lineTo(p.x - Math.cos(ang) * L * 1.4 - Math.sin(ang) * B, p.y - Math.sin(ang) * L * 1.4 + Math.cos(ang) * B);
            ctx.stroke();
        }
        ctx.save();
        ctx.translate(p.x, p.y + bob);
        ctx.rotate(ang);
        ctx.fillStyle = '#6a4626';
        ctx.beginPath();
        ctx.moveTo(L / 2, 0);
        ctx.quadraticCurveTo(L * 0.1, -B, -L / 2, -B * 0.7);
        ctx.lineTo(-L / 2, B * 0.7);
        ctx.quadraticCurveTo(L * 0.1, B, L / 2, 0);
        ctx.fill();
        ctx.fillStyle = '#8b6236';
        ctx.fillRect(-L * 0.3, -B * 0.45, L * 0.55, B * 0.9);
        // a fisher in her
        ctx.fillStyle = '#4a3a2a';
        ctx.beginPath(); ctx.arc(-L * 0.18, 0, art * 2.6, 0, Math.PI * 2); ctx.fill();
        if (sail) {
            ctx.fillStyle = '#8a5a3a';
            ctx.beginPath();
            ctx.moveTo(L * 0.1, 0);
            ctx.lineTo(-L * 0.2, -B * 2.2);
            ctx.lineTo(-L * 0.3, art);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();
        if (fish) {
            // the net's floats in a curve beside her
            ctx.fillStyle = '#e8d8a8';
            for (let i = 0; i < 5; i++) {
                const a = i / 4 * Math.PI;
                ctx.fillRect(p.x + Math.cos(a) * cs * 0.9 - art, p.y + Math.sin(a) * cs * 0.6 + cs * 0.2 - art, art * 2, art * 2);
            }
        }
    },

    /** Crates and barrels at the pier's foot; fish baskets in the afternoon */
    _drawQuayGoods(ctx, P, V, cs, art) {
        const q = V.quay;
        const base = P(q.x, q.y);
        const ax = q.along.x, ay = q.along.y;
        for (let i = 0; i < V.crates; i++) {
            const row = Math.floor(i / 3), col = i % 3;
            const x = base.x + ax * (col - 3.5) * cs * 0.5 + ay * row * cs * 0.1, y = base.y + ay * (col - 3.5) * cs * 0.5 - row * cs * 0.28;
            ctx.fillStyle = i % 4 === 3 ? '#6a4a2a' : '#9a7444';
            ctx.fillRect(x - cs * 0.2, y - cs * 0.2, cs * 0.4, cs * 0.38);
            ctx.strokeStyle = '#4a3018';
            ctx.lineWidth = Math.max(1, art);
            ctx.strokeRect(x - cs * 0.2, y - cs * 0.2, cs * 0.4, cs * 0.38);
            ctx.beginPath(); ctx.moveTo(x - cs * 0.2, y - cs * 0.2); ctx.lineTo(x + cs * 0.2, y + cs * 0.18); ctx.stroke();
        }
        for (let i = 0; i < V.baskets; i++) {
            const x = base.x + ax * (i + 1.5) * cs * 0.45, y = base.y + ay * (i + 1.5) * cs * 0.45 + cs * 0.1;
            ctx.fillStyle = '#a8864e';
            ctx.beginPath(); ctx.ellipse(x, y, cs * 0.18, cs * 0.12, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#b8c8d0';
            for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.ellipse(x - cs * 0.07 + k * cs * 0.07, y - cs * 0.04, cs * 0.06, cs * 0.025, 0.4, 0, Math.PI * 2); ctx.fill(); }
        }
    },

    /**
     * A person at the harbour: the town's own character sprites (data/innerMapRenderer.json
     * presets 'docker', 'harbourmaster'), with what he carries drawn in his hands — a crate
     * on the shoulder, a plank, the harbourmaster's staff, a shipwright's adze. Until the
     * sheets are loaded, a plain painted figure stands in.
     */
    _drawPerson(ctx, p, cs, art, coat, carry = null, walk = 0, hat = false, look = null) {
        const s = cs / 32;
        const feetY = p.y + s * 7;
        const preset = look ? InnerMapCharacters.getPresetForNPC(look.type, look.seed, look.gender || null) : null;
        const cw = cs * 1.2, ch = cs * 1.8;
        const drawn = !!(preset && InnerMapCharacters.drawCharacter(ctx, preset, look.anim || 'idle', look.dir != null ? look.dir : InnerMapCharacters.DIR_DOWN, look.t || 0, p.x - cw / 2, feetY - ch + cs * 0.3, cw, ch));
        if (!drawn) this._drawPlainPerson(ctx, p, s, coat, walk, hat);
        // the sprite's head stands about 1.1 tiles over its feet; the hands about half a tile
        const head = drawn ? feetY - cs * 0.98 : p.y - s * 17;
        const hand = drawn ? feetY - cs * 0.5 : p.y - s * 8;
        const side = drawn && look && look.dir === InnerMapCharacters.DIR_LEFT ? -1 : 1;
        if (carry === 'crate') {
            const w = s * 12, h = s * 8;
            ctx.fillStyle = '#9a7444';
            ctx.fillRect(p.x - w / 2, head - h, w, h);
            ctx.strokeStyle = '#4a3018';
            ctx.lineWidth = Math.max(1, art * 0.7);
            ctx.strokeRect(p.x - w / 2, head - h, w, h);
            ctx.beginPath(); ctx.moveTo(p.x - w / 2, head - h); ctx.lineTo(p.x + w / 2, head); ctx.stroke();
        } else if (carry === 'plank') {
            ctx.fillStyle = WOOD.plankHi;
            ctx.fillRect(p.x - s * 12, hand - s * 7, s * 24, s * 2.5);
        } else if (carry === 'staff') {
            this._drawStaff(ctx, p, cs, art, side, drawn);
        } else if (carry === 'adze' || carry === 'adzeDown') {
            ctx.strokeStyle = '#3a2a18';
            ctx.lineWidth = Math.max(1, s * 1.5);
            const up = carry === 'adze';
            ctx.beginPath(); ctx.moveTo(p.x + s * 4, hand); ctx.lineTo(p.x + s * (up ? 7 : 11), hand + s * (up ? -12 : 4)); ctx.stroke();
            ctx.fillStyle = '#8a8a8a';
            ctx.fillRect(p.x + s * (up ? 5 : 10), hand + s * (up ? -14 : 2), s * 4, s * 2.5);
        }
    },

    /** The harbourmaster's staff, upright at his side (side −1 when he faces left); sprite: drawn over a character sprite. */
    _drawStaff(ctx, p, cs, art, side = 1, sprite = true) {
        const s = cs / 32;
        const feetY = p.y + s * 7;
        const head = sprite ? feetY - cs * 0.98 : p.y - s * 17;
        // (in his fist: the sprite's hand hangs about 5½ of its 32 pixels out from the middle)
        const x = p.x + s * (sprite ? 5.5 : 7) * side;
        ctx.strokeStyle = '#3a2a18';
        ctx.lineWidth = Math.max(1, s * 1.5);
        ctx.beginPath(); ctx.moveTo(x, feetY); ctx.lineTo(x, head - s * 3); ctx.stroke();
        // (a brass knob atop it: the post's mark)
        ctx.fillStyle = '#c9a24a';
        ctx.beginPath(); ctx.arc(x, head - s * 3, Math.max(1, s * 1.6), 0, Math.PI * 2); ctx.fill();
    },

    /** The stand-in before the character sheets load: head, coat, legs. */
    _drawPlainPerson(ctx, p, s, coat, walk, hat) {
        const step = walk ? Math.sin(walk) * s * 2 : 0;
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath(); ctx.ellipse(p.x, p.y + s * 6, s * 6, s * 2.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#3a2a1a';
        ctx.fillRect(p.x - s * 3 + step * 0.5, p.y, s * 2.2, s * 6);
        ctx.fillRect(p.x + s * 0.8 - step * 0.5, p.y, s * 2.2, s * 6);
        ctx.fillStyle = coat;
        ctx.fillRect(p.x - s * 4, p.y - s * 10, s * 8, s * 11);
        ctx.fillStyle = SKIN;
        ctx.beginPath(); ctx.arc(p.x, p.y - s * 13, s * 3.4, 0, Math.PI * 2); ctx.fill();
        if (hat) { ctx.fillStyle = '#1e2a3e'; ctx.fillRect(p.x - s * 4.5, p.y - s * 17, s * 9, s * 2.2); ctx.fillRect(p.x - s * 3, p.y - s * 19.5, s * 6, s * 3); }
    },

    /** A fisherman's punt on the river, his rod out over the water */
    _drawPunt(ctx, p, fx, fy, cs, art, t) {
        const ang = Math.atan2(fy, fx) + Math.PI / 2;
        const L = cs * 0.9, B = cs * 0.26;
        ctx.save();
        ctx.translate(p.x, p.y + Math.sin(t * 1.3) * art * 0.6);
        ctx.rotate(ang);
        ctx.fillStyle = '#5e4024';
        ctx.fillRect(-L / 2, -B / 2, L, B);
        ctx.fillStyle = '#7a5530';
        ctx.fillRect(-L / 2 + art * 2, -B / 2 + art * 1.5, L - art * 4, B - art * 3);
        ctx.fillStyle = '#4a3a2a';
        ctx.beginPath(); ctx.arc(-L * 0.15, 0, art * 2.6, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#3a2a18';
        ctx.lineWidth = Math.max(1, art * 0.7);
        ctx.beginPath(); ctx.moveTo(-L * 0.15, 0); ctx.lineTo(L * 0.2, -cs * 0.9); ctx.stroke();
        ctx.restore();
        // the line's ring on the water
        ctx.strokeStyle = 'rgba(230,245,255,0.5)';
        ctx.lineWidth = Math.max(1, art * 0.7);
        const k = (t * 0.5) % 1;
        ctx.beginPath(); ctx.ellipse(p.x + Math.cos(ang) * cs * 0.7, p.y + Math.sin(ang) * cs * 0.7 - cs * 0.5, cs * 0.2 * (0.5 + k), cs * 0.08 * (0.5 + k), 0, 0, Math.PI * 2); ctx.stroke();
    },

    /** A barge with its load (what really moved on the link: systems/barges.js) and a man at the pole */
    _drawBarge(ctx, p, fx, fy, cs, art, t, b, zoom) {
        const ang = Math.atan2(fy, fx);
        const L = cs * 2.6, B = cs * 0.8;
        ctx.save();
        ctx.translate(p.x, p.y + Math.sin(t * 0.9) * art * 0.5);
        ctx.rotate(ang);
        ctx.fillStyle = '#4e3620';
        ctx.beginPath();
        ctx.moveTo(L / 2, -B * 0.35); ctx.lineTo(L / 2 + B * 0.3, 0); ctx.lineTo(L / 2, B * 0.35);
        ctx.lineTo(L / 2, B / 2); ctx.lineTo(-L / 2, B / 2); ctx.lineTo(-L / 2, -B / 2); ctx.lineTo(L / 2, -B / 2);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#6e4e2c';
        ctx.fillRect(-L / 2 + art * 2, -B / 2 + art * 2, L - art * 4, B - art * 4);
        // the load: sacks and crates
        for (let i = 0; i < 5; i++) {
            ctx.fillStyle = i % 2 ? '#9a7444' : '#c2ac7c';
            ctx.fillRect(-L * 0.35 + i * L * 0.13, -B * 0.3, L * 0.11, B * 0.6);
        }
        // the poleman at the stern
        ctx.fillStyle = '#4a3a2a';
        ctx.beginPath(); ctx.arc(-L * 0.44, 0, art * 3, 0, Math.PI * 2); ctx.fill();
        const sw = Math.sin(t * 1.2);
        ctx.strokeStyle = '#6b4a26';
        ctx.lineWidth = Math.max(1, art * 1.2);
        ctx.beginPath(); ctx.moveTo(-L * 0.44, 0); ctx.lineTo(-L * 0.44 - cs * (0.8 + sw * 0.3), B * (0.9 + sw * 0.4)); ctx.stroke();
        ctx.restore();
        if (zoom >= 0.9 && b && b.good) this._portLabel(ctx, p.x, p.y - cs * 0.9, `${b.qty} ${String(b.good).replace(/_/g, ' ')} for ${b.to}`, art);
    },

    /** The ferry: a rope over the river, the raft on it, the ferryman at his pole */
    _drawFerry(ctx, P, f, cs, art, t, zoom) {
        const a = P(f.a.x, f.a.y), b = P(f.b.x, f.b.y), p = P(f.pos.x, f.pos.y);
        ctx.strokeStyle = '#3b2a18';
        ctx.lineWidth = Math.max(1, art);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        for (const e of [a, b]) {
            ctx.fillStyle = '#4a2f18';
            ctx.fillRect(e.x - art * 2, e.y - art * 8, art * 4, art * 10);
        }
        const ang = Math.atan2(f.fy, f.fx);
        const L = cs * 1.6, B = cs * 1.1;
        ctx.save();
        ctx.translate(p.x, p.y + Math.sin(t) * art * 0.5);
        ctx.rotate(ang);
        ctx.fillStyle = '#6a4a28';
        ctx.fillRect(-L / 2, -B / 2, L, B);
        ctx.strokeStyle = '#4a3018';
        ctx.lineWidth = Math.max(1, art);
        for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * L * 0.2, -B / 2); ctx.lineTo(i * L * 0.2, B / 2); ctx.stroke(); }
        ctx.strokeRect(-L / 2, -B / 2, L, B);
        ctx.restore();
        this._drawPerson(ctx, { x: p.x, y: p.y }, cs, art, '#3a4a3a', 'staff', 0, false, { type: 'docker', seed: Math.floor(_hash(String(f.ferryman)) * 99991), anim: 'idle', dir: InnerMapCharacters.DIR_DOWN, t });
        if (zoom >= 0.8) this._portLabel(ctx, p.x, p.y - cs * 1.0, `${f.ferryman}'s ferry · ${f.fare}g${f.next != null ? ` · next ${String(Math.floor(f.next)).padStart(2, '0')}:00` : ''}`, art);
    },
});
