// ============================================
// UPBRINGING — raising the heirs of the House
// ============================================
// From about age 6 to 16 every child of the player has an education focus
// (martial, stewardship, diplomacy, learning, intrigue or piety) chosen by the
// player. A tutor can be hired: a court figure for gold, or a travelling
// companion. Each growth tick the child's stats and skills grow toward the
// focus, faster with a matching tutor.
//
// Personality is grown, not rolled. Each child holds "seeds": points toward
// the earned traits of systems/traits.js. The focus, the tutor, childhood
// events (data-driven dilemmas with choices: a bully, a fever, a duel…) and
// the parent's own earned traits (which have a chance to rub off) feed the
// seeds. Seeds above a threshold are the child's childhood traits; at coming
// of age (16) they become fixed adult traits, which the child carries into
// rule as real earned traits if they inherit (Traits.grantTraits).
//
// After coming of age the child can be given a House office (House.assignRole),
// married off or sent as a ward (systems/heirs.js). A ward's return is
// handled here, since it is part of the child's daily record.
//
// Determinism: growth is deterministic (fractional accumulators). Randomness
// (event rolls, risks, the parent's example) flows through Utils and is drawn
// only while the player has a child in the 6–16 window. No import-time side
// effects. Content: data/upbringing.json (DataLoader.upbringing).

import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { Traits } from './traits.js';
import { House } from './house.js';

const STATS = ['strength', 'charisma', 'intelligence', 'faith', 'luck'];
const SKILLS = ['commerce', 'combat', 'leadership', 'diplomacy', 'stealth', 'cartography'];

const DEFAULT_CONFIG = {
    startAge: 6, comeOfAgeAge: 16, growthCadence: 30, eventCadence: 40, eventChance: 0.45,
    pendingDays: 20, unfocusedSkillRate: 0.12, statCap: 14, skillCap: 8, seedThreshold: 3,
    seedCap: 12, maxChildhoodTraits: 3, parentRubOffChancePerYear: 0.35, parentRubOff: 1,
    mismatchTutorFactor: 0.3, companionQuality: 1.2, companionMatchQuality: 1.7, historyCap: 12,
};

function _num(v) {
    return typeof v === 'number' && isFinite(v) ? v : 0;
}

function _pronouns(child) {
    const f = child && child.gender === 'female';
    return { them: f ? 'her' : 'him', they: f ? 'she' : 'he', their: f ? 'her' : 'his', themself: f ? 'herself' : 'himself' };
}

