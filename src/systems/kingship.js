// ============================================
// KINGSHIP — ruling a realm: council, edicts, vassals, factions, revolts
// ============================================
// The endgame layer on top of systems/throne.js. Once the player wears a
// crown (won in a civil war or founded), the realm becomes something to rule:
//
//   ROYAL COUNCIL  five great offices (Chancellor, Marshal, Steward,
//                  Spymaster, High Priest), filled from the realm's vassal
//                  lords, the old court's great officers, the player's family
//                  (spouse, grown children) or travel companions. Each holder
//                  has a competence (1-20) and a loyalty (0-100); the office's
//                  bonus is competence × a loyalty factor, fed to the kingdom
//                  through kingdom.crown.mods (KingdomBonuses.get): Steward →
//                  treasury income, Marshal → army size and regen, Spymaster →
//                  intrigue and plots revealed, Chancellor → diplomacy and
//                  peace, High Priest → faith and faith unity.
//   EDICTS         realm-wide decrees (data/kingship.json → edicts) with a
//                  passing cost and daily upkeep from the royal treasury, kept
//                  until revoked (or until the treasury can't pay). They move
//                  the kingdom's bonuses and stability, the council factions
//                  (systems/councils.js), peoples' sentiment and faith unity,
//                  and the vassals' opinion (by their goals).
//   VASSALS        the realm's lords, one per town (NPCLords personalities:
//                  traits, goals, ambition, honor). Each has an opinion of the
//                  crown (levy, edicts, council seats, kinship, favour,
//                  grudges, the realm's state) and a power (seat, land and
//                  titles granted, martial skill). Win them with gold, titles,
//                  land, marriages, feasts and favours — or break them.
//   FACTIONS       unhappy, ambitious lords band together behind a demand (a
//                  lighter levy, an edict passed or repealed). Factions form in
//                  secret; the Spymaster reveals them. A revealed faction
//                  strong enough issues an ultimatum: concede, arrest its
//                  leader, or face levies refused or a revolt. A hidden one
//                  strong enough rises without warning.
//   REVOLT         a civil war inside the realm: the rebels' seats withhold
//                  their levies and taxes, their war hosts (RealmWars world
//                  units) march on loyal towns, the royal army fights them in
//                  the field, and the player may break hosts or besiege rebel
//                  seats (systems/sieges.js). It ends crushed, conceded, or
//                  bought off at a parley.
//
// State lives on player.throne.ruling.court (saved with the throne; gone when
// the crown is). Tunables and text live in data/kingship.json. Randomness
// flows through Utils only, and nothing here draws unless the player rules.

import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { DataLoader } from '../core/dataLoader.js';
import { NPCLords } from '../world/npcLords.js';
import { Characters } from '../world/characters.js';
import { Throne } from './throne.js';
import { House } from './house.js';
import { Councils } from './councils.js';
import { Companions } from './companions.js';
import { Relationships } from './relationships.js';
import { Upbringing } from './upbringing.js';
import { RealmWars } from './realmWars.js';
import { Holdings } from './holdings.js';

const OFFICES = ['chancellor', 'marshal', 'steward', 'spymaster', 'highPriest'];
const TAX_STEPS = ['heavy', 'standard', 'light'];
const LOG_CAP = 30;

const _num = v => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const _day = world => (world && world.day) || 0;
const _key = (q, r) => `${q},${r}`;

