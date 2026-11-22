// ============================================
// MAIM FAITH — how a faith takes the knife
// ============================================
// The realm's faith (kingdom.religion.faithId) and the creed the player keeps
// (a founded religion, leaned by its tenets; or a world faith adopted through
// systems/devotion.js) each take a STANCE on mutilation:
//
//   sacred   the body is the god's: the realm's regard and the crown's heat
//            weigh heavier, a lawful sentence excuses less, the clergy turn
//            against the doer, a mutilation law costs more to proclaim, the
//            realm's own courts take fewer hands.
//   mild     neither blesses nor curses the knife.
//   harsh    the law's knife is the god's justice: the lawful deed weighs
//            little, the realm grumbles less at a mutilation law.
//
// Readers: systems/maiming.js brand (regard, heat, karma, cruelty, clergy
// standing, faith) and its weekly courts (aiLaw); systems/laws.js canEnact
// (the mutilation law's cost). Pure lookups: only DataLoader, no state, no
// randomness. Content: data/maiming.json → faith.

import { DataLoader } from '../core/dataLoader.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

const MILD = { label: 'neither blesses nor curses the knife', icon: '⚖️', rep: 1, heat: 1, lawful: 0.3, clergy: 0.3, lawfulClergy: 0, karma: 1, cruelty: 1, ownClergy: 0.5, faithLoss: 0, lawStability: 0, lawCost: 1, aiLaw: 1, line: '' };

export const MaimFaith = {
    config() {
        const d = DataLoader._gamedata && DataLoader._gamedata.maiming;
        return _obj(d && d.faith) || { faiths: {}, tenets: {}, stances: { mild: MILD } };
    },

    /** The stance's tuning: { label, icon, rep, heat, lawful, clergy, … }. */
    def(stance) {
        const S = _obj(MaimFaith.config().stances) || {};
        return { ...MILD, ...(_obj(S.mild) || {}), ...(_obj(S[stance]) || {}) };
    },

    /** A world faith's stance: 'sacred' | 'mild' | 'harsh'. */
    stanceOfFaith(faithId) {
        const f = (_obj(MaimFaith.config().faiths) || {})[faithId];
        return f === 'sacred' || f === 'harsh' ? f : 'mild';
    },

    /** A founded religion's tenets lean it: sum ≤ −2 sacred, ≥ 2 harsh. */
    stanceOfTenets(tenets) {
        const T = _obj(MaimFaith.config().tenets) || {};
        const s = (Array.isArray(tenets) ? tenets : []).reduce((a, t) => a + _num(T[t]), 0);
        return s <= -2 ? 'sacred' : s >= 2 ? 'harsh' : 'mild';
    },

    /** The realm's faith id, or null. */
    realmFaith(world, kingdomId) {
        if (kingdomId == null || !world) return null;
        const k = typeof world.getKingdom === 'function' ? world.getKingdom(kingdomId)
            : (world.kingdoms || []).find(x => x && String(x.id) === String(kingdomId));
        return (k && k.religion && k.religion.faithId) || null;
    },

    /** How the realm's faith takes it. */
    realmStance(world, kingdomId) {
        const f = MaimFaith.realmFaith(world, kingdomId);
        return f ? MaimFaith.stanceOfFaith(f) : 'mild';
    },

    /** The creed the player keeps: { id (world faith id or 'own'), name, stance } or null. */
    creed(player) {
        if (!player) return null;
        const r = _obj(player.religion);
        if (r && r.name) {
            if (r.worldFaithId) return { id: r.worldFaithId, name: r.name, stance: MaimFaith.stanceOfFaith(r.worldFaithId), own: true };
            return { id: 'own', name: r.name, stance: MaimFaith.stanceOfTenets(r.tenets), own: true };
        }
        const fid = _obj(player.devotion) && player.devotion.faithId;
        return fid ? { id: fid, name: MaimFaith.faithName(fid), stance: MaimFaith.stanceOfFaith(fid), own: false } : null;
    },

    playerStance(player) {
        const c = MaimFaith.creed(player);
        return c ? c.stance : 'mild';
    },

    faithName(faithId) {
        const gd = DataLoader._gamedata;
        const f = gd && gd.religion && gd.religion.faiths && gd.religion.faiths[faithId];
        return (f && f.name) || String(faithId || 'the faith');
    },

    /**
     * What a mutilation law (an option that takes a limb) costs a realm on
     * top of the usual: { stability, costMult, stance }. 'never' costs nothing extra.
     */
    lawCost(world, kingdomId, optionId) {
        const stance = MaimFaith.realmStance(world, kingdomId);
        const d = MaimFaith.def(stance);
        if (optionId === 'never') return { stability: 0, costMult: 1, stance };
        return { stability: _num(d.lawStability), costMult: _num(d.lawCost, 1), stance };
    },
};
