// ============================================
// DEEDS & RECORDS — one ledger of everything the systems count
// ============================================
// Many systems keep counters about the player (delves, petitions, sagas,
// companions, the underworld, holdings, ailments, rivals, sieges, the trading
// company, discoveries, voyages, the throne and the royal court, sieges of the
// player's holdings, bounties, foraging and hunting, patronage).
// Deeds gathers them into one flat map of numbers (collect) and a sectioned
// view (sections) with two columns: the House's lifetime total, and this
// reign's share — measured against the snapshot Legacy takes when a ruler
// takes up the mantle (house.currentReign.snapshot.deeds). A reign that
// opened before the snapshot existed is counted from zero.
//
// Read-only: it never creates or backfills another system's state, draws no
// randomness and imports no system, so any layer above may call it.

function _num(v) {
    return typeof v === 'number' && isFinite(v) ? v : 0;
}

function _obj(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

/**
 * Section layout: each row reads one counter (`key` in collect()). `current`
 * rows are present-tense facts (a level, a holding count) and have no reign
 * column.
 */
export const DEED_SECTIONS = [
    { id: 'house', title: 'Arms & House', icon: '⚔️', rows: [
        ['house.battleWon', 'Battles won'], ['house.quest', 'Quests completed'], ['house.titleGained', 'Titles gained'],
        ['house.settlementHeld', 'Settlements taken'], ['house.nobleMarriage', 'Noble marriages'], ['house.ambitionMilestone', 'Ambition milestones'],
    ] },
    { id: 'throne', title: 'The Throne', icon: '👑', rows: [
        ['house.crowned', 'Crowns won'], ['throne.claims', 'Claims held', true], ['throne.crises', 'Succession crises underway', true],
        ['throne.civilWar', 'Civil war being waged', true], ['throne.ruling', 'Reigning over a realm', true], ['throne.events', 'Throne chronicle entries'],
    ] },
    { id: 'kingship', title: 'The Royal Court', icon: '🏛️', rows: [
        ['kingship.vassals', 'Vassal lords', true], ['kingship.edictsInForce', 'Edicts in force', true],
        ['kingship.edictsPassed', 'Edicts proclaimed'], ['kingship.feasts', 'Royal feasts'], ['kingship.grants', 'Grants and favours'],
        ['kingship.plotsRevealed', 'Plots uncovered'], ['kingship.revolts', 'Revolts'], ['kingship.revoltsCrushed', 'Revolts crushed'],
        ['kingship.revoltsConceded', 'Revolts conceded'], ['kingship.lordsBroken', 'Lords broken'],
        ['kingship.monopolyRevenue', 'Crown monopoly revenue'], ['kingship.doleGrain', 'Grain given in the famine dole'],
        ['kingship.reignsEnded', 'Crowns lost or set down'], ['kingship.daysRuled', 'Days ruled (crowns since lost)'],
    ] },
    { id: 'holdingSieges', title: 'Holdings Besieged', icon: '🏯', rows: [
        ['holdingSieges.active', 'Under siege now', true], ['holdingSieges.besieged', 'Sieges endured'], ['holdingSieges.relieved', 'Relieved'],
        ['holdingSieges.held', 'Held until the enemy gave up'], ['holdingSieges.terms', 'Saved by terms'], ['holdingSieges.bought', 'Besiegers bought off'],
        ['holdingSieges.lifted', 'Lifted by peace'], ['holdingSieges.fallen', 'Fallen'],
    ] },
    { id: 'holdings', title: 'Holdings', icon: '🏰', rows: [
        ['holdings.held', 'Holdings ruled', true], ['holdings.projects', 'Projects built'], ['holdings.raidsRepelled', 'Raids repelled'],
        ['holdings.raidsSuffered', 'Raids suffered'], ['holdings.rebellions', 'Rebellions'], ['holdings.rebellionsCrushed', 'Rebellions crushed'],
        ['holdings.holdingsLost', 'Holdings lost'], ['holdings.betrayals', 'Governors who betrayed you'],
    ] },
    { id: 'patronage', title: 'Patronage & Great Works', icon: '🎨', rows: [
        ['patronage.clients', 'Clients in your service', true], ['patronage.hired', 'Clients taken on'], ['patronage.works', 'Works commissioned'],
        ['patronage.masterpieces', 'Masterpieces'], ['patronage.treatises', 'Treatises written'], ['patronage.medicalTexts', 'Medical texts written'],
        ['patronage.chronicles', 'Chronicles written'], ['patronage.donated', 'Works donated'], ['patronage.greatWorks', 'Great Works raised'],
        ['patronage.uniqueWorks', 'Wonders of the world'], ['patronage.forestalled', 'Wonders lost to a rival realm'],
        ['patronage.matched', 'Rival offers matched'], ['patronage.poached', 'Clients poached'], ['patronage.left', 'Clients who left'],
        ['patronage.goldSpent', 'Gold spent on patronage'],
    ] },
    { id: 'court', title: 'Petitions & Court', icon: '⚖️', rows: [
        ['petitions.ruled', 'Petitions ruled'], ['petitions.ignored', 'Petitions ignored'],
    ] },
    { id: 'sieges', title: 'Sieges', icon: '🛡️', rows: [
        ['sieges.invested', 'Towns besieged'], ['sieges.captured', 'Taken by storm or surrender'], ['sieges.sacked', 'Sacked'],
        ['sieges.terms', 'Terms accepted'], ['sieges.lifted', 'Sieges lifted'], ['sieges.broken', 'Sieges broken'], ['sieges.reliefsBeaten', 'Relief armies beaten'],
    ] },
    { id: 'sagas', title: 'Sagas', icon: '📜', rows: [
        ['sagas.started', 'Sagas begun in the world'], ['sagas.joined', 'Sagas you joined'], ['sagas.won', 'Sagas ended in triumph'],
        ['sagas.ended', 'Sagas ended'], ['sagas.beastsSlain', 'Saga beasts slain'], ['sagas.bountyGold', 'Saga bounty gold'],
    ] },
    { id: 'bounties', title: 'Bounty Hunting', icon: '🎯', rows: [
        ['bounty.rank', 'Hunter rank', true], ['bounty.completed', 'Bounties completed'], ['bounty.turnedIn', 'Outlaws turned in'],
        ['bounty.recruited', 'Outlaws recruited'], ['bounty.failed', 'Captures botched'], ['bounty.beasts', 'Saga beasts on notice'],
    ] },
    { id: 'delves', title: 'Delves', icon: '🕳️', rows: [
        ['delves.delves', 'Delves entered'], ['delves.chambers', 'Chambers explored'], ['delves.cleared', 'Delves cleared'],
        ['delves.deepest', 'Deepest chamber reached'], ['delves.retreats', 'Retreats'], ['delves.collapses', 'Collapses survived'],
    ] },
    { id: 'rivals', title: 'Rival Adventurers', icon: '🗡️', rows: [
        ['rivals.duelsWon', 'Duels won'], ['rivals.duelsLost', 'Duels lost'], ['rivals.racesWon', 'Races won'], ['rivals.racesLost', 'Races lost'],
        ['rivals.slain', 'Rivals slain'], ['rivals.sabotaged', 'Rivals sabotaged'], ['rivals.teamUps', 'Delving partnerships'], ['rivals.hires', 'Rivals hired'],
    ] },
    { id: 'companions', title: 'Companions', icon: '🤝', rows: [
        ['companions.party', 'Travelling with you', true], ['companions.devoted', 'Became devoted'], ['companions.fallen', 'Fell in your service'],
        ['companions.deserted', 'Deserted'], ['companions.betrayals', 'Betrayed you'],
    ] },
    { id: 'underworld', title: 'The Underworld', icon: '🌑', rows: [
        ['underworld.rank', 'Guild rank', true], ['underworld.crimes', 'Crimes committed'], ['underworld.caught', 'Times caught'],
        ['underworld.earned', 'Gold from crime'],
    ] },
    { id: 'company', title: 'Trading Company', icon: '🏦', rows: [
        ['company.posts', 'Trading posts', true], ['company.capital', 'Company capital', true], ['company.contractsDone', 'Contracts fulfilled'],
        ['company.contractsFailed', 'Contracts failed'], ['company.robberies', 'Posts robbed'], ['company.convoysLost', 'Convoys lost'],
    ] },
    { id: 'discovery', title: 'Discoveries', icon: '🧭', rows: [
        ['discovery.found', 'Uncharted lands found'], ['discovery.named', 'Lands named'], ['discovery.gathered', 'Exotic hauls gathered'],
        ['discovery.sold', 'Charts sold'], ['discovery.colonies', 'Colonies founded there'], ['discovery.contestsWon', 'Naval contests won'],
        ['discovery.contestsLost', 'Naval contests lost'], ['discovery.rivalFinds', 'Lands found first by rivals'],
    ] },
    { id: 'voyages', title: 'Voyages', icon: '⛵', rows: [
        ['voyages.voyages', 'Voyages completed'], ['voyages.daysAtSea', 'Days at sea'], ['voyages.events', 'Events at sea'],
        ['voyages.longest', 'Longest voyage (days)'],
    ] },
    { id: 'ailments', title: 'Wounds & Sickness', icon: '🩹', rows: [
        ['ailments.wounds', 'Wounds taken'], ['ailments.diseases', 'Diseases caught'], ['ailments.healed', 'Recoveries'],
        ['ailments.infections', 'Wounds that festered'], ['ailments.scars', 'Lasting scars'], ['ailments.treatments', 'Treatments received'],
    ] },
    { id: 'heralds', title: 'The Heralds', icon: '📯', rows: [
        ['heralds.proclaimed', 'News proclaimed in the world'], ['heralds.cried', 'Proclamations heard'],
    ] },
    { id: 'land', title: 'Living off the Land', icon: '🌿', rows: [
        ['land.foragingTrips', 'Foraging trips'], ['land.huntingTrips', 'Hunts'],
    ] },
];

export const Deeds = {
    SECTIONS: DEED_SECTIONS,

    /** Every counter as a flat { key: number } map (read straight from player state). */
    collect(player) {
        const out = {};
        if (!player) return out;
        const put = (prefix, src, keys) => {
            const o = _obj(src);
            for (const k of keys) out[`${prefix}.${k}`] = _num(o[k]);
        };
        const house = _obj(player.house);
        put('house', house.stats, ['battleWon', 'quest', 'titleGained', 'settlementHeld', 'nobleMarriage', 'ambitionMilestone', 'crowned']);

        const throne = _obj(player.throne);
        out['throne.claims'] = Object.keys(_obj(throne.claims)).length;
        out['throne.crises'] = Array.isArray(throne.crises) ? throne.crises.length : 0;
        out['throne.civilWar'] = throne.civilWar ? 1 : 0;
        out['throne.ruling'] = throne.ruling ? 1 : 0;
        out['throne.events'] = Array.isArray(throne.history) ? throne.history.length : 0;

        // The royal court rides inside the crown (systems/kingship.js)
        // — plus every crown the House wore and lost, filed in house.crownLedger
        // (Throne._archiveReign), so the tallies outlive the court
        const court = _obj(_obj(throne.ruling).court);
        const ledger = _obj(_obj(house.crownLedger).totals);
        const liveStats = _obj(court.stats);
        for (const k of ['edictsPassed', 'feasts', 'grants', 'plotsRevealed', 'revolts', 'revoltsCrushed', 'revoltsConceded', 'lordsBroken', 'monopolyRevenue', 'doleGrain', 'doleGold']) {
            out[`kingship.${k}`] = _num(liveStats[k]) + _num(ledger[k]);
        }
        out['kingship.reignsEnded'] = _num(ledger.reignsEnded);
        out['kingship.daysRuled'] = _num(ledger.daysRuled);
        out['kingship.vassals'] = Array.isArray(court.vassals) ? court.vassals.filter(v => v && !v.rebel).length : 0;
        out['kingship.edictsInForce'] = Object.keys(_obj(court.edicts)).length;

        // Sieges of the player's holdings (systems/holdingSieges.js, on player.realmWars)
        const rw = _obj(player.realmWars);
        put('holdingSieges', rw.siegeStats, ['besieged', 'relieved', 'held', 'terms', 'bought', 'lifted', 'fallen']);
        out['holdingSieges.active'] = Object.keys(_obj(rw.besieged)).length;

        const holdings = _obj(player.holdings);
        put('holdings', holdings.stats, ['projects', 'raidsRepelled', 'raidsSuffered', 'rebellions', 'rebellionsCrushed', 'holdingsLost', 'betrayals']);
        out['holdings.held'] = Array.isArray(holdings.keys) ? holdings.keys.length : 0;

        // Patronage & Great Works (systems/patronage.js)
        const pat = _obj(player.patronage);
        put('patronage', pat.stats, ['hired', 'works', 'masterpieces', 'treatises', 'medicalTexts', 'chronicles', 'donated',
            'greatWorks', 'uniqueWorks', 'forestalled', 'matched', 'poached', 'left', 'goldSpent']);
        out['patronage.clients'] = Array.isArray(pat.clients) ? pat.clients.length : 0;

        put('petitions', _obj(player.petitions).stats, ['ruled', 'ignored']);
        put('sieges', _obj(player.sieges).stats, ['invested', 'captured', 'sacked', 'terms', 'lifted', 'broken', 'reliefsBeaten']);
        put('sagas', _obj(player.sagas).stats, ['started', 'joined', 'won', 'ended', 'beastsSlain', 'bountyGold']);

        const bh = _obj(player.bountyHunter);
        out['bounty.rank'] = _num(bh.rank) || 1;
        out['bounty.completed'] = _num(player.bountiesCompleted);
        out['bounty.turnedIn'] = _num(bh.capturesTurnedIn);
        out['bounty.recruited'] = _num(bh.capturesRecruited);
        out['bounty.failed'] = _num(bh.failedCaptures);
        out['bounty.beasts'] = _num(bh.beastsSlain);

        put('delves', _obj(player.delves).stats, ['delves', 'chambers', 'cleared', 'deepest', 'retreats', 'collapses']);
        put('rivals', _obj(player.rivals).stats, ['duelsWon', 'duelsLost', 'racesWon', 'racesLost', 'slain', 'sabotaged', 'teamUps', 'hires']);
        put('companions', _obj(player.companions).stats, ['devoted', 'fallen', 'deserted', 'betrayals']);
        out['companions.party'] = Array.isArray(player.travelParty) ? player.travelParty.length : 0;

        const uw = _obj(player.underworld);
        put('underworld', uw.stats, ['crimes', 'caught', 'earned']);
        out['underworld.rank'] = _obj(uw.guild).member ? _num(_obj(uw.guild).rank) + 1 : 0;

        const company = _obj(_obj(player.merchant).company);
        put('company', company.stats, ['contractsDone', 'contractsFailed', 'robberies', 'convoysLost']);
        out['company.posts'] = Array.isArray(company.posts) ? company.posts.length : 0;
        out['company.capital'] = Math.round(_num(company.capital));

        put('discovery', _obj(player.discovery).stats, ['found', 'named', 'gathered', 'sold', 'colonies', 'contestsWon', 'contestsLost', 'rivalFinds']);
        put('voyages', player.voyageStats, ['voyages', 'daysAtSea', 'events', 'longest']);
        put('ailments', _obj(player.ailments).stats, ['wounds', 'diseases', 'healed', 'infections', 'scars', 'treatments']);
        put('heralds', _obj(player.heralds).stats, ['proclaimed', 'cried']);
        out['land.foragingTrips'] = _num(player.foragingTrips);
        out['land.huntingTrips'] = _num(player.huntingTrips);
        return out;
    },

    /** The reign-start snapshot of these counters, or null (counted from zero). */
    reignBaseline(player) {
        const r = player && player.house && player.house.currentReign;
        const snap = r && r.snapshot && r.snapshot.deeds;
        return snap && typeof snap === 'object' ? snap : null;
    },

    /**
     * The panel's data: [{ id, title, icon, rows: [{ key, label, lifetime,
     * reign, current }], empty }]. `reign` is null for present-tense rows.
     * Sections with nothing to show are flagged `empty` (the panel folds them).
     */
    sections(player) {
        const now = Deeds.collect(player);
        const base = Deeds.reignBaseline(player) || {};
        return DEED_SECTIONS.map(sec => {
            const rows = sec.rows.map(([key, label, current]) => {
                const lifetime = _num(now[key]);
                // "Deepest" and "longest" are records, not tallies: this reign's best is the lifetime best only if set this reign
                const isRecord = /\.(deepest|longest)$/.test(key);
                let reign = null;
                if (!current) reign = isRecord ? (lifetime > _num(base[key]) ? lifetime : 0) : Math.max(0, lifetime - _num(base[key]));
                return { key, label, lifetime, reign, current: !!current };
            });
            // A hunter's rank starts at 1 — that alone isn't a record worth a section
            const empty = rows.every(r => (r.key === 'bounty.rank' ? r.lifetime <= 1 : !r.lifetime));
            return { id: sec.id, title: sec.title, icon: sec.icon, rows, empty };
        });
    },
};
