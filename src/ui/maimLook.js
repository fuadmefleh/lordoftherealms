// MaimLook — the maimed, seen. Turns what shows of a body (systems/maimMarks.js
// visible()) into LPC layers laid over a look: a stump bound in rag, an iron
// hook, a wooden leg, a crutch under the arm, the eye patch, a scarred-out eye,
// a blindfold over put-out eyes, cropped ears, a slit nose, a copper nose, a
// brand on the cheek.
//
// The sheets are drawn by scripts/make_maim_layers.py into
// assets/lpc/Characters/Maimed/<Layer>/<Masculine|Feminine>/<Anim>.png, each
// frame fitted to the LPC bodies' hands, feet and eyes. 'Erase - …' layers are
// masks: InnerMapCharacters composites them with destination-out, cutting the
// hand or foot out of everything beneath (body, sleeve, glove, boot) before the
// stump, hook or peg is laid on.
//
// One composited preset per look and body ('maim:<key>|<base>'), made once on
// first need and kept (InnerMapCharacters' cache): the player's sprite and HUD
// portrait (ui/playerAppearance.js), townsfolk on the street
// (ui/innerMapMaiming.js presetFor) and the conversation portrait
// (ui/npcPortrait.js) all ask here.

import { InnerMapCharacters } from './innerMapCharacters.js';
import { MaimMarks } from '../systems/maimMarks.js';

/** The LPC eye patch layer (files straight in the folder: Walk.png, Idle.png, …). */
export const EYE_PATCH_LAYER = 'Head Accessories/Eyewear 03 - Eyepatch';

const ROOT = 'Maimed/';
const SIDE = { R: 'Right', L: 'Left' };

// A layer that belongs over the face goes under a helmet, a cap, a mask; one
// over the limbs over everything worn, but under what is carried
const HEADGEAR = /^Head Accessories\/(Helm|Cap|Mask)/;
const CARRIED = /^Props\//;

/** The body a look is built on, from its layers: 'Feminine' | 'Masculine', or null (a child's sprite: none fit). */
export function buildOf(layers) {
    if (!Array.isArray(layers) || !layers.length) return null;
    if (layers.some(l => String(l).startsWith(InnerMapCharacters.CHILD_ROOT || 'Children/'))) return null;
    return layers.some(l => /^Body\/[^/]*Feminine/.test(l)) ? 'Feminine' : 'Masculine';
}

/** A short key for what shows ('' when nothing does): part of the preset's id. */
export function maimKey(vis) {
    if (!vis) return '';
    const out = [];
    for (const s of ['R', 'L']) if (vis.hands && vis.hands[s]) out.push(`h${s}${vis.hands[s][0]}`);
    for (const s of ['L', 'R']) if (vis.feet && vis.feet[s]) out.push(`f${s}${vis.feet[s][0]}`);
    if (vis.crutch) out.push(`c${vis.crutch}`);
    if (vis.eyes) out.push(`e${vis.eyes[0]}`);
    if (vis.ears) out.push(`a${vis.ears}`);
    if (vis.nose) out.push(`n${vis.nose[0]}`);
    if (vis.brand) out.push('b');
    return out.join('');
}

/**
 * The layers for what shows, on a body ('Masculine' | 'Feminine'):
 * { face: [...], limbs: [...] } in drawing order (each erase before what it makes room for).
 */
export function maimLayers(vis, build) {
    const face = [];
    const limbs = [];
    if (!vis || !build) return { face, limbs };
    const L = (name) => `${ROOT}${name}/${build}`;
    for (const s of ['R', 'L']) {
        const h = vis.hands && vis.hands[s];
        if (!h) continue;
        limbs.push(L(`Erase - ${SIDE[s]} Hand`), L(`${h === 'hook' ? 'Hook' : 'Stump'} - ${SIDE[s]} Hand`));
    }
    for (const s of ['L', 'R']) {
        const f = vis.feet && vis.feet[s];
        if (f === 'peg') limbs.push(L(`Erase - ${SIDE[s]} Leg`), L(`Peg - ${SIDE[s]} Leg`));
        else if (f) limbs.push(L(`Erase - ${SIDE[s]} Foot`), L(`Stump - ${SIDE[s]} Foot`));
    }
    if (vis.crutch) limbs.push(L(`Crutch - ${SIDE[vis.crutch]}`));
    if (vis.eyes === 'patch') face.push(EYE_PATCH_LAYER);
    else if (vis.eyes === 'scar') face.push(L('Scar - Left Eye'));
    else if (vis.eyes === 'blind') face.push(L('Blindfold'));
    if (vis.ears >= 1) face.push(L('Crop - Right Ear'));
    if (vis.ears >= 2) face.push(L('Crop - Left Ear'));
    if (vis.nose === 'slit') face.push(L('Slit Nose'));
    else if (vis.nose === 'copper') face.push(L('Copper Nose'));
    if (vis.brand) face.push(L('Brand - Right Cheek'));
    return { face, limbs };
}

