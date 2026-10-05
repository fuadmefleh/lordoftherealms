// ============================================
// TRAITS — earned character traits
// ============================================
// The player's character becomes someone through what they do. Deeds are
// recorded from existing hooks (Quests.track counters, combat, threats,
// gifts, festivals, bounties, gambling, …) as `Traits.recordDeed(player, x)`.
// Each trait accumulates progress from its deeds; when progress reaches the
// trait's threshold the trait is earned. Deeds that go against a trait
// (`erodedBy`) wear its progress down, and a trait whose progress falls below
// `loseFraction` of its threshold is lost. Opposite traits (Brave/Craven,
// Generous/Greedy, …) cannot coexist: earning one displaces the other.
//
// Earned traits carry modest effects read by PlayerEffects (battle power,
// prices, negotiation, diplomacy, reputation gains), NpcDisposition (NPC
// warmth, intimidation), lords (opinion, trait affinity) and the council.
//
// Traits are not inherited. On succession the House keeps a "reputation of
// the dynasty" echo — the late ruler's strongest traits at reduced strength,
// fading day by day — which only affects how others react (config.echoKeys).
//
// Content lives in data/traits.json (loaded by DataLoader → Traits.load).
// No import-time side effects; no randomness (greeting picks take a roll).

const DEFAULT_CONFIG = {
    loseFraction: 0.5,
    maxFraction: 2,
    echoCount: 2,
    echoStrength: 0.5,
    echoDecayPerDay: 0.0025,
    echoMinStrength: 0.05,
    greetingChance: 0.3,
    highTaxGreedPerDay: 0.2,
    lowTaxGoodwillPerDay: 0.15,
    echoKeys: ['npcWarmth', 'lordOpinion', 'intimidation', 'reputationGain', 'negotiation',
        'clergy', 'commons', 'nobility', 'merchants', 'military'],
};

/** Notices kept for the UI before they are drained. */
const NOTICE_CAP = 20;

function _num(v) {
    return typeof v === 'number' && isFinite(v) ? v : 0;
}

