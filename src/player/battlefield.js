// ============================================
// BATTLEFIELD — a field battle fought out on the ground, company by company
// ============================================
// The phased battle (player/fieldBattle.js) decides a fight in three stance
// choices. This is the same battle fought where it happens: both armies drawn
// up as companies of men (foot, archers, horse) on the hex's own ground, and
// the player commanding them — move, hold, charge, loose a volley, fall back,
// sound the retreat — while the fight runs in real time (the UI can pause it).
//
// The numbers are the phased battle's. A battle is first drawn up by
// FieldBattle.start (counters, terrain, weather, morale from leadership,
// traits, artifacts, techs, specials, the difficulty, the battle's fortune);
// this module splits each side's power over its companies and lets them meet:
//
//   volleys   archers loose at what is in range: the opening phase's loss
//             base, scaled by the shooters' share of the power against the
//             target's (cover in woods, shields of a company holding)
//   melee     companies in contact trade losses from the melee phase's loss
//             base and their share of the power (the stance numbers of Hold
//             the line for a company holding, Aggressive for one charging;
//             flank and rear attacks, the first shock of a charge, horse in
//             woods, high ground, fords)
//   pursuit   a company that breaks runs for its own edge of the field; what
//             catches it cuts it down at the pursuit phase's loss base × the
//             rout multiplier, horse best
//   morale    each company's own: losses shake it, a flank or rear attack
//             shakes it more, a friend breaking nearby too; the commander
//             near steadies it. Shaken it wavers; broken it routs
//
// When one side has no company left standing (or the player sounds the
// retreat and gets off the field, or the objective's time runs out) the
// battle is over: conclude() turns each of the player's companies' losses
// into soldiers lost from that company's own units (PlayerMilitary.
// _applyCasualties with a pick list), writes the end state into the
// FieldBattle battle (sim, log, outcome) and runs FieldBattle.finish — the
// same aftermath as every other battle (spoils, renown, companions, the
// world unit's fate through attackUnit).
//
// Pure domain logic: explicit params, no DOM, no globals. Every roll comes
// from the battle's own seeded stream (through Utils.withRng), so a battle
// replays exactly from its seed and the orders given at the same ticks, and
// never moves the game's dice. tick() always advances a fixed step.
// Positions are in tiles of the field (the hex's inner map). The caller hands
// in the ground as a `field`: { w, h, pass(q,r), cover(q,r), slow(q,r),
// high(q,r) } — Battlefield.openField(w, h) is a plain meadow for tests.
// Tuning: data/military.json → battlefield.

import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { PlayerMilitary } from './playerMilitary.js';
import { FieldBattle } from './fieldBattle.js';
import { Traits } from '../systems/traits.js';
import { Arms } from '../systems/arms.js';

const DEFAULTS = {
    step: 0.1,
    maxSeconds: 420,
    // How much strength one figure on the field stands for (the bigger side is capped)
    strPerFigure: 2.5,
    maxFiguresPerSide: 54,
    minFiguresPerCompany: 3,
    maxFiguresPerCompany: 16,
    kinds: {
        foot: { name: 'Foot', icon: '🛡️', speed: 1.35, ranks: 3, along: 1.0, across: 1.0, melee: 1 },
        archer: { name: 'Archers', icon: '🏹', speed: 1.45, ranks: 2, along: 1.1, across: 1.15, melee: 0.6, range: 13, volleyEvery: 3.2 },
        horse: { name: 'Horse', icon: '🐎', speed: 3.1, ranks: 2, along: 1.9, across: 1.45, melee: 1.1 },
    },
    deploy: { gap: 22, rowGap: 2.5 },
    counterWeight: 0.6,
    // The army's whole make-up against the foe's (the phased battle's counter), laid on every company
    armyCounter: 0,
    // Each side's luck of the day on the field (×1±fieldLuck, drawn once from the battle's stream)
    fieldLuck: 0,
    chargeSpeed: 1.45,
    routSpeed: 1.25,
    withdrawSpeed: 0.85,
    contact: 1.35,
    meleeSeconds: 18,
    volleySeconds: 10,
    // Volleys into a press where your own men fight: this share of the effect (0: held)
    pressVolley: 0,
    pursuitSeconds: 8,
    spread: 0.15,
    chargeShock: { seconds: 2.5, horse: 1.5, foot: 1.2, vsHoldingFoot: 0.75 },
    flank: { side: 1.2, rear: 1.4, shockSide: 0.08, shockRear: 0.18 },
    terrain: { coverArrows: 0.45, coverMelee: 1.15, horseInCover: 0.65, high: 1.15, water: 0.75, holdShields: 0.75 },
    morale: { lossShock: 2.2, regen: 0.015, commanderRegen: 0.02, commanderRadius: 7, friendRout: 0.08, friendRadius: 9, waver: 0.5, waverPower: 0.8, rout: 0.22, routStrength: 0.3, routChance: 1.4, rallyAfter: 12, rallyMorale: 0.55 },
    ai: { think: 1, horseWait: 6, footWait: 2.5, archerKeepAway: 5, archerJoin: 0 },
    pursuitAfterBreak: 9,
    holdSeconds: 150,
    withdrawSeconds: 14,
    flightSpeed: 16,
    // The share of a company's strength lost that is men lost for good (the rest scattered, back by evening)
    lossToUnits: 0.6,
    // A company holding faces the foe once and keeps that front; it wheels only for a threat
    // within threatRange tiles more than acos(threatCos) off its front
    hold: { threatRange: 9, threatCos: 0.5 },
    // An assault on a town: the attackers drawn up this many tiles outside the streets
    assault: { gap: 26 },
    // The day's clock while a battle is fought: it stands still, then moves on by this
    clock: { baseHours: 1, hoursPerMinute: 0.5, minHours: 1, maxHours: 5 },
};

function _merge(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
        if (k.startsWith('_')) continue;
        out[k] = (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]))
            ? _merge(base[k], v) : v;
    }
    return out;
}

let _cfgCache = null;
let _cfgSource = null;

const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const _r2 = (v) => Math.round(v * 100) / 100;

/** A role in PlayerMilitary.FORMATION_ROLES → a company kind on the field. */
const KIND_OF_ROLE = { pikeman: 'foot', archer: 'archer', cavalry: 'horse' };
const ROLE_OF_KIND = { foot: 'pikeman', archer: 'archer', horse: 'cavalry' };

