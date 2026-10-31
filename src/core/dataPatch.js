// ============================================
// DATA PATCH — minimal diffs between two JSON values
// ============================================
// Mods store their edits to a gamedata section as a patch against the base
// data, not a full copy, so a game update to an untouched field still reaches
// a modded game, and a mod pack stays small.
//
// Patch format (a plain JSON value):
//   - a plain object patches a plain object key by key; its reserved keys are
//       "$delete": [keys]   keys to remove from the base
//       "$replace": value   ignore the base and use this value whole
//   - anything else (array, string, number, null…) replaces the base value.
// Unlike RFC 7386 merge patch, null is an ordinary value here (gamedata uses
// null for "Infinity" move costs), so deletes are spelled out with $delete.
//
// The editor suite ships the same two functions in editor-core.js
// (EditorCore.createDataPatch / applyDataPatch); a test keeps them in step.

function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function clone(v) {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
        return true;
    }
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    for (const k of ka) {
        if (!Object.prototype.hasOwnProperty.call(b, k) || !deepEqual(a[k], b[k])) return false;
    }
    return true;
}

/**
 * The patch that turns `base` into `target`, or undefined when they are equal.
 */
export function createDataPatch(base, target) {
    if (deepEqual(base, target)) return undefined;
    if (!isPlainObject(base) || !isPlainObject(target)) {
        // A plain object given as a whole value must not be read as a patch.
        return isPlainObject(target) ? { $replace: clone(target) } : clone(target);
    }
    const patch = {};
    const removed = Object.keys(base).filter(k => !Object.prototype.hasOwnProperty.call(target, k));
    if (removed.length) patch.$delete = removed;
    for (const k of Object.keys(target)) {
        const sub = Object.prototype.hasOwnProperty.call(base, k)
            ? createDataPatch(base[k], target[k])
            : (isPlainObject(target[k]) ? { $replace: clone(target[k]) } : clone(target[k]));
        if (sub !== undefined) patch[k] = sub;
    }
    return patch;
}

/**
 * `base` with `patch` applied. Never mutates either argument.
 */
export function applyDataPatch(base, patch) {
    if (patch === undefined) return clone(base);
    if (!isPlainObject(patch)) return clone(patch);
    if (Object.prototype.hasOwnProperty.call(patch, '$replace')) return clone(patch.$replace);
    const out = isPlainObject(base) ? clone(base) : {};
    for (const k of Array.isArray(patch.$delete) ? patch.$delete : []) delete out[k];
    for (const k of Object.keys(patch)) {
        if (k === '$delete') continue;
        out[k] = applyDataPatch(out[k], patch[k]);
    }
    return out;
}

/**
 * Apply a { sectionKey: patch } map onto a gamedata object, in place.
 * Returns the list of section keys that were patched.
 */
export function applySectionPatches(gamedata, patches) {
    const applied = [];
    if (!gamedata || !isPlainObject(patches)) return applied;
    for (const [key, patch] of Object.entries(patches)) {
        if (patch === undefined) continue;
        gamedata[key] = applyDataPatch(gamedata[key], patch);
        applied.push(key);
    }
    return applied;
}

/**
 * Fold the Tech Tree editor's `customTechs` ({ categories, techs,
 * researchCosts }) into a gamedata `technology` section, in place.
 * Editor categories are keyed by lower-case id; the game keys them upper-case.
 */
export function mergeCustomTechs(technology, customTechs) {
    if (!technology || !isPlainObject(customTechs)) return 0;
    let n = 0;
    for (const c of Object.values(customTechs.categories || {})) {
        if (!c || !c.id) continue;
        technology.CATEGORIES = technology.CATEGORIES || {};
        technology.CATEGORIES[String(c.id).toUpperCase()] = { id: c.id, name: c.name || c.id, icon: c.icon || '🔬', color: c.color || '#888888' };
        n++;
    }
    for (const [KEY, t] of Object.entries(customTechs.techs || {})) {
        if (!t || !t.id) continue;
        technology.TECHS = technology.TECHS || {};
        technology.TECHS[KEY] = { ...clone(t) };
        n++;
    }
    for (const [id, cost] of Object.entries(customTechs.researchCosts || {})) {
        technology.RESEARCH_COSTS = technology.RESEARCH_COSTS || {};
        technology.RESEARCH_COSTS[id] = clone(cost);
    }
    return n;
}
