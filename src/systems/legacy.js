// ============================================
// LEGACY — the House Chronicle across generations
// ============================================
// The House keeps one record per ruler. A reign opens when a ruler takes up
// the mantle (game start, or an heir succeeding) and closes when they die.
// The closed record summarises the reign: years ruled, the ruler's earned
// traits, titles and crowns, battles, quests, wars, delves, rival
// adventurers bested, petitions ruled (with the notable rulings), children
// born, Prestige gained and the chronicle's highlights. Deed counts are
// deltas of counters other systems already keep (House.stats, delve, rival
// and petition stats), measured against a snapshot taken when the reign
// opened, so no other system needs a new hook.
//
// When the line ends (no heir), the House is closed with an epitaph and a
// legacy score: weighted deeds of every reign plus generations and Prestige
// (data/upbringing.json → legacy).
//
// State: player.house.reigns ([] of closed records), player.house.currentReign
// (the open one) and player.house.ended. Saved with the House. No randomness.

import { DataLoader } from '../core/dataLoader.js';
import { House } from './house.js';
import { Traits } from './traits.js';
import { Deeds } from './deeds.js';

const DEFAULT_LEGACY = {
    weights: {
        generation: 40, yearRuled: 2, prestige: 1, crown: 150, title: 20, settlement: 25, battle: 3, quest: 2,
        ambitionMilestone: 10, ambitionCapstone: 60, delveCleared: 6, rivalBested: 5, petitionRuled: 1,
        child: 5, earnedTrait: 4, nobleMarriage: 10,
        holdingProject: 3, raidRepelled: 4, rebellionCrushed: 6,
    },
    ranks: [{ min: 0, label: 'A Forgotten Line', icon: '🕯️' }],
    epithets: [],
    highlightTags: ['throne', 'ambition', 'capstone', 'war', 'court'],
    highlightCap: 8,
    notableRulingCap: 3,
};

function _num(v) {
    return typeof v === 'number' && isFinite(v) ? v : 0;
}