export const Upbringing = {
    // ──────────── DATA ────────────

    data() {
        return (typeof DataLoader !== 'undefined' && DataLoader.upbringing) || {};
    },

    config() {
        return { ...DEFAULT_CONFIG, ...(Upbringing.data().config || {}) };
    },

    focuses() {
        return Upbringing.data().focuses || {};
    },

    focus(id) {
        return (id && Upbringing.focuses()[id]) || null;
    },

    tutors() {
        return Upbringing.data().tutors || [];
    },

    events() {
        return Upbringing.data().events || [];
    },

    _daysPerYear() {
        const rel = (typeof DataLoader !== 'undefined' && DataLoader.relationships) || null;
        return _num(rel && rel.heirSettings && rel.heirSettings.daysPerYear) || 120;
    },

    // ──────────── STATE ────────────

    _blank() {
        return {
            focus: null, focusSince: null, tutor: null, xp: {}, seeds: {}, events: [], pending: null,
            comeOfAge: false, comeOfAgeDay: null, adultTraits: [], placement: null, spouse: null, fostered: false,
        };
    },

    /** Get (creating/backfilling) a child's upbringing record. Never draws RNG. */
    ensure(child) {
        if (!child) return null;
        const up = child.upbringing;
        if (!up || typeof up !== 'object') {
            child.upbringing = Upbringing._blank();
            return child.upbringing;
        }
        const blank = Upbringing._blank();
        for (const k of Object.keys(blank)) if (up[k] === undefined) up[k] = blank[k];
        if (!up.xp || typeof up.xp !== 'object') up.xp = {};
        if (!up.seeds || typeof up.seeds !== 'object') up.seeds = {};
        if (!Array.isArray(up.events)) up.events = [];
        if (!Array.isArray(up.adultTraits)) up.adultTraits = [];
        if (!child.skills || typeof child.skills !== 'object') child.skills = {};
        for (const s of SKILLS) if (typeof child.skills[s] !== 'number') child.skills[s] = 0;
        return up;
    },

    /**
     * Backfill after load (and at game start): every child gets a default
     * upbringing; a child already of age counts as come of age, with no
     * adult traits. Deterministic.
     */
    loadState(player) {
        if (!player || !Array.isArray(player.children)) return;
        const cfg = Upbringing.config();
        for (const child of player.children) {
            if (!child) continue;
            const fresh = !child.upbringing;
            const up = Upbringing.ensure(child);
            if (fresh && (child.age || 0) >= cfg.comeOfAgeAge) {
                up.comeOfAge = true;
                up.comeOfAgeDay = null;
            }
        }
    },

    _child(player, childId) {
        return ((player && player.children) || []).find(c => c && c.id === childId) || null;
    },

    _living(player) {
        return ((player && player.children) || []).filter(c => c && c.isAlive !== false);
    },

    inChildhood(child) {
        const cfg = Upbringing.config();
        const up = child && child.upbringing;
        const age = (child && child.age) || 0;
        return !!child && child.isAlive !== false && !(up && up.comeOfAge) && age >= cfg.startAge && age < cfg.comeOfAgeAge;
    },

    isAway(child) {
        const p = child && child.upbringing && child.upbringing.placement;
        return !!(p && p.kind === 'ward' && !p.returned);
    },

    // ──────────── CHOICES ────────────

    /** Choose (or clear, with null) a child's education focus. */
    setFocus(player, childId, focusId, world = null) {
        const child = Upbringing._child(player, childId);
        if (!child || child.isAlive === false) return { success: false, reason: 'No such child.' };
        const up = Upbringing.ensure(child);
        if (up.comeOfAge) return { success: false, reason: `${child.firstName} has already come of age.` };
        if (focusId && !Upbringing.focus(focusId)) return { success: false, reason: 'Unknown focus.' };
        up.focus = focusId || null;
        up.focusSince = (world && world.day) || 0;
        return { success: true, focus: Upbringing.focus(focusId) };
    },

    /** Hire a court tutor (data/upbringing.json tutors) for gold. */
    hireCourtTutor(player, world, childId, tutorId) {
        const child = Upbringing._child(player, childId);
        if (!child || child.isAlive === false) return { success: false, reason: 'No such child.' };
        const up = Upbringing.ensure(child);
        if (up.comeOfAge) return { success: false, reason: `${child.firstName} is grown; tutors are for children.` };
        const def = Upbringing.tutors().find(t => t.id === tutorId);
        if (!def) return { success: false, reason: 'No such tutor.' };
        const cost = _num(def.hireCost);
        if ((player.gold || 0) < cost) return { success: false, reason: `The ${def.name} wants ${cost} gold up front.` };
        player.gold -= cost;
        up.tutor = {
            kind: 'court', id: def.id, name: def.name, icon: def.icon || '🧑‍🏫', focus: def.focus || null,
            quality: _num(def.quality) || 1, wage: _num(def.wage), seeds: { ...(def.seeds || {}) },
            since: (world && world.day) || 0,
        };
        return { success: true, tutor: up.tutor, cost };
    },

    /**
     * A travelling companion tutors the child. Their occupation decides what
     * they teach and their values what rubs off; `effectiveness` is their mood
     * tier's (Companions.tier(npc).effectiveness). They teach for free, but only
     * while they travel with the House.
     */
    hireCompanionTutor(player, world, childId, npc, effectiveness = 1) {
        const child = Upbringing._child(player, childId);
        if (!child || child.isAlive === false) return { success: false, reason: 'No such child.' };
        const up = Upbringing.ensure(child);
        if (up.comeOfAge) return { success: false, reason: `${child.firstName} is grown; tutors are for children.` };
        if (!npc || !Array.isArray(player.travelParty) || !player.travelParty.includes(npc.id)) {
            return { success: false, reason: 'Only a companion travelling with you can tutor.' };
        }
        const cfg = Upbringing.config();
        const focus = (Upbringing.data().companionOccupations || {})[npc.occupation] || null;
        const base = focus ? cfg.companionMatchQuality : cfg.companionQuality;
        const quality = Math.round((1 + (base - 1) * Math.max(0, _num(effectiveness) || 1)) * 100) / 100;
        const seeds = {};
        const valueSeeds = Upbringing.data().companionValueSeeds || {};
        for (const v of ((npc.companion && npc.companion.values) || [])) {
            for (const [id, pts] of Object.entries(valueSeeds[v] || {})) seeds[id] = _num(seeds[id]) + _num(pts);
        }
        up.tutor = {
            kind: 'companion', npcId: npc.id, name: `${npc.firstName}${npc.dynasty ? ' ' + npc.dynasty : ''}`,
            icon: '🧭', occupation: npc.occupation || null, focus, quality, wage: 0, seeds,
            since: (world && world.day) || 0,
        };
        return { success: true, tutor: up.tutor };
    },

    dismissTutor(player, childId) {
        const child = Upbringing._child(player, childId);
        if (!child) return { success: false, reason: 'No such child.' };
        const up = Upbringing.ensure(child);
        if (!up.tutor) return { success: false, reason: 'There is no tutor to dismiss.' };
        const tutor = up.tutor;
        up.tutor = null;
        return { success: true, tutor };
    },

    /** Growth multiplier from the tutor (1 without one). */
    tutorMultiplier(up) {
        const t = up && up.tutor;
        if (!t) return 1;
        const q = _num(t.quality) || 1;
        if (!t.focus || t.focus === up.focus) return q;
        return 1 + (q - 1) * Upbringing.config().mismatchTutorFactor;
    },

    // ──────────── GROWTH ────────────

    _addXp(child, kind, key, amount) {
        if (!(amount > 0)) return;
        const cfg = Upbringing.config();
        const up = child.upbringing;
        const k = `${kind}:${key}`;
        up.xp[k] = _num(up.xp[k]) + amount;
        while (up.xp[k] >= 1) {
            up.xp[k] -= 1;
            if (kind === 'stat') child[key] = Math.min(cfg.statCap, _num(child[key]) + 1);
            else child.skills[key] = Math.min(cfg.skillCap, _num(child.skills[key]) + 1);
        }
        up.xp[k] = Math.round(up.xp[k] * 10000) / 10000;
    },

    _addSeeds(child, seeds, scale = 1) {
        const cfg = Upbringing.config();
        const up = Upbringing.ensure(child);
        for (const [id, pts] of Object.entries(seeds || {})) {
            const v = _num(up.seeds[id]) + _num(pts) * scale;
            up.seeds[id] = Math.round(Utils.clamp(v, 0, cfg.seedCap) * 1000) / 1000;
        }
    },

    /** `years` of the focus's (or a general) education, at the tutor's pace. Deterministic. */
    _growPure(child, years, withTutor = true) {
        const cfg = Upbringing.config();
        const up = Upbringing.ensure(child);
        const mult = withTutor ? Upbringing.tutorMultiplier(up) : 1;
        const focus = Upbringing.focus(up.focus);
        if (focus) {
            for (const [stat, rate] of Object.entries(focus.stats || {})) Upbringing._addXp(child, 'stat', stat, _num(rate) * years * mult);
            for (const [skill, rate] of Object.entries(focus.skills || {})) Upbringing._addXp(child, 'skill', skill, _num(rate) * years * mult);
            Upbringing._addSeeds(child, focus.seeds, years);
        } else {
            for (const skill of SKILLS) Upbringing._addXp(child, 'skill', skill, cfg.unfocusedSkillRate * years * mult);
        }
        if (withTutor && up.tutor && up.tutor.seeds) Upbringing._addSeeds(child, up.tutor.seeds, years);
    },

    /** A growth tick: tutor upkeep, focus growth, and the parent's example. */
    _growthTick(player, world, child, out) {
        const cfg = Upbringing.config();
        const up = child.upbringing;
        const years = cfg.growthCadence / Upbringing._daysPerYear();

        // The tutor: a companion teaches only while travelling with you; a
        // court tutor wants wages.
        if (up.tutor) {
            const t = up.tutor;
            let leave = null;
            if (t.kind === 'companion' && !((player.travelParty || []).includes(t.npcId))) {
                leave = `${t.name} no longer travels with you and stops tutoring ${child.firstName}.`;
            } else if (t.kind === 'court' && t.wage > 0) {
                if ((player.gold || 0) >= t.wage) player.gold -= t.wage;
                else leave = `Unpaid, the ${t.name} leaves ${child.firstName}'s service.`;
            }
            if (leave) {
                up.tutor = null;
                out.tutorsLeft.push({ child, text: leave });
            }
        }

        Upbringing._growPure(child, years, true);

        // The parent's example: each of the ruler's earned traits may rub off
        const chance = cfg.parentRubOffChancePerYear * years;
        for (const id of Traits.getEarned(player)) {
            if (Utils.random() < chance) {
                Upbringing._addSeeds(child, { [id]: cfg.parentRubOff });
                out.rubOff.push({ child, traitId: id });
            }
        }
    },

    // ──────────── TRAITS ────────────

    /**
     * The child's childhood traits: seeds at or above the threshold, strongest
     * first, opposites resolved in favour of the stronger. After coming of age
     * the fixed adult traits are returned instead.
     */
    childhoodTraits(child) {
        const up = child && child.upbringing;
        if (!up) return [];
        if (up.comeOfAge) return up.adultTraits.filter(id => Traits.TRAITS[id]);
        const cfg = Upbringing.config();
        const ranked = Object.entries(up.seeds)
            .filter(([id, v]) => Traits.TRAITS[id] && v >= cfg.seedThreshold)
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        const out = [];
        for (const [id] of ranked) {
            const opp = Traits.TRAITS[id].opposite;
            if (opp && out.includes(opp)) continue;
            out.push(id);
            if (out.length >= cfg.maxChildhoodTraits) break;
        }
        return out;
    },

    /** Seeds still forming (above 1 but not yet traits): [{ id, pct }]. */
    leanings(child) {
        const up = child && child.upbringing;
        if (!up || up.comeOfAge) return [];
        const cfg = Upbringing.config();
        const held = Upbringing.childhoodTraits(child);
        return Object.entries(up.seeds)
            .filter(([id, v]) => Traits.TRAITS[id] && !held.includes(id) && !held.includes(Traits.TRAITS[id].opposite) && v >= 1)
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, 3)
            .map(([id, v]) => ({ id, pct: Math.min(99, Math.floor(v / cfg.seedThreshold * 100)) }));
    },

    /** The child comes of age: final stats, fixed traits, tutor released. */
    comeOfAge(player, world, child) {
        const up = Upbringing.ensure(child);
        if (up.comeOfAge) return null;
        up.adultTraits = Upbringing.childhoodTraits(child);
        up.comeOfAge = true;
        up.comeOfAgeDay = (world && world.day) || 0;
        up.pending = null;
        up.tutor = null;
        const focus = Upbringing.focus(up.focus);
        const names = up.adultTraits.map(id => Traits.TRAITS[id].name);
        const text = `${child.firstName} comes of age${focus ? `, raised in ${focus.name.toLowerCase()} arts` : ''}`
            + `${names.length ? ` — ${names.join(', ')}` : ''}.`;
        if (player && player.house) House._chronicle(player.house, world, text, ['upbringing', 'heirs']);
        return { child, traits: up.adultTraits.slice(), text };
    },

    /**
     * The heir takes up the mantle (Relationships.succeedAsHeir, after the
     * old ruler's traits were cleared): their upbringing's traits become real
     * earned traits. An under-age heir (regency) is brought of age first.
     */
    applyHeirTraits(player, child, world) {
        if (!player || !child) return [];
        const up = Upbringing.ensure(child);
        if (!up.comeOfAge) Upbringing.comeOfAge(null, world, child);
        return Traits.grantTraits(player, up.adultTraits);
    },

    // ──────────── EVENTS ────────────

    _eligibleEvents(player, child) {
        const up = child.upbringing;
        const age = child.age || 0;
        const recent = up.events.slice(-3).map(e => e.id);
        const siblings = Upbringing._living(player).filter(c => c.id !== child.id);
        return Upbringing.events().filter(ev => {
            if (age < _num(ev.minAge) || age > (ev.maxAge != null ? ev.maxAge : 99)) return false;
            if (recent.includes(ev.id)) return false;
            if (ev.requires && ev.requires.siblings && siblings.length === 0) return false;
            return true;
        });
    },

    _rollEvent(player, world, child) {
        const cfg = Upbringing.config();
        const up = child.upbringing;
        if (Utils.random() >= cfg.eventChance) return null;
        const pool = Upbringing._eligibleEvents(player, child);
        if (!pool.length) return null;
        const weight = ev => _num(ev.weight || 1) * _num((ev.focusWeight && ev.focusWeight[up.focus]) || 1);
        const total = pool.reduce((s, ev) => s + weight(ev), 0);
        let r = Utils.random() * total;
        let pick = pool[pool.length - 1];
        for (const ev of pool) {
            r -= weight(ev);
            if (r <= 0) { pick = ev; break; }
        }
        // The nearest-in-age sibling plays the other part (deterministic)
        const sibling = Upbringing._living(player)
            .filter(c => c.id !== child.id)
            .sort((a, b) => Math.abs((a.age || 0) - (child.age || 0)) - Math.abs((b.age || 0) - (child.age || 0)))[0] || null;
        const day = (world && world.day) || 0;
        up.pending = { eventId: pick.id, day, expires: day + cfg.pendingDays, siblingId: sibling ? sibling.id : null };
        return up.pending;
    },

    _fill(text, child, sibling) {
        const p = _pronouns(child);
        const up = child.upbringing || {};
        const feats = Upbringing.data().focusFeats || {};
        const feat = feats[up.focus || 'none'] || feats.none || '';
        return String(text || '')
            .replace(/\{focusFeat\}/g, feat)
            .replace(/\{child\}/g, child.firstName || 'The child')
            .replace(/\{sibling\}/g, (sibling && sibling.firstName) || 'a cousin')
            .replace(/\{themself\}/g, p.themself)
            .replace(/\{them\}/g, p.them)
            .replace(/\{they\}/g, p.they)
            .replace(/\{their\}/g, p.their);
    },

    /** A child's pending event, filled in for display, or null. */
    pendingEvent(player, child) {
        const up = child && child.upbringing;
        if (!up || !up.pending) return null;
        const def = Upbringing.events().find(e => e.id === up.pending.eventId);
        if (!def) return null;
        const sibling = up.pending.siblingId ? Upbringing._child(player, up.pending.siblingId) : null;
        return {
            id: def.id, title: def.title, icon: def.icon || '📜', expires: up.pending.expires,
            text: Upbringing._fill(def.text, child, sibling),
            choices: def.choices.map(c => ({
                id: c.id, label: Upbringing._fill(c.label, child, sibling), cost: _num(c.cost),
                affordable: (player.gold || 0) >= _num(c.cost), isDefault: c.id === def.default,
                risky: !!(c.risk || c.contest),
            })),
        };
    },

    /** Apply one effects block to the child (and the House). Returns a death flag. */
    _applyEffects(player, world, child, fx, sibling) {
        if (!fx) return;
        const cfg = Upbringing.config();
        for (const [stat, v] of Object.entries(fx.stats || {})) {
            if (STATS.includes(stat)) child[stat] = Utils.clamp(_num(child[stat]) + _num(v), 1, cfg.statCap);
        }
        for (const [skill, v] of Object.entries(fx.skills || {})) {
            if (SKILLS.includes(skill)) child.skills[skill] = Utils.clamp(_num(child.skills[skill]) + _num(v), 0, cfg.skillCap);
        }
        if (fx.seeds) Upbringing._addSeeds(child, fx.seeds);
        if (fx.siblingSeeds && sibling) Upbringing._addSeeds(sibling, fx.siblingSeeds);
        if (fx.focusBoost) Upbringing._growPure(child, _num(fx.focusBoost) * 0.5, false);
        if (fx.maxHealth) {
            child.maxHealth = Math.max(50, _num(child.maxHealth || 100) + _num(fx.maxHealth));
            child.health = Math.min(_num(child.health || child.maxHealth), child.maxHealth);
        }
        if (fx.gold) player.gold = Math.max(0, (player.gold || 0) + _num(fx.gold));
        if (fx.renown) player.renown = Math.max(0, (player.renown || 0) + _num(fx.renown));
        if (fx.karma) player.karma = (player.karma || 0) + _num(fx.karma);
        if (fx.prestige && player.house) {
            const day = (world && world.day) || 0;
            if (fx.prestige > 0) House.award(player.house, fx.prestige, `${child.firstName}'s childhood`, day);
            else House.spend(player.house, Math.min(player.house.prestige || 0, -fx.prestige), `${child.firstName}'s childhood`, day);
        }
    },

    /**
     * Answer a child's pending event. `choiceId` null takes the default (an
     * unanswered event resolves itself that way). Returns { success, text,
     * died, notable } or { success:false, reason }.
     */
    resolveEvent(player, world, childId, choiceId = null) {
        const child = Upbringing._child(player, childId);
        if (!child || child.isAlive === false) return { success: false, reason: 'No such child.' };
        const up = Upbringing.ensure(child);
        if (!up.pending) return { success: false, reason: 'Nothing awaits your decision.' };
        const def = Upbringing.events().find(e => e.id === up.pending.eventId);
        if (!def) {
            up.pending = null;
            return { success: false, reason: 'That matter has passed.' };
        }
        let choice = def.choices.find(c => c.id === (choiceId || def.default));
        if (!choice) return { success: false, reason: 'No such choice.' };
        const cost = _num(choice.cost);
        if (cost > (player.gold || 0)) {
            if (choiceId) return { success: false, reason: `That needs ${cost} gold.` };
            choice = def.choices.find(c => !_num(c.cost)) || choice;
        }
        if (_num(choice.cost) > 0) player.gold = Math.max(0, (player.gold || 0) - _num(choice.cost));

        const sibling = up.pending.siblingId ? Upbringing._child(player, up.pending.siblingId) : null;
        const fill = (t) => Upbringing._fill(t, child, sibling);
        const texts = [fill(choice.result)];
        let notable = false;
        let died = false;
        Upbringing._applyEffects(player, world, child, choice.effects, sibling);

        if (choice.contest) {
            const c = choice.contest;
            const chance = Utils.clamp(_num(c.base) + _num(c.per) * ((_num(child[c.stat]) - 5) + _num(child.skills[c.skill])), 0.05, 0.95);
            const branch = Utils.random() < chance ? c.win : c.lose;
            if (branch) {
                texts.push(fill(branch.result));
                Upbringing._applyEffects(player, world, child, branch.effects, sibling);
                notable = true;
            }
        }
        if (choice.risk && Utils.random() < _num(choice.risk.chance)) {
            texts.push(fill(choice.risk.result));
            Upbringing._applyEffects(player, world, child, choice.risk.effects, sibling);
            if (choice.risk.deathChance && Utils.random() < _num(choice.risk.deathChance)) {
                died = true;
                notable = true;
                child.isAlive = false;
                texts.push(fill(choice.risk.deathResult || '{child} dies.'));
            }
        }

        const day = (world && world.day) || 0;
        const text = texts.filter(Boolean).join(' ');
        const cfg = Upbringing.config();
        up.events.push({ day, age: child.age || 0, id: def.id, title: def.title, icon: def.icon || '📜', choice: fill(choice.label), text });
        if (up.events.length > cfg.historyCap) up.events = up.events.slice(-cfg.historyCap);
        up.pending = null;
        if (notable && player.house) House._chronicle(player.house, world, `${child.firstName}: ${text}`, ['upbringing']);
        if (died && player.heir === child.id) player.heir = null;
        return { success: true, child, event: def, choice, text, died, notable };
    },

    // ──────────── DAILY ────────────

    /**
     * Daily tick. Draws no RNG unless a child is in the 6–16 window.
     * Returns { events, resolved, comeOfAge, tutorsLeft, rubOff, wardsReturned }.
     */
    processDay(player, world) {
        const out = { events: [], resolved: [], comeOfAge: [], tutorsLeft: [], rubOff: [], wardsReturned: [] };
        const kids = Upbringing._living(player);
        if (!kids.length) return out;
        const cfg = Upbringing.config();
        const day = (world && world.day) || 0;

        for (const child of kids) {
            const up = Upbringing.ensure(child);

            if (!up.comeOfAge && (child.age || 0) >= cfg.comeOfAgeAge) {
                const res = Upbringing.comeOfAge(player, world, child);
                if (res) out.comeOfAge.push(res);
            }
            if (Upbringing.isAway(child) && day >= _num(up.placement.until)) {
                out.wardsReturned.push(Upbringing._returnWard(player, world, child));
            }
            if (!Upbringing.inChildhood(child)) continue;

            if (up.pending && day >= _num(up.pending.expires)) {
                const res = Upbringing.resolveEvent(player, world, child.id, null);
                if (res.success) out.resolved.push(res);
                if (child.isAlive === false) continue;
            }
            if (cfg.growthCadence > 0 && day % cfg.growthCadence === 0) {
                Upbringing._growthTick(player, world, child, out);
            }
            if (!up.pending && cfg.eventCadence > 0 && day > 0 && day % cfg.eventCadence === 0) {
                const p = Upbringing._rollEvent(player, world, child);
                if (p) out.events.push({ child, event: Upbringing.pendingEvent(player, child) });
            }
        }
        return out;
    },

    /** A ward comes home: skills, a trait learned from the lord, standing with their realm. */
    _returnWard(player, world, child) {
        const up = child.upbringing;
        const p = up.placement;
        p.returned = true;
        const cfg = Upbringing.config();
        const pl = Upbringing.data().placements || {};
        for (const [skill, v] of Object.entries(pl.wardSkills || {})) {
            child.skills[skill] = Math.min(cfg.skillCap, _num(child.skills[skill]) + _num(v));
        }
        let trait = null;
        const def = p.trait && Traits.TRAITS[p.trait];
        if (def && !up.adultTraits.includes(p.trait) && !(def.opposite && up.adultTraits.includes(def.opposite))) {
            up.adultTraits.push(p.trait);
            trait = p.trait;
        }
        if (p.kingdomId) {
            if (!player.reputation) player.reputation = {};
            player.reputation[p.kingdomId] = (player.reputation[p.kingdomId] || 0) + _num(pl.wardReputation);
        }
        const text = `${child.firstName} returns from fostering at the court of ${p.lordName || p.kingdomName || 'a lord'}`
            + `${trait ? `, ${Traits.TRAITS[trait].name.toLowerCase()} like their host` : ''}.`;
        if (player.house) House._chronicle(player.house, world, text, ['heirs']);
        return { child, trait, text };
    },

    // ──────────── UI ────────────

    /** Display profile of one child (Dynasty panel, death screen). */
    profile(player, child) {
        if (!child) return null;
        const up = Upbringing.ensure(child);
        const cfg = Upbringing.config();
        const tr = id => ({ id, name: (Traits.TRAITS[id] || {}).name || id, icon: (Traits.TRAITS[id] || {}).icon || '' });
        const role = player && player.house && player.house.roles
            ? (House.ROLE_IDS.find(r => player.house.roles[r] === child.id) || null) : null;
        const focus = Upbringing.focus(up.focus);
        return {
            id: child.id, name: `${child.firstName} ${child.dynasty || ''}`.trim(), firstName: child.firstName,
            age: child.age || 0, gender: child.gender, alive: child.isAlive !== false,
            stage: up.comeOfAge ? 'adult' : (child.age || 0) < cfg.startAge ? 'infant' : 'child',
            focus: focus ? { id: up.focus, name: focus.name, icon: focus.icon } : null,
            tutor: up.tutor ? { ...up.tutor, multiplier: Upbringing.tutorMultiplier(up) } : null,
            stats: STATS.reduce((a, s) => { a[s] = _num(child[s]); return a; }, {}),
            skills: SKILLS.reduce((a, s) => { a[s] = _num(child.skills && child.skills[s]); return a; }, {}),
            maxHealth: _num(child.maxHealth) || 100,
            birthTraits: (Array.isArray(child.traits) ? child.traits : []).map(t => ({ id: t.id, name: t.name, icon: t.icon })),
            traits: Upbringing.childhoodTraits(child).map(tr),
            leanings: Upbringing.leanings(child).map(l => ({ ...tr(l.id), pct: l.pct })),
            events: up.events.slice(-5).reverse(),
            pending: Upbringing.pendingEvent(player, child),
            comeOfAge: up.comeOfAge,
            placement: up.placement,
            spouse: up.spouse,
            away: Upbringing.isAway(child),
            role,
        };
    },

    /** One line for an heir card: "⚔️ Martial · 🦁 Brave, 🦊 Cunning". */
    summary(player, child) {
        const p = Upbringing.profile(player, child);
        if (!p) return '';
        const parts = [];
        parts.push(p.focus ? `${p.focus.icon} ${p.focus.name}` : 'No focus');
        if (p.traits.length) parts.push(p.traits.map(t => `${t.icon} ${t.name}`).join(', '));
        return parts.join(' · ');
    },
};