export const Traits = {
    /** Trait definitions keyed by id (data/traits.json → traits). */
    TRAITS: {},
    /** Deed labels keyed by id (data/traits.json → deeds). */
    DEEDS: {},
    /** Quests.track stat → { deed: weight } (data/traits.json → statDeeds). */
    STAT_DEEDS: {},
    CONFIG: { ...DEFAULT_CONFIG },

    /** Install content from data/traits.json. */
    load(data) {
        if (!data) return;
        Traits.TRAITS = data.traits || {};
        Traits.DEEDS = data.deeds || {};
        Traits.STAT_DEEDS = data.statDeeds || {};
        Traits.CONFIG = { ...DEFAULT_CONFIG, ...(data.config || {}) };
    },

    // ──────────── STATE ────────────

    _blank() {
        return { deeds: {}, progress: {}, earned: {}, notices: [] };
    },

    /** Get (creating/backfilling) the player's trait state. */
    getState(player) {
        if (!player) return null;
        const st = player.traits;
        if (!st || typeof st !== 'object' || Array.isArray(st)) {
            player.traits = Traits._blank();
            return player.traits;
        }
        if (!st.deeds || typeof st.deeds !== 'object') st.deeds = {};
        if (!st.progress || typeof st.progress !== 'object') st.progress = {};
        if (!st.earned || typeof st.earned !== 'object') st.earned = {};
        if (!Array.isArray(st.notices)) st.notices = [];
        return st;
    },

    /** Ids of the traits the player currently holds. */
    getEarned(player) {
        if (!player || !player.traits || !player.traits.earned) return [];
        return Object.keys(player.traits.earned).filter(id => Traits.TRAITS[id]);
    },

    has(player, traitId) {
        return !!(player && player.traits && player.traits.earned && player.traits.earned[traitId]);
    },

    /** Progress / threshold for a trait (0 – maxFraction). */
    strength(player, traitId) {
        const def = Traits.TRAITS[traitId];
        if (!def || !player || !player.traits) return 0;
        return _num(player.traits.progress[traitId]) / Math.max(1, def.threshold || 1);
    },

    // ──────────── DEEDS ────────────

    /**
     * Record a deed. Adds to the deed counter, advances every trait fed by the
     * deed and erodes every trait that deed goes against. Returns the trait
     * changes: { gained:[id], lost:[id] } (also queued as UI notices).
     */
    recordDeed(player, deed, amount = 1) {
        const out = { gained: [], lost: [] };
        if (!player || !deed || !(amount > 0)) return out;
        const st = Traits.getState(player);
        st.deeds[deed] = _num(st.deeds[deed]) + amount;
        const cfg = Traits.CONFIG;
        for (const [id, def] of Object.entries(Traits.TRAITS)) {
            const gain = _num(def.deeds && def.deeds[deed]) * amount;
            const loss = _num(def.erodedBy && def.erodedBy[deed]) * amount;
            if (!gain && !loss) continue;
            const cap = (def.threshold || 1) * cfg.maxFraction;
            st.progress[id] = Math.max(0, Math.min(cap, _num(st.progress[id]) + gain - loss));
        }
        Traits._settle(player, out);
        return out;
    },

    /** Record several deeds at once: { deed: amount }. Zero/negative entries are skipped. */
    recordDeeds(player, deeds) {
        const out = { gained: [], lost: [] };
        for (const [deed, amount] of Object.entries(deeds || {})) {
            const r = Traits.recordDeed(player, deed, amount);
            out.gained.push(...r.gained);
            out.lost.push(...r.lost);
        }
        return out;
    },

    /** Quests.track hook: turn a quest stat into deeds (data → statDeeds). */
    recordStat(player, stat, amount = 1) {
        const map = Traits.STAT_DEEDS[stat];
        if (!map) return null;
        const deeds = {};
        for (const [deed, weight] of Object.entries(map)) deeds[deed] = _num(weight) * amount;
        return Traits.recordDeeds(player, deeds);
    },

    /**
     * Acts against a kingdom: records the given deeds, plus kinslaying when
     * the act is violent (cruelty or dread) and the target is the realm the
     * player married into.
     */
    recordAggression(player, kingdomId, deeds) {
        const all = { ...(deeds || {}) };
        const violent = (all.cruelty || 0) > 0 || (all.dread || 0) > 0;
        if (violent && player && kingdomId && player.marriageAllianceKingdom === kingdomId) {
            all.kinslaying = (all.kinslaying || 0) + 1;
        }
        return Traits.recordDeeds(player, all);
    },

    /** Earn traits that reached their threshold, lose those that fell too low. */
    _settle(player, out) {
        const st = player.traits;
        const cfg = Traits.CONFIG;
        const day = _num(st.day);
        // Losses first, so erosion and a fresh gain in one deed resolve cleanly
        for (const id of Object.keys(st.earned)) {
            const def = Traits.TRAITS[id];
            if (!def) continue;
            if (_num(st.progress[id]) < (def.threshold || 1) * cfg.loseFraction) {
                delete st.earned[id];
                out.lost.push(id);
                Traits._notice(st, 'lost', id);
            }
        }
        for (const [id, def] of Object.entries(Traits.TRAITS)) {
            if (st.earned[id]) continue;
            if (_num(st.progress[id]) < (def.threshold || 1)) continue;
            // Opposites cannot coexist: the new trait displaces the old one
            const opp = def.opposite;
            if (opp && st.earned[opp]) {
                delete st.earned[opp];
                const oppDef = Traits.TRAITS[opp];
                st.progress[opp] = Math.min(_num(st.progress[opp]),
                    ((oppDef && oppDef.threshold) || 1) * cfg.loseFraction);
                out.lost.push(opp);
                Traits._notice(st, 'lost', opp, id);
            }
            st.earned[id] = { since: day };
            out.gained.push(id);
            Traits._notice(st, 'gained', id);
        }
    },

    _notice(st, kind, id, by = null) {
        st.notices.push(by ? { kind, id, by } : { kind, id });
        if (st.notices.length > NOTICE_CAP) st.notices.splice(0, st.notices.length - NOTICE_CAP);
    },

    /**
     * Take the queued gain/loss notices for display. Returns
     * [{ kind:'gained'|'lost', id, title, text }].
     */
    drainNotices(player) {
        if (!player || !player.traits || !Array.isArray(player.traits.notices) || !player.traits.notices.length) return [];
        const notices = player.traits.notices.splice(0);
        return notices.map(n => {
            const def = Traits.TRAITS[n.id] || { name: n.id, icon: '' };
            const byDef = n.by && Traits.TRAITS[n.by];
            if (n.kind === 'gained') {
                return { ...n, title: `${def.icon} Trait Earned: ${def.name}`, text: def.description || '' };
            }
            return {
                ...n,
                title: `${def.icon} Trait Lost: ${def.name}`,
                text: byDef ? `Your deeds as ${byDef.name} have overturned it.` : 'You have acted against it for too long.',
            };
        });
    },

    // ──────────── DAILY ────────────

    /**
     * Daily tick: habits fade without practice (decayPerDay), your tax policy
     * reads as greed or goodwill, and the dynasty echo fades.
     */
    processDay(player, world) {
        const out = { gained: [], lost: [] };
        if (!player) return out;
        const st = Traits.getState(player);
        st.day = (world && world.day) || st.day || 0;
        const cfg = Traits.CONFIG;

        for (const [id, def] of Object.entries(Traits.TRAITS)) {
            const decay = _num(def.decayPerDay);
            if (decay > 0 && st.progress[id] > 0) st.progress[id] = Math.max(0, st.progress[id] - decay);
        }

        // Ruling settlements: heavy taxes are greed, light ones goodwill
        const rules = (player.colonies && player.colonies.length > 0) || !!player.currentTitle;
        if (rules) {
            const rate = player.taxRate || 'moderate';
            if (rate === 'high' || rate === 'very_high') {
                Traits.recordDeed(player, 'greed', cfg.highTaxGreedPerDay * (rate === 'very_high' ? 2 : 1));
            } else if (rate === 'low' || rate === 'very_low') {
                const g = cfg.lowTaxGoodwillPerDay * (rate === 'very_low' ? 2 : 1);
                Traits.recordDeeds(player, { generosity: g, popularity: g });
            }
        }

        Traits._settle(player, out);
        Traits._fadeEcho(player);
        return out;
    },

    // ──────────── SUCCESSION ────────────

    /** The House's fading memory of past rulers' traits: [{ id, strength, from }]. */
    getEcho(player) {
        const house = player && player.house;
        return (house && Array.isArray(house.traitEcho)) ? house.traitEcho : [];
    },

    /**
     * The heir takes over. Traits are not inherited: the old ruler's two
     * strongest traits pass to the House as a faded echo, and the new
     * character starts with a clean slate.
     */
    onSuccession(player, world, oldName = null) {
        if (!player) return [];
        const st = Traits.getState(player);
        const cfg = Traits.CONFIG;
        const ranked = Object.keys(st.earned)
            .filter(id => Traits.TRAITS[id])
            .map(id => ({ id, s: Traits.strength(player, id) }))
            .sort((a, b) => b.s - a.s || a.id.localeCompare(b.id))
            .slice(0, cfg.echoCount);
        const echo = ranked.map(r => ({
            id: r.id,
            strength: Math.round(cfg.echoStrength * Math.min(1, r.s) * 1000) / 1000,
            from: oldName || null,
            day: (world && world.day) || 0,
        }));
        if (player.house) {
            // The newest memory replaces older echoes of the same trait
            const older = Traits.getEcho(player).filter(e => !echo.some(n => n.id === e.id));
            player.house.traitEcho = [...echo, ...older];
        }
        player.traits = Traits._blank();
        return echo;
    },

    /**
     * Grant traits outright (an heir's upbringing — systems/upbringing.js).
     * Each trait starts at its threshold, so it holds but is not yet deeply
     * set. A trait whose opposite is already held is skipped. Returns the
     * ids granted.
     */
    grantTraits(player, ids) {
        if (!player || !Array.isArray(ids)) return [];
        const st = Traits.getState(player);
        const granted = [];
        for (const id of ids) {
            const def = Traits.TRAITS[id];
            if (!def || st.earned[id]) continue;
            if (def.opposite && st.earned[def.opposite]) continue;
            st.progress[id] = Math.max(_num(st.progress[id]), def.threshold || 1);
            st.earned[id] = { since: _num(st.day) };
            Traits._notice(st, 'gained', id);
            granted.push(id);
        }
        return granted;
    },

    _fadeEcho(player) {
        const house = player && player.house;
        if (!house || !Array.isArray(house.traitEcho) || !house.traitEcho.length) return;
        const cfg = Traits.CONFIG;
        house.traitEcho = house.traitEcho
            .map(e => ({ ...e, strength: Math.round((_num(e.strength) - cfg.echoDecayPerDay) * 10000) / 10000 }))
            .filter(e => e.strength >= cfg.echoMinStrength);
    },

    // ──────────── EFFECTS ────────────

    /**
     * Sum of one effect over the player's traits, plus the dynasty echo for
     * the social keys in config.echoKeys (scaled by the echo's strength).
     */
    effect(player, key) {
        if (!player) return 0;
        let total = 0;
        for (const id of Traits.getEarned(player)) {
            total += _num((Traits.TRAITS[id].effects || {})[key]);
        }
        if ((Traits.CONFIG.echoKeys || []).includes(key)) {
            for (const e of Traits.getEcho(player)) {
                const def = Traits.TRAITS[e.id];
                if (def) total += _num((def.effects || {})[key]) * _num(e.strength);
            }
        }
        return total;
    },

    /** Multiplier on positive NPC disposition gains (Dread Lord: loved by none). */
    npcWarmthMultiplier(player) {
        return Math.max(0.25, 1 + Traits.effect(player, 'npcWarmth'));
    },

    /**
     * A lord's opinion adjustment: the traits' flat lordOpinion plus their
     * affinity with the lord's own traits (a Pious lord likes a Pious player).
     */
    lordOpinion(player, lord) {
        if (!player) return 0;
        let total = Traits.effect(player, 'lordOpinion');
        const lordTraits = ((lord && lord.traits) || []).map(t => (t && t.id) || t);
        if (!lordTraits.length) return Math.round(total);
        const affinity = (def, scale) => {
            for (const [lt, v] of Object.entries(def.lordAffinity || {})) {
                if (lordTraits.includes(lt)) total += _num(v) * scale;
            }
        };
        for (const id of Traits.getEarned(player)) affinity(Traits.TRAITS[id], 1);
        for (const e of Traits.getEcho(player)) {
            if (Traits.TRAITS[e.id]) affinity(Traits.TRAITS[e.id], _num(e.strength));
        }
        return Math.round(total);
    },

    /**
     * A flavoured greeting from one of the player's traits, or null.
     * `roll` and `pick` are in [0,1) and come from the caller (UI randomness).
     */
    greetingLine(player, roll, pick = 0) {
        const earned = Traits.getEarned(player).filter(id => (Traits.TRAITS[id].greetings || []).length);
        if (!earned.length || !(roll < Traits.CONFIG.greetingChance)) return null;
        const lines = earned.flatMap(id => Traits.TRAITS[id].greetings);
        return lines[Math.min(lines.length - 1, Math.floor(pick * lines.length))];
    },

    // ──────────── UI ────────────

    /**
     * Character-panel summary: earned traits with strength, the nearest
     * unearned traits with progress, and the dynasty echo.
     */
    describe(player) {
        const st = (player && player.traits) || Traits._blank();
        const earned = Traits.getEarned(player).map(id => {
            const def = Traits.TRAITS[id];
            return {
                id, name: def.name, icon: def.icon, description: def.description,
                strength: Traits.strength(player, id),
                effects: def.effects || {},
            };
        });
        const progress = Object.entries(Traits.TRAITS)
            .filter(([id]) => !(st.earned && st.earned[id]))
            .map(([id, def]) => {
                const blocked = def.opposite && st.earned && st.earned[def.opposite];
                return {
                    id, name: def.name, icon: def.icon,
                    pct: Math.min(99, Math.floor(_num(st.progress && st.progress[id]) / Math.max(1, def.threshold) * 100)),
                    displaces: blocked ? (Traits.TRAITS[def.opposite] || {}).name : null,
                };
            })
            .filter(p => p.pct > 0)
            .sort((a, b) => b.pct - a.pct)
            .slice(0, 4);
        const echo = Traits.getEcho(player)
            .filter(e => Traits.TRAITS[e.id])
            .map(e => ({ ...e, name: Traits.TRAITS[e.id].name, icon: Traits.TRAITS[e.id].icon }));
        return { earned, progress, echo };
    },

    /** Short "+5% battle power, …" text for a trait's effects. */
    effectText(effects) {
        const pct = (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;
        const pts = (v) => `${v > 0 ? '+' : ''}${v}`;
        const LABELS = {
            battlePower: v => `${pct(v)} battle power`,
            tradeBonus: v => `${pct(v)} prices`,
            negotiation: v => `${pct(v)} negotiation`,
            diplomacy: v => `${pts(v)} diplomacy`,
            reputationGain: v => `${pct(v)} reputation gains`,
            npcWarmth: v => `${pct(v)} goodwill from townsfolk`,
            intimidation: v => (v < 0 ? `intimidate ${-v} easier` : `intimidate ${v} harder`),
            lordOpinion: v => `${pts(v)} lord opinion`,
            gamblingLuck: v => `${pct(v)} dice luck`,
            clergy: v => `${pts(v)} clergy`,
            commons: v => `${pts(v)} commons`,
            nobility: v => `${pts(v)} nobility`,
            merchants: v => `${pts(v)} merchants`,
            military: v => `${pts(v)} military faction`,
        };
        return Object.entries(effects || {})
            .filter(([k, v]) => LABELS[k] && v)
            .map(([k, v]) => LABELS[k](v))
            .join(', ');
    },

    // ──────────── PERSISTENCE ────────────

    serialize(player) {
        const st = player && player.traits;
        if (!st) return null;
        return JSON.parse(JSON.stringify({ deeds: st.deeds, progress: st.progress, earned: st.earned, notices: st.notices, day: st.day || 0 }));
    },

    /** Restore after load; backfills a blank state for saves from before traits. */
    loadState(player) {
        Traits.getState(player);
        if (player && player.house && !Array.isArray(player.house.traitEcho)) player.house.traitEcho = [];
    },
};