/** The battle's own dice: a mulberry32 stream whose state lives on the battlefield. */
function _stream(bf) {
    return () => {
        bf.rs = (bf.rs + 0x6D2B79F5) | 0;
        let t = bf.rs;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export const Battlefield = {
    DEFAULTS,

    /** Tuning: the defaults with data/military.json → battlefield laid over them. */
    config() {
        const src = DataLoader.military && DataLoader.military.battlefield;
        if (!_cfgCache || _cfgSource !== src) {
            _cfgCache = _merge(DEFAULTS, src || {});
            _cfgSource = src;
        }
        return _cfgCache;
    },

    /** A plain open field (tests, and the fallback when there is no map). */
    openField(w = 64, h = 40, opts = {}) {
        return {
            w, h,
            pass: (q, r) => q >= 0 && r >= 0 && q < w && r < h && !(opts.water && opts.water(q, r)),
            cover: (q, r) => (opts.woods && opts.woods(q, r) ? 1 : 0),
            slow: (q, r) => (opts.woods && opts.woods(q, r) ? 0.65 : 1),
            high: (q, r) => (opts.hill && opts.hill(q, r) ? 1 : 0),
        };
    },

    /**
     * Where on the field to fight: the open rectangle (`w`×`h` tiles) with the
     * most passable ground, nearest `prefer` {q, r} (the player). Pure scan.
     * → { x0, y0, x1, y1, cx, cy }
     */
    pickArea(field, prefer = null, w = 44, h = 24) {
        w = Math.min(w, field.w - 2);
        h = Math.min(h, field.h - 2);
        const px = prefer ? prefer.q : field.w / 2, py = prefer ? prefer.r : field.h / 2;
        let best = null;
        const stepX = Math.max(2, Math.floor(w / 8)), stepY = Math.max(2, Math.floor(h / 8));
        for (let y0 = 1; y0 + h < field.h - 1; y0 += stepY) {
            for (let x0 = 1; x0 + w < field.w - 1; x0 += stepX) {
                let open = 0, n = 0;
                for (let y = y0; y < y0 + h; y += 2) {
                    for (let x = x0; x < x0 + w; x += 2) {
                        n++;
                        // (a town's streets and yards count for little: armies meet outside the walls)
                        if (field.pass(x, y)) open += field.cover(x, y) ? 0.6 : (field.town && field.town(x, y) ? 0.25 : 1);
                    }
                }
                const cx = x0 + w / 2, cy = y0 + h / 2;
                // Open ground first (a field, not a town's streets), then near where you stand
                const share = open / Math.max(1, n);
                const score = share * share * share - _dist(cx, cy, px, py) / (field.w + field.h) * 0.25;
                if (!best || score > best.score) best = { x0, y0, x1: x0 + w, y1: y0 + h, cx, cy, score };
            }
        }
        if (!best) best = { x0: 1, y0: 1, x1: field.w - 2, y1: field.h - 2, cx: field.w / 2, cy: field.h / 2, score: 0 };
        delete best.score;
        return best;
    },

    /**
     * The ground of an assault on a town (or a raid on a village): the
     * defenders in the streets, the attackers drawn up outside, toward the
     * edge of the map with the most room between it and the town. Needs the
     * field's `town(q, r)` (the street map's built-up ground). → { area, lines:
     * { player, enemy }, cy, playerSide } or null when the field has no town.
     */
    assaultLayout(field) {
        if (typeof field.town !== 'function') return null;
        let sx = 0, sy = 0, n = 0;
        for (let y = 1; y < field.h - 1; y += 2) {
            for (let x = 1; x < field.w - 1; x += 2) {
                if (field.pass(x, y) && field.town(x, y)) { sx += x; sy += y; n++; }
            }
        }
        if (n < 6) return null;
        const tx = sx / n, ty = sy / n;
        const cfg = Battlefield.config();
        const gap = (cfg.assault && cfg.assault.gap) || 26;
        // Come on from the side with the more room outside the town
        const west = tx >= field.w / 2;
        const dir = west ? 1 : -1;
        const px = _clamp(tx - dir * gap, 4, field.w - 5);
        const ex = _clamp(tx, 4, field.w - 5);
        const cy = _clamp(ty, 8, field.h - 9);
        const x0 = Math.max(1, Math.min(px, ex) - 6), x1 = Math.min(field.w - 2, Math.max(px, ex) + 6);
        const y0 = Math.max(1, cy - 14), y1 = Math.min(field.h - 2, cy + 14);
        return {
            area: { x0, y0, x1, y1, cx: (px + ex) / 2, cy },
            lines: { player: px, enemy: ex },
            cy,
            playerSide: west ? 'west' : 'east',
        };
    },

    /**
     * The companies of a side with a living man inside the box (field tiles,
     * corners in any order): a drag-box selection. → [company id]
     */
    inBox(bf, side, x0, y0, x1, y1) {
        const lx = Math.min(x0, x1), hx = Math.max(x0, x1), ly = Math.min(y0, y1), hy = Math.max(y0, y1);
        return bf.companies
            .filter(c => c.side === side && Battlefield.standing(c)
                && c.figures.some(f => f.alive && f.x >= lx && f.x <= hx && f.y >= ly && f.y <= hy))
            .map(c => c.id);
    },

    /**
     * The hours of the day a battle takes: a set time for drawing up and
     * clearing the field, and so much more for each minute it was fought
     * (data/military.json → battlefield.clock). The world's clock stands while
     * the battle runs and moves on by this when it ends.
     */
    gameHours(bf) {
        const C = Battlefield.config().clock || {};
        const h = (Number(C.baseHours) || 0) + (Math.max(0, Number(bf && bf.t) || 0) / 60) * (Number(C.hoursPerMinute) || 0);
        return _r2(_clamp(h, Number(C.minHours) || 0, Number(C.maxHours) || 24));
    },

    // ── Drawing up ──────────────────────────────────────────────────────

    /**
     * The player's companies: the land units grouped by role, a company per
     * `maxFiguresPerCompany` figures. → [{ kind, role, typeId, units, str }]
     */
    _playerGroups(player, theatre = 'land') {
        // (a realm's household guard riding with you — unit.realmGuard, player/realmEscort.js —
        // stands as companies of its own, in its realm's livery, after your own of each role)
        const byRole = { pikeman: [], archer: [], cavalry: [] };
        const guardRole = { pikeman: new Map(), archer: new Map(), cavalry: new Map() };
        for (const u of player.army || []) {
            if (!PlayerMilitary._theatreParticipant(u, theatre) || PlayerMilitary.isNavalUnit(u)) continue;
            const role = PlayerMilitary._roleForUnitType(u.type);
            if (u.realmGuard != null) {
                const m = guardRole[role];
                if (!m.has(u.realmGuard)) m.set(u.realmGuard, []);
                m.get(u.realmGuard).push(u);
            } else byRole[role].push(u);
        }
        const out = [];
        const weight = (u) => (u.strength || 1) * (1 + ((u.level || 1) - 1) * 0.2) * (u.woundedDays > 0 ? 0.5 : 1);
        const add = (role, list, guard) => {
            if (!list.length) return;
            const total = list.reduce((s, u) => s + weight(u), 0);
            const g = { kind: KIND_OF_ROLE[role], role, units: list, weight: total, typeId: Battlefield._dominantType(list) };
            if (guard != null) g.guard = guard;
            out.push(g);
        };
        for (const role of ['pikeman', 'archer', 'cavalry']) {
            add(role, byRole[role], null);
            for (const [kid, list] of guardRole[role]) add(role, list, kid);
        }
        return out;
    },

    _dominantType(units) {
        const tally = {};
        for (const u of units) tally[u.type] = (tally[u.type] || 0) + (u.strength || 1);
        return Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    },

    /** Unit types the enemy's companies are shown as, by enemy kind. */
    _enemyTypes(enemy) {
        const name = String((enemy && enemy.name) || '').toLowerCase();
        const type = enemy && enemy.type;
        const rabble = type === 'raider' || type === 'pirate' || type === 'smuggler' || /bandit|brigand|outlaw|raider|pirate|rebel|mob/.test(name);
        return rabble ? { pikeman: 'militia', archer: 'archer', cavalry: 'cavalry', rabble: true }
            : { pikeman: 'soldier', archer: 'archer', cavalry: /knight|host|royal/.test(name) ? 'knight' : 'cavalry', rabble: false };
    },

    /**
     * Draw the battle up on the field. `battle` is a FieldBattle.start battle;
     * `opts`: { area (pickArea), objective: { type: 'rout'|'hold', seconds },
     * playerSide: 'west'|'east', enemy: the enemy description (type, name,
     * livery) }. Splits each side's strength over its companies and sets them
     * out facing each other. Returns the battlefield.
     */
    create(player, battle, field, opts = {}) {
        const cfg = Battlefield.config();
        // An assault: the defenders in the town's streets, the attackers outside (assaultLayout)
        const assault = opts.layout === 'assault' ? Battlefield.assaultLayout(field) : null;
        const area = (assault && assault.area) || opts.area || Battlefield.pickArea(field, opts.prefer || null);
        const pDir = (assault ? assault.playerSide : opts.playerSide) === 'east' ? -1 : 1;
        const bf = {
            id: `bf_${battle.id}`,
            seed: battle.seed,
            // (the battle's own stream: one draw from the game's dice when it is drawn up, none after)
            rs: (Math.abs(Utils.hashStr(`field:${battle.seed}:${Math.floor(Utils.random() * 1e9)}`)) % 2147483647) + 1,
            t: 0,
            field,
            area,
            battle,
            theatre: battle.theatre,
            objective: { type: 'rout', seconds: cfg.holdSeconds, ...(opts.objective || {}) },
            companies: [],
            pending: [],
            events: [],
            log: [],
            over: null,
            brokeAt: null,
            retreatAt: null,
            commander: null,
            nextId: 1,
            enemyLabel: battle.enemyName,
            enemyInfo: { type: battle.enemyType || (opts.enemy && opts.enemy.type) || null, name: battle.enemyName },
            sides: {
                player: { dir: pDir, rest: 1, kindMult: {}, leadership: battle.leadership || 0, fortune: battle.fortune || 1, casMult: battle.pCasMult || 1, personal: battle.personal || { opening: 1, melee: 1, pursuit: 1 } },
                enemy: { dir: -pDir, rest: 1, kindMult: {}, leadership: battle.enemyMoraleBonus || 0, fortune: 1, casMult: 1, personal: { opening: 1, melee: 1, pursuit: 1 } },
            },
            aiSide: { player: false, enemy: true },
            aiT: 0,
            layout: assault ? 'assault' : 'field',
            lines: assault ? assault.lines : null,
        };
        // Each side's power with the composition-borne parts (hex terrain, weather)
        // taken out, to be laid on per company kind instead
        for (const [side, comp, mult] of [['player', battle.pComp, battle.pMult], ['enemy', battle.eComp, battle.eMult]]) {
            const S = bf.sides[side];
            const compBorne = PlayerMilitary._terrainMultiplier(battle.terrainId, comp) * PlayerMilitary._weatherMultiplier(battle.weather, comp);
            S.rest = (mult || 1) / Math.max(0.01, compBorne);
            // The army's make-up against the foe's as a whole (the phased battle's counter):
            // an army that answers the enemy's fights better everywhere (armyCounter of it)
            const other = side === 'player' ? battle.eComp : battle.pComp;
            S.counter = comp && other ? PlayerMilitary._counterMultiplier(comp, other) : 1;
            // The run of the day on each side (the phased battle's rolls, felt over the whole field)
            const L = Number(cfg.fieldLuck) || 0;
            if (L > 0) S.fortune *= Utils.withRng(_stream(bf), () => Utils.randFloat(1 - L, 1 + L));
            for (const kind of Object.keys(cfg.kinds)) {
                const pure = { cavalry: 0, archer: 0, pikeman: 0, [ROLE_OF_KIND[kind]]: 1 };
                S.kindMult[kind] = PlayerMilitary._terrainMultiplier(battle.terrainId, pure) * PlayerMilitary._weatherMultiplier(battle.weather, pure);
            }
        }

        // The player's side, from the army itself (a realm's host: from its composition, below)
        const groups = battle.host ? [] : Battlefield._playerGroups(player, battle.theatre);
        const pTotal = Math.max(1, battle.sim.pStr);
        const eTotal = Math.max(1, battle.sim.eStr);
        const gWeight = groups.reduce((s, g) => s + g.weight, 0) || 1;
        const strPerFig = Math.max(cfg.strPerFigure, Math.max(pTotal, eTotal) / cfg.maxFiguresPerSide);
        const pSpecs = [];
        for (const g of groups) {
            const str = pTotal * g.weight / gWeight;
            Battlefield._split(str, strPerFig, cfg).forEach((part, i, all) => {
                const share = part.str / str;
                // The units of this group shared over its companies, in order
                const from = Math.round(g.units.length * all.slice(0, i).reduce((s, p) => s + p.str / str, 0));
                const to = i === all.length - 1 ? g.units.length : Math.round(g.units.length * all.slice(0, i + 1).reduce((s, p) => s + p.str / str, 0));
                pSpecs.push({ side: 'player', kind: g.kind, typeId: g.typeId, str: part.str, figs: part.figs, units: g.units.slice(from, Math.max(from, to)), share, guard: g.guard });
            });
        }
        // The enemy's, from what is known of them (their composition)
        const eTypes = Battlefield._enemyTypes(opts.enemy || { name: battle.enemyName, type: battle.enemyType });
        bf.enemyInfo.rabble = eTypes.rabble;
        const eSpecs = Battlefield._compSpecs('enemy', battle.eComp, eTotal, strPerFig, eTypes);
        if (battle.host) pSpecs.push(...Battlefield._compSpecs('player', battle.pComp, pTotal, strPerFig, { pikeman: 'soldier', archer: 'archer', cavalry: 'knight' }));

        // The spoils are what the beaten carried: the purse handed in, else a world unit's
        // inventory, a town's purse, a realm's treasury (FieldBattle.lootSource) — minting nothing
        if (opts.lootPurse !== undefined) battle.lootPurse = opts.lootPurse;

        Battlefield._deploySide(bf, pSpecs, 'player');
        Battlefield._deploySide(bf, eSpecs, 'enemy');

        // The commander (the player) behind the middle of their line
        const pc = bf.companies.filter(c => c.side === 'player');
        const led = pc.find(c => c.kind === 'foot') || pc[0] || null;
        bf.commander = {
            x: (led ? led.x : area.cx) - bf.sides.player.dir * 4,
            y: led ? led.y : area.cy,
            ledId: led ? led.id : null,
        };
        Battlefield._place(bf, bf.commander);
        // ...and theirs: the enemy's captain behind their foot (steadies their men the same way)
        const ec = bf.companies.filter(c => c.side === 'enemy');
        const eLed = ec.find(c => c.kind === 'foot') || ec[0] || null;
        bf.foeCaptain = { x: (eLed ? eLed.x : area.cx) - bf.sides.enemy.dir * 4, y: eLed ? eLed.y : area.cy, ledId: eLed ? eLed.id : null, side: 'enemy' };
        Battlefield._place(bf, bf.foeCaptain);
        for (const c of bf.companies) {
            c.morale0 = c.morale = PlayerMilitary._moraleValue(
                c.side === 'player' ? pTotal : eTotal, c.side === 'player' ? eTotal : pTotal, bf.sides[c.side].leadership);
        }
        bf.log.push({ t: 0, text: `The armies are drawn up: your ${pc.length} compan${pc.length === 1 ? 'y' : 'ies'} against the ${battle.enemyName}.` });
        return bf;
    },

    /** A side's companies from a composition: [{ side, kind, typeId, str, figs, units: [] }]. */
    _compSpecs(side, comp, total, strPerFig, types) {
        const cfg = Battlefield.config();
        const out = [];
        for (const role of ['pikeman', 'archer', 'cavalry']) {
            const share = comp[role] || 0;
            if (share < 0.06) continue;
            for (const part of Battlefield._split(total * share, strPerFig, cfg)) {
                out.push({ side, kind: KIND_OF_ROLE[role], typeId: types[role], str: part.str, figs: part.figs, units: [] });
            }
        }
        if (!out.length) out.push({ side, kind: 'foot', typeId: types.pikeman, str: total, figs: Math.max(cfg.minFiguresPerCompany, Math.round(total / strPerFig)), units: [] });
        // (the shares left re-normalised, so the side's strength is whole)
        const sum = out.reduce((s, c) => s + c.str, 0);
        for (const c of out) c.str *= total / sum;
        return out;
    },

    /** Split a strength into companies of at most maxFiguresPerCompany figures. */
    _split(str, strPerFig, cfg) {
        const figs = Math.max(cfg.minFiguresPerCompany, Math.round(str / strPerFig));
        const n = Math.max(1, Math.ceil(figs / cfg.maxFiguresPerCompany));
        const out = [];
        for (let i = 0; i < n; i++) {
            const f = Math.max(cfg.minFiguresPerCompany, Math.round(figs / n));
            out.push({ str: str / n, figs: f });
        }
        return out;
    },

    /** Set one side's companies out: foot in the middle, archers before them, horse on the wings. */
    _deploySide(bf, specs, side) {
        const cfg = Battlefield.config();
        const S = bf.sides[side];
        const a = bf.area;
        // (an assault sets each side's line itself: the attackers outside, the defenders in the streets)
        const lineX = bf.lines && bf.lines[side] != null ? bf.lines[side] : a.cx - S.dir * cfg.deploy.gap / 2;
        const foot = specs.filter(s => s.kind === 'foot');
        const archers = specs.filter(s => s.kind === 'archer');
        const horse = specs.filter(s => s.kind === 'horse');
        const width = (s) => {
            const k = cfg.kinds[s.kind];
            return Math.ceil(s.figs / Math.min(k.ranks, s.figs)) * k.across;
        };
        const row = (list, x) => {
            const total = list.reduce((sum, s) => sum + width(s), 0) + Math.max(0, list.length - 1) * cfg.deploy.rowGap;
            let y = a.cy - total / 2;
            const placed = [];
            for (const s of list) {
                const w = width(s);
                placed.push(Battlefield._addCompany(bf, s, x, y + w / 2));
                y += w + cfg.deploy.rowGap;
            }
            return { total, placed };
        };
        const mid = row(foot, lineX);
        // (the archers a few paces behind the foot, loosing over them: deploy.archers, negative = behind)
        row(archers, lineX + S.dir * (foot.length ? (cfg.deploy.archers == null ? -3.5 : cfg.deploy.archers) : 0));
        // Horse on the wings, outside the foot
        const half = Math.max(mid.total, 6) / 2 + 3;
        horse.forEach((s, i) => {
            const wing = i % 2 === 0 ? 1 : -1;
            const off = half + Math.floor(i / 2) * (width(s) + cfg.deploy.rowGap) + width(s) / 2;
            Battlefield._addCompany(bf, s, lineX - S.dir * 1.5, a.cy + wing * off);
        });
    },

    _addCompany(bf, spec, x, y) {
        const cfg = Battlefield.config();
        const k = cfg.kinds[spec.kind];
        const S = bf.sides[spec.side];
        const def = PlayerMilitary.UNIT_TYPES && spec.typeId ? Object.values(PlayerMilitary.UNIT_TYPES).find(u => u.id === spec.typeId) : null;
        const id = bf.nextId++;
        const c = {
            id,
            side: spec.side,
            kind: spec.kind,
            role: ROLE_OF_KIND[spec.kind],
            typeId: spec.typeId || null,
            name: def ? Battlefield.plural(def.name) : k.name,
            icon: def ? def.icon : k.icon,
            units: spec.units || [],
            str0: spec.str,
            str: spec.str,
            figs0: spec.figs,
            x: _clamp(x, bf.area.x0, bf.area.x1), y: _clamp(y, 1, bf.field.h - 2),
            dx: S.dir, dy: 0,
            order: { type: 'hold' },
            state: 'formed',
            morale: 1, morale0: 1,
            volleyT: (id % 3) * 0.6,
            engaged: [],
            chargeT: -99,
            routT: null,
            lastHurtT: -99,
            moving: false,
            figures: [],
            cols: 1,
            rangeBonus: def && def.rangeBonus ? def.rangeBonus : 0,
        };
        // A realm's household guard (player/realmEscort.js): its own company, in its realm's livery
        if (spec.guard != null) {
            c.guard = spec.guard;
            c.name = `Guard ${c.name.toLowerCase()}`;
        }
        const ranks = Math.min(k.ranks, spec.figs);
        c.cols = Math.ceil(spec.figs / ranks);
        for (let i = 0; i < spec.figs; i++) {
            c.figures.push({ i, slot: i, x: 0, y: 0, alive: true, fellAt: null, side: 0, anim: 'idle', swingT: 0, moving: false });
        }
        // Each in their place in the formation
        for (const f of c.figures) {
            const p = Battlefield.slotPos(c, f.slot);
            f.x = p.x; f.y = p.y;
            Battlefield._place(bf, f);
        }
        // Arrows: the volleys its bowmen's quivers hold (systems/arms.js; null: not counted)
        c.volleys = Arms.fieldVolleys(c.units);
        bf.companies.push(c);
        return c;
    },

    /** A figure's place in its company's formation (rank 0 is the front). */
    slotPos(c, slot) {
        const k = Battlefield.config().kinds[c.kind];
        const alive = c.figures.filter(f => f.alive).length || c.figs0;
        const cols = Math.max(1, Math.min(c.cols, alive));
        const rank = Math.floor(slot / cols), col = slot % cols;
        const inRank = Math.min(cols, alive - rank * cols);
        const across = (col - (inRank - 1) / 2) * k.across;
        const along = -rank * k.along;
        // facing (dx, dy); across is the left-hand perpendicular (-dy, dx)
        return { x: c.x + c.dx * along - c.dy * across, y: c.y + c.dy * along + c.dx * across };
    },

    /** Nudge a point onto passable ground (nearest within 3 tiles). */
    _place(bf, p) {
        const f = bf.field;
        if (f.pass(Math.round(p.x), Math.round(p.y))) return true;
        for (let r = 1; r <= 3; r++) {
            for (let dy = -r; dy <= r; dy++) {
                for (let dx = -r; dx <= r; dx++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                    if (f.pass(Math.round(p.x + dx), Math.round(p.y + dy))) { p.x += dx; p.y += dy; return true; }
                }
            }
        }
        return false;
    },

    // ── Orders ─────────────────────────────────────────────────────────

    /**
     * Give a company an order: { type: 'hold' } | { type: 'move', x, y } |
     * { type: 'charge', targetId } | { type: 'volley', targetId } |
     * { type: 'withdraw' }. Routed companies do not listen.
     */
    order(bf, companyId, order) {
        const c = bf.companies.find(x => x.id === companyId);
        if (!c || !Battlefield.standing(c) || bf.over) return false;
        if (c.state === 'withdrawing' && order.type !== 'withdraw' && bf.retreatAt != null) return false;
        if (order.type === 'volley' && c.kind !== 'archer') order = { type: 'charge', targetId: order.targetId };
        c.order = { ...order };
        if (order.type === 'charge') c.chargeT = -99;
        if (order.type === 'withdraw') c.state = 'withdrawing';
        else if (c.state === 'withdrawing') c.state = 'formed';
        return true;
    },

    /** Sound the retreat: every company of the player's leaves the field. */
    retreat(bf) {
        if (bf.over || bf.retreatAt != null) return false;
        bf.retreatAt = bf.t;
        for (const c of bf.companies) {
            if (c.side === 'player' && Battlefield.standing(c)) { c.order = { type: 'withdraw' }; c.state = 'withdrawing'; }
        }
        bf.log.push({ t: bf.t, text: 'You sound the retreat.' });
        return true;
    },

    /** Hand the player's side to the captains (true) or take it back. */
    setCaptains(bf, on) {
        bf.aiSide.player = !!on;
    },

    /** Lead a company in person: the commander keeps behind it. */
    lead(bf, companyId) {
        const c = bf.companies.find(x => x.id === companyId && x.side === 'player');
        if (!c || !Battlefield.standing(c)) return false;
        bf.commander.ledId = c.id;
        return true;
    },

    standing(c) {
        return c && (c.state === 'formed' || c.state === 'withdrawing') && c.str > 0;
    },

    alive(c) {
        return c && c.state !== 'destroyed' && c.state !== 'fled' && c.str > 0;
    },

    // ── The fight ───────────────────────────────────────────────────────

    /** Advance the battle one fixed step. Returns bf.over (null while it goes on). */
    tick(bf) {
        if (bf.over) return bf.over;
        const cfg = Battlefield.config();
        const dt = cfg.step;
        Utils.withRng(_stream(bf), () => {
            bf.t = _r2(bf.t + dt);
            if (bf.t - bf.aiT >= cfg.ai.think) {
                bf.aiT = bf.t;
                for (const side of ['player', 'enemy']) if (bf.aiSide[side]) Battlefield._think(bf, side);
            }
            Battlefield._landShots(bf);
            for (const c of bf.companies) Battlefield._moveCompany(bf, c, dt);
            Battlefield._contacts(bf);
            Battlefield._melee(bf, dt);
            for (const c of bf.companies) Battlefield._shoot(bf, c, dt);
            for (const c of bf.companies) Battlefield._spirits(bf, c, dt);
            for (const c of bf.companies) Battlefield._figures(bf, c, dt);
            Battlefield._moveCommander(bf, dt);
            Battlefield._checkEnd(bf);
        });
        return bf.over;
    },

    /** Fight on with both sides in the captains' hands until it ends (tests, headless). */
    fightOut(bf, maxSeconds = null) {
        const cfg = Battlefield.config();
        const limit = maxSeconds == null ? cfg.maxSeconds + 30 : maxSeconds;
        bf.aiSide.player = true;
        let guard = Math.ceil(limit / cfg.step) + 5;
        while (!bf.over && guard-- > 0) Battlefield.tick(bf);
        return bf.over;
    },

    _enemiesOf(bf, c) {
        return bf.companies.filter(o => o.side !== c.side && Battlefield.alive(o));
    },

    _nearest(c, list, filter = null) {
        let best = null, bd = Infinity;
        for (const o of list) {
            if (filter && !filter(o)) continue;
            const d = _dist(c.x, c.y, o.x, o.y);
            if (d < bd) { bd = d; best = o; }
        }
        return best ? { c: best, d: bd } : null;
    },

    /** The captains' minds: what each standing company of a side does next. */
    _think(bf, side) {
        const cfg = Battlefield.config();
        const S = bf.sides[side];
        const foes = bf.companies.filter(o => o.side !== side && Battlefield.standing(o));
        if (!foes.length) return;
        // (the defenders of an assaulted town hold their streets and let the attackers come)
        const holdGround = (side === 'player' && bf.objective.type === 'hold') || (side === 'enemy' && bf.battle.defending === false && bf.objective.type === 'hold')
            || (side === 'enemy' && bf.layout === 'assault');
        const foeHasArchers = foes.some(f => f.kind === 'archer');
        const ownFootEngaged = bf.companies.some(o => o.side === side && o.kind === 'foot' && o.engaged.length);
        for (const c of bf.companies) {
            if (c.side !== side || c.state !== 'formed') continue;
            if (c.engaged.length) continue; // in the press: fight on where they stand
            const near = Battlefield._nearest(c, foes);
            if (!near) continue;
            if (c.kind === 'archer') {
                const k = cfg.kinds.archer;
                const threat = Battlefield._nearest(c, foes, f => f.kind !== 'archer');
                // When the lines have met, the archers sling their bows and fall on the flank of the
                // nearest press within ai.archerJoin tiles (0: they keep shooting from where they stand)
                // (only an army that is mostly bowmen does it — ai.archerJoinShare of its strength:
                // a few archers behind the foot keep shooting)
                const own = bf.companies.filter(o => o.side === side && Battlefield.alive(o));
                const bowShare = own.reduce((s2, o) => s2 + (o.kind === 'archer' ? o.str0 : 0), 0) / Math.max(1e-6, own.reduce((s2, o) => s2 + o.str0, 0));
                const join = bowShare >= (Number(cfg.ai.archerJoinShare) || 0) ? Number(cfg.ai.archerJoin) || 0 : 0;
                const press = join > 0 && !holdGround ? Battlefield._nearest(c, foes, f => f.engaged.some(id => (bf.companies.find(x => x.id === id) || {}).side === side)) : null;
                if (press && press.d <= join) {
                    if (c.order.type !== 'charge' || c.order.targetId !== press.c.id) Battlefield.order(bf, c.id, { type: 'charge', targetId: press.c.id });
                } else if (threat && threat.d < cfg.ai.archerKeepAway && !holdGround) {
                    c.order = { type: 'move', x: c.x - S.dir * 5, y: c.y };
                } else {
                    // A mark they may loose at: not locked in a press with their own men (unless
                    // pressVolley lets them drop shafts over their heads)
                    const range = k.range + c.rangeBonus;
                    const intoPress = (Number(cfg.pressVolley) || 0) > 0;
                    const clearOf = f => intoPress || !f.engaged.some(id => (bf.companies.find(x => x.id === id) || {}).side === side);
                    const inRange = Battlefield._nearest(c, foes, f => clearOf(f) && f.kind !== 'archer' && _dist(c.x, c.y, f.x, f.y) <= range)
                        || Battlefield._nearest(c, foes, f => clearOf(f) && _dist(c.x, c.y, f.x, f.y) <= range);
                    const mark = inRange || Battlefield._nearest(c, foes, clearOf);
                    if (inRange) c.order = { type: 'volley', targetId: inRange.c.id };
                    else if (mark && !holdGround) {
                        // Walk up until a clear mark is in range (the foe's archers, as often as not)
                        c.order = { type: 'move', x: mark.c.x - (mark.c.x - c.x) / mark.d * (k.range - 2), y: mark.c.y - (mark.c.y - c.y) / mark.d * (k.range - 2) };
                    } else c.order = { type: 'volley', targetId: near.c.id };
                }
            } else if (c.kind === 'horse') {
                if (bf.t < cfg.ai.horseWait && !ownFootEngaged && !holdGround) continue;
                // Ride down archers, then whatever wavers or is held in a press (into its
                // flank), then other horse; never straight onto foot that stand ready
                const prey = Battlefield._nearest(c, foes, f => f.kind === 'archer')
                    || Battlefield._nearest(c, foes, f => f.morale < cfg.morale.waver || f.engaged.length > 0)
                    || Battlefield._nearest(c, foes, f => f.kind === 'horse');
                if (!prey) {
                    // Nothing worth the charge: keep out on the wing, off their foot's front
                    const wing = c.y >= bf.area.cy ? 1 : -1;
                    c.order = { type: 'move', x: near.c.x - S.dir * 6, y: _clamp(near.c.y + wing * 9, 2, bf.field.h - 3) };
                    continue;
                }
                if (holdGround && prey.d > 9) continue;
                if (c.order.type !== 'charge' || c.order.targetId !== prey.c.id) Battlefield.order(bf, c.id, { type: 'charge', targetId: prey.c.id });
            } else {
                if (bf.t < cfg.ai.footWait && foeHasArchers === false) continue;
                if (holdGround && near.d > 6) { c.order = { type: 'hold' }; continue; }
                // Foot meet their foot first (never marching past it to leave their own archers bare),
                // then whatever else is not horse
                const prey = Battlefield._nearest(c, foes, f => f.kind === 'foot') || Battlefield._nearest(c, foes, f => f.kind !== 'horse') || near;
                if (prey.d > 9) c.order = { type: 'move', x: prey.c.x - (prey.c.x - c.x) / prey.d * 6, y: prey.c.y };
                else if (c.order.type !== 'charge' || c.order.targetId !== prey.c.id) Battlefield.order(bf, c.id, { type: 'charge', targetId: prey.c.id });
            }
        }
    },

    /** Where a company is headed this step, and how fast. → { x, y, speed } | null */
    _goal(bf, c) {
        const cfg = Battlefield.config();
        const k = cfg.kinds[c.kind];
        const S = bf.sides[c.side];
        if (c.state === 'routed') {
            const edge = S.dir > 0 ? 0 : bf.field.w - 1;
            return { x: edge, y: c.y, speed: k.speed * cfg.routSpeed };
        }
        if (c.state === 'withdrawing') {
            const edge = S.dir > 0 ? 0 : bf.field.w - 1;
            return { x: edge, y: c.y, speed: k.speed * cfg.withdrawSpeed };
        }
        if (c.engaged.length) return null;
        const o = c.order;
        if (o.type === 'move') return { x: o.x, y: o.y, speed: k.speed };
        if (o.type === 'charge') {
            const t = bf.companies.find(x => x.id === o.targetId);
            if (!t || !Battlefield.alive(t)) { c.order = { type: 'hold' }; return null; }
            return { x: t.x, y: t.y, speed: k.speed * cfg.chargeSpeed, target: t };
        }
        return null;
    },

    _moveCompany(bf, c, dt) {
        c.moving = false;
        if (!Battlefield.alive(c)) return;
        const g = Battlefield._goal(bf, c);
        if (!g) {
            Battlefield._holdFront(bf, c, dt);
            return;
        }
        c.front = null; // on the move: a new front is taken when it halts
        const d = _dist(c.x, c.y, g.x, g.y);
        if (d < 0.3) {
            if (c.order.type === 'move') c.order = { type: 'hold' };
            return;
        }
        const ux = (g.x - c.x) / d, uy = (g.y - c.y) / d;
        const slow = Battlefield._slowAt(bf, c, c.x, c.y);
        const step = Math.min(d, g.speed * slow * dt);
        // Around what blocks the way: straight on, else bear off up to a right angle
        let moved = false;
        for (const ang of [0, 0.5, -0.5, 1, -1, 1.5, -1.5]) {
            const cos = Math.cos(ang), sin = Math.sin(ang);
            const vx = ux * cos - uy * sin, vy = ux * sin + uy * cos;
            const nx = c.x + vx * step, ny = c.y + vy * step;
            if (bf.field.pass(Math.round(nx), Math.round(ny)) || (c.state === 'routed' && ang !== 0 && Math.abs(ang) >= 1.5)) {
                c.x = _clamp(nx, 0, bf.field.w - 1);
                c.y = _clamp(ny, 0, bf.field.h - 1);
                moved = true;
                break;
            }
        }
        c.moving = moved;
        if (c.state === 'routed' || c.state === 'withdrawing') Battlefield._turn(c, ux, uy, dt * 4);
        else Battlefield._turn(c, ux, uy, dt);
        // Off their own edge of the field
        if ((c.state === 'routed' || c.state === 'withdrawing') && (c.x <= 0.6 || c.x >= bf.field.w - 1.6)) {
            const was = c.state;
            c.state = 'fled';
            c.left = was;
            bf.log.push({ t: bf.t, text: was === 'routed' ? `${Battlefield.label(bf, c)} flee the field.` : `${Battlefield.label(bf, c)} are off the field.` });
        }
    },

    /**
     * A company standing still keeps a front. In the press it faces the foe
     * it fights (nearest of them). Holding, it takes its front once (toward
     * the nearest foe, or as it stands) and keeps it: it wheels only for a
     * real threat — a foe still in order within hold.threatRange coming on
     * from outside its front arc — not for every company that moves out there.
     */
    _holdFront(bf, c, dt) {
        const H = Battlefield.config().hold || {};
        if (c.engaged.length) {
            const foes = c.engaged.map(id => bf.companies.find(x => x.id === id)).filter(Boolean);
            const foe = Battlefield._nearest(c, foes);
            if (foe) Battlefield._turn(c, foe.c.x - c.x, foe.c.y - c.y, dt);
            c.front = null;
            return;
        }
        const foes = bf.companies.filter(o => o.side !== c.side && Battlefield.standing(o));
        if (!c.front) {
            const foe = Battlefield._nearest(c, foes);
            const vx = foe && foe.d < 30 ? (foe.c.x - c.x) / foe.d : c.dx, vy = foe && foe.d < 30 ? (foe.c.y - c.y) / foe.d : c.dy;
            c.front = { x: vx, y: vy };
        } else {
            const range = Number(H.threatRange) || 9;
            const cos = H.threatCos == null ? 0.5 : Number(H.threatCos);
            const threat = Battlefield._nearest(c, foes, o => {
                const d = _dist(c.x, c.y, o.x, o.y);
                if (d > range || d < 1e-6) return false;
                return ((o.x - c.x) * c.front.x + (o.y - c.y) * c.front.y) / d < cos;
            });
            if (threat) c.front = { x: (threat.c.x - c.x) / threat.d, y: (threat.c.y - c.y) / threat.d };
        }
        Battlefield._turn(c, c.front.x, c.front.y, dt);
    },

    /** Swing the company's facing toward (vx, vy), quickly. */
    _turn(c, vx, vy, dt) {
        const len = Math.hypot(vx, vy);
        if (len < 1e-6) return;
        const tx = vx / len, ty = vy / len;
        const a = Math.min(1, dt * 3);
        const nx = c.dx + (tx - c.dx) * a, ny = c.dy + (ty - c.dy) * a;
        const n = Math.hypot(nx, ny) || 1;
        c.dx = nx / n; c.dy = ny / n;
    },

    _slowAt(bf, c, x, y) {
        const q = Math.round(x), r = Math.round(y);
        let s = bf.field.slow(q, r);
        if (c.kind === 'horse' && bf.field.cover(q, r)) s *= 0.7;
        return _clamp(s, 0.2, 1.2);
    },

    /** Who is in contact with whom (any two figures within `contact` tiles). */
    _contacts(bf) {
        const cfg = Battlefield.config();
        for (const c of bf.companies) c.engaged = [];
        const live = bf.companies.filter(c => Battlefield.alive(c));
        for (let i = 0; i < live.length; i++) {
            const a = live[i];
            for (let j = i + 1; j < live.length; j++) {
                const b = live[j];
                if (a.side === b.side) continue;
                // Two companies leaving the field do not seek each other out
                if ((a.state === 'routed' || a.state === 'withdrawing') && (b.state === 'routed' || b.state === 'withdrawing')) continue;
                if (_dist(a.x, a.y, b.x, b.y) > 22) continue;
                let touch = false;
                for (const fa of a.figures) {
                    if (!fa.alive) continue;
                    for (const fb of b.figures) {
                        if (!fb.alive) continue;
                        if (Math.abs(fa.x - fb.x) <= cfg.contact && Math.abs(fa.y - fb.y) <= cfg.contact) { touch = true; break; }
                    }
                    if (touch) break;
                }
                if (!touch) continue;
                if (!a.engaged.length && a.engagedSince == null) a.engagedSince = bf.t;
                if (!b.engaged.length && b.engagedSince == null) b.engagedSince = bf.t;
                a.engaged.push(b.id);
                b.engaged.push(a.id);
                // The first shock: who came on, and from where
                const key = `${Math.min(a.id, b.id)}:${Math.max(a.id, b.id)}`;
                bf._met = bf._met || {};
                if (!bf._met[key]) {
                    bf._met[key] = bf.t;
                    Battlefield._clash(bf, a, b);
                }
            }
        }
        for (const c of bf.companies) if (!c.engaged.length) c.engagedSince = null;
    },

    /** Two companies meet: a charge's shock, a flank or rear taken. */
    _clash(bf, a, b) {
        const cfg = Battlefield.config();
        for (const [att, def] of [[a, b], [b, a]]) {
            if (att.order.type !== 'charge' || att.order.targetId !== def.id) continue;
            att.chargeT = bf.t;
            const side = Battlefield._facingHit(att, def);
            if (side === 'rear') { def.morale -= cfg.flank.shockRear; def.lastHurtT = bf.t; }
            else if (side === 'flank') { def.morale -= cfg.flank.shockSide; def.lastHurtT = bf.t; }
            bf.events.push({ type: 'clash', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, horse: att.kind === 'horse', side });
            if (side !== 'front') bf.log.push({ t: bf.t, text: `${Battlefield.label(bf, att)} take ${Battlefield.label(bf, def)} in the ${side}!` });
        }
    },

    /** Where `att` strikes `def`: 'front' | 'flank' | 'rear'. */
    _facingHit(att, def) {
        const vx = def.x - att.x, vy = def.y - att.y;
        const len = Math.hypot(vx, vy) || 1;
        const dot = (def.dx * vx + def.dy * vy) / len; // def facing away from the attacker → +1
        if (dot > 0.45) return 'rear';
        if (dot > -0.45) return 'flank';
        return 'front';
    },

    /** The stance numbers an order fights with (FieldBattle's stances). */
    _stance(c) {
        const st = FieldBattle.config().stances;
        if (c.state === 'withdrawing') return { power: 0.75, ownLoss: 1.1, enemyLoss: 0.6 };
        if (c.order.type === 'charge') return st.aggressive;
        if (c.order.type === 'hold' || c.order.type === 'volley') return st.hold;
        return { power: 1, ownLoss: 1, enemyLoss: 1 };
    },

    /** A company's fighting power for a kind of blow ('melee' | 'volley' | 'guard'). */
    power(bf, c, kind = 'melee', vs = null) {
        const cfg = Battlefield.config();
        const S = bf.sides[c.side];
        const k = cfg.kinds[c.kind];
        const T = cfg.terrain;
        const q = Math.round(c.x), r = Math.round(c.y);
        // (kinds.X.power: what a company of its kind is worth on the field, all blows — the field's own weighing of horse and bow)
        let p = c.str * S.rest * (S.kindMult[c.kind] || 1) * S.fortune * (k.power || 1);
        p *= (c.morale < cfg.morale.waver ? cfg.morale.waverPower : 1) * _clamp(c.morale, 0.4, 1.2);
        if (kind !== 'guard') p *= 1 + ((S.counter || 1) - 1) * (Number(cfg.armyCounter) || 0);
        if (vs) {
            const a = { cavalry: 0, archer: 0, pikeman: 0, [c.role]: 1 };
            const b = { cavalry: 0, archer: 0, pikeman: 0, [vs.role]: 1 };
            const counter = PlayerMilitary._counterMultiplier(a, b);
            // In the press an archer's edge over foot is gone; at range a pike's over horse is
            // (one kind against one is starker than the blended armies the counters were made for)
            const cw = cfg.counterWeight == null ? 1 : cfg.counterWeight;
            const felt = 1 + (counter - 1) * cw;
            p *= kind === 'melee' ? (c.kind === 'archer' && !cfg.archerMeleeCounter ? 1 : felt) : kind === 'volley' ? felt : 1;
        }
        if (kind === 'melee') {
            p *= k.melee || 1;
            const st = Battlefield._stance(c);
            let sp = st.power || 1;
            if (c.order.type === 'hold' && c.role === 'pikeman') sp += st.pikemanPower || 0;
            if (c.order.type === 'hold' && bf.battle.defending && c.side === 'player') sp += st.defendingPower || 0;
            p *= sp;
            p *= S.personal.melee || 1;
            if (bf.field.cover(q, r)) p *= c.kind === 'horse' ? T.horseInCover : T.coverMelee;
            if (bf.field.high(q, r)) p *= T.high;
            if (!bf.field.pass(q, r)) p *= T.water;
        } else if (kind === 'volley') {
            p *= S.personal.opening || 1;
            if (bf.field.high(q, r)) p *= T.high;
            if (c.rangeBonus) p *= 1 + Math.min(0.3, c.rangeBonus * 0.03);
            // Quivers empty: what arrows they can scrounge
            if (c.volleys != null && (c.shots || 0) >= c.volleys) p *= Arms.dryMult();
        }
        if (bf.battle.ambushed && c.side === 'enemy' && bf.t < 15) p *= FieldBattle.config().ambushPower;
        return Math.max(0.0001, p);
    },

    /** Strength lost: the figures that fall, the morale shaken. */
    _hurt(bf, c, loss, cause) {
        if (loss <= 0 || !Battlefield.alive(c)) return;
        const cfg = Battlefield.config();
        const before = c.str;
        c.str = Math.max(0, c.str - loss);
        c.lastHurtT = bf.t;
        c.morale -= (before - c.str) / Math.max(1, c.str0) * cfg.morale.lossShock;
        // The figures that fall: as many as the strength left no longer fills
        const keep = c.str <= 0.05 * c.str0 ? 0 : Math.max(1, Math.ceil(c.figs0 * c.str / c.str0 - 0.15));
        let alive = c.figures.filter(f => f.alive);
        while (alive.length > keep) {
            // The front rank falls first, one of them at random
            const front = alive.filter(f => f.slot < Math.max(1, Math.min(c.cols, alive.length)));
            const pool = front.length ? front : alive;
            const f = pool[Math.floor(Utils.random() * pool.length)];
            f.alive = false;
            f.fellAt = bf.t;
            f.side = Utils.random() < 0.5 ? -1 : 1;
            bf.events.push({ type: 'fall', companyId: c.id, fig: f.i, x: f.x, y: f.y, cause });
            alive = c.figures.filter(x => x.alive);
            // Close up the ranks: the living take the first places
            alive.sort((a, b) => a.slot - b.slot).forEach((x, i) => { x.slot = i; });
        }
        if (!alive.length || c.str <= 0.05 * c.str0) {
            c.str = Math.min(c.str, 0);
            c.state = 'destroyed';
            bf.log.push({ t: bf.t, text: `${Battlefield.label(bf, c)} are cut down to the last.` });
        }
    },

    _melee(bf, dt) {
        const cfg = Battlefield.config();
        const fb = FieldBattle.config();
        const melee = fb.phases.find(p => p.id === 'melee') || { lossBase: 0.12 };
        const pursuit = fb.phases.find(p => p.id === 'pursuit') || { lossBase: 0.08 };
        const losses = new Map();
        const add = (c, v) => losses.set(c, (losses.get(c) || 0) + v);
        const done = new Set();
        for (const a of bf.companies) {
            for (const bid of a.engaged) {
                const b = bf.companies.find(x => x.id === bid);
                const key = `${Math.min(a.id, b.id)}:${Math.max(a.id, b.id)}`;
                if (done.has(key)) continue;
                done.add(key);
                const aRun = a.state === 'routed', bRun = b.state === 'routed';
                if (aRun && bRun) continue;
                if (aRun || bRun) {
                    // The pursuit: the beaten cut down as they run
                    const [chaser, prey] = aRun ? [b, a] : [a, b];
                    const pw = Battlefield.power(bf, chaser, 'melee', prey) * (chaser.kind === 'horse' ? 2 : 1);
                    const rate = pursuit.lossBase * 2 * fb.rout.lossMult / cfg.pursuitSeconds;
                    const share = rate * _clamp(pw / Math.max(1, pw + prey.str * 0.5), 0.2, 0.95);
                    add(prey, prey.str * share * dt * (prey.side === 'player' ? bf.sides.player.casMult : 1) * (bf.sides[chaser.side].personal.pursuit || 1));
                    continue;
                }
                // (a company fighting two shares its blows between them)
                let pa = Battlefield.power(bf, a, 'melee', b) / Math.max(1, a.engaged.length);
                let pb = Battlefield.power(bf, b, 'melee', a) / Math.max(1, b.engaged.length);
                // Flank and rear, and the first shock of a charge
                const ha = Battlefield._facingHit(a, b), hb = Battlefield._facingHit(b, a);
                if (ha === 'flank') pa *= cfg.flank.side; else if (ha === 'rear') pa *= cfg.flank.rear;
                if (hb === 'flank') pb *= cfg.flank.side; else if (hb === 'rear') pb *= cfg.flank.rear;
                for (const [x, y, set] of [[a, b, (v) => { pa *= v; }], [b, a, (v) => { pb *= v; }]]) {
                    if (bf.t - x.chargeT > cfg.chargeShock.seconds) continue;
                    let shock = x.kind === 'horse' ? cfg.chargeShock.horse : cfg.chargeShock.foot;
                    // Horse riding onto foot that stand their ground
                    if (x.kind === 'horse' && y.kind === 'foot' && y.order.type === 'hold') shock *= cfg.chargeShock.vsHoldingFoot;
                    set(shock);
                }
                const spread = cfg.spread;
                pa *= Utils.randFloat(1 - spread, 1 + spread);
                pb *= Utils.randFloat(1 - spread, 1 + spread);
                const r = pa / (pa + pb);
                const rate = melee.lossBase * 2 / cfg.meleeSeconds;
                const sa = Battlefield._stance(a), sb = Battlefield._stance(b);
                const lossA = a.str * rate * (1 - r) * (sa.ownLoss || 1) * (sb.enemyLoss || 1) * (a.side === 'player' ? bf.sides.player.casMult : 1);
                const lossB = b.str * rate * r * (sb.ownLoss || 1) * (sa.enemyLoss || 1) * (b.side === 'player' ? bf.sides.player.casMult : 1);
                add(a, lossA * dt);
                add(b, lossB * dt);
                if (Utils.random() < 0.25) bf.events.push({ type: 'blow', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
            }
        }
        for (const [c, v] of losses) Battlefield._hurt(bf, c, v, 'melee');
    },

    /** Archers loose at what is in range; the arrows land a moment later (_landShots). */
    _shoot(bf, c, dt) {
        const cfg = Battlefield.config();
        if (c.kind !== 'archer' || c.state !== 'formed' || c.engaged.length || c.moving) return;
        c.volleyT -= dt;
        if (c.volleyT > 0) return;
        const k = cfg.kinds.archer;
        const range = k.range + (c.rangeBonus || 0);
        let target = null;
        if (c.order.type === 'volley') {
            target = bf.companies.find(x => x.id === c.order.targetId && Battlefield.alive(x));
            if (target && _dist(c.x, c.y, target.x, target.y) > range) target = null;
        }
        // A press where your own are fighting: loosed into only when nothing else is in
        // range, dropping shafts over your men's heads at the back of theirs (pressVolley
        // of the effect; 0 holds the volley)
        const inPress = (o) => o.engaged.length > 0 && o.engaged.some(id => (bf.companies.find(x => x.id === id) || {}).side === c.side);
        const intoPress = Number(cfg.pressVolley) || 0;
        if (target && inPress(target) && !(intoPress > 0)) target = null;
        if (!target) {
            const near = Battlefield._nearest(c, Battlefield._enemiesOf(bf, c), o => o.state !== 'fled' && !inPress(o));
            if (near && near.d <= range) target = near.c;
        }
        if (!target && intoPress > 0) {
            const near = Battlefield._nearest(c, Battlefield._enemiesOf(bf, c), o => o.state !== 'fled' && o.state !== 'routed');
            if (near && near.d <= range) target = near.c;
        }
        if (!target) return;
        c.volleyT = k.volleyEvery;
        c.shots = (c.shots || 0) + 1;
        const d = _dist(c.x, c.y, target.x, target.y);
        const flight = d / cfg.flightSpeed;
        bf.pending.push({ at: _r2(bf.t + flight), from: c.id, to: target.id, ...(inPress(target) ? { press: intoPress } : {}) });
        bf.events.push({ type: 'volley', from: c.id, to: target.id, flight, n: c.figures.filter(f => f.alive).length });
    },

    _landShots(bf) {
        const cfg = Battlefield.config();
        const fb = FieldBattle.config();
        const opening = fb.phases.find(p => p.id === 'opening') || { lossBase: 0.05 };
        const keep = [];
        for (const s of bf.pending) {
            if (s.at > bf.t) { keep.push(s); continue; }
            const a = bf.companies.find(x => x.id === s.from);
            const b = bf.companies.find(x => x.id === s.to);
            if (!a || !b || !Battlefield.alive(b) || a.str <= 0) continue;
            const T = cfg.terrain;
            let pa = Battlefield.power(bf, a, 'volley', b) * Utils.randFloat(1 - cfg.spread, 1 + cfg.spread);
            let guard = b.str * bf.sides[b.side].rest * (b.morale < cfg.morale.waver ? cfg.morale.waverPower : 1);
            if (bf.field.cover(Math.round(b.x), Math.round(b.y))) guard /= T.coverArrows;
            if (b.kind === 'foot' && b.order.type === 'hold') guard /= T.holdShields;
            const r = pa / (pa + guard);
            const share = opening.lossBase * 2 * r * cfg.kinds.archer.volleyEvery / cfg.volleySeconds * (s.press != null ? s.press : 1);
            const loss = b.str * share * (b.side === 'player' ? bf.sides.player.casMult : 1);
            bf.events.push({ type: 'land', to: b.id, x: b.x, y: b.y });
            Battlefield._hurt(bf, b, loss, 'arrows');
        }
        bf.pending = keep;
    },

    /** Morale: steadied when let be and near the commander; broken, a company routs. */
    _spirits(bf, c, dt) {
        const cfg = Battlefield.config();
        const M = cfg.morale;
        if (!Battlefield.alive(c)) return;
        const S = bf.sides[c.side];
        const quiet = !c.engaged.length && bf.t - c.lastHurtT > 3;
        const cap = c.side === 'player' ? bf.commander : bf.foeCaptain;
        const cmd = !!cap && _dist(c.x, c.y, cap.x, cap.y) <= M.commanderRadius;
        if (c.state === 'routed') {
            // Rally: let be long enough, still some of them, the commander at hand helps
            c.morale = Math.min(c.morale0, c.morale + (M.regen + (cmd ? M.commanderRegen : 0)) * dt);
            const foe = Battlefield._nearest(c, Battlefield._enemiesOf(bf, c), o => o.state !== 'routed');
            if (quiet && bf.t - c.routT > M.rallyAfter && c.morale >= M.rallyMorale && c.str > c.str0 * M.routStrength
                && (!foe || foe.d > 10) && bf.retreatAt == null && !bf.brokeAt) {
                c.state = 'formed';
                c.order = { type: 'hold' };
                bf.log.push({ t: bf.t, text: `${Battlefield.label(bf, c)} rally!` });
            }
            return;
        }
        if (quiet) c.morale = Math.min(c.morale0, c.morale + (M.regen + S.leadership * 0.02 + (cmd ? M.commanderRegen : 0)) * dt);
        else if (cmd) c.morale = Math.min(c.morale0, c.morale + M.commanderRegen * 0.5 * dt);
        c.morale = _clamp(c.morale, 0, 1.3);
        if (c.state !== 'formed' && c.state !== 'withdrawing') return;
        // Broken: too few left, or the spirit gone (a roll a second while shaken)
        let breaks = c.str < c.str0 * M.routStrength || c.morale <= M.rout;
        // (shaken men break under pressure — in the press or under the arrows — not at the sight of the foe)
        if (!breaks && c.morale < M.waver && !quiet) {
            c._waverRoll = (c._waverRoll || 0) + dt;
            if (c._waverRoll >= 1) {
                c._waverRoll = 0;
                breaks = Utils.random() < (M.waver - c.morale) * M.routChance;
            }
        }
        if (!breaks) return;
        c.state = 'routed';
        c.routT = bf.t;
        c.order = { type: 'hold' };
        bf.events.push({ type: 'rout', companyId: c.id });
        bf.log.push({ t: bf.t, text: `${Battlefield.label(bf, c)} break and run!` });
        // It shakes the friends who see it
        for (const o of bf.companies) {
            if (o === c || o.side !== c.side || !Battlefield.standing(o)) continue;
            if (_dist(o.x, o.y, c.x, c.y) <= M.friendRadius) o.morale -= M.friendRout;
        }
    },

    /** The men: each makes for their place in the formation, or for the foe in a press. */
    _figures(bf, c, dt) {
        const cfg = Battlefield.config();
        const k = cfg.kinds[c.kind];
        const S = bf.sides[c.side];
        const foes = c.engaged.length ? c.engaged.map(id => bf.companies.find(x => x.id === id)) : null;
        const speed = k.speed * (c.state === 'routed' ? cfg.routSpeed : c.order.type === 'charge' ? cfg.chargeSpeed : 1) * 1.35;
        for (const f of c.figures) {
            if (!f.alive) continue;
            let tx, ty;
            if (c.state === 'routed' || c.state === 'fled') {
                // Every man for himself: straight for their own edge
                tx = S.dir > 0 ? 0 : bf.field.w - 1;
                ty = f.y + Math.sin(f.i * 1.7) * 0.4;
            } else {
                const p = Battlefield.slotPos(c, f.slot);
                tx = p.x; ty = p.y;
                if (foes && f.slot < Math.max(1, c.cols)) {
                    // the front rank steps in to strike at the nearest man
                    let best = null, bd = Infinity;
                    for (const o of foes) {
                        for (const g of o.figures) {
                            if (!g.alive) continue;
                            const d = _dist(f.x, f.y, g.x, g.y);
                            if (d < bd) { bd = d; best = g; }
                        }
                    }
                    if (best && bd < 3) {
                        const ux = (f.x - best.x) / (bd || 1), uy = (f.y - best.y) / (bd || 1);
                        tx = best.x + ux * 0.95; ty = best.y + uy * 0.95;
                        f.foeX = best.x; f.foeY = best.y;
                    }
                }
            }
            const d = _dist(f.x, f.y, tx, ty);
            f.moving = d > 0.12;
            if (f.moving) {
                const st = Math.min(d, speed * Battlefield._slowAt(bf, c, f.x, f.y) * dt);
                const nx = f.x + (tx - f.x) / d * st, ny = f.y + (ty - f.y) / d * st;
                if (bf.field.pass(Math.round(nx), Math.round(ny)) || (c.state === 'routed' && nx >= 0 && nx <= bf.field.w - 1)) {
                    f.x = _clamp(nx, 0, bf.field.w - 1); f.y = _clamp(ny, 0, bf.field.h - 1);
                } else if (bf.field.pass(Math.round(nx), Math.round(f.y))) {
                    f.x = nx;
                } else if (bf.field.pass(Math.round(f.x), Math.round(ny))) {
                    f.y = ny;
                } else {
                    f.moving = false;
                }
                f.fx = tx - f.x; f.fy = ty - f.y;
            } else {
                f.fx = c.dx; f.fy = c.dy;
            }
            // In the press the front rank swings, each to their own beat
            const fighting = !!(foes && f.slot < Math.max(1, c.cols) && f.foeX != null && _dist(f.x, f.y, f.foeX, f.foeY) < 1.6);
            if (fighting) { f.fx = f.foeX - f.x; f.fy = f.foeY - f.y; }
            f.anim = c.state === 'routed' ? 'walk' : fighting ? 'fight' : f.moving ? 'walk'
                : c.kind === 'archer' && c.volleyT > Battlefield.config().kinds.archer.volleyEvery - 0.6 ? 'shoot'
                    : (c.order.type === 'hold' || c.order.type === 'volley') && Battlefield._nearestFoeDist(bf, c) < 16 ? 'ready' : 'idle';
            if (!foes) { f.foeX = null; f.foeY = null; }
        }
    },

    _nearestFoeDist(bf, c) {
        const n = Battlefield._nearest(c, Battlefield._enemiesOf(bf, c));
        return n ? n.d : Infinity;
    },

    /** The commander keeps a few paces behind the company they lead. */
    _moveCommander(bf, dt, cm = bf.commander, side = 'player') {
        if (side === 'player' && bf.foeCaptain) Battlefield._moveCommander(bf, dt, bf.foeCaptain, 'enemy');
        if (!cm) return;
        let led = bf.companies.find(c => c.id === cm.ledId);
        if (!led || !Battlefield.alive(led) || led.state === 'routed') {
            led = bf.companies.find(c => c.side === side && Battlefield.standing(c)) || null;
            cm.ledId = led ? led.id : null;
        }
        if (!led) return;
        const k = Battlefield.config().kinds[led.kind];
        const back = Battlefield.config().kinds[led.kind].ranks * k.along + 2.5;
        const tx = led.x - led.dx * back, ty = led.y - led.dy * back;
        const d = _dist(cm.x, cm.y, tx, ty);
        cm.moving = d > 1.2;
        if (!cm.moving) return;
        const st = Math.min(d, 3.2 * dt);
        const nx = cm.x + (tx - cm.x) / d * st, ny = cm.y + (ty - cm.y) / d * st;
        if (bf.field.pass(Math.round(nx), Math.round(ny))) { cm.x = nx; cm.y = ny; }
    },

    /** Is the battle over? Sets bf.over = { winner: 'player'|'enemy'|'withdrew', how }. */
    _checkEnd(bf) {
        const cfg = Battlefield.config();
        const standing = (side) => bf.companies.some(c => c.side === side && c.state === 'formed');
        const onField = (side) => bf.companies.some(c => c.side === side && (c.state === 'formed' || c.state === 'routed' || c.state === 'withdrawing'));
        // The retreat: done when the last company is off the field (or the rear-guard's time is up)
        if (bf.retreatAt != null) {
            const left = bf.companies.filter(c => c.side === 'player' && (c.state === 'withdrawing' || c.state === 'routed'));
            if (!left.length || bf.t - bf.retreatAt >= cfg.withdrawSeconds) {
                bf.over = { winner: 'withdrew', how: 'retreat' };
                bf.log.push({ t: bf.t, text: 'You are off the field.' });
            }
            return;
        }
        const pUp = standing('player'), eUp = standing('enemy');
        if (!pUp || !eUp) {
            if (bf.brokeAt == null) {
                bf.brokeAt = bf.t;
                bf.broken = !eUp && pUp ? 'enemy' : !pUp && eUp ? 'player' : 'both';
                bf.log.push({ t: bf.t, text: bf.broken === 'enemy' ? `The ${bf.enemyLabel} are broken!` : bf.broken === 'player' ? 'Your army is broken!' : 'Both armies are spent.' });
            }
            // The pursuit runs on a while, or until the beaten are gone
            const loser = bf.broken === 'enemy' ? 'enemy' : 'player';
            if (bf.t - bf.brokeAt >= cfg.pursuitAfterBreak || !onField(loser)) {
                bf.over = { winner: bf.broken === 'enemy' ? 'player' : bf.broken === 'player' ? 'enemy' : Battlefield._byScore(bf), how: 'broken' };
            }
            return;
        }
        if (bf.objective.type === 'hold' && bf.t >= bf.objective.seconds) {
            bf.over = { winner: 'player', how: 'held' };
            bf.log.push({ t: bf.t, text: 'You have held the field: they draw off.' });
            return;
        }
        if (bf.t >= cfg.maxSeconds) {
            bf.over = { winner: Battlefield._byScore(bf), how: 'time' };
            bf.log.push({ t: bf.t, text: 'Night falls on the field: both sides draw apart.' });
        }
    },

    /** Who had the better of it: the share of each side's strength still standing. */
    _byScore(bf) {
        const left = (side) => {
            const cs = bf.companies.filter(c => c.side === side);
            return cs.reduce((s, c) => s + (c.state === 'formed' ? c.str : c.str * 0.5), 0) / Math.max(1, cs.reduce((s, c) => s + c.str0, 0));
        };
        return left('player') >= left('enemy') ? 'player' : 'enemy';
    },

    /** Each side's strength now: { pStr, eStr, pStr0, eStr0 }. */
    strengths(bf) {
        const sum = (side, key) => bf.companies.filter(c => c.side === side).reduce((s, c) => s + Math.max(0, c[key]), 0);
        return { pStr: sum('player', 'str'), eStr: sum('enemy', 'str'), pStr0: sum('player', 'str0'), eStr0: sum('enemy', 'str0') };
    },

    /** "Soldier" → "Soldiers", "Pikeman" → "Pikemen"; "Militia", "Light Cavalry" stay. */
    plural(name) {
        const n = String(name || '');
        if (/man$/.test(n)) return n.replace(/man$/, 'men');
        if (/(militia|cavalry|s)$/i.test(n)) return n;
        return `${n}s`;
    },

    /** A company's name for the log: "your Soldiers (2)" / "their Archers". */
    label(bf, c) {
        const same = bf.companies.filter(x => x.side === c.side && x.name === c.name);
        const n = same.length > 1 ? ` (${same.indexOf(c) + 1})` : '';
        return `${c.side === 'player' ? 'Your' : 'Their'} ${c.name}${n}`;
    },

    /**
     * Keep the FieldBattle battle's numbers in step with the field (so a
     * battle broken off — the day ending, the map left — is fought out by
     * FieldBattle.auto from where it stands). No player state touched.
     */
    sync(bf) {
        const s = Battlefield.strengths(bf);
        const b = bf.battle;
        b.sim.eStr = Math.max(1, s.eStr);
        b.sim.pStrField = s.pStr;
        // The phase the fight has reached: the opening until the lines meet, then the melee
        const met = bf.companies.some(c => c.engaged.length) || Object.keys(bf._met || {}).length > 0;
        b.sim.phase = Math.max(b.sim.phase, met ? 1 : 0);
        return s;
    },

    // ── The aftermath ──────────────────────────────────────────────────

    /**
     * The battle is over (bf.over): the player's losses taken from the units
     * of the companies that suffered them, the FieldBattle battle brought up
     * to date (sim, log, outcome) and FieldBattle.finish run — the usual
     * aftermath. Returns battle.result.
     */
    // ── A realm's host (the General: player/generalship.js) ────────────

    /**
     * The battle a general fights with the crown's host, drawn up from a
     * Generalship.prepareBattle spec: { kind, where { terrainId }, host { men,
     * retinue, quality, morale, composition, kingdomName }, enemy { men,
     * quality, composition, kingdomName } }. The host's quality and the
     * enemy's stand in for the army multipliers (FieldBattle.start's pMult /
     * eMult); terrain and weather by composition as ever. Returns a battle
     * object Battlefield.create takes — its companies carry no units (the
     * host's men are counted, not listed): read the end with hostOutcome().
     */
    hostBattle(player, world, spec, ctx = {}) {
        const comp = (c) => PlayerMilitary._normalizeComposition(c || {});
        const pComp = comp(spec.host.composition);
        const eComp = comp(spec.enemy.composition);
        const terrainId = (spec.where && spec.where.terrainId) || null;
        const weather = PlayerMilitary._battleWeather(player, { world, ...ctx });
        const pStr = Math.max(1, (Number(spec.host.men) || 0) + (Number(spec.host.retinue) || 0));
        const eStr = Math.max(1, Number(spec.enemy.men) || 1);
        const byComp = (c) => PlayerMilitary._terrainMultiplier(terrainId, c) * PlayerMilitary._weatherMultiplier(weather, c);
        const morale = _clamp((Number(spec.host.morale) || 60) / 100, 0, 1);
        return {
            id: spec.id || `host_${(world && world.day) || 0}`,
            seed: (Math.abs(Utils.hashStr(`host:${spec.id}:${pStr}:${eStr}`)) % 200000) + 1,
            enemyName: `${spec.enemy.kingdomName || 'enemy'} army`,
            enemyType: 'war_host',
            enemyIcon: '⚔️',
            unitId: null,
            theatre: 'land',
            terrainId,
            weather,
            defending: !!ctx.defending,
            ambushed: false,
            pComp, eComp,
            leadership: (player.skills?.leadership || 1) * 0.015 + (morale - 0.6) * 0.3,
            leadershipSkill: player.skills?.leadership || 1,
            enemyMoraleBonus: 0,
            pMult: byComp(pComp) * (Number(spec.host.quality) || 1),
            eMult: byComp(eComp) * (Number(spec.enemy.quality) || 1),
            pCasMult: 1,
            personal: FieldBattle.personalEdge(player),
            fortune: 1,
            pStr0: pStr, eStr0: eStr,
            sim: { pStr, eStr, phase: 0, score: 0, reservesUsed: false, routed: null },
            log: [], casualties: 0, wounded: 0, outcome: null, done: false, result: null,
            host: true,
        };
    },

    /**
     * The end of a host battle, in Generalship.settleBattle's terms:
     * { victory, hostLost, enemyLost, retinueLost, withdrew } — the share of
     * each side's strength lost on the field (the host's men × lossToUnits,
     * the scattered come back), the retinue's only in a defeat or retreat.
     */
    hostOutcome(bf, spec) {
        const cfg = Battlefield.config();
        const fb = FieldBattle.config();
        if (!bf.over) bf.over = { winner: Battlefield._byScore(bf), how: 'ended' };
        const pursuit = fb.phases[fb.phases.length - 1];
        const lossShare = (side) => {
            const cs = bf.companies.filter(c => c.side === side);
            const str0 = cs.reduce((s, c) => s + c.str0, 0) || 1;
            const left = cs.reduce((s, c) => {
                const ran = c.state === 'routed' || (c.state === 'fled' && c.left === 'routed');
                return s + Math.max(0, c.str) * (ran ? 1 - pursuit.lossBase * fb.rout.lossMult : 1);
            }, 0);
            return _clamp(1 - left / str0, 0, 1);
        };
        const victory = bf.over.winner === 'player';
        const pShare = lossShare('player') * cfg.lossToUnits;
        const eShare = lossShare('enemy') * (spec.kind === 'assault' && victory ? 1 : cfg.lossToUnits);
        return {
            victory,
            withdrew: bf.over.winner === 'withdrew',
            hostLost: Math.round((Number(spec.host.men) || 0) * pShare),
            enemyLost: Math.round((Number(spec.enemy.men) || 0) * eShare),
            retinueLost: victory ? 0 : Math.ceil((Number(spec.host.retinueUnits) || 0) * pShare),
            seconds: Math.round(bf.t),
        };
    },

    conclude(player, bf, world) {
        const b = bf.battle;
        if (b.done) return b.result;
        if (!bf.over) bf.over = { winner: Battlefield._byScore(bf), how: 'ended' };
        const fbCfg = FieldBattle.config();
        const cfg = Battlefield.config();
        let lost = 0;
        // The pursuit beyond the field: a company that broke and ran loses what the
        // phased battle's rout takes (the pursuit's loss base × rout.lossMult)
        const pursuit = fbCfg.phases[fbCfg.phases.length - 1];
        for (const c of bf.companies) {
            if (c.state === 'routed' || (c.state === 'fled' && c.left === 'routed')) {
                c.str *= 1 - pursuit.lossBase * fbCfg.rout.lossMult * (c.side === 'player' ? bf.sides.player.casMult : 1);
            }
        }
        Utils.withRng(_stream(bf), () => {
            for (const c of bf.companies) {
                if (c.side !== 'player' || !c.units.length) continue;
                // (not every man counted out of the line is dead: the scattered find their way back)
                const share = _clamp(1 - Math.max(0, c.str) / Math.max(1e-6, c.str0), 0, 1) * cfg.lossToUnits;
                const expected = c.units.length * share;
                let count = Math.floor(expected);
                if (expected - count > 0 && Utils.random() < expected - count) count++;
                if (count <= 0) continue;
                // The last of the company's units fall first
                const pick = c.units.filter(u => (player.army || []).includes(u)).reverse();
                const { casualties, woundedUnits } = PlayerMilitary._applyCasualties(player, b.theatre, count, { pick });
                b.casualties += casualties;
                b.wounded += woundedUnits.length;
                lost += casualties + woundedUnits.length;
            }
        });
        const s = Battlefield.strengths(bf);
        b.sim.pStr = PlayerMilitary.getTheatreStrength(player, b.theatre);
        b.sim.eStr = Math.max(0, s.eStr);
        b.sim.phase = fbCfg.phases.length;
        const winner = bf.over.winner;
        b.sim.routed = bf.broken === 'enemy' ? 'enemy' : bf.broken === 'player' ? 'player' : null;
        b.outcome = winner === 'withdrew' ? 'withdrew' : winner === 'player' ? 'victory' : 'defeat';
        if (winner === 'withdrew' && s.eStr / Math.max(1, s.pStr) < fbCfg.withdraw.cowardiceRatio) Traits.recordDeed(player, 'cowardice', 1);
        b.log.push({
            phase: 'field', name: 'The battle on the field', icon: '⚔️', stance: 'field', stanceName: 'Your orders',
            share: _r2(s.pStr / Math.max(1, s.pStr + s.eStr)), lost, enemyLost: Math.round(s.eStr0 - s.eStr),
            feint: null, routed: b.sim.routed, pStr: Math.round(b.sim.pStr), eStr: Math.round(b.sim.eStr),
            seconds: Math.round(bf.t), how: bf.over.how,
        });
        b.field = { seconds: Math.round(bf.t), how: bf.over.how, log: bf.log.slice(-12) };
        // The volleys each of your companies loosed: the arrows they spent (systems/arms.js, via FieldBattle.finish)
        b.volleys = bf.companies.filter(c => c.side === 'player' && c.units.length).map(c => ({ units: c.units, n: Math.min(c.shots || 0, c.volleys == null ? Infinity : c.volleys) }));
        const result = FieldBattle.finish(player, b, world);
        return result;
    },
};
