// ============================================
// MAIL VOICE — a reply is a letter from a person
// ============================================
// systems/mail.js decides what a letter does (who is pleased, what gold
// moves, which pact is offered); this file writes the answer as a letter in
// its writer's own hand:
//
//   • the writer (writer()): who they are — a crowned lord, a rival House's
//     head, a merchant house's clerk, a townsman, a friend, your spouse, your
//     child, a companion away — their persona (formal, blunt, flowery, pious,
//     sly, nervous, warm: from lord traits, a rival head's traits, an NPC's
//     personality, a townsperson's temper, a companion's values), their
//     register (court, plain folk, family, comrades), whether they can write
//     (a farmer has the priest of their own town set it down, or sends word
//     by a carter), and their tongue (a foreign letter comes through as much
//     as the player reads of it — systems/languages.js; read() garbles it
//     with the player's comprehension at reading time, so learning the
//     tongue or hiring an interpreter makes old letters readable);
//   • what is true where they live (facts()): the realm's war, a siege,
//     plague or famine, an outlaw lair, a dearth or a glut in their market,
//     food dearer by a real percentage, the harvest, taxes and coin, the
//     roads, a new ruler, what the criers proclaimed, a court scandal told
//     in their town ("they say…" — systems/whispers.js), the player's own
//     deeds as the rumour reached them (systems/gossip.js), and their own
//     life: a lord's illness or new child, a rival head's errand and family,
//     a townsperson's wedding, birth, widowing, a child gone away, a beating
//     not yet healed, a neighbour's death (systems/townsfolk.js), your own
//     children at home in a spouse's letter;
//   • the letter (compose()): salutation fitting the player's rank and the
//     relation, an acknowledgement of the player's letter (where it came
//     from, how long it rode, how many have passed between you), the answer
//     to what was written (the gift by its amount, the enemy warned of, the
//     pact proposed — data/couriers.json → letters.answers[kind][outcome]),
//     one to three lines of their own life and town, a hook paragraph
//     (Mail decides and applies the hooks: a request, an invitation, a tip,
//     a secret, an enclosure), a closing, a signature or a mark, a P.S.
//
// The grammar is data (data/couriers.json → letters): every line may be
// tagged by register (r), persona (p), tone, the player's rank and the
// relation; candidates whose {placeholders} the facts can't fill are never
// drawn. A small memory per correspondent (player.mail.corr[key], kept by
// Mail) remembers the lines used (no repeats until the list is spent), the
// facts told (not told twice in a season) and running threads (a ruler's
// illness, a dearth, a siege, a lair, a war, a mourning) whose later letters
// say whether it goes on or is over — always from the state as it is.
//
// Randomness: Utils.random inside the caller's seeded stream (Mail runs every
// letter in Utils.withRng). The optional LLM voice (systems/npcBrain.js
// writeLetter) only rephrases the finished letter for major writers, under
// guards that reject any name or number not already in it; the written
// letter always stands without it. No import-time effects.

import { Utils } from '../core/utils.js';
import { Cultures } from '../world/cultures.js';
import { Couriers } from './couriers.js';
import { CourtLetters } from './courtLetters.js';
import { Chatter } from './chatter.js';
import { Townsfolk } from './townsfolk.js';
import { Languages } from './languages.js';
import { Throne } from './throne.js';
import { Upbringing } from './upbringing.js';
import { NpcBrain } from './npcBrain.js';
import { Whispers } from './whispers.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = (world) => (world && Number.isFinite(world.day) ? world.day : 0);
const _cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '');

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

const PERSONAS = ['formal', 'blunt', 'flowery', 'pious', 'sly', 'nervous', 'warm'];
const THREADS = ['ruler_ill', 'war', 'lord_war', 'siege', 'dearth', 'outlaws', 'plague', 'famine', 'hurt', 'widowed', 'harvest_failing', 'strike'];
const DAYS_PER_YEAR = 120;

/** "a fortnight", "a month", "two months" — how long ago, in a letter's words. */
function _ago(days) {
    const d = Math.max(0, Math.round(days));
    if (d <= 2) return 'a day or two';
    if (d <= 5) return 'a few days';
    if (d <= 10) return 'a week';
    if (d <= 18) return 'a fortnight';
    if (d <= 40) return 'a month';
    if (d <= 70) return 'two months';
    if (d <= 100) return 'a season';
    return 'half a year';
}

const NUMWORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];