export const Kingship = {

    OFFICES,

    // ── Data ────────────────────────────────────────────────────

    data() {
        return DataLoader.kingship || (DataLoader.get && DataLoader.get('kingship')) || {};
    },

    config() {
        return Kingship.data().config || {};
    },

    offices() {
        return Kingship.data().offices || {};
    },

    edicts() {
        return Kingship.data().edicts || {};
    },

    // ── State ───────────────────────────────────────────────────

    _blank() {
        const council = {};
        for (const o of OFFICES) council[o] = null;
        return {
            council, edicts: {}, vassals: [], factions: [], revolt: null,
            mods: {}, peaceChance: 0, lastFeastDay: -999, nextId: 1, lastNewVassalDay: 0,
            stats: { plotsRevealed: 0, revolts: 0, revoltsCrushed: 0, revoltsConceded: 0, edictsPassed: 0, feasts: 0, lordsBroken: 0, grants: 0 },
            log: [], initialized: false,
        };
    },

    /** The court of the realm the player rules, created/backfilled on use; null if no crown. */
    court(player) {
        const r = player && player.throne && player.throne.ruling;
        if (!r) return null;
        if (!r.court || typeof r.court !== 'object') r.court = Kingship._blank();
        const c = r.court;
        const blank = Kingship._blank();
        if (!c.council || typeof c.council !== 'object') c.council = blank.council;
        for (const o of OFFICES) if (c.council[o] === undefined) c.council[o] = null;
        for (const k of ['edicts', 'mods', 'stats']) if (!c[k] || typeof c[k] !== 'object') c[k] = blank[k];
        for (const [k, v] of Object.entries(blank.stats)) if (typeof c.stats[k] !== 'number') c.stats[k] = v;
        for (const k of ['vassals', 'factions', 'log']) if (!Array.isArray(c[k])) c[k] = [];
        if (c.revolt === undefined) c.revolt = null;
        if (c.revolt && !Array.isArray(c.revolt.hosts)) c.revolt.hosts = [];
        if (!(c.nextId > 0)) c.nextId = 1;
        if (typeof c.lastFeastDay !== 'number') c.lastFeastDay = -999;
        if (typeof c.peaceChance !== 'number') c.peaceChance = 0;
        return c;
    },

    _realm(player, world) {
        return Throne.ruledKingdom(player, world);
    },

    _log(court, world, text) {
        court.log.push({ day: _day(world), text });
        if (court.log.length > LOG_CAP) court.log = court.log.slice(-LOG_CAP);
    },

    _note(out, icon, title, text, type = 'info') {
        if (out) out.notices.push({ icon, title, text, type });
    },

    // ── Vassals ─────────────────────────────────────────────────

    _traitDefs() {
        return Object.values(NPCLords.TRAITS || {});
    },

    traitNames(v) {
        const defs = Kingship._traitDefs();
        return (v.traits || []).map(id => (defs.find(t => t.id === id) || { name: id }).name);
    },

    /** The player's own holdings (systems/holdings.js) as a set of "q,r" keys. */
    _holdingKeys(player, world) {
        return new Set(player ? Holdings.list(player, world).map(h => h.key) : []);
    },

    /**
     * Realm settlements no vassal holds. The capital is the crown's own, and so
     * are the player's holdings: no lord is seated on them (and none can carry
     * them into a revolt the player could never besiege them out of).
     */
    _freeSeats(court, world, k, player = null) {
        const held = new Set(court.vassals.filter(v => v.seat).map(v => _key(v.seat.q, v.seat.r)));
        const mine = Kingship._holdingKeys(player, world);
        const cap = k.capital;
        return Throne._settlementsOf(world, k)
            .filter(e => !(cap && cap.q === e.q && cap.r === e.r) && !held.has(_key(e.q, e.r)) && !mine.has(_key(e.q, e.r)))
            .sort((a, b) => _num(b.settlement.population) - _num(a.settlement.population));
    },

    /** A new lord for a seat (or a landless one): an NPCLords personality and a Characters name. */
    _newVassal(court, world, k, seat) {
        const ch = Characters.generateCharacter({ culture: k.culture, age: Utils.randInt(22, 60) });
        const lord = NPCLords.generateLord({ ruler: Characters.getFullName(ch), id: k.id });
        const v = {
            id: `vassal_${court.nextId++}`,
            firstName: ch.firstName, dynasty: ch.dynasty, gender: ch.gender, age: ch.age, culture: ch.culture,
            seat: seat ? { q: seat.q, r: seat.r, name: seat.settlement.name } : null,
            traits: lord.traits.map(t => t.id), goals: lord.goals,
            ambition: lord.ambition, honor: lord.honor,
            skills: { ...ch.skills },
            opinion: 0, favour: 0, grudge: 0, kin: false, lands: 0, titles: 0, powerMult: 1,
            cowedUntil: 0, refusingUntil: 0, factionId: null, rebel: false, lastFavourDay: -999,
            sinceDay: _day(world),
        };
        court.vassals.push(v);
        return v;
    },

    _generateVassals(player, world, k, court) {
        const C = Kingship.config();
        const seats = Kingship._freeSeats(court, world, k, player).slice(0, C.maxVassals || 8);
        for (const s of seats) Kingship._newVassal(court, world, k, s);
        while (court.vassals.length < (C.minVassals || 3)) Kingship._newVassal(court, world, k, null);
        for (const v of court.vassals) {
            v.opinion = Math.round(Kingship.opinion(player, world, v).target + Utils.randInt(-10, 10));
        }
    },

    vassal(player, id) {
        const c = Kingship.court(player);
        return c ? c.vassals.find(v => v.id === id) || null : null;
    },

    fullName(v) {
        return v ? `${v.firstName} ${v.dynasty}` : 'Unknown';
    },

    /** The settlement a vassal holds, if it is still in the realm. */
    _seatOf(world, v, k) {
        if (!v || !v.seat || !k) return null;
        const tile = world.getTile(v.seat.q, v.seat.r);
        const s = tile && tile.settlement;
        return s && s.kingdom === k.id ? s : null;
    },

    /** A vassal's power 0-100: seat, land and titles granted, martial skill. */
    power(world, v, k) {
        const P = Kingship.config().power || {};
        const s = Kingship._seatOf(world, v, k);
        let p = _num(P.base);
        if (s) {
            p += Math.min(_num(P.populationCap), _num(s.population) * _num(P.perPopulation));
            p += _num((P.typeBonus || {})[s.type]);
        } else {
            p = _num(P.landless);
        }
        p += _num(v.skills && v.skills.martial) * _num(P.perMartial);
        p += _num(v.lands) * _num(P.perLand) + _num(v.titles) * _num(P.perTitle);
        p *= v.powerMult == null ? 1 : v.powerMult;
        return Math.round(Utils.clamp(p, 0, 100));
    },

    _goalTypes(v) {
        return (v.goals || []).map(g => g.type);
    },

    /** Where a vassal's opinion of the crown is heading, with the reasons. */
    opinion(player, world, v) {
        const O = Kingship.config().opinion || {};
        const court = Kingship.court(player);
        const k = Kingship._realm(player, world);
        const parts = [];
        const add = (label, val) => { val = Math.round(val); if (val) parts.push({ label, value: val }); return val; };
        let t = 0;
        const traitOp = Kingship.data().traitOpinion || {};
        t += add('Temperament', (v.traits || []).reduce((s, id) => s + _num(traitOp[id]), 0)
            + (_num(v.honor) - 5.5) * _num(O.honorPer) + (_num(v.ambition) - 5.5) * _num(O.ambitionPer));
        const tax = player.throne && player.throne.ruling && player.throne.ruling.policies && player.throne.ruling.policies.tax;
        t += add('The royal levy', _num((O.levy || {})[tax]));
        if (court) {
            const onCouncil = OFFICES.some(o => court.council[o] && court.council[o].kind === 'vassal' && court.council[o].id === v.id);
            if (onCouncil) t += add('A seat on the council', _num(O.councilSeat));
            else if (_num(v.ambition) >= _num(O.upstartsAmbition)
                && OFFICES.some(o => court.council[o] && court.council[o].kind !== 'vassal')) {
                t += add('Upstarts on the council', _num(O.upstarts));
            }
            const goals = Kingship._goalTypes(v);
            let ed = 0;
            for (const id of Object.keys(court.edicts)) {
                const def = Kingship.edicts()[id];
                if (!def) continue;
                ed += _num(def.vassalOpinion);
                if ((def.likes || []).some(g => goals.includes(g))) ed += _num(O.edictLike);
                if ((def.hates || []).some(g => goals.includes(g))) ed += _num(O.edictHate);
            }
            t += add('Your edicts', ed);
        }
        if (v.kin) t += add('Kinship with your House', _num(O.kin));
        if (k) {
            const stab = typeof k.stability === 'number' ? k.stability : 60;
            t += add('The state of the realm', (stab - _num(O.stabilityPivot)) * _num(O.stabilityWeight));
            const wars = Math.min(_num(O.warCap), (k.wars || []).length);
            if (wars) {
                const goals = Kingship._goalTypes(v);
                if (goals.includes('domination') || goals.includes('conquer')) t += add('Glory in war', wars * _num(O.warLike));
                else if (goals.includes('survive') || goals.includes('peace')) t += add('Weary of war', wars * _num(O.warHate));
            }
        }
        if (O.prestigePer) t += add('Your Prestige', Math.min(_num(O.prestigeCap), House.getPrestige(player) / O.prestigePer));
        if (v.refusingUntil > _day(world)) t += add('Defying the crown', _num(O.refusingLevy) * 0.2);
        t += add('Favours', _num(v.favour));
        t += add('Grudges', _num(v.grudge));
        return { target: Utils.clamp(Math.round(t), -100, 100), parts };
    },

    /** Vassals with their computed power and opinion forecast, for UI. */
    vassalSummary(player, world) {
        const court = Kingship.court(player);
        const k = Kingship._realm(player, world);
        if (!court || !k) return [];
        return court.vassals.map(v => ({
            vassal: v, name: Kingship.fullName(v), power: Kingship.power(world, v, k),
            opinion: Math.round(v.opinion), forecast: Kingship.opinion(player, world, v),
            traits: Kingship.traitNames(v), goals: Kingship._goalTypes(v),
            seatName: v.seat ? v.seat.name : 'landless',
            refusing: v.refusingUntil > _day(world), cowed: v.cowedUntil > _day(world),
            faction: v.factionId ? court.factions.find(f => f.id === v.factionId) || null : null,
        }));
    },

    // ── The royal council ───────────────────────────────────────

    _loyaltyFactor(loyalty) {
        const C = Kingship.config().council || {};
        return Utils.clamp(_num(C.loyaltyBase) + _num(loyalty) * _num(C.loyaltyPer), _num(C.loyaltyBase), _num(C.loyaltyMax) || 1.25);
    },

    _advisors(k) {
        return Object.values((k && k.characterData && k.characterData.advisors) || {}).filter(a => a && a.isAlive !== false);
    },

    _grownChild(c) {
        if (!c || c.isAlive === false) return false;
        const up = c.upbringing;
        const grown = up ? !!up.comeOfAge : _num(c.age) >= 16;
        return grown && !(up && Upbringing.isAway(c));
    },

    /**
     * Resolve one person for an office: { kind, id, name, competence, loyalty,
     * desc } or null if they can no longer serve. Draws no RNG.
     */
    _person(player, world, office, kind, id) {
        const court = Kingship.court(player);
        const k = Kingship._realm(player, world);
        const def = Kingship.offices()[office];
        if (!court || !k || !def) return null;
        const C = Kingship.config().council || {};
        const clampC = v => Math.round(Utils.clamp(v, 1, 20));
        if (kind === 'vassal') {
            const v = court.vassals.find(x => x.id === id);
            if (!v || v.rebel) return null;
            let comp = _num(v.skills && v.skills[def.skill]);
            if (office === 'highPriest' && (v.traits || []).includes('pious')) comp += _num(def.piousBonus);
            return { kind, id, name: Kingship.fullName(v), competence: clampC(comp),
                loyalty: Math.round(Utils.clamp(50 + _num(v.opinion) * _num(C.vassalLoyaltyFromOpinion), 0, 100)),
                desc: `Lord of ${v.seat ? v.seat.name : 'no seat'}` };
        }
        if (kind === 'courtier') {
            const a = Kingship._advisors(k).find(x => x.id === id);
            if (!a) return null;
            let comp = _num(a.skills && a.skills[def.skill]);
            if (office === 'highPriest' && (a.traits || []).includes('pious')) comp += _num(def.piousBonus);
            const role = Characters.ADVISOR_ROLES && Characters.ADVISOR_ROLES[a.advisorRole];
            return { kind, id, name: Characters.getFullName(a), competence: clampC(comp),
                loyalty: Math.round(Utils.clamp(a.loyalty != null ? a.loyalty : 60, 0, 100)),
                desc: `The old court's ${role ? role.name : 'officer'}` };
        }
        if (kind === 'family') {
            const spouse = player.spouse ? Relationships.getNPC(player.spouse) : null;
            if (spouse && spouse.id === id && spouse.isAlive !== false) {
                const match = (def.occupations || []).includes(spouse.occupation) ? 3 : 0;
                return { kind, id, name: `${spouse.firstName} ${spouse.dynasty}`, competence: clampC(_num(C.spouseCompetence) + match),
                    loyalty: _num(C.familyLoyalty), desc: 'Your spouse' };
            }
            const child = (player.children || []).find(c => c && c.id === id);
            if (!child || !Kingship._grownChild(child)) return null;
            const comp = _num(child.skills && child.skills[def.childSkill]) * 2 + _num(child[def.childStat]) * 0.4;
            const rl = player.house && player.house.roleLoyalty && player.house.roleLoyalty[id];
            return { kind, id, name: `${child.firstName || 'Your child'}`, competence: clampC(comp),
                loyalty: Math.round(rl != null ? rl : _num(C.familyLoyalty)), desc: `Your ${child.gender === 'female' ? 'daughter' : 'son'}` };
        }
        if (kind === 'companion') {
            const npc = Companions.members(player, world).find(n => n.id === id);
            if (!npc) return null;
            const comp = _num(C.companionBase) + ((def.occupations || []).includes(npc.occupation) ? _num(C.companionMatch) : 0)
                + (npc.companion && npc.companion.devoted ? _num(C.devotedBonus) : 0);
            return { kind, id, name: `${npc.firstName} ${npc.dynasty}`, competence: clampC(comp),
                loyalty: Math.round(Utils.clamp(npc.companion ? _num(npc.companion.approval) : 55, 0, 100)),
                desc: `Companion (${npc.occupation || 'traveller'})` };
        }
        return null;
    },

    /** Everyone who could take an office, best first. */
    candidates(player, world, office) {
        const court = Kingship.court(player);
        const k = Kingship._realm(player, world);
        if (!court || !k || !OFFICES.includes(office)) return [];
        const refs = [];
        for (const v of court.vassals) refs.push(['vassal', v.id]);
        for (const a of Kingship._advisors(k)) refs.push(['courtier', a.id]);
        if (player.spouse) refs.push(['family', player.spouse]);
        for (const c of player.children || []) if (c && c.id) refs.push(['family', c.id]);
        for (const npc of Companions.members(player, world)) refs.push(['companion', npc.id]);
        const seated = {};
        for (const o of OFFICES) if (court.council[o]) seated[`${court.council[o].kind}:${court.council[o].id}`] = o;
        const out = [];
        for (const [kind, id] of refs) {
            const p = Kingship._person(player, world, office, kind, id);
            if (!p) continue;
            p.office = seated[`${kind}:${id}`] || null;
            p.score = p.competence * Kingship._loyaltyFactor(p.loyalty);
            out.push(p);
        }
        return out.sort((a, b) => b.score - a.score);
    },

    /** The person holding an office, freshly resolved, or null. */
    councillor(player, world, office) {
        const court = Kingship.court(player);
        const seat = court && court.council[office];
        if (!seat) return null;
        const p = Kingship._person(player, world, office, seat.kind, seat.id);
        if (p) p.since = seat.since;
        return p;
    },

    appoint(player, world, office, kind, id) {
        const court = Kingship.court(player);
        if (!court || !Kingship._realm(player, world)) return { success: false, reason: 'You rule no realm.' };
        const def = Kingship.offices()[office];
        if (!def) return { success: false, reason: 'No such office.' };
        const p = Kingship._person(player, world, office, kind, id);
        if (!p) return { success: false, reason: 'They cannot serve.' };
        for (const o of OFFICES) {
            const s = court.council[o];
            if (s && s.kind === kind && s.id === id) court.council[o] = null;
        }
        court.council[office] = { kind, id, name: p.name, since: _day(world) };
        Kingship._log(court, world, `${def.icon} ${p.name} is named ${def.label}.`);
        Kingship.refresh(player, world);
        return { success: true, message: `${p.name} is now your ${def.label} (competence ${p.competence}, loyalty ${p.loyalty}).` };
    },

    dismiss(player, world, office) {
        const court = Kingship.court(player);
        if (!court || !court.council[office]) return { success: false, reason: 'That office is empty.' };
        const name = court.council[office].name;
        const seat = court.council[office];
        court.council[office] = null;
        // A dismissed lord takes it ill
        if (seat.kind === 'vassal') {
            const v = court.vassals.find(x => x.id === seat.id);
            if (v) v.grudge = _num(v.grudge) - 10;
        }
        Kingship.refresh(player, world);
        return { success: true, message: `${name} leaves the council.` };
    },

    // ── Edicts ──────────────────────────────────────────────────

    edictSlots(player, world) {
        const R = Kingship.config().edictRules || {};
        const ch = Kingship.councillor(player, world, 'chancellor');
        return _num(R.maxEdicts) + (ch && ch.competence >= _num(R.chancellorExtraAt) ? 1 : 0);
    },

    canPass(player, world, id, { free = false } = {}) {
        const court = Kingship.court(player);
        const k = Kingship._realm(player, world);
        const def = Kingship.edicts()[id];
        if (!court || !k) return { ok: false, reason: 'You rule no realm.' };
        if (!def) return { ok: false, reason: 'No such edict.' };
        if (court.edicts[id]) return { ok: false, reason: 'That edict is already law.' };
        if (free) return { ok: true };
        const blocking = (def.excludes || []).filter(x => court.edicts[x]);
        if (blocking.length) return { ok: false, reason: `Repeal ${blocking.map(x => (Kingship.edicts()[x] || {}).label || x).join(', ')} first.` };
        if (Object.keys(court.edicts).length >= Kingship.edictSlots(player, world)) return { ok: false, reason: `The court can enforce only ${Kingship.edictSlots(player, world)} edicts at once.` };
        const cost = Kingship._passCost(def);
        if (_num(k.treasury) < cost) return { ok: false, reason: `Proclaiming it costs ${cost}g from the royal treasury.` };
        return { ok: true };
    },

    _passCost(def) {
        return def.passCost != null ? def.passCost : _num((Kingship.config().edictRules || {}).defaultPassCost);
    },

    _shiftFactions(player, shifts, mult) {
        if (!shifts) return;
        const state = Councils._ensureState(player);
        for (const [id, amt] of Object.entries(shifts)) {
            const f = state.factions[id];
            if (f) f.support = Utils.clamp(f.support + amt * mult, 0, 100);
        }
    },

    /** Proclaim an edict. opts.free: forced by a faction or a revolt (no cost, displaces what it excludes). */
    passEdict(player, world, id, opts = {}) {
        const can = Kingship.canPass(player, world, id, opts);
        if (!can.ok) return { success: false, reason: can.reason };
        const court = Kingship.court(player);
        const k = Kingship._realm(player, world);
        const def = Kingship.edicts()[id];
        if (opts.free) {
            for (const x of def.excludes || []) if (court.edicts[x]) Kingship.revokeEdict(player, world, x, { quiet: true });
        } else {
            k.treasury -= Kingship._passCost(def);
        }
        court.edicts[id] = { since: _day(world) };
        court.stats.edictsPassed++;
        Kingship._shiftFactions(player, def.factions, 1);
        Kingship._log(court, world, `${def.icon} The edict of ${def.label} is proclaimed.`);
        Throne._log(player, world, `${def.icon} ${k.name}: the edict of ${def.label} is proclaimed.`);
        Kingship.refresh(player, world);
        return { success: true, message: `${def.label} is now the law of ${k.name}. ${def.blurb || ''}`.trim() };
    },

    revokeEdict(player, world, id, opts = {}) {
        const court = Kingship.court(player);
        const def = Kingship.edicts()[id];
        if (!court || !court.edicts[id] || !def) return { success: false, reason: 'That edict is not in force.' };
        delete court.edicts[id];
        const R = Kingship.config().edictRules || {};
        Kingship._shiftFactions(player, def.factions, -_num(R.revokeFactionShare));
        if (!opts.quiet) Kingship._log(court, world, `${def.icon} The edict of ${def.label} is ${opts.lapse ? 'lapsed — the treasury could not pay for it' : 'repealed'}.`);
        Kingship.refresh(player, world);
        return { success: true, message: `${def.label} is ${opts.lapse ? 'lapsed' : 'repealed'}.` };
    },

    upkeep(player) {
        const court = Kingship.court(player);
        if (!court) return 0;
        return Object.keys(court.edicts).reduce((s, id) => s + _num((Kingship.edicts()[id] || {}).upkeep), 0);
    },

    // ── Grants, feasts, favours — and breaking a lord ───────────

    _target(player, world, vassalId) {
        const court = Kingship.court(player);
        const k = Kingship._realm(player, world);
        if (!court || !k) return { error: 'You rule no realm.' };
        const v = court.vassals.find(x => x.id === vassalId);
        if (!v) return { error: 'No such lord.' };
        if (v.rebel) return { error: `${Kingship.fullName(v)} is in open revolt.` };
        return { court, k, v };
    },

    _granted(court, world, v, favour, text) {
        v.favour = _num(v.favour) + favour;
        v.opinion = Utils.clamp(_num(v.opinion) + Math.round(favour / 2), -100, 100);
        court.stats.grants++;
        Kingship._log(court, world, text);
    },

    grantGold(player, world, vassalId) {
        const G = (Kingship.config().grants || {}).gold || {};
        const t = Kingship._target(player, world, vassalId);
        if (t.error) return { success: false, reason: t.error };
        if (_num(t.k.treasury) < _num(G.treasury)) return { success: false, reason: `The royal treasury needs ${G.treasury}g.` };
        t.k.treasury -= _num(G.treasury);
        Kingship._granted(t.court, world, t.v, _num(G.favour), `💰 A purse of ${G.treasury}g for ${Kingship.fullName(t.v)}.`);
        return { success: true, message: `${Kingship.fullName(t.v)} accepts the crown's gold (+${G.favour} favour).` };
    },

    grantTitle(player, world, vassalId) {
        const G = (Kingship.config().grants || {}).title || {};
        const t = Kingship._target(player, world, vassalId);
        if (t.error) return { success: false, reason: t.error };
        if (_num(t.v.titles) >= _num(G.maxTitles)) return { success: false, reason: `${Kingship.fullName(t.v)} holds every title you can give.` };
        if (!House.spend(player.house, _num(G.prestige), `a title for ${Kingship.fullName(t.v)}`, _day(world))) return { success: false, reason: `Need ${G.prestige} Prestige.` };
        t.v.titles = _num(t.v.titles) + 1;
        Kingship._granted(t.court, world, t.v, _num(G.favour), `🎖️ ${Kingship.fullName(t.v)} is raised in title.`);
        return { success: true, message: `${Kingship.fullName(t.v)} is raised in rank (+${G.favour} favour, more power).` };
    },

    grantLand(player, world, vassalId) {
        const G = (Kingship.config().grants || {}).land || {};
        const t = Kingship._target(player, world, vassalId);
        if (t.error) return { success: false, reason: t.error };
        if (_num(t.v.lands) >= _num(G.max)) return { success: false, reason: `You have granted ${Kingship.fullName(t.v)} all the land you can spare.` };
        t.v.lands = _num(t.v.lands) + 1;
        Kingship._granted(t.court, world, t.v, _num(G.favour), `🌾 Crown lands are granted to ${Kingship.fullName(t.v)}.`);
        Kingship.refresh(player, world);
        return { success: true, message: `${Kingship.fullName(t.v)} receives crown lands (+${G.favour} favour, more power; the crown's own taxes fall ${Math.round(_num(G.taxLoss) * 100)}%).` };
    },

    /** Grown, unwed children who could marry into a vassal's house. */
    marriageableChildren(player) {
        return (player.children || []).filter(c => Kingship._grownChild(c) && !(c.upbringing && c.upbringing.spouse) && c.id !== player.heir);
    },

    arrangeMarriage(player, world, vassalId, childId = null) {
        const G = (Kingship.config().grants || {}).marriage || {};
        const t = Kingship._target(player, world, vassalId);
        if (t.error) return { success: false, reason: t.error };
        if (t.v.kin) return { success: false, reason: `${Kingship.fullName(t.v)}'s house is already joined to yours.` };
        const pool = Kingship.marriageableChildren(player);
        const child = childId ? pool.find(c => c.id === childId) : pool[0];
        if (!child) return { success: false, reason: 'You have no grown, unwed child (other than your heir) to offer.' };
        if (_num(player.gold) < _num(G.gold)) return { success: false, reason: `The dowry is ${G.gold}g.` };
        if (!House.spend(player.house, _num(G.prestige), `a match with ${Kingship.fullName(t.v)}`, _day(world))) return { success: false, reason: `Need ${G.prestige} Prestige.` };
        player.gold -= _num(G.gold);
        const up = Upbringing.ensure(child);
        up.spouse = { kind: 'vassal', kingdomId: t.k.id, kingdomName: t.k.name, name: `kin of ${Kingship.fullName(t.v)}`, day: _day(world) };
        t.v.kin = true;
        Kingship._granted(t.court, world, t.v, 0, `💍 ${child.firstName} weds into the house of ${Kingship.fullName(t.v)}.`);
        if (player.house) House._chronicle(player.house, world, `${child.firstName} weds into the house of ${Kingship.fullName(t.v)}, a lord of ${t.k.name}.`, ['marriage', 'throne']);
        return { success: true, message: `${child.firstName} weds into the house of ${Kingship.fullName(t.v)}. Kin now, they stand by the crown.` };
    },

    canFeast(player, world) {
        const F = (Kingship.config().grants || {}).feast || {};
        const court = Kingship.court(player);
        const k = Kingship._realm(player, world);
        if (!court || !k) return { ok: false, reason: 'You rule no realm.' };
        const next = court.lastFeastDay + _num(F.cooldown);
        if (_day(world) < next) return { ok: false, reason: `The court is still recovering from the last feast (day ${next}).` };
        if (_num(k.treasury) < _num(F.treasury)) return { ok: false, reason: `A royal feast costs ${F.treasury}g from the treasury.` };
        return { ok: true };
    },

    holdFeast(player, world) {
        const F = (Kingship.config().grants || {}).feast || {};
        const can = Kingship.canFeast(player, world);
        if (!can.ok) return { success: false, reason: can.reason };
        const court = Kingship.court(player);
        const k = Kingship._realm(player, world);
        k.treasury -= _num(F.treasury);
        court.lastFeastDay = _day(world);
        court.stats.feasts++;
        let n = 0;
        for (const v of court.vassals) {
            if (v.rebel) continue;
            v.favour = _num(v.favour) + _num(F.favour);
            n++;
        }
        k.stability = Utils.clamp(_num(k.stability) + _num(F.stability), 0, 100);
        if (F.prestige) House.award(player.house, F.prestige, 'a royal feast', _day(world));
        Kingship._log(court, world, `🍖 A royal feast for ${n} lords of ${k.name}.`);
        return { success: true, message: `${n} lords feast at your table (+${F.favour} favour each, +${F.stability} stability).` };
    },

    /** Settle a lord's quarrel in his favour: his nearest neighbour resents it. */
    grantFavour(player, world, vassalId) {
        const G = (Kingship.config().grants || {}).favour || {};
        const t = Kingship._target(player, world, vassalId);
        if (t.error) return { success: false, reason: t.error };
        if (_day(world) < _num(t.v.lastFavourDay) + _num(G.cooldown)) return { success: false, reason: `You favoured ${Kingship.fullName(t.v)} only lately.` };
        if (_num(player.gold) < _num(G.gold)) return { success: false, reason: `It costs ${G.gold}g of your own.` };
        player.gold -= _num(G.gold);
        t.v.lastFavourDay = _day(world);
        Kingship._granted(t.court, world, t.v, _num(G.favour), `🤝 You settle a quarrel in favour of ${Kingship.fullName(t.v)}.`);
        let rival = null;
        if (t.v.seat) {
            let best = Infinity;
            for (const o of t.court.vassals) {
                if (o === t.v || !o.seat || o.rebel) continue;
                const d = Hex.wrappingDistance(o.seat.q, o.seat.r, t.v.seat.q, t.v.seat.r, world.width);
                if (d < best) { best = d; rival = o; }
            }
        }
        if (rival) rival.favour = _num(rival.favour) + _num(G.rivalFavour);
        return { success: true, message: `${Kingship.fullName(t.v)} wins the quarrel (+${G.favour} favour)${rival ? `; ${Kingship.fullName(rival)} resents it` : ''}.` };
    },

    /** The crown's own strength against a faction: a base, the royal army and the loyal lords. */
    crownPower(player, world, exclude = null) {
        const F = (Kingship.config().factions) || {};
        const court = Kingship.court(player);
        const k = Kingship._realm(player, world);
        if (!court || !k) return 0;
        let p = _num(F.crownBase) + _num(k.military) * _num(F.crownPerMilitary);
        for (const v of court.vassals) {
            if (v.rebel || (exclude && exclude.includes(v.id))) continue;
            if (_num(v.opinion) >= _num(F.loyalOpinion) && !v.factionId) p += Kingship.power(world, v, k) * _num(F.loyalShare);
        }
        return Math.round(p);
    },

    canBreak(player, world, vassalId) {
        const B = Kingship.config().breakLord || {};
        const t = Kingship._target(player, world, vassalId);
        if (t.error) return { ok: false, reason: t.error };
        const power = Kingship.power(world, t.v, t.k);
        const crown = Kingship.crownPower(player, world, [t.v.id]);
        if (power > crown * _num(B.maxPowerShare)) return { ok: false, reason: `${Kingship.fullName(t.v)} is too strong to break (power ${power} against the crown's ${crown}).` };
        return { ok: true };
    },

    _breakLord(player, world, court, k, v, why) {
        const B = Kingship.config().breakLord || {};
        v.powerMult = (v.powerMult == null ? 1 : v.powerMult) * _num(B.powerMult);
        v.lands = 0;
        v.titles = 0;
        v.grudge = _num(v.grudge) + _num(B.grudge);
        v.cowedUntil = _day(world) + _num(B.cowedDays);
        v.refusingUntil = 0;
        v.rebel = false;
        Kingship._leaveFaction(court, v);
        for (const o of OFFICES) if (court.council[o] && court.council[o].kind === 'vassal' && court.council[o].id === v.id) court.council[o] = null;
        court.stats.lordsBroken++;
        Kingship._log(court, world, `⛓️ ${Kingship.fullName(v)} is broken: ${why}.`);
    },

    /** Strip a lord of lands, titles and men. The realm fears you; he hates you. */
    breakVassal(player, world, vassalId) {
        const B = Kingship.config().breakLord || {};
        const can = Kingship.canBreak(player, world, vassalId);
        if (!can.ok) return { success: false, reason: can.reason };
        const t = Kingship._target(player, world, vassalId);
        Kingship._breakLord(player, world, t.court, t.k, t.v, 'stripped of his lands and titles by the crown');
        for (const o of t.court.vassals) if (o !== t.v && !o.rebel) o.grudge = _num(o.grudge) + _num(B.fearOthers);
        t.k.stability = Utils.clamp(_num(t.k.stability) + _num(B.stability), 0, 100);
        if (B.prestige) House.award(player.house, B.prestige, `broke ${Kingship.fullName(t.v)}`, _day(world));
        Kingship.refresh(player, world);
        return { success: true, message: `${Kingship.fullName(t.v)} is broken: lands and titles forfeit, his levies cut. The other lords take note.` };
    },

    // ── Factions ────────────────────────────────────────────────

    demandText(demand) {
        const D = (Kingship.data().demands || {})[demand.type] || { label: demand.type, icon: '📜' };
        const ed = demand.edict ? (Kingship.edicts()[demand.edict] || {}).label || demand.edict : '';
        return { icon: D.icon, label: D.label.replace('{edict}', ed) };
    },

    demandSatisfied(player, demand) {
        const court = Kingship.court(player);
        if (!court || !demand) return true;
        if (demand.type === 'lowerLevy') {
            const tax = player.throne.ruling.policies && player.throne.ruling.policies.tax;
            return tax === 'light';
        }
        if (demand.type === 'passEdict') return !!court.edicts[demand.edict];
        if (demand.type === 'revokeEdict') return !court.edicts[demand.edict];
        return true;
    },

    /** What this lord would band together to demand, or null. */
    _demandFor(player, v) {
        const table = Kingship.data().goalDemands || {};
        const rank = { high: 3, medium: 2, low: 1 };
        const goals = (v.goals || []).slice().sort((a, b) => (rank[b.priority] || 0) - (rank[a.priority] || 0));
        for (const g of goals) {
            for (const [type, edict] of table[g.type] || []) {
                if (edict && !Kingship.edicts()[edict]) continue;
                const d = edict ? { type, edict } : { type };
                if (!Kingship.demandSatisfied(player, d)) return d;
            }
        }
        const levy = { type: 'lowerLevy' };
        return Kingship.demandSatisfied(player, levy) ? null : levy;
    },

    _leaveFaction(court, v) {
        if (!v.factionId) return;
        const f = court.factions.find(x => x.id === v.factionId);
        v.factionId = null;
        if (!f) return;
        f.members = f.members.filter(id => id !== v.id);
        if (!f.members.length) court.factions = court.factions.filter(x => x !== f);
        else if (f.leaderId === v.id) f.leaderId = f.members[0];
    },

    factionStrength(player, world, f) {
        const court = Kingship.court(player);
        const k = Kingship._realm(player, world);
        if (!court || !k) return 0;
        return f.members.reduce((s, id) => {
            const v = court.vassals.find(x => x.id === id);
            return s + (v ? Kingship.power(world, v, k) : 0);
        }, 0);
    },

    /** 0-1: how the faction weighs against the crown. */
    threat(player, world, f) {
        const s = Kingship.factionStrength(player, world, f);
        const c = Kingship.crownPower(player, world, f.members);
        return s / Math.max(1, s + c);
    },

    factions(player, world, { revealedOnly = false } = {}) {
        const court = Kingship.court(player);
        if (!court) return [];
        return court.factions.filter(f => !revealedOnly || f.revealed).map(f => ({
            faction: f, demand: Kingship.demandText(f.demand),
            leader: Kingship.fullName(court.vassals.find(v => v.id === f.leaderId)),
            members: f.members.map(id => Kingship.fullName(court.vassals.find(v => v.id === id))),
            strength: Kingship.factionStrength(player, world, f),
            threat: Math.round(Kingship.threat(player, world, f) * 100) / 100,
        }));
    },

    _applyDemand(player, world, demand) {
        if (demand.type === 'lowerLevy') {
            const r = player.throne.ruling;
            const i = TAX_STEPS.indexOf(r.policies.tax);
            const next = TAX_STEPS[Math.min(TAX_STEPS.length - 1, (i < 0 ? 1 : i) + 1)];
            if (next !== r.policies.tax) Throne.setPolicy(player, world, 'tax', next);
        } else if (demand.type === 'passEdict') {
            Kingship.passEdict(player, world, demand.edict, { free: true });
        } else if (demand.type === 'revokeEdict') {
            Kingship.revokeEdict(player, world, demand.edict);
        }
    },

    _dissolve(court, f) {
        for (const id of f.members) {
            const v = court.vassals.find(x => x.id === id);
            if (v && v.factionId === f.id) v.factionId = null;
        }
        court.factions = court.factions.filter(x => x !== f);
    },

    /** Give a revealed faction what it wants: it disbands, its lords mollified. */
    concede(player, world, factionId) {
        const F = Kingship.config().factions || {};
        const court = Kingship.court(player);
        const f = court && court.factions.find(x => x.id === factionId && x.revealed);
        if (!f) return { success: false, reason: 'No such faction.' };
        const d = Kingship.demandText(f.demand);
        Kingship._applyDemand(player, world, f.demand);
        for (const id of f.members) {
            const v = court.vassals.find(x => x.id === id);
            if (v) v.favour = _num(v.favour) + _num(F.concedeOpinion);
        }
        Kingship._dissolve(court, f);
        Kingship._log(court, world, `🏳️ The crown grants ${d.label}; the faction disbands.`);
        Kingship.refresh(player, world);
        return { success: true, message: `You grant ${d.label}. The faction disbands, its lords mollified.` };
    },

    /** Seize a revealed faction's leader: he is broken, the faction scattered, its members resentful. */
    arrestLeader(player, world, factionId) {
        const F = Kingship.config().factions || {};
        const court = Kingship.court(player);
        const k = Kingship._realm(player, world);
        const f = court && court.factions.find(x => x.id === factionId && x.revealed);
        if (!f || !k) return { success: false, reason: 'No such faction.' };
        const leader = court.vassals.find(v => v.id === f.leaderId);
        if (!leader) return { success: false, reason: 'The faction has no leader to seize.' };
        const can = Kingship.canBreak(player, world, leader.id);
        if (!can.ok) return { success: false, reason: can.reason };
        const members = f.members.filter(id => id !== leader.id);
        Kingship._dissolve(court, f);
        Kingship._breakLord(player, world, court, k, leader, 'seized as the head of a faction');
        for (const id of members) {
            const v = court.vassals.find(x => x.id === id);
            if (v) v.grudge = _num(v.grudge) + _num(F.arrestOthers);
        }
        Kingship.refresh(player, world);
        return { success: true, message: `${Kingship.fullName(leader)} is seized and broken; his faction scatters in fear and anger.` };
    },

    // ── Revolt ──────────────────────────────────────────────────

    revolt(player) {
        const c = Kingship.court(player);
        return (c && c.revolt) || null;
    },

    /** Is this a seat held by rebels against the player's crown? (systems/sieges.js) */
    isRebelSeat(player, q, r) {
        const rv = Kingship.revolt(player);
        return !!(rv && rv.seats.includes(_key(q, r)));
    },

    rebelStrength(player) {
        const rv = Kingship.revolt(player);
        return rv ? Math.round(rv.strength) : 0;
    },

    _startRevolt(player, world, court, k, f, out) {
        const R = Kingship.config().revolt || {};
        const members = f.members.map(id => court.vassals.find(v => v.id === id)).filter(Boolean);
        let power = 0;
        const seats = [];
        const mine = Kingship._holdingKeys(player, world);
        for (const v of members) {
            const p = Kingship.power(world, v, k);
            power += p;
            v.rebel = true;
            for (const o of OFFICES) if (court.council[o] && court.council[o].kind === 'vassal' && court.council[o].id === v.id) court.council[o] = null;
            // A lord seated (in an older save) on a holding of the player's cannot carry it into revolt
            if (Kingship._seatOf(world, v, k) && !mine.has(_key(v.seat.q, v.seat.r))) seats.push(_key(v.seat.q, v.seat.r));
        }
        const levies = Math.round(power * _num(R.leviesPerPower));
        k.military = Math.max(0, _num(k.military) - levies);
        const leader = court.vassals.find(v => v.id === f.leaderId) || members[0];
        court.revolt = {
            id: f.id, demand: f.demand, leaderId: leader ? leader.id : null, leaderName: Kingship.fullName(leader),
            members: members.map(v => v.id), seats, startDay: _day(world),
            strength: Math.round(power * _num(R.strengthPerPower)), momentum: 0,
            hosts: [], lastHostDay: _day(world) - _num(R.hostCadence) + 5, battlesWon: 0, battlesLost: 0,
        };
        court.factions = court.factions.filter(x => x !== f);
        for (const v of members) v.factionId = null;
        court.stats.revolts++;
        const d = Kingship.demandText(f.demand);
        const text = `🔥 ${Kingship.fullName(leader)} and ${members.length - 1} other lord(s) rise in revolt against the crown of ${k.name}, demanding ${d.label}!`;
        Kingship._log(court, world, text);
        Throne._log(player, world, text);
        if (Array.isArray(world.events)) world.events.push({ text, type: 'military', category: 'MILITARY', kingdom: k.id });
        Kingship._note(out, '🔥', 'Revolt!', `${text} Their levies (${levies}) desert the royal host. Break their war hosts, besiege their seats, or parley from the Royal Court.`, 'error');
    },

    _endRevolt(player, world, court, k, how, out) {
        const R = Kingship.config().revolt || {};
        const rv = court.revolt;
        court.revolt = null;
        for (const h of rv.hosts) {
            const unit = (world.units || []).find(u => u.id === h.id);
            if (unit) unit.destroyed = true;
        }
        const members = rv.members.map(id => court.vassals.find(v => v.id === id)).filter(Boolean);
        const d = Kingship.demandText(rv.demand);
        let text;
        if (how === 'crushed') {
            for (const v of members) Kingship._breakLord(player, world, court, k, v, 'defeated in revolt');
            court.stats.revoltsCrushed++;
            k.stability = Utils.clamp(_num(k.stability) + _num(R.crushedStability), 0, 100);
            House.award(player.house, _num(R.crushedPrestige), `crushed the revolt of ${rv.leaderName}`, _day(world));
            House.recordPlayerDeed(player, world, 'battleWon', { reason: `crushed the revolt of ${rv.leaderName}` });
            text = `👑 The revolt of ${rv.leaderName} is crushed. Its lords are broken (+${R.crushedPrestige} Prestige).`;
        } else {
            for (const v of members) {
                v.rebel = false;
                v.favour = _num(v.favour) + _num(how === 'parley' ? R.parleyOpinion : (Kingship.config().factions || {}).concedeOpinion);
            }
            const leader = court.vassals.find(v => v.id === rv.leaderId);
            if (leader && how === 'conceded') leader.titles = _num(leader.titles) + 1;
            Kingship._applyDemand(player, world, rv.demand);
            k.military = _num(k.military) + Math.round(rv.strength * 0.5);
            if (how === 'parley') {
                const loss = Math.min(House.getPrestige(player), -_num(R.parleyPrestige));
                if (loss > 0) House.spend(player.house, loss, 'a parley with rebels', _day(world));
                text = `🕊️ You parley with ${rv.leaderName}: ${d.label} is granted and the rebels go home.`;
            } else {
                court.stats.revoltsConceded++;
                k.stability = Utils.clamp(_num(k.stability) + _num(R.concededStability), 0, 100);
                const loss = Math.min(House.getPrestige(player), -_num(R.concededPrestige));
                if (loss > 0) House.spend(player.house, loss, `bowed to the revolt of ${rv.leaderName}`, _day(world));
                text = `🥀 The crown bows to ${rv.leaderName}'s revolt: ${d.label} is forced upon you (−${loss} Prestige).`;
            }
        }
        Kingship._log(court, world, text);
        Throne._log(player, world, text);
        if (Array.isArray(world.events)) world.events.push({ text, type: 'political', category: 'political', kingdom: k.id });
        Kingship._note(out, how === 'crushed' ? '👑' : '🥀', how === 'crushed' ? 'Revolt Crushed' : 'Revolt Ends', text, how === 'crushed' ? 'success' : 'warning');
        Kingship.refresh(player, world);
        return text;
    },

    parleyCost(player) {
        const R = Kingship.config().revolt || {};
        return Math.round(Kingship.rebelStrength(player) * _num(R.parleyPerStrength));
    },

    /** Buy the rebels off: grant their demand and pay them from the treasury. */
    parley(player, world) {
        const court = Kingship.court(player);
        const k = Kingship._realm(player, world);
        if (!court || !court.revolt || !k) return { success: false, reason: 'There is no revolt to end.' };
        const cost = Kingship.parleyCost(player);
        if (_num(k.treasury) < cost) return { success: false, reason: `The rebels want ${cost}g from the royal treasury.` };
        k.treasury -= cost;
        const text = Kingship._endRevolt(player, world, court, k, 'parley', null);
        return { success: true, failed: true, message: text };
    },

    /** PlayerMilitary.attackUnit: the player broke a rebel war host. */
    onRebelHostDefeated(player, world, unit) {
        const R = Kingship.config().revolt || {};
        const rv = Kingship.revolt(player);
        if (!rv || !unit || unit.revoltId !== rv.id) return null;
        const before = rv.hosts.length;
        rv.hosts = rv.hosts.filter(h => h.id !== unit.id);
        if (rv.hosts.length === before) return null;
        rv.momentum += _num(R.hostDefeated);
        rv.battlesWon++;
        House.recordPlayerDeed(player, world, 'battleWon', { reason: `broke the ${unit.name}` });
        return rv;
    },

    /** systems/sieges.js: the player took a rebel seat by storm or surrender. */
    onRebelSeatTaken(player, world, q, r) {
        const R = Kingship.config().revolt || {};
        const court = Kingship.court(player);
        const k = Kingship._realm(player, world);
        const rv = court && court.revolt;
        if (!rv || !k) return null;
        const key = _key(q, r);
        if (!rv.seats.includes(key)) return null;
        rv.seats = rv.seats.filter(s => s !== key);
        const v = court.vassals.find(x => x.seat && _key(x.seat.q, x.seat.r) === key && rv.members.includes(x.id));
        let gain = _num(R.seatTaken);
        let name = null;
        if (v) {
            if (v.id === rv.leaderId) gain = _num(R.leaderSeatTaken);
            rv.members = rv.members.filter(id => id !== v.id);
            rv.strength = Math.max(0, rv.strength - Kingship.power(world, v, k) * _num(R.strengthPerPower) * 0.5);
            Kingship._breakLord(player, world, court, k, v, 'his seat taken by the royal army');
            name = Kingship.fullName(v);
        }
        rv.momentum += gain;
        return { gain, lord: name };
    },

    _spawnHost(world, k, rv, rec) {
        const unit = RealmWars._spawnUnit(world, { id: `rebels_${k.id}` }, rec);
        unit.revoltId = rv.id;
        unit.icon = '🔥';
        return unit;
    },

    _dispatchHost(world, k, rv, player = null) {
        const R = Kingship.config().revolt || {};
        const bases = rv.seats.map(s => s.split(',').map(Number));
        // A holding of the player's already under siege by a foreign war host
        // (systems/holdingSieges.js) is that siege's business, not the rebels'
        const besieged = (player && player.realmWars && player.realmWars.besieged) || {};
        const loyal = Throne._settlementsOf(world, k).filter(e => !rv.seats.includes(_key(e.q, e.r)) && !besieged[_key(e.q, e.r)]);
        if (!bases.length || !loyal.length) return null;
        let best = null;
        for (const t of loyal) {
            for (const [bq, br] of bases) {
                const d = Hex.wrappingDistance(t.q, t.r, bq, br, world.width);
                if (!best || d < best.d) best = { d, t, b: { q: bq, r: br } };
            }
        }
        const strength = Math.round(Utils.clamp(rv.strength * _num(R.hostShare), _num(R.hostMin), _num(R.hostMax)));
        rv.strength = Math.max(0, rv.strength - strength);
        const rec = {
            id: `rh_${k.id}_${_day(world)}_${rv.hosts.length}`, name: `${rv.leaderName}'s Rebel Host`,
            q: best.b.q, r: best.b.r, targetQ: best.t.q, targetR: best.t.r,
            target: { kind: 'town', q: best.t.q, r: best.t.r, name: best.t.settlement.name }, strength,
        };
        rv.hosts.push(rec);
        rv.lastHostDay = _day(world);
        Kingship._spawnHost(world, k, rv, rec);
        return rec;
    },

    _hostStrikes(world, k, rv, rec, unit, out, player = null) {
        const R = Kingship.config().revolt || {};
        unit.destroyed = true;
        rv.hosts = rv.hosts.filter(h => h.id !== rec.id);
        const tile = world.getTile(rec.targetQ, rec.targetR);
        const s = tile && tile.settlement;
        if (!s || s.kingdom !== k.id) { rv.strength += rec.strength; return; }
        const isCapital = !!(k.capital && k.capital.q === rec.targetQ && k.capital.r === rec.targetR);
        // A holding of the player's own (systems/holdings.js) also fights with its garrison and walls
        const holding = player ? Holdings.find(player, world, rec.targetQ, rec.targetR) : null;
        const defense = _num(s.population) * 0.05 + _num(k.military) * (isCapital ? 0.3 : 0.1)
            + (holding ? Holdings.defenseRating(s) : 0);
        if (holding) {
            // The rebels can storm the player's own town but cannot make it a rebel seat
            if (rec.strength * Utils.randFloat(0.8, 1.3) > defense) {
                const h = Holdings.ensure(s);
                const H = (Kingship.config().revolt || {}).holdingSacked || {};
                h.unrest = Utils.clamp(_num(h.unrest) + _num(H.unrest), 0, 100);
                Holdings._garrisonLosses(h, _num(H.garrisonLoss));
                s.population = Math.max(0, Math.round(_num(s.population) * (1 - _num(H.populationLoss))));
                rv.momentum += _num(R.townFalls);
                rv.strength += Math.round(rec.strength * 0.5);
                Kingship._note(out, '🔥', 'Holding Sacked', `${rec.name} breaks into ${s.name}, your own holding, and sacks it before marching off. Its people seethe and its garrison is bloodied.`, 'error');
            } else {
                rv.momentum += _num(R.townHolds);
                Holdings.onSiegeRepelled(s);
                Kingship._note(out, '🛡️', 'Rebels Repelled', `Your holding of ${s.name} holds against ${rec.name}; the host is scattered.`, 'success');
            }
            return;
        }
        if (rec.strength * Utils.randFloat(0.8, 1.3) > defense) {
            rv.seats.push(_key(rec.targetQ, rec.targetR));
            rv.momentum += _num(R.townFalls);
            rv.strength += Math.round(rec.strength * 0.8);
            Kingship._note(out, '🔥', 'Town Falls to Rebels', `${rec.name} takes ${s.name}; it declares for the rebels.`, 'error');
        } else {
            rv.momentum += _num(R.townHolds);
            Kingship._note(out, '🛡️', 'Rebels Repelled', `${s.name} holds against ${rec.name}; the host is scattered.`, 'success');
        }
    },

    _tickRevolt(player, world, court, k, out) {
        const R = Kingship.config().revolt || {};
        const rv = court.revolt;
        // Hosts: keep records and units in sync, re-spawn after a load, resolve arrivals
        for (const rec of rv.hosts.slice()) {
            let unit = (world.units || []).find(u => u.id === rec.id);
            if (!unit) unit = Kingship._spawnHost(world, k, rv, rec);
            if (unit.destroyed) continue;
            rec.stuckDays = (unit.q === rec.q && unit.r === rec.r) ? (rec.stuckDays || 0) + 1 : 0;
            rec.q = unit.q; rec.r = unit.r;
            if (rec.stuckDays >= 8) {
                unit.destroyed = true;
                rv.hosts = rv.hosts.filter(h => h.id !== rec.id);
                rv.strength += rec.strength;
                continue;
            }
            if (unit.q === rec.targetQ && unit.r === rec.targetR) Kingship._hostStrikes(world, k, rv, rec, unit, out, player);
        }
        if (rv.hosts.length < 2 && _day(world) - rv.lastHostDay >= _num(R.hostCadence) && rv.strength >= _num(R.hostMin) * 2) {
            const rec = Kingship._dispatchHost(world, k, rv, player);
            if (rec) Kingship._note(out, '🔥', 'Rebel Host Marching', `${rec.name} (strength ${rec.strength}) marches on ${rec.target.name}. Meet it in the field.`, 'warning');
        }
        // The royal host meets the rebels in the field
        if (rv.strength > 0 && Utils.random() < _num(R.battleChance)) {
            const royal = _num(k.military) * _num(R.royalShare);
            const winP = Utils.clamp(royal / Math.max(1, royal + rv.strength) + rv.momentum / 400, 0.1, 0.9);
            if (Utils.random() < winP) {
                rv.momentum += _num(R.momentumPerBattle);
                rv.strength = Math.floor(rv.strength * (1 - _num(R.rebelLoss)));
                rv.battlesWon++;
            } else {
                rv.momentum -= _num(R.momentumPerBattle);
                k.military = Math.floor(_num(k.military) * (1 - _num(R.royalLoss)));
                rv.battlesLost++;
            }
        }
        // Rebel seats raise more men
        let seatPower = 0;
        for (const id of rv.members) {
            const v = court.vassals.find(x => x.id === id);
            if (v && v.seat && rv.seats.includes(_key(v.seat.q, v.seat.r))) seatPower += Kingship.power(world, v, k);
        }
        rv.strength = Math.round((rv.strength + seatPower * _num(R.regen)) * 10) / 10;
        rv.momentum = Math.round(rv.momentum * 10) / 10;

        const capKey = k.capital ? _key(k.capital.q, k.capital.r) : null;
        const days = _day(world) - rv.startDay;
        if (rv.momentum >= _num(R.crushedAt) || (!rv.hosts.length && (rv.strength < 5 || (!rv.seats.length && !rv.members.length)))) {
            Kingship._endRevolt(player, world, court, k, 'crushed', out);
        } else if (rv.momentum <= _num(R.lostAt) || (capKey && rv.seats.includes(capKey))) {
            Kingship._endRevolt(player, world, court, k, 'conceded', out);
        } else if (days >= _num(R.maxDays)) {
            Kingship._endRevolt(player, world, court, k, rv.momentum >= 0 ? 'crushed' : 'conceded', out);
        }
    },

    // ── Council, edicts and vassals feed the realm ──────────────

    /** Recompute the court's crown mods and push them to kingdom.crown. */
    refresh(player, world) {
        Kingship.computeMods(player, world);
        Throne.syncCrowns(player, world);
    },

    computeMods(player, world) {
        const court = Kingship.court(player);
        const k = Kingship._realm(player, world);
        if (!court || !k) return {};
        const mods = {};
        const add = (key, v) => { if (v) mods[key] = (mods[key] || 0) + v; };
        let peace = 0;
        const C = Kingship.config().council || {};
        for (const o of OFFICES) {
            const p = Kingship.councillor(player, world, o);
            if (!p) continue;
            const def = Kingship.offices()[o] || {};
            const f = Kingship._loyaltyFactor(p.loyalty);
            for (const [key, per] of Object.entries(def.mods || {})) add(key, per * p.competence * f);
            if (def.peaceChance) peace += def.peaceChance * p.competence * f;
            if (o === 'steward' && p.loyalty < _num(C.embezzleLoyalty)) add('treasury', -(_num(C.embezzleLoyalty) - p.loyalty) * _num(C.embezzleShare));
        }
        // Edicts' effects outside the kingdom AI (roads, charters, rival houses,
        // holdings' walls), published on kingdom.crown.effects by Throne.syncCrowns
        // and read through KingdomBonuses.crownEffect
        const effects = {};
        for (const id of Object.keys(court.edicts)) {
            const def = Kingship.edicts()[id];
            for (const [key, v] of Object.entries((def && def.mods) || {})) add(key, v);
            for (const [key, v] of Object.entries((def && def.effects) || {})) if (typeof v === 'number') effects[key] = (effects[key] || 0) + v;
        }
        court.effects = effects;
        const G = (Kingship.config().grants || {}).land || {};
        add('tax', -court.vassals.reduce((s, v) => s + _num(v.lands), 0) * _num(G.taxLoss));
        // Lords who refuse the levy keep their men and their dues
        const day = _day(world);
        for (const v of court.vassals) {
            if (v.rebel || !(v.refusingUntil > day)) continue;
            const p = Kingship.power(world, v, k);
            add('tax', -p / 1000);
            add('military', -p / 500);
        }
        if (court.revolt) {
            const R = Kingship.config().revolt || {};
            add('stability', _num(R.stabilityMod));
            let pop = 0;
            let total = 0;
            for (const e of Throne._settlementsOf(world, k)) {
                total += _num(e.settlement.population);
                if (court.revolt.seats.includes(_key(e.q, e.r))) pop += _num(e.settlement.population);
            }
            if (total > 0) add('tax', -0.5 * pop / total);
        }
        for (const key of Object.keys(mods)) mods[key] = Math.round(mods[key] * 1000) / 1000;
        court.mods = mods;
        court.peaceChance = Math.round(peace * 1000) / 1000;
        return mods;
    },

    /** Realm read-outs for the Royal Court's Realm tab. */
    realmStats(player, world) {
        const court = Kingship.court(player);
        const k = Kingship._realm(player, world);
        if (!court || !k) return null;
        const settlements = Throne._settlementsOf(world, k);
        return {
            kingdom: k, treasury: Math.floor(_num(k.treasury)), military: Math.floor(_num(k.military)),
            stability: Math.round(_num(k.stability)), population: settlements.reduce((s, e) => s + _num(e.settlement.population), 0),
            towns: settlements.length, unity: k.religion && typeof k.religion.unity === 'number' ? Math.round(k.religion.unity) : null,
            piety: k.religion && typeof k.religion.piety === 'number' ? Math.round(k.religion.piety) : null,
            wars: (k.wars || []).map(id => (world.getKingdom(id) || { name: id }).name),
            allies: (k.allies || []).map(id => (world.getKingdom(id) || { name: id }).name),
            upkeep: Kingship.upkeep(player), edicts: Object.keys(court.edicts).length, edictSlots: Kingship.edictSlots(player, world),
            mods: { ...court.mods }, peaceChance: court.peaceChance, stats: { ...court.stats },
            vassals: court.vassals.length, loyal: court.vassals.filter(v => v.opinion >= 20 && !v.rebel).length,
            disloyal: court.vassals.filter(v => v.opinion < 0 || v.rebel).length,
        };
    },

    // ── Daily ───────────────────────────────────────────────────

    _validateCouncil(player, world, court, out) {
        for (const o of OFFICES) {
            const seat = court.council[o];
            if (!seat) continue;
            if (!Kingship._person(player, world, o, seat.kind, seat.id)) {
                court.council[o] = null;
                const def = Kingship.offices()[o] || {};
                Kingship._note(out, def.icon || '🏛️', 'Council Seat Empty', `${seat.name} can no longer serve as ${def.label || o}. Name another from the Royal Court.`, 'warning');
            }
        }
    },

    _payUpkeep(player, world, court, k, out) {
        for (const id of Object.keys(court.edicts)) {
            const def = Kingship.edicts()[id];
            const cost = _num(def && def.upkeep);
            if (!def) { delete court.edicts[id]; continue; }
            if (!cost) continue;
            if (_num(k.treasury) >= cost) {
                k.treasury -= cost;
            } else {
                Kingship.revokeEdict(player, world, id, { lapse: true });
                Kingship._note(out, def.icon, 'Edict Lapses', `The royal treasury cannot pay for ${def.label}; it lapses.`, 'warning');
            }
        }
    },

    /** Faith unity: the High Priest draws the church together; edicts push it. */
    _faithDay(player, world, court, k) {
        const rel = k.religion;
        if (!rel || typeof rel.unity !== 'number') return;
        let d = 0;
        for (const id of Object.keys(court.edicts)) d += _num((Kingship.edicts()[id] || {}).unityDaily);
        const hp = Kingship.councillor(player, world, 'highPriest');
        if (hp) {
            const def = Kingship.offices().highPriest || {};
            const target = Utils.clamp(50 + hp.competence * _num(def.unity) * Kingship._loyaltyFactor(hp.loyalty), 0, 100);
            if (target > rel.unity) d += (target - rel.unity) * 0.02;
        }
        if (d) rel.unity = Math.round(Utils.clamp(rel.unity + d, 0, 100) * 100) / 100;
    },

    /** Weekly: minorities feel the edicts on faith. */
    _peoplesWeek(world, court, k) {
        let shift = 0;
        for (const id of Object.keys(court.edicts)) shift += _num((Kingship.edicts()[id] || {}).minoritySentiment);
        if (!shift) return;
        for (const e of Throne._settlementsOf(world, k)) {
            const demos = (e.settlement.demographics || []).filter(d => d && d.tribe);
            if (demos.length < 2) continue;
            const major = demos.reduce((a, b) => (_num(b.population) > _num(a.population) ? b : a));
            for (const d of demos) {
                if (d === major) continue;
                d.sentiment = Utils.clamp(Math.round(_num(d.sentiment) + shift), 0, 100);
            }
        }
    },

    _revealPlots(player, world, court, out) {
        const F = Kingship.config().factions || {};
        const sm = Kingship.councillor(player, world, 'spymaster');
        const def = Kingship.offices().spymaster || {};
        const per = def.reveal != null ? def.reveal : F.revealPerCompetence; // the office's own rate, else the factions' default
        const chance = _num(F.revealBase) + (sm ? _num(per) * sm.competence * Kingship._loyaltyFactor(sm.loyalty) : 0);
        for (const f of court.factions) {
            if (f.revealed) continue;
            if (Utils.random() < chance) {
                f.revealed = true;
                court.stats.plotsRevealed++;
                const d = Kingship.demandText(f.demand);
                Kingship._note(out, '🗝️', 'A Plot Revealed', `${sm ? `${sm.name}, your Spymaster, uncovers` : 'Whispers reveal'} a faction of ${f.members.length} lord(s) led by ${Kingship.fullName(court.vassals.find(v => v.id === f.leaderId))}, demanding ${d.label}.`, 'warning');
            }
        }
    },

    _resolveUltimatums(player, world, court, k, out) {
        const F = Kingship.config().factions || {};
        const day = _day(world);
        for (const f of court.factions.slice()) {
            if (Kingship.demandSatisfied(player, f.demand)) {
                for (const id of f.members) {
                    const v = court.vassals.find(x => x.id === id);
                    if (v) v.favour = _num(v.favour) + _num(F.concedeOpinion) / 2;
                }
                Kingship._dissolve(court, f);
                if (f.revealed) Kingship._note(out, '🏳️', 'Faction Disbands', `With ${Kingship.demandText(f.demand).label} granted, the faction disbands.`, 'success');
                continue;
            }
            if (!f.ultimatum || day < f.ultimatum.dueDay) continue;
            f.ultimatum = null;
            if (!court.revolt && Kingship.threat(player, world, f) >= _num(F.revoltThreat)) {
                Kingship._startRevolt(player, world, court, k, f, out);
                continue;
            }
            f.refusedDay = day;
            for (const id of f.members) {
                const v = court.vassals.find(x => x.id === id);
                if (!v) continue;
                v.refusingUntil = day + _num(F.refuseDays);
                v.grudge = _num(v.grudge) + _num(F.refuseOpinion);
            }
            const text = `The faction of ${Kingship.fullName(court.vassals.find(v => v.id === f.leaderId))} refuses the royal levy: its lords keep their men and their dues for ${F.refuseDays} days.`;
            Kingship._log(court, world, `🚫 ${text}`);
            Kingship._note(out, '🚫', 'Levies Refused', text, 'error');
        }
    },

    _vassalWeek(player, world, court, k, out) {
        const C = Kingship.config();
        const F = C.factions || {};
        const day = _day(world);
        for (const v of court.vassals) {
            // Seats lost to the realm make a lord landless
            if (v.seat && !Kingship._seatOf(world, v, k) && !v.rebel) {
                Kingship._note(out, '🏚️', 'A Lord Unseated', `${Kingship.fullName(v)} has lost ${v.seat.name} and is landless.`, 'warning');
                v.seat = null;
            }
            v.favour = Math.round(_num(v.favour) * _num(C.favourDecay) * 10) / 10;
            v.grudge = Math.round(_num(v.grudge) * _num(C.grudgeDecay) * 10) / 10;
            if (v.rebel) continue;
            const target = Kingship.opinion(player, world, v).target;
            v.opinion = Math.round((_num(v.opinion) + (target - _num(v.opinion)) * _num(C.opinionDrift)) * 10) / 10;
        }
        // Factions: the discontented band together, the content drift away
        for (const v of court.vassals) {
            if (v.rebel) continue;
            if (v.factionId && v.opinion >= _num(F.leaveOpinion)) { Kingship._leaveFaction(court, v); continue; }
            if (v.factionId || v.cowedUntil > day || v.opinion > _num(F.joinOpinion)) continue;
            const demand = Kingship._demandFor(player, v);
            if (!demand) continue;
            const chance = _num(F.joinChance) * (_num(v.ambition) / 10) * Math.min(1, -v.opinion / 50);
            if (Utils.random() >= chance) continue;
            const key = `${demand.type}:${demand.edict || ''}`;
            let f = court.factions.find(x => x.key === key);
            if (!f) {
                f = { id: `faction_${court.nextId++}`, key, demand, leaderId: v.id, members: [], formedDay: day, revealed: false, ultimatum: null, refusedDay: -999 };
                court.factions.push(f);
            }
            f.members.push(v.id);
            v.factionId = f.id;
        }
        // Strong factions move against the crown
        for (const f of court.factions.slice()) {
            const threat = Kingship.threat(player, world, f);
            if (f.revealed) {
                if (!f.ultimatum && threat >= _num(F.ultimatumThreat) && day - _num(f.refusedDay) >= _num(F.refuseDays)) {
                    f.ultimatum = { dueDay: day + _num(F.ultimatumDays) };
                    const d = Kingship.demandText(f.demand);
                    Kingship._note(out, '📜', 'An Ultimatum', `The faction of ${Kingship.fullName(court.vassals.find(v => v.id === f.leaderId))} demands ${d.label} by day ${f.ultimatum.dueDay} — or the realm will feel it. Answer from the Royal Court.`, 'warning');
                }
            } else if (!court.revolt && threat >= _num(F.revoltThreat) && Utils.random() < _num(F.surpriseRevoltChance)) {
                Kingship._startRevolt(player, world, court, k, f, out);
            }
        }
    },

    _yearly(player, world, court, k, out) {
        const C = Kingship.config();
        for (const v of court.vassals.slice()) {
            v.age = _num(v.age) + 1;
            if (v.rebel || v.age <= _num(C.deathAge)) continue;
            if (Utils.random() >= _num(C.deathChancePerYear) * (v.age - _num(C.deathAge))) continue;
            const old = Kingship.fullName(v);
            const heir = Characters.generateCharacter({ culture: k.culture, age: Utils.randInt(18, 35), dynasty: v.dynasty });
            Kingship._leaveFaction(court, v);
            for (const o of OFFICES) if (court.council[o] && court.council[o].kind === 'vassal' && court.council[o].id === v.id) court.council[o] = null;
            Object.assign(v, { firstName: heir.firstName, gender: heir.gender, age: heir.age, skills: { ...heir.skills },
                opinion: Math.round(_num(v.opinion) / 2), favour: 0, grudge: Math.round(_num(v.grudge) / 2), kin: false, titles: 0, cowedUntil: 0 });
            Kingship._note(out, '⚰️', 'A Lord Dies', `${old} is dead; ${Kingship.fullName(v)} inherits${v.seat ? ` ${v.seat.name}` : ''}.`, 'info');
        }
    },

    /**
     * Advance the court one day. Call after Throne.processDaily. Draws nothing
     * unless the player rules a realm.
     * @returns {{ notices: object[] }}
     */
    processDay(world, player) {
        const out = { notices: [] };
        if (!player || !world) return out;
        const k = Kingship._realm(player, world);
        if (!k) {
            // A lost crown leaves no rebel hosts behind
            for (const u of world.units || []) if (u.revoltId && !u.destroyed) u.destroyed = true;
            return out;
        }
        const court = Kingship.court(player);
        const C = Kingship.config();
        const day = _day(world);
        if (!court.initialized) {
            Kingship._generateVassals(player, world, k, court);
            court.initialized = true;
            court.lastNewVassalDay = day;
            Kingship._note(out, '🏛️', 'The Royal Court', `${court.vassals.length} lords of ${k.name} owe you fealty. Name your council and proclaim your edicts from the Royal Court.`, 'info');
        }
        Kingship._validateCouncil(player, world, court, out);
        Kingship._payUpkeep(player, world, court, k, out);
        Kingship._faithDay(player, world, court, k);
        Kingship._revealPlots(player, world, court, out);
        Kingship._resolveUltimatums(player, world, court, k, out);
        const since = _num(player.throne.ruling.since);
        if ((day - since) % (C.vassalTick || 7) === 0) {
            Kingship._vassalWeek(player, world, court, k, out);
            Kingship._peoplesWeek(world, court, k);
        }
        if ((day - since) > 0 && (day - since) % (C.yearDays || 120) === 0) Kingship._yearly(player, world, court, k, out);
        if (day - court.lastNewVassalDay >= _num(C.newVassalCadence) && court.vassals.length < _num(C.maxVassals)) {
            court.lastNewVassalDay = day;
            const seat = Kingship._freeSeats(court, world, k, player)[0];
            if (seat) {
                const v = Kingship._newVassal(court, world, k, seat);
                v.opinion = Kingship.opinion(player, world, v).target;
                Kingship._note(out, '🏰', 'A New Vassal', `${Kingship.fullName(v)} swears fealty for ${seat.settlement.name}.`, 'info');
            }
        }
        if (court.revolt) Kingship._tickRevolt(player, world, court, k, out);
        Kingship.refresh(player, world);
        return out;
    },

    // ── Persistence ─────────────────────────────────────────────

    /** Backfill the court on load (it is saved inside player.throne). */
    load(player, world) {
        if (!Kingship.court(player)) return;
        if (world) Kingship.refresh(player, world);
    },
};