const SHIELD = /^Props\/Shield/;
const TWO_HANDED = /^Props\/(Bow|Crossbow|Pike|Bill|Halberd|Dane Axe|Spear)\//;

/**
 * Whether a carried layer can still be held by this body: the weapon is held in the
 * right hand (the first to go) and is stowed once it is gone, hooked or not; a bow, a
 * crossbow or a polearm wants both hands; a shield on the left arm stays until that
 * hand goes too. With both hands gone, nothing is carried.
 */
export function canCarry(layer, vis) {
    const h = (vis && vis.hands) || {};
    if (!h.R && !h.L) return true;
    if (h.R && h.L) return false;
    if (TWO_HANDED.test(layer)) return false;
    return SHIELD.test(layer) ? !h.L : !h.R;
}

/** A look's layers with what shows laid in (the face under any helmet, the limbs under what is carried). */
export function applyMaim(layers, vis) {
    const base = (layers || []).filter(l => l !== EYE_PATCH_LAYER && !String(l).startsWith(ROOT));
    const { face, limbs } = maimLayers(vis, buildOf(base));
    if (!face.length && !limbs.length) return base;
    const out = base.filter(l => !CARRIED.test(l) || canCarry(l, vis));
    let at = out.findIndex(l => CARRIED.test(l));
    if (at < 0) at = out.length;
    out.splice(at, 0, ...limbs);
    let fa = out.findIndex(l => HEADGEAR.test(l) || CARRIED.test(l));
    if (fa < 0) fa = out.length;
    out.splice(fa, 0, ...face);
    return out;
}

// The bust's crop of a 64px frame (ui/npcPortrait.js): head and shoulders; lower and
// wider when a hand is gone (the stump or the hook at the hip) or a foot (the peg, the crutch)
const BUST = { x: 14, y: 10, size: 36 };
const BUST_HANDS = { x: 10, y: 11, size: 44 };
const BUST_FEET = { x: 8, y: 13, size: 48 };
const KEY_RE = /^(?:h[RL][hs]|f[RL][ps]|c[RL]|e[psb]|a\d|n[sc]|b)+$/;

/** The maim key a preset id carries ('maim:<key>|…', or a player look's last '|<key>'), or ''. */
export function keyOfPreset(presetId) {
    const id = String(presetId || '');
    const m = /^maim:([^|]*)\|/.exec(id);
    if (m) return m[1];
    if (id.startsWith('player:')) {
        const last = id.slice(id.lastIndexOf('|') + 1);
        if (KEY_RE.test(last)) return last;
    }
    return '';
}

/** The bust's crop for a preset: { x, y, size } in the frame's pixels. */
export function bustCrop(presetId) {
    const key = keyOfPreset(presetId);
    if (/f[RL]|c[RL]/.test(key)) return BUST_FEET;
    if (/h[RL]/.test(key)) return BUST_HANDS;
    return BUST;
}

const _pending = new Set();
const _failed = new Set();   // (a look whose sheets would not load: not asked for again every frame)

export const MaimLook = {
    EYE_PATCH_LAYER,
    buildOf,
    maimKey,
    maimLayers,
    applyMaim,
    canCarry,
    bustCrop,
    keyOfPreset,

    /** What shows of a person's body (systems/maimMarks.js), or null. */
    visible(person) { return MaimMarks.visible(person); },

    /**
     * The preset to draw `base` (a preset id) as this body: the maimed look's id once
     * it is composited, else null — its making started, and the plain look drawn
     * meanwhile. Null too when nothing shows or the look has no body to fit (a child).
     */
    presetOver(base, person) {
        if (!base || !person) return null;
        const vis = MaimMarks.visible(person);
        const key = maimKey(vis);
        if (!key) return null;
        const id = `maim:${key}|${base}`;
        if (InnerMapCharacters.getComposited(id)) return id;
        const preset = InnerMapCharacters._presets[base];
        if (!preset || !Array.isArray(preset.layers) || !buildOf(preset.layers) || _pending.has(id) || _failed.has(id)) return null;
        _pending.add(id);
        Promise.resolve(InnerMapCharacters.registerPreset(id, applyMaim(preset.layers, vis)))
            .catch(() => false)
            .then((ok) => { if (!ok) _failed.add(id); })
            .finally(() => _pending.delete(id));
        return null;
    },
};