export const MailVoice = {

    // ──────────── DATA ────────────

    data() {
        return _obj(Couriers.data().letters) || {};
    },

    personaOf(traitIds, fallbackKey, pool = null) {
        const map = _obj(MailVoice.data().personaMap) || {};
        for (const t of traitIds || []) {
            const id = typeof t === 'string' ? t : t && t.id;
            if (id && map[id] && PERSONAS.includes(map[id])) return map[id];
        }
        const list = pool || PERSONAS;
        return list[_hash(fallbackKey) % list.length];
    },

    // ──────────── THE PLAYER, AS THE WRITER ADDRESSES THEM ────────────

    /** 'crown' (rules a realm), 'noble' (titled, landed or a House of note) or 'common'. */
    playerRank(player, world) {
        if (!player) return 'common';
        if (Throne.ruledKingdom(player, world)) return 'crown';
        const title = String(player.title || '');
        if (player.currentTitle || player.kingdomTitle || (title && !['Nobody', 'Wanderer', 'Exile', ''].includes(title))) return 'noble';
        if (player.holdings && Object.keys(player.holdings).length) return 'noble';
        if (_num(player.house && player.house.prestige) >= 150) return 'noble';
        return 'common';
    },

    _address(player, world, W) {
        const rank = MailVoice.playerRank(player, world);
        const f = player && player.gender === 'female';
        const first = (player && (player.firstName || player.name)) || 'friend';
        const last = (player && player.lastName) || '';
        let Sir;
        if (rank === 'crown') Sir = 'Your Majesty';
        else if (rank === 'noble') Sir = f ? 'My lady' : 'My lord';
        else if (W.register === 'high') Sir = last ? `${f ? 'Mistress' : 'Master'} ${last}` : `${f ? 'Mistress' : 'Master'} ${first}`;
        else Sir = f ? 'Mistress' : 'Master';
        return {
            rank, Sir, sir: /^My /.test(Sir) ? Sir.charAt(0).toLowerCase() + Sir.slice(1) : Sir,
            player: first, playerFull: (player && player.name) || first,
            house: (player && player.house && player.house.name) || 'your House',
            parentWord: f ? 'Mother' : 'Father', spouseWord: f ? 'wife' : 'husband',
            yourRealm: rank === 'crown' ? (Throne.ruledKingdom(player, world) || {}).name || '' : '',
        };
    },

    // ──────────── THE WRITER ────────────

    /**
     * Who writes: { key, type, name, first, gender, persona, register, group,
     * station, rel, literate, scribe, mouth, lang, town, kingdom, old, major,
     * sig }. `to` is the recipient record (Mail.recipients), `s` its live
     * subject (Mail._subject).
     */
    writer(player, world, to, s = {}) {
        const W = {
            key: to.key, type: to.type, name: to.name, first: String(to.name || '').split(' ')[0], gender: null,
            persona: 'formal', register: 'low', station: 'commoner', rel: null, literate: true, scribe: null, mouth: false,
            lang: null, town: { q: to.q, r: to.r, name: to.place || 'their town', kingdomId: to.kingdomId || null },
            kingdom: s.kingdom || null, old: false, major: false, sigName: to.name, sigStyle: '',
        };
        const k = s.kingdom;
        const tile = world && typeof world.getTile === 'function' && Number.isFinite(to.q) ? world.getTile(to.q, to.r) : null;
        const settlement = tile && tile.settlement;
        const townLang = settlement ? Languages.settlementLanguage(world, settlement) : null;
        const native = (player && player.nativeLanguage) || null;
        switch (to.type) {
            case 'lord': {
                const lord = (k && k.lord) || {};
                const ruler = k && k.characterData && k.characterData.ruler;
                W.first = (ruler && ruler.firstName) || String(lord.name || '').split(' ').slice(-2, -1)[0] || W.first;
                W.gender = ruler ? ruler.gender : null;
                W.persona = MailVoice.personaOf([...(lord.traits || []), ...((ruler && ruler.traits) || [])], `lord:${k && k.id}:${lord.name}`, ['formal', 'formal', 'flowery', 'blunt', 'sly']);
                W.register = 'high';
                W.station = 'royal';
                W.lang = k ? Cultures.languageOfCulture(k.culture) : null;
                W.courtTongue = true;
                W.old = _num(lord.age) >= 60;
                W.major = true;
                W.sigName = lord.name || (k && k.ruler) || to.name;
                W.sigStyle = k ? `of ${k.name}` : '';
                W.town = { ...W.town, name: to.place || W.town.name };
                break;
            }
            case 'rival': {
                const rv = s.rival || {};
                const h = rv.head || null;
                W.first = (h && h.firstName) || W.first;
                W.gender = h ? h.gender : null;
                W.persona = MailVoice.personaOf((h && h.traits) || [], `rival:${to.kingdomId}:${W.first}`, ['formal', 'sly', 'blunt', 'flowery']);
                W.register = 'high';
                W.station = 'noble';
                W.lang = k ? Cultures.languageOfCulture(k.culture) : townLang;
                W.courtTongue = true;
                W.old = _num(h && h.age) >= 60;
                W.major = true;
                W.sigName = h ? `${h.firstName}, head of ${rv.name || to.name}` : to.name;
                W.passion = h && h.persona && h.persona.passion ? h.persona.passion : null;
                W.hand = 'rival';
                W.sigHouse = rv.name || to.name;
                break;
            }
            case 'house': {
                W.persona = MailVoice.personaOf([], `house:${to.houseId}`, ['formal', 'sly', 'blunt']);
                W.register = 'high';
                W.group = 'trade';
                W.station = 'merchant';
                // Merchants write in whatever tongue pays
                W.lang = native;
                W.sigName = `for ${to.name}`;
                W.hand = 'clerk';
                break;
            }
            case 'spouse':
            case 'npc':
            case 'companion': {
                const npc = s.npc || {};
                W.first = npc.firstName || W.first;
                W.gender = npc.gender || null;
                const vals = (s.companion && s.companion.values) || [];
                W.persona = MailVoice.personaOf([npc.personality, ...vals.map(v => `value_${v}`), ...(npc.traits || [])], `npc:${npc.id}`);
                W.register = to.type === 'spouse' ? 'kin' : to.type === 'companion' ? 'comrade' : 'low';
                W.rel = to.type === 'spouse' ? 'spouse' : to.romantic ? 'love' : to.type === 'npc' ? 'friend' : 'comrade';
                const occ = String(npc.occupation || '').toLowerCase();
                W.literate = to.type !== 'npc' || /noble|merchant|scholar|priest|scribe|clerk|physician|lord|lady/.test(occ) || (_hash(`lit:${npc.id}`) % 100) < 55;
                // A spouse or a companion has lived beside you: they write in your tongue
                W.lang = to.type === 'npc' ? (Cultures.languageOfCulture(npc.culture) || townLang) : native;
                W.old = _num(npc.age) >= 60;
                W.major = to.type === 'spouse';
                W.sigName = npc.firstName || to.name;
                W.npc = npc;
                if (npc.folkUid) W.person = MailVoice._personByUid(world, npc.folkUid);
                break;
            }
            case 'child': {
                const c = s.child || {};
                W.first = c.firstName || W.first;
                W.gender = c.gender || null;
                W.persona = MailVoice.personaOf([], `child:${c.id}`, ['warm', 'warm', 'formal', 'nervous']);
                W.register = 'kin';
                W.rel = 'child';
                W.station = 'kin';
                W.lang = native;
                W.sigName = c.firstName || to.name;
                W.held = !!to.held;
                W.child = c;
                break;
            }
            case 'folk': {
                const p = s.person || {};
                W.first = p.first || W.first;
                W.gender = p.gender || null;
                const role = p.retired || p.role || 'villager';
                const tempers = { priest: 'pious' };
                W.persona = tempers[role] || MailVoice.personaOf(p.traits || [], `folk:${to.key}`);
                W.register = 'low';
                W.station = 'commoner';
                W.role = role;
                W.roleTitle = Townsfolk.roleTitle(p);
                const lit = { priest: 100, noble: 100, merchant: 85, blacksmith_npc: 35, guard: 30, farmer: 12, villager: 18, beggar: 0 };
                W.literate = (_hash(`lit:${to.key}`) % 100) < _num(lit[role], 20);
                W.lang = townLang;
                W.old = Townsfolk.age(p, _day(world)) >= 60;
                W.person = settlement && settlement.folk ? { person: p, folk: settlement.folk, settlement } : null;
                W.sigName = Townsfolk.name(p);
                if (!W.literate && W.person) {
                    const folk = W.person.folk;
                    const scribe = (folk.people || []).find(x => x && x.died == null && !x.away && x.id !== p.id && x.role === 'priest')
                        || (folk.people || []).find(x => x && x.died == null && !x.away && x.id !== p.id && (x.role === 'merchant' || x.role === 'noble'));
                    // A carter carries word by mouth now and then, from those with no one to write it
                    W.mouth = !scribe || (_hash(`mouth:${to.key}`) % 4) === 0;
                    if (scribe && !W.mouth) W.scribe = { name: scribe.role === 'priest' ? `${scribe.gender === 'female' ? 'Mother' : 'Father'} ${scribe.first}` : Townsfolk.name(scribe), role: scribe.role };
                }
                break;
            }
            default: break;
        }
        if (!W.group) W.group = W.register === 'high' ? 'high' : W.register === 'kin' ? 'kin' : 'low';
        W.town.settlement = settlement || null;
        return W;
    },

    _personByUid(world, uid) {
        const m = /^(-?\d+),(-?\d+)#(.+)$/.exec(String(uid || ''));
        if (!m || !world || typeof world.getTile !== 'function') return null;
        const tile = world.getTile(Number(m[1]), Number(m[2]));
        const folk = tile && tile.settlement && tile.settlement.folk;
        const pid = Number.isFinite(Number(m[3])) ? Number(m[3]) : m[3];
        const person = folk ? Townsfolk.get(folk, pid) : null;
        return person ? { person, folk, settlement: tile.settlement } : null;
    },

    // ──────────── WHAT IS TRUE WHERE THEY LIVE ────────────

    /**
     * Facts the writer could tell, each true now: [{ k, x, vars, w, mine }].
     * k picks the grammar's lines (letters.facts[k]); x tells two of the
     * same kind apart (a thread's identity: the enemy, the good, the lair).
     */
    facts(player, world, W, s = {}) {
        const out = [];
        const day = _day(world);
        const add = (k, x, vars = {}, w = 1, mine = false) => out.push({ k, x: String(x == null ? '' : x), vars, w, mine });
        const town = W.town || {};
        const settlement = town.settlement;
        let ctx = null;
        try {
            if (Number.isFinite(town.q) && settlement) ctx = Chatter.context(world, player, { q: town.q, r: town.r });
        } catch { ctx = null; }
        const tn = town.name || 'here';
        if (ctx) {
            if (ctx.war && ctx.enemy) add('war', ctx.enemy, { enemy: ctx.enemy, town: tn, realm: ctx.kingdomName }, 2);
            if (ctx.siege && ctx.siegeTown) add('siege', ctx.siegeTown, { siegeTown: ctx.siegeTown, town: tn }, 2);
            for (const ev of ctx.events || []) {
                const id = String(ev.id || '').toLowerCase();
                if (['plague', 'famine', 'drought', 'flood', 'blizzard', 'bandit_uprising', 'monster_sighting', 'festival', 'comet_sighting', 'eclipse', 'refugee_wave', 'rebellion', 'religious_schism', 'gold_rush', 'market_crash', 'trade_boom', 'bountiful_harvest', 'earthquake', 'pirate_surge'].includes(id)) {
                    add(`ev_${id}`, id, { event: ev.name, place: ev.place || tn, town: tn }, id === 'plague' || id === 'famine' ? 3 : 1.5);
                }
            }
            if (ctx.outlaws) {
                // (the lair keeps its id when a new chief renames it: a thread follows the lair, not its name)
                const lair = ((player && player.outlawLairs && player.outlawLairs.lairs) || []).find(l => l && l.name === ctx.outlaws.name);
                add('outlaws', lair && lair.id != null ? lair.id : ctx.outlaws.name, { lair: ctx.outlaws.name, leader: ctx.outlaws.leader, town: tn }, 2);
            }
            if (ctx.dearth) add('dearth', ctx.dearth.id, { good: ctx.dearth.label, town: tn }, 2);
            if (ctx.glut) add('glut', ctx.glut.id, { good: ctx.glut.label, town: tn }, W.group === 'trade' ? 2 : 0.6);
            const pi = ctx.priceInfo;
            if ((ctx.prices || []).includes('dear_food') && pi && pi.foodPct > 2) add('dear_food', '', { pct: pi.foodPct, since: pi.since, town: tn }, 1.5);
            if ((ctx.prices || []).includes('cheap_food')) add('cheap_food', '', { town: tn }, 0.8);
            if ((ctx.prices || []).includes('inflation') && pi && pi.goodsPct > 2) add('inflation', '', { pct: pi.goodsPct, since: pi.since, town: tn }, 1);
            if ((ctx.prices || []).includes('engrossing')) add('engrossing', '', { town: tn }, 1);
            for (const h of ctx.harvest || []) if (['failing', 'bumper', 'poor', 'plenty'].includes(h)) add(`harvest_${h}`, h, { town: tn }, h === 'failing' ? 2 : 1);
            for (const m of ctx.money || []) if (['levy', 'debased', 'heavy_taxes', 'army_unpaid', 'tax_revolt', 'coin_short', 'default'].includes(m.kind)) add(`money_${m.kind}`, m.kind, { town: tn, realm: ctx.kingdomName }, 1);
            for (const l of ctx.labour || []) if (['strike', 'idle', 'refugees', 'hardship', 'boom'].includes(l)) add(`labour_${l}`, l, { town: tn }, 0.9);
            if (ctx.strike) add('strike', ctx.strike.guild, { guild: ctx.strike.guild, good: ctx.strike.good, town: tn }, 1.2);
            for (const rd of ctx.roads || []) if (['pass_closed', 'flood', 'ruined', 'mud', 'washed_out', 'highway', 'canal', 'works'].includes(rd)) add(`road_${rd}`, rd, { town: tn }, 0.6);
            if (ctx.newRuler && W.type !== 'lord') add('new_ruler', ctx.ruler, { ruler: ctx.ruler, oldRuler: ctx.oldRuler, realm: ctx.kingdomName }, 1.5);
            if (ctx.revolt) add('revolt', '', { town: tn, realm: ctx.kingdomName }, 1.5);
            const proc = (ctx.proclamations || [])[0];
            if (proc && proc.text && day - _num(proc.day) <= 30) add('herald', `${proc.day}`, { text: String(proc.text).replace(/^\s*(Hear ye!|Oyez!?)\s*/i, '').replace(/\s+$/, ''), town: tn }, 1.2);
            for (const live of Whispers.talkAt(player, town.q, town.r).slice(0, 2)) {
                const sc = { subject: live.subject && live.subject.name, tale: Whispers.text(live), id: live.id };
                if (!sc.tale || !sc.subject) continue;
                // A lord does not repeat the tales told of himself
                if (W.type === 'lord' && W.kingdom && (sc.subject === W.kingdom.ruler || (W.kingdom.lord && sc.subject === W.kingdom.lord.name))) continue;
                const taleQ = /[.!?]$/.test(sc.tale.trim()) ? sc.tale.trim() : `${sc.tale.trim()}.`;
                add('scandal', sc.subject, { tale: sc.tale.replace(/[.\s]+$/, ''), taleQ, subject: sc.subject, town: tn, scandalId: sc.id }, 1.6);
            }
            const deed = (ctx.deeds || []).find(d => ['duel_won', 'beast_slain', 'feast_given', 'famine_dole', 'pilgrimage_made', 'pardon', 'wilds_rescue', 'sack', 'murder', 'theft', 'assault', 'affair'].includes(d.type));
            if (deed) {
                const here = deed.place === tn;
                add(`deed_${deed.type}`, `${deed.type}:${deed.place}`, {
                    place: deed.place, victim: deed.victim, town: tn,
                    atPlace: here ? `here in ${tn}` : `at ${deed.place}`, nearPlace: `near ${deed.place}`, toPlace: `to ${deed.place}`,
                }, 1.4);
            }
            for (const f of (ctx.fashions || []).slice(0, 1)) add('fashion', f.id, { fashion: String(f.name).toLowerCase(), goods: f.goods, place: f.place }, 0.5);
        }
        const season = world && world.season ? String(world.season) : null;
        if (season) add(`season_${season.toLowerCase()}`, season, { season: season.toLowerCase(), town: tn }, 0.5);

        // Their own life
        MailVoice._lifeFacts(player, world, W, s, add);
        // A lord tells of his own war, not the town's talk of it
        const own = new Set(out.filter(f => f.k === 'lord_war').map(f => f.x));
        return out.filter(f => !(f.k === 'war' && own.has(f.x)));
    },

    _lifeFacts(player, world, W, s, add) {
        const day = _day(world);
        switch (W.type) {
            case 'lord': {
                const k = W.kingdom;
                const cd = k && k.characterData;
                const ruler = cd && cd.ruler;
                if (ruler && ruler.isIll) add('ruler_ill', 'self', {}, 3, true);
                const sp = cd && cd.spouse;
                if (sp && sp.isAlive !== false && sp.isIll) add('spouse_ill', sp.firstName, { spouse: sp.firstName }, 2, true);
                const kids = ((cd && cd.children) || []).filter(c => c && c.isAlive !== false);
                const baby = kids.find(c => _num(c.age) <= 1 && Number.isFinite(c.birthDay) && day - c.birthDay <= 90 && day >= c.birthDay);
                if (baby) add('lord_birth', baby.firstName, { child: baby.firstName, childWord: baby.gender === 'female' ? 'daughter' : 'son' }, 3, true);
                const heir = kids.slice().sort((a, b) => _num(b.age) - _num(a.age))[0];
                if (heir && _num(heir.age) >= 12) add('lord_heir', heir.firstName, { child: heir.firstName, childWord: heir.gender === 'female' ? 'daughter' : 'son', age: Math.round(_num(heir.age)) }, 0.8, true);
                const ls = k && k.lastSuccession;
                if (ls && day - _num(ls.day) <= 90 && day >= _num(ls.day) && ls.oldRulerName) add('lord_new', ls.oldRulerName, { oldRuler: ls.oldRulerName, realm: k.name }, 3, true);
                if (k && (k.wars || []).length) {
                    const foe = world.getKingdom(k.wars[0]);
                    if (foe) add('lord_war', foe.name, { enemy: foe.name, realm: k.name }, 2, true);
                }
                break;
            }
            case 'rival': {
                const rv = s.rival || {};
                const h = rv.head;
                if (!h) break;
                const kids = (h.children || []).filter(c => c && c.isAlive !== false);
                const eldest = kids.slice().sort((a, b) => _num(b.age) - _num(a.age))[0];
                if (eldest) add('rival_child', eldest.firstName, { child: eldest.firstName, childWord: eldest.gender === 'female' ? 'daughter' : 'son', age: Math.round(_num(eldest.age)) }, 1, true);
                const plan = rv.plan || null;
                const place = plan && ((plan.to && plan.to.name) || (plan.from && plan.from.name));
                if (place) add('rival_errand', place, { place }, 1.2, true);
                if (W.passion && W.passion.line) add('rival_passion', W.passion.id || 'passion', { line: String(W.passion.line).replace(/\{seat\}/g, (rv.seat && rv.seat.name) || W.town.name) }, 1, true);
                break;
            }
            case 'spouse': {
                const kids = ((player && player.children) || []).filter(c => c && c.isAlive !== false && !Upbringing.isAway(c));
                const young = kids.filter(c => _num(c.age) < 16);
                if (young.length) {
                    const c = young[_hash(`kid:${day >> 4}`) % young.length];
                    add('spouse_kid', c.firstName, { child: c.firstName, age: Math.round(_num(c.age)), he: c.gender === 'female' ? 'she' : 'he', his: c.gender === 'female' ? 'her' : 'his' }, 3, true);
                }
                add('spouse_missing', 'self', {}, 1.5, true);
                break;
            }
            case 'child': {
                const k = W.kingdom;
                if (k && !W.held) add('child_court', k.id, { news: CourtLetters._news(world, k).replace(/^"|"$/g, '').replace(/\s*I am well, and I think of home\.$/, '').replace(/^Here\s+/, '').replace(/[.\s]+$/, ''), realm: k.name }, 3, true);
                if (W.held && k) add('child_held', k.id, { realm: k.name }, 4, true);
                const up = W.child ? Upbringing.ensure(W.child) : null;
                if (up && up.spouse && up.spouse.name) add('child_spouse', up.spouse.name, { spouse: up.spouse.name }, 1.5, true);
                break;
            }
            case 'companion': {
                if (W.npc && W.npc.governing && W.town.name) add('governing', W.town.name, { town: W.town.name }, 2, true);
                break;
            }
            default: break;
        }
        // A townsperson's own life (folk, or a friend who is one of the town's people)
        const pr = W.person;
        if (pr && pr.person) {
            const p = pr.person;
            const folk = pr.folk;
            for (const e of (p.log || []).slice().reverse()) {
                if (day - _num(e.d) > 100 || _num(e.d) > day) continue;
                const o = Townsfolk.get(folk, e.o);
                switch (e.k) {
                    case 'wed': if (o) add('life_wed', `${e.d}`, { name: Townsfolk.name(o), first: o.first }, 3, true); break;
                    case 'birth': if (o && o.died == null) add('life_birth', `${e.d}`, { child: o.first, childWord: o.gender === 'female' ? 'girl' : 'boy' }, 3, true); break;
                    case 'widowed': if (o) add('widowed', o.first, { name: o.first, spouseWord: Townsfolk.kinWord(o, 'spouse'), cause: e.x || 'a fever' }, 3, true); break;
                    case 'childDied': if (o) add('life_child_died', `${e.d}`, { name: o.first, childWord: Townsfolk.kinWord(o, 'child'), cause: e.x || 'a fever' }, 3, true); break;
                    case 'parentDied': if (o) add('life_parent_died', `${e.d}`, { name: o.first, parentWord: Townsfolk.kinWord(o, 'parent') }, 2.5, true); break;
                    case 'kidLeft': if (o) add('life_kid_left', `${e.d}`, { name: o.first, to: e.x || 'the city', childWord: Townsfolk.kinWord(o, 'child') }, 2, true); break;
                    case 'retired': add('life_retired', `${e.d}`, { work: Townsfolk.title(e.x, p.gender) }, 1.5, true); break;
                    default: break;
                }
            }
            if (p.hurt && _num(p.hurt.hp) > 0) {
                const left = Math.max(0, Math.round(_num(p.hurt.hp) - (day - _num(p.hurt.d)) * 0.12 * _num(p.hurt.max, 1)));
                if (left > 0) add('hurt', 'self', {}, 2.5, true);
            }
            // The family at home, by name and age (a plain, true line)
            const kids = (p.kids || []).map(id => Townsfolk.get(folk, id)).filter(k => k && k.died == null && !k.away);
            if (kids.length) {
                const c = kids[_hash(`fam:${p.id}:${day >> 5}`) % kids.length];
                const age = Townsfolk.age(c, day);
                add(age < 16 ? 'family_kid' : 'family_grown', c.first, { child: c.first, age, childWord: Townsfolk.kinWord(c, 'child'), work: Townsfolk.roleTitle(c) }, 1, true);
            }
            // A neighbour's news (the town's annals, told as gossip)
            const since = day - 60;
            // (their own family's news they tell as their own, not as the town's)
            const own = new Set([p.id, p.spouse, ...(p.kids || []), ...(p.parents || [])].filter(x => x != null));
            const ann = (folk.annals || []).filter(a => a && a.d > since && !own.has(a.a) && !own.has(a.b) && ['died', 'wed', 'born', 'left', 'exiled', 'beaten', 'plotFoiled'].includes(a.k)).slice(-4);
            if (ann.length) {
                const a = ann[_hash(`ann:${p.id}:${day}`) % ann.length];
                const text = Townsfolk.annalText(folk, a, world);
                if (text) add('neighbour', `${a.k}:${a.a}:${a.d}`, { text: text.replace(/[.\s]+$/, '') }, 1.2);
            }
        }
    },

    // ──────────── THE CORRESPONDENCE ────────────

    /** The memory of one correspondence (on player.mail.corr), created on first use. */
    corr(player, key) {
        if (!player || !player.mail) return { n: 0, used: [], told: {}, threads: {} };
        if (!_obj(player.mail.corr)) player.mail.corr = {};
        let c = player.mail.corr[key];
        if (!_obj(c)) c = player.mail.corr[key] = { n: 0, used: [], told: {}, threads: {} };
        if (!Array.isArray(c.used)) c.used = [];
        if (!_obj(c.told)) c.told = {};
        if (!_obj(c.threads)) c.threads = {};
        return c;
    },

    // ──────────── PICKING LINES ────────────

    _entries(list) {
        if (!Array.isArray(list)) return typeof list === 'string' ? [{ t: list }] : [];
        return list.map(e => (typeof e === 'string' ? { t: e } : e)).filter(e => e && typeof e.t === 'string');
    },

    _fits(e, W, o) {
        const list = (v) => (Array.isArray(v) ? v : v == null ? null : [v]);
        const r = list(e.r);
        if (r && !r.includes(W.register) && !r.includes(W.group)) return false;
        const p = list(e.p);
        if (p && !p.includes(W.persona)) return false;
        const tone = list(e.tone);
        if (tone && !tone.includes(o.tone)) return false;
        const rank = list(e.rank);
        if (rank && !rank.includes(o.rank)) return false;
        const rel = list(e.rel);
        if (rel && !rel.includes(W.rel || 'none')) return false;
        const type = list(e.type);
        if (type && !type.includes(W.type)) return false;
        const when = list(e.when);
        if (when && !when.every(f => (o.flags || []).includes(f))) return false;
        const not = list(e.not);
        if (not && not.some(f => (o.flags || []).includes(f))) return false;
        // Every {placeholder} must be fillable
        const need = e.t.match(/\{(\w+)\}/g) || [];
        return need.every(m => { const v = o.vars[m.slice(1, -1)]; return v != null && v !== ''; });
    },

    /**
     * One line from a grammar list for this writer (persona-matching lines
     * three times as likely), not one this correspondence has had yet if any
     * other remains. Returns the filled text, or ''.
     */
    pick(list, W, o, corr = null) {
        const all = MailVoice._entries(list);
        let cands = all.filter(e => MailVoice._fits(e, W, o));
        // Nothing in this voice: any persona of the register, then anyone's line that fits the facts
        if (!cands.length) cands = all.filter(e => MailVoice._fits({ ...e, p: undefined }, W, o));
        if (!cands.length) cands = all.filter(e => MailVoice._fits({ ...e, p: undefined, r: undefined }, W, o));
        if (!cands.length) return '';
        const usedList = [...(corr ? corr.used : []), ...(o.usedNow || [])];
        const used = new Set(usedList);
        const id = (e) => _hash(e.t) % 1000003;
        const fresh = cands.filter(e => !used.has(id(e)));
        if (fresh.length) cands = fresh;
        else if (cands.length > 1) {
            // All said before: the one said longest ago
            const last = (e) => usedList.lastIndexOf(id(e));
            const oldest = Math.min(...cands.map(last));
            cands = cands.filter(e => last(e) === oldest);
        }
        const lately = o.lately || null;
        const weights = cands.map(e => _num(e.w, 1) * (e.p ? 3 : 1) * (e.r ? 1.5 : 1) * (lately && lately.includes(id(e)) ? 0.25 : 1));
        const total = weights.reduce((a, b) => a + b, 0);
        let roll = Utils.random() * total;
        let pick = cands[cands.length - 1];
        for (let i = 0; i < cands.length; i++) {
            roll -= weights[i];
            if (roll <= 0) { pick = cands[i]; break; }
        }
        if (o.usedNow) o.usedNow.push(id(pick));
        return MailVoice.fill(pick.t, o.vars);
    },

    fill(text, vars) {
        const s = String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
        // Sentences start with a capital (a fact may begin a sentence with a lower-case name)
        return s.replace(/(^|[.!?]\s+)([a-z])/g, (m, a, b) => a + b.toUpperCase());
    },

    // ──────────── THE LETTER ────────────

    /**
     * Write the letter. spec: { to, s (subject), kind (a letter kind, or
     * 'unprompted'), outcome, tone, vars (the answer's: gold, gift, enemy,
     * replyGold, …), L (the player's letter, if this answers one), reason
     * (an unprompted letter's: condolence_child, congrats_birth, deed, news,
     * request…), hooks ([{ k, vars }] — already decided and applied by Mail) }.
     * → { v, from, salutation, paras, ps, closing, signature, hand, handNote,
     *     lang, enclosed, persona, register, tone, major }
     */
    compose(player, world, spec) {
        const D = MailVoice.data();
        const day = _day(world);
        const to = spec.to;
        const W = spec.W || MailVoice.writer(player, world, to, spec.s || {});
        const corr = MailVoice.corr(player, to.key);
        const tone = spec.tone || 'cool';
        const addr = MailVoice._address(player, world, W);
        const flags = [];
        if (corr.n > 0) flags.push('again');
        else flags.push('first');
        if (corr.n >= 3) flags.push('often');
        if (spec.L) flags.push('reply');
        else flags.push('unprompted');
        if (W.old) flags.push('old');
        if (W.scribe) flags.push('scribe');
        if (W.mouth) flags.push('mouth');
        if (spec.L && spec.L.delayed) flags.push('delayed');
        if (W.gender === 'female' || W.gender === 'male') flags.push(W.gender);
        // A great house's clerks write a foreigner in their own tongue — unless the house means a slight
        const native = (player && player.nativeLanguage) || null;
        let lang = W.lang || null;
        if (W.courtTongue && lang && native && lang !== native) {
            if (tone === 'hostile') flags.push('theirTongue');
            else { lang = native; flags.push('yourTongue'); }
        }
        flags.push(player && player.gender === 'female' ? 'toFemale' : 'toMale');
        const vars = {
            ...addr,
            me: W.first, name: W.name, town: W.town.name, realm: (W.kingdom && W.kingdom.name) || '',
            spouseOf: W.gender === 'female' ? 'wife' : W.gender === 'male' ? 'husband' : 'spouse',
            childOf: W.gender === 'female' ? 'daughter' : W.gender === 'male' ? 'son' : 'child',
            scribe: W.scribe ? W.scribe.name : '',
            ...(spec.vars || {}),
        };
        if (spec.L) {
            vars.fromPlace = (spec.L.from && spec.L.from.name && spec.L.from.name !== 'the road') ? spec.L.from.name : '';
            const rode = Math.max(1, _num(spec.L.resolvedDay, day) - _num(spec.L.sentDay, day));
            vars.days = rode;
            vars.daysWord = rode <= 12 ? `${NUMWORDS[rode]} day${rode === 1 ? '' : 's'}` : `${rode} days`;
        }
        if (corr.n > 0 && corr.last != null) vars.lastAgo = _ago(day - corr.last);
        if (corr.n >= 2) vars.count = corr.n + 1 <= 12 ? ORDINALS[corr.n + 1] : `${corr.n + 1}th`;
        if (corr.lastWhat) vars.lastWhat = corr.lastWhat;
        if (player && player.mail && !Array.isArray(player.mail.lately)) player.mail.lately = [];
        const o = { tone, rank: addr.rank, flags, vars, usedNow: [], lately: player && player.mail ? player.mail.lately : null };

        // Salutation and the receipt of the player's letter
        const salutation = W.mouth ? '' : MailVoice.pick(D.salutations, W, o, corr);
        const paras = [];
        const open = MailVoice.pick(spec.L ? D.openings : (D.unprompted || {}).openings, W, o, corr);

        // The answer to what was written (or why they write unasked)
        let answer = '';
        if (spec.L) {
            const A = _obj((D.answers || {})[spec.kind]) || {};
            answer = MailVoice.pick(A[spec.outcome], W, o, corr) || MailVoice.pick(A[tone], W, o, corr);
        } else {
            answer = MailVoice.pick(((D.unprompted || {}).reasons || {})[spec.reason], W, o, corr);
        }
        const first = [open, answer].filter(Boolean).join(' ');
        if (first) paras.push(first);
        for (const extra of spec.extra || []) if (extra) paras.push(extra);

        // Their own life and their town, threads first
        const life = [];
        const told = [];
        const avail = MailVoice.facts(player, world, W, spec.s || {});
        const threadLines = MailVoice._threads(W, o, corr, avail, D, day);
        life.push(...threadLines.lines);
        const want = tone === 'hostile' ? (Utils.random() < 0.25 ? 1 : 0)
            : tone === 'cool' ? (W.register === 'kin' ? 2 : Utils.random() < 0.6 ? 1 : 0)
                : W.register === 'kin' ? 3 : 1 + (Utils.random() < 0.65 ? 1 : 0) + (W.persona === 'flowery' || W.persona === 'warm' ? 1 : 0);
        // Not twice to the same person in a season (a deed of yours: not twice at all)
        const quiet = (f) => (f.k.startsWith('deed_') ? 400 : 60);
        const pool = avail.filter(f => !threadLines.done.has(f.k) && !(corr.told[`${f.k}:${f.x}`] != null && day - corr.told[`${f.k}:${f.x}`] < quiet(f)) && (D.facts || {})[f.k]);
        const toldAny = (player && player.mail && _obj(player.mail.toldAny)) || {};
        // A hostile writer has no news for you but the bad
        const hostileOk = ['war', 'lord_war', 'scandal', 'deed_murder', 'deed_theft', 'deed_assault', 'deed_affair', 'deed_sack', 'outlaws', 'siege'];
        const usable = tone === 'hostile' ? pool.filter(f => hostileOk.includes(f.k)) : pool;
        const seenKinds = new Set();
        if (spec.reason === 'deed') {
            const i = usable.findIndex(f => f.k.startsWith('deed_'));
            if (i > 0) usable.unshift(usable.splice(i, 1)[0]);
            if (i >= 0) {
                const f = usable.shift();
                const line = MailVoice.pick(D.facts[f.k], W, { ...o, vars: { ...vars, ...f.vars } }, corr);
                if (line) { life.push(line); told.push(f); seenKinds.add('deed'); }
            }
        }
        for (let i = 0; i < want - threadLines.lines.length && usable.length; i++) {
            // (news everyone tells — a proclamation, a fashion — less likely from the next writer)
            const ws = usable.map(f => f.w * (f.mine ? 1.6 : 1) * (seenKinds.has(f.k.split('_')[0]) ? 0.3 : 1) * (toldAny[`${f.k}:${f.x}`] != null && day - toldAny[`${f.k}:${f.x}`] < 30 ? 0.3 : 1));
            const tot = ws.reduce((a, b) => a + b, 0);
            let roll = Utils.random() * tot;
            let idx = usable.length - 1;
            for (let j = 0; j < usable.length; j++) { roll -= ws[j]; if (roll <= 0) { idx = j; break; } }
            const f = usable.splice(idx, 1)[0];
            const line = MailVoice.pick(D.facts[f.k], W, { ...o, vars: { ...vars, ...f.vars } }, corr);
            if (!line) continue;
            seenKinds.add(f.k.split('_')[0]);
            life.push(line);
            told.push(f);
        }
        if (life.length) {
            // One paragraph of their own life, one of the town — or one together when short
            const mine = life.slice(0, 2).join(' ');
            const rest = life.slice(2).join(' ');
            paras.push(mine);
            if (rest) paras.push(rest);
        }

        // The hooks (a request, an invitation, a tip, a secret, an enclosure)
        const enclosed = [];
        for (const h of spec.hooks || []) {
            const line = MailVoice.pick(((D.hooks || {})[h.k]), W, { ...o, vars: { ...vars, ...(h.vars || {}) } }, corr);
            if (line) paras.push(line);
            if (h.enclosed) enclosed.push(h.enclosed);
        }

        // Closing, signature, a P.S.
        const closing = W.mouth ? '' : MailVoice.pick(D.closings, W, o, corr);
        const signature = MailVoice._signature(W, o);
        let ps = '';
        if (!W.mouth && tone !== 'hostile' && Utils.random() < (W.persona === 'nervous' || W.persona === 'warm' ? 0.45 : 0.25)) {
            // A leftover fact makes the best P.S.; otherwise a line of their own
            const left = usable.find(f => (D.facts || {})[f.k] && !told.includes(f));
            if (left && Utils.random() < 0.5) {
                const line = MailVoice.pick(D.facts[left.k], W, { ...o, vars: { ...vars, ...left.vars } }, corr);
                if (line) { ps = line; told.push(left); }
            }
            if (!ps) ps = MailVoice.pick(D.ps, W, o, corr);
        }

        // Who held the pen
        let hand = W.mouth ? 'mouth' : W.scribe ? 'scribe' : W.hand || (W.type === 'lord' ? 'clerk' : 'own');
        const H = _obj(D.hands) || {};
        const handNote = MailVoice.pick(H[hand], W, { ...o, vars: { ...vars, scribe: W.scribe ? W.scribe.name : '', writer: W.sigName, first: W.first, sigHouse: W.sigHouse || '' } }, null);
        if (hand === 'own' && !handNote) hand = 'own';

        // Remember: lines used, facts told, threads begun, what was written
        corr.used = [...corr.used, ...o.usedNow].slice(-120);
        if (player && player.mail) {
            const any = _obj(player.mail.toldAny) || {};
            for (const f of told) any[`${f.k}:${f.x}`] = day;
            player.mail.toldAny = Object.fromEntries(Object.entries(any).filter(([, d]) => day - d < 60).slice(-80));
        }
        if (player && player.mail) player.mail.lately = [...(player.mail.lately || []), ...o.usedNow].slice(-60);
        for (const f of told) {
            corr.told[`${f.k}:${f.x}`] = day;
            if (THREADS.includes(f.k) || f.k === 'ev_plague' || f.k === 'ev_famine') corr.threads[f.k] = { d: day, x: f.x, vars: f.vars };
        }
        const tk = Object.entries(corr.told).sort((a, b) => b[1] - a[1]).slice(0, 24);
        corr.told = Object.fromEntries(tk);
        corr.n = _num(corr.n) + 1;
        corr.last = day;
        corr.name = W.name;
        if (spec.L) corr.lastKind = spec.kind;

        // Names stay names in a foreign hand: the player knows them however little of the tongue they have
        const keep = new Set();
        const addNames = (v) => { if (typeof v === 'string') for (const w of v.match(/[A-ZÀ-Þ][A-Za-zÀ-ɏ']+/g) || []) keep.add(w); };
        for (const [k, v] of Object.entries(vars)) if (!['Sir', 'sir', 'parentWord', 'spouseWord', 'spouseOf', 'childOf'].includes(k)) addNames(v);
        for (const f of avail) for (const v of Object.values(f.vars || {})) addNames(v);
        for (const h of spec.hooks || []) for (const v of Object.values(h.vars || {})) addNames(v);
        addNames(W.sigName);
        return {
            v: 1, day, from: W.sigName, salutation, paras: paras.filter(Boolean), ps, closing, signature, hand, handNote,
            lang: lang || null, keep: [...keep].slice(0, 60), enclosed,
            heard: told.filter(f => f.vars && f.vars.scandalId != null).map(f => f.vars.scandalId), persona: W.persona, register: W.register, tone, major: !!W.major, writerType: W.type,
        };
    },

    /** Threads begun in earlier letters: still so, or over — told first. */
    _threads(W, o, corr, avail, D, day) {
        const lines = [];
        const done = new Set();
        for (const [k, t] of Object.entries(corr.threads || {})) {
            if (!t || day - _num(t.d) < 8) continue;
            const now = avail.find(f => f.k === k && f.x === t.x);
            if (now) done.add(k);
            // Still so: a word now and then, not in every letter; over: always news
            if (now && (day - _num(t.d) < 30 || Utils.random() < 0.5)) continue;
            const key = now ? `${k}_still` : `${k}_over`;
            const list = (D.facts || {})[key];
            if (!now) delete corr.threads[k];
            else t.d = day;
            if (!list) continue;
            const line = MailVoice.pick(list, W, { ...o, vars: { ...o.vars, ...(t.vars || {}), ...((now && now.vars) || {}) } }, corr);
            if (line) lines.push(line);
            if (lines.length >= 2) break;
        }
        return { lines, done };
    },

    _signature(W, o) {
        const D = MailVoice.data();
        const S = _obj(D.signatures) || {};
        const vars = { ...o.vars, sig: W.sigName, style: W.sigStyle, first: W.first, role: W.roleTitle || '', town: W.town.name };
        if (W.mouth) return '';
        if (W.scribe) return MailVoice.pick(S.mark, W, { ...o, vars }, null) || `+ the mark of ${W.sigName}`;
        const list = S[W.type] || S.default;
        return MailVoice.pick(list, W, { ...o, vars }, null) || W.sigName;
    },

    // ──────────── READING IT ────────────

    /**
     * The letter as the player reads it today: in a tongue they read poorly
     * the words they don't know come out foreign (Cultures.hear), unless an
     * interpreter reads it to them. → { salutation, paras, ps, closing,
     * signature, notes: [..], garbled }
     */
    read(player, letter) {
        if (!letter || !Array.isArray(letter.paras)) return null;
        const notes = [];
        if (letter.handNote) notes.push(letter.handNote);
        let share = 1;
        let lang = letter.lang || null;
        if (lang && player && _obj(player.languages)) {
            const c = Languages.comprehension(player, lang);
            if (c.value < 80) {
                const name = Cultures.languageName(lang);
                if (c.via === 'translator' && player.translator) {
                    notes.push(`It is written in ${name}; ${player.translator.name || 'your interpreter'} reads it to you.`);
                } else {
                    share = Math.max(0, Math.min(1, (c.value - 10) / 70));
                    notes.push(share <= 0.05
                        ? `It is written in ${name}, and you cannot read a word of it. An interpreter could read it to you.`
                        : `It is written in ${name}; you make out ${share >= 0.6 ? 'most' : share >= 0.3 ? 'some' : 'a little'} of it.`);
                }
            } else lang = null;
        } else lang = null;
        const keep = new Set(letter.keep || []);
        const hear = (t) => (lang && share < 0.999 && t ? String(t).replace(/[A-Za-zÀ-ɏ']+/g, w => (keep.has(w) ? w : Cultures.hear(w, lang, share))) : t);
        const voiced = letter.voiced && Array.isArray(letter.voiced.paras) ? letter.voiced : null;
        const paras = voiced ? voiced.paras : letter.paras;
        return {
            salutation: hear(letter.salutation || ''), paras: paras.map(hear), ps: letter.ps ? `P.S. ${hear(String(letter.ps).replace(/^P\.S\.\s*/, ''))}` : '',
            closing: hear(letter.closing || ''), signature: letter.signature || '',
            notes, garbled: !!lang && share < 0.999, enclosed: letter.enclosed || [], voiced: !!voiced,
        };
    },

    /** One string: the letter as a notice or an inbox body shows it. */
    plain(player, letter) {
        const r = MailVoice.read(player, letter);
        if (!r) return '';
        return [r.salutation, ...r.paras, r.ps, [r.closing, r.signature].filter(Boolean).join(' ')].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    },

    // ──────────── THE LLM VOICE (optional) ────────────

    /**
     * Ask the local model to rephrase a major writer's letter in their voice
     * (systems/npcBrain.js writeLetter). The model sees only the written
     * letter and the writer's sketch; NpcBrain rejects any answer that drops
     * a number or brings a name the letter didn't have. On success the
     * letter gains `voiced`; otherwise it stays as written. Never throws.
     */
    async voice(letter, sketch = {}) {
        if (!letter || !letter.major || letter.voiced || !NpcBrain.isEnabled() || typeof NpcBrain.writeLetter !== 'function') return false;
        try {
            const res = await NpcBrain.writeLetter({ paras: letter.paras, salutation: letter.salutation, closing: letter.closing, ps: letter.ps }, {
                writer: letter.from, persona: letter.persona, tone: letter.tone, ...sketch,
            });
            if (res && res.ok && Array.isArray(res.paras) && res.paras.length) {
                letter.voiced = { paras: res.paras };
                return true;
            }
        } catch { /* the written letter stands */ }
        return false;
    },

    // ──────────── TEST / QA HELPERS ────────────

    _personas() { return PERSONAS.slice(); },
    _ago,
    DAYS_PER_YEAR,
};