export const Legacy = {
    config() {
        const d = (typeof DataLoader !== 'undefined' && DataLoader.upbringing && DataLoader.upbringing.legacy) || {};
        return { ...DEFAULT_LEGACY, ...d, weights: { ...DEFAULT_LEGACY.weights, ...(d.weights || {}) } };
    },

    _daysPerYear() {
        const rel = (typeof DataLoader !== 'undefined' && DataLoader.relationships) || null;
        return _num(rel && rel.heirSettings && rel.heirSettings.daysPerYear) || 120;
    },

    /** Counters a reign is measured by, read from state other systems keep. */
    _snapshot(player) {
        const house = (player && player.house) || {};
        const rivals = player && player.rivals && player.rivals.stats;
        const delves = player && player.delves && player.delves.stats;
        const petitions = player && player.petitions && player.petitions.stats;
        const holdings = player && player.holdings && player.holdings.stats;
        return {
            prestige: _num(house.prestige),
            stats: { ...(house.stats || {}) },
            delves: _num(delves && delves.delves),
            delvesCleared: _num(delves && delves.cleared),
            rivalsBested: rivals ? _num(rivals.duelsWon) + _num(rivals.slain) + _num(rivals.racesWon) : 0,
            petitionsRuled: _num(petitions && petitions.ruled),
            holdingProjects: _num(holdings && holdings.projects),
            raidsRepelled: _num(holdings && holdings.raidsRepelled),
            rebellionsCrushed: _num(holdings && holdings.rebellionsCrushed),
            holdingsLost: _num(holdings && holdings.holdingsLost),
            // Every counter Deeds & Records shows, for its 'this reign' column
            deeds: Deeds.collect(player),
        };
    },

    _zeroSnapshot() {
        return { prestige: 0, stats: {}, delves: 0, delvesCleared: 0, rivalsBested: 0, petitionsRuled: 0, holdingProjects: 0, raidsRepelled: 0, rebellionsCrushed: 0, holdingsLost: 0 };
    },

    /** Backfill the reign records (old saves, new games). Idempotent. */
    ensure(player, world) {
        const house = player && player.house;
        if (!house) return null;
        if (!Array.isArray(house.reigns)) house.reigns = [];
        if (house.currentReign === undefined || (house.currentReign === null && !house.ended)) {
            // A save from before the chronicle: the current ruler's reign is
            // taken to have begun at the last succession (or the founding),
            // measured from zero.
            const last = (house.history || []).filter(h => (h.tags || []).includes('succession')).pop();
            house.currentReign = {
                name: player.name || 'The Founder',
                generation: house.generation || 1,
                startDay: last ? last.day : _num(house.foundedDay),
                startAge: _num(player.age),
                snapshot: Legacy._zeroSnapshot(),
            };
        }
        if (house.ended === undefined) house.ended = null;
        return house;
    },

    /** A new ruler takes up the mantle. */
    openReign(player, world) {
        const house = player && player.house;
        if (!house) return null;
        if (!Array.isArray(house.reigns)) house.reigns = [];
        house.currentReign = {
            name: player.name,
            generation: house.generation || 1,
            startDay: (world && world.day) || 0,
            startAge: _num(player.age),
            snapshot: Legacy._snapshot(player),
        };
        return house.currentReign;
    },

    /** Build the summary of the open reign as it stands now (no state change). */
    summarize(player, world, opts = {}) {
        const house = Legacy.ensure(player, world);
        if (!house) return null;
        const cfg = Legacy.config();
        const r = house.currentReign;
        const now = Legacy._snapshot(player);
        const was = r.snapshot || Legacy._zeroSnapshot();
        const stat = k => Math.max(0, _num(now.stats[k]) - _num(was.stats && was.stats[k]));
        const day = (world && world.day) || 0;
        const gen = r.generation || house.generation || 1;
        const history = (house.history || []).filter(h => (h.generation || 1) === gen && h.day >= r.startDay);
        const tagged = (tag) => history.filter(h => (h.tags || []).includes(tag));

        // Highlights: the most important tags first, then told in order
        const prio = (h) => {
            const i = cfg.highlightTags.findIndex(t => (h.tags || []).includes(t));
            return i < 0 ? 999 : i;
        };
        const highlights = history
            .map((h, idx) => ({ h, idx, p: prio(h) }))
            .filter(x => x.p < 999)
            .sort((a, b) => a.p - b.p || b.idx - a.idx)
            .slice(0, cfg.highlightCap)
            .sort((a, b) => a.idx - b.idx)
            .map(x => ({ day: x.h.day, text: x.h.text }));

        const notable = ((player.petitions && player.petitions.notable) || [])
            .filter(n => _num(n.day) >= r.startDay)
            .slice(-cfg.notableRulingCap)
            .map(n => ({ day: n.day, text: `${n.title}${n.choice ? ` — ${n.choice}` : ''}` }));

        const ruling = player.throne && player.throne.ruling;
        const crownKingdom = ruling && world && world.getKingdom ? world.getKingdom(ruling.kingdomId) : null;
        const traits = Traits.getEarned(player);

        const rec = {
            name: r.name || player.name,
            generation: gen,
            startDay: r.startDay,
            endDay: day,
            startAge: r.startAge,
            endAge: _num(player.age),
            years: Math.round(((day - r.startDay) / Legacy._daysPerYear()) * 10) / 10,
            cause: opts.cause || null,
            traits,
            title: player.currentTitle ? (player.title || player.currentTitle) : null,
            crown: crownKingdom ? crownKingdom.name : null,
            crownsWon: stat('crowned'),
            battles: stat('battleWon'),
            quests: stat('quest'),
            titles: stat('titleGained'),
            settlements: stat('settlementHeld'),
            ambitionMilestones: stat('ambitionMilestone'),
            ambitionCapstones: tagged('capstone').length,
            nobleMarriages: stat('nobleMarriage'),
            wars: history.filter(h => (h.tags || []).includes('war') && /declares war/.test(h.text || '')).length,
            delves: Math.max(0, now.delves - _num(was.delves)),
            delvesCleared: Math.max(0, now.delvesCleared - _num(was.delvesCleared)),
            rivalsBested: Math.max(0, now.rivalsBested - _num(was.rivalsBested)),
            petitionsRuled: Math.max(0, now.petitionsRuled - _num(was.petitionsRuled)),
            holdingProjects: Math.max(0, now.holdingProjects - _num(was.holdingProjects)),
            raidsRepelled: Math.max(0, now.raidsRepelled - _num(was.raidsRepelled)),
            rebellionsCrushed: Math.max(0, now.rebellionsCrushed - _num(was.rebellionsCrushed)),
            holdingsLost: Math.max(0, now.holdingsLost - _num(was.holdingsLost)),
            notableRulings: notable,
            children: ((player.children || []).filter(c => c && _num(c.birthDay) >= r.startDay)).length,
            prestigeGained: Math.round(now.prestige - _num(was.prestige)),
            highlights,
        };
        // The royal court this ruler kept (Deeds' kingship tallies include
        // crowns since lost — house.crownLedger — so a deposed or succeeded
        // king's record survives), and the crowns lost in this reign
        const deed = k => Math.max(0, _num(now.deeds && now.deeds[k]) - _num(was.deeds && was.deeds[k]));
        rec.court = {};
        for (const k of ['edictsPassed', 'feasts', 'plotsRevealed', 'revolts', 'revoltsCrushed', 'revoltsConceded', 'lordsBroken', 'monopolyRevenue', 'doleGrain']) {
            const v = deed(`kingship.${k}`);
            if (v) rec.court[k] = v;
        }
        rec.crownsLost = (((house.crownLedger || {}).records) || [])
            .filter(c => _num(c.until) >= r.startDay && _num(c.until) <= day)
            .map(c => ({ kingdomName: c.kingdomName, how: c.how, days: c.days }));
        rec.epithet = Legacy.epithet(rec);
        rec.score = Legacy.reignScore(rec);
        return rec;
    },

    /** "the Crowned", "the Brave", … — the first rule a reign satisfies, else its first trait. */
    epithet(rec) {
        for (const e of Legacy.config().epithets || []) {
            if (_num(rec[e.field]) >= _num(e.min)) return e.epithet;
        }
        const t = (rec.traits || []).map(id => Traits.TRAITS[id]).find(Boolean);
        return t ? `the ${t.name}` : '';
    },

    reignScore(rec) {
        const w = Legacy.config().weights;
        return Math.round(
            _num(rec.years) * w.yearRuled + _num(rec.crownsWon) * w.crown + _num(rec.titles) * w.title
            + _num(rec.settlements) * w.settlement + _num(rec.battles) * w.battle + _num(rec.quests) * w.quest
            + _num(rec.ambitionMilestones) * w.ambitionMilestone + _num(rec.ambitionCapstones) * w.ambitionCapstone
            + _num(rec.delvesCleared) * w.delveCleared + _num(rec.rivalsBested) * w.rivalBested
            + _num(rec.petitionsRuled) * w.petitionRuled + _num(rec.children) * w.child
            + (rec.traits || []).length * w.earnedTrait + _num(rec.nobleMarriages) * w.nobleMarriage
            + _num(rec.holdingProjects) * _num(w.holdingProject) + _num(rec.raidsRepelled) * _num(w.raidRepelled)
            + _num(rec.rebellionsCrushed) * _num(w.rebellionCrushed));
    },

    /** The ruler dies: close and file their reign. Returns the record. */
    closeReign(player, world, opts = {}) {
        const house = Legacy.ensure(player, world);
        if (!house || !house.currentReign) return null;
        const rec = Legacy.summarize(player, world, opts);
        house.reigns.push(rec);
        house.currentReign = null;
        return rec;
    },

    /** Legacy score of the whole House (closed reigns, plus the open one if live). */
    score(player, world) {
        const house = player && player.house;
        if (!house) return 0;
        const w = Legacy.config().weights;
        const reigns = [...(house.reigns || [])];
        if (house.currentReign) {
            const live = Legacy.summarize(player, world);
            if (live) reigns.push(live);
        }
        return Math.round(reigns.reduce((s, r) => s + _num(r.score), 0)
            + _num(house.generation || 1) * w.generation + _num(house.prestige) * w.prestige);
    },

    rank(score) {
        const ranks = (Legacy.config().ranks || []).slice().sort((a, b) => a.min - b.min);
        let out = ranks[0] || { label: '', icon: '' };
        for (const r of ranks) if (score >= r.min) out = r;
        return out;
    },

    /**
     * The line ends (no heir, or the player lets it end). Closes the last
     * reign, scores the House and writes its epitaph. Idempotent.
     */
    endDynasty(player, world, cause = null) {
        const house = Legacy.ensure(player, world);
        if (!house) return null;
        if (house.ended) return Legacy.epitaph(player, world);
        const last = house.currentReign ? Legacy.closeReign(player, world, { cause }) : null;
        const score = Legacy.score(player, world);
        const rank = Legacy.rank(score);
        house.ended = { day: (world && world.day) || 0, cause, score, rank: rank.label, lastRuler: last ? last.name : player.name };
        House._chronicle(house, world, `The line of ${house.name} ends with ${house.ended.lastRuler}. ${rank.label}.`, ['succession', 'ended']);
        return Legacy.epitaph(player, world);
    },

    /** Epitaph screen data for an ended House. */
    epitaph(player, world) {
        const house = player && player.house;
        if (!house) return null;
        const reigns = house.reigns || [];
        const ended = house.ended || {};
        const score = ended.score != null ? ended.score : Legacy.score(player, world);
        const rank = Legacy.rank(score);
        const years = reigns.reduce((s, r) => s + _num(r.years), 0);
        const best = reigns.slice().sort((a, b) => _num(b.score) - _num(a.score))[0] || null;
        return {
            houseName: house.name, motto: house.motto || '', sigil: house.sigil || {},
            generations: reigns.length || house.generation || 1,
            years: Math.round(years * 10) / 10,
            prestige: _num(house.prestige),
            crowns: reigns.reduce((s, r) => s + _num(r.crownsWon), 0),
            score, rank, best, reigns,
            line: best ? `Remembered for ${best.name}${best.epithet ? ` ${best.epithet}` : ''}.` : '',
        };
    },

    /** The House Chronicle view: closed reigns plus the living ruler. */
    describe(player, world) {
        const house = Legacy.ensure(player, world);
        if (!house) return null;
        const reigns = (house.reigns || []).map(r => ({ ...r, live: false }));
        if (house.currentReign) {
            const live = Legacy.summarize(player, world);
            if (live) reigns.push({ ...live, live: true });
        }
        const score = Legacy.score(player, world);
        return {
            houseName: house.name, motto: house.motto || '', sigil: house.sigil || {},
            generation: house.generation || 1, foundedDay: house.foundedDay || 0,
            prestige: _num(house.prestige), reigns, score, rank: Legacy.rank(score), ended: house.ended || null,
        };
    },
};
