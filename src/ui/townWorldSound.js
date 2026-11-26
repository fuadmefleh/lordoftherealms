// ============================================
// TOWN WORLD SOUND — what the realm's affairs in the streets sound like
// ============================================
// Called from ui/innerMapTownWorld.js on its half-second tick (on the street, not indoors),
// with the figures it walks (npc._tw) and the town's own crier (world/innerMap/townScenes.js):
//
//   - the drill: the billeted men at drill on the square — their tramp and stamp (a bed at the
//     ranks' middle) and now and then the sergeant's shout and the ranks' answer;
//   - the preacher calling for the cross: a sermon's murmur heard about him (a bed);
//   - the muster camp outside the walls: its hubbub, kit and harness clinking (a bed);
//   - the town crier: his handbell as he begins to cry the news, and again between his lines.
//
// The beds are place-bound sources (ui/soundscape.js Soundscape.addSource) renewed while the
// figures are at it and let lapse a couple of seconds after (a short ttl); the one-shots are
// audioManager.playSFX(kind, { q, r }) — as loud as they are near. Reads the figures only;
// never moves them. The shout's timing is the sound's own (Math.random: cosmetic, not the
// game's RNG).
//
// QA from the console: TownWorldSound.debug() → { drill, preacher, camp, criers, shouts, bells }.

import { InnerMap } from '../world/innerMap.js';
import { audioManager } from '../systems/audio.js';
import { Soundscape } from './soundscape.js';

const TTL = 2.5;            // s a bed lingers after its last renewal
const SHOUT_EVERY = [5, 10]; // s between the drill's shouts
const BELL_EVERY = 13;      // s between the crier's bells while he cries

function _mid(list) {
    const n = list.length;
    let q = 0, r = 0;
    for (const p of list) { q += Number(p.q) || 0; r += Number(p.r) || 0; }
    return { q: q / n, r: r / n };
}

/**
 * What the town world's figures sound like now — pure. figs: [{ kind, activity: { type, label }, q, r }],
 * camp: { q, r } | null, criers: [{ q, r, crying }]. → { drill: {q,r}|null, preacher: {q,r}|null,
 * camp: {q,r}|null, criers: [{ q, r }] (the ones crying) }.
 */
export function townWorldSounds(figs, camp, criers) {
    const drilling = [], preaching = [], mustered = [];
    for (const n of figs || []) {
        if (!n || n.state === 'gone' || n.state === 'inside_building') continue;
        const a = n.activity || {};
        if (n.kind === 'soldier' && a.type === 'drill') drilling.push(n);
        else if (n.kind === 'preacher' && a.type === 'preach' && /call|cross/i.test(String(a.label || ''))) preaching.push(n);
        else if ((n.kind === 'muster' || n.kind === 'crusader') && a.type === 'camp') mustered.push(n);
    }
    return {
        drill: drilling.length >= 2 ? _mid(drilling) : null,
        preacher: preaching.length ? { q: Number(preaching[0].q) || 0, r: Number(preaching[0].r) || 0 } : null,
        camp: camp && mustered.length ? { q: Number(camp.q) || 0, r: Number(camp.r) || 0 } : null,
        criers: (criers || []).filter(c => c && c.crying).map(c => ({ q: Number(c.q) || 0, r: Number(c.r) || 0 })),
    };
}

export const TownWorldSound = {
    audio: audioManager,     // (specs swap in a fake)
    scape: Soundscape,
    _clock: 0,
    _last: 0,
    _shoutAt: 0,
    _criers: new Map(),      // npc id → { next } the next bell while he cries
    _now: null,
    shouts: 0,
    bells: 0,

    /** From InnerMapTownWorld.update's tick. tw: InnerMapTownWorld (its _figs, _camp). */
    update(tw) {
        try {
            const t = (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) / 1000;
            this._clock = t;
            const figs = ((tw && tw._figs) || []).map(n => ({ kind: n._tw && n._tw.kind, activity: n.activity, q: n.q, r: n.r, state: n.state }));
            const criers = [];
            for (const n of InnerMap.npcs || []) {
                if (n && n._crier && n.state !== 'gone') criers.push({ id: n.id, q: n.q, r: n.r, crying: !!(n.activity && n.activity.type === 'cry') });
            }
            const S = townWorldSounds(figs, tw && tw._camp, criers);
            this._now = S;
            if (S.drill) {
                this.scape.addSource('tw_drill', { bed: 'drill', q: S.drill.q, r: S.drill.r, level: 0.85, near: 3, far: 20, ttl: TTL });
                if (t >= this._shoutAt) {
                    if (this._shoutAt) {
                        this.shouts++;
                        this.audio.playSFX('drill_shout', { q: S.drill.q, r: S.drill.r, far: 26 });
                    }
                    this._shoutAt = t + SHOUT_EVERY[0] + Math.random() * (SHOUT_EVERY[1] - SHOUT_EVERY[0]);
                }
            } else {
                this._shoutAt = 0;
            }
            if (S.preacher) this.scape.addSource('tw_preacher', { bed: 'sermon', q: S.preacher.q, r: S.preacher.r, level: 0.8, near: 2, far: 14, ttl: TTL });
            if (S.camp) this.scape.addSource('tw_camp', { bed: 'camp', q: S.camp.q, r: S.camp.r, level: 0.9, near: 5, far: 24, ttl: TTL });
            // The crier's handbell: as he starts, and between his lines
            const crying = new Set();
            for (const c of criers) {
                if (!c.crying) continue;
                crying.add(c.id);
                const st = this._criers.get(c.id);
                if (!st || t >= st.next) {
                    this.bells++;
                    this.audio.playSFX('handbell', { q: c.q, r: c.r, far: 28 });
                    this._criers.set(c.id, { next: t + BELL_EVERY });
                }
            }
            for (const id of [...this._criers.keys()]) if (!crying.has(id)) this._criers.delete(id);
        } catch { /* sound is best-effort */ }
    },

    debug() {
        return { ...(this._now || {}), shouts: this.shouts, bells: this.bells };
    },
};
