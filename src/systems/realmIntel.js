// ============================================
// REALM INTEL — who may read a realm's private books
// ============================================
// A realm's treasury, budget and debts, its mint's take and its coin flows,
// its customs and granaries, the size of its army and the loyalty of its
// council are the crown's own business. A commoner hears rumours of them; the
// numbers are for those with a place at that court, or eyes inside it:
//
//   ruler     the realm you rule (Throne.ruledKingdom) — everything
//   office    an office of the realm you are sworn to (player.allegiance;
//             player.currentTitle / player.kingdomTitle): the treasury roles
//             (chancellor, tax collector, treasurer, spymaster) read the
//             books; the war roles (chancellor, marshal, spymaster) know the
//             army; any office sits close enough to know the court
//   royal kin married into its royal house (Heirs.kinshipWith 'married' via a
//             royal match): the court
//   spies     a spy of yours placed in one of its towns, or on a mission
//             against it — everything, while they are there
//   lease     the realm's mint you hold on lease (Mints): its mint's books
//
// can(player, world, kid, kind) answers for one realm and one kind ('books',
// 'mint', 'military', 'court'); why() names the reason for the panels.
// Everyone else gets a rumour: band(kind, value) turns a number into the
// words the street uses ("lean coffers", "a strong army"), shown only where
// the player already knows something of the realm (player.knowsAbout).
// Pure reads; no RNG; no import-time effects. Bands in data/realmIntel.json.

import { DataLoader } from '../core/dataLoader.js';
import { Throne } from './throne.js';
import { Relationships } from './relationships.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

const DEFAULTS = {
    roles: {
        books: ['chancellor', 'tax_collector', 'treasurer', 'spymaster', 'king'],
        military: ['chancellor', 'marshal', 'spymaster', 'king'],
        court: '*',
        mint: ['chancellor', 'tax_collector', 'treasurer', 'spymaster', 'king'],
    },
    bands: {
        treasury: [[25000, 'overflowing coffers'], [8000, 'a rich treasury'], [2000, 'comfortable coffers'], [500, 'lean coffers'], [-Infinity, 'an empty chest']],
        military: [[600, 'a great host'], [200, 'a strong army'], [60, 'a modest host'], [-Infinity, 'a token guard']],
        fleet: [[200, 'a great fleet'], [60, 'a fair fleet'], [1, 'a few ships'], [-Infinity, 'no fleet to speak of']],
        capital: [[20000, 'a great fortune'], [5000, 'deep pockets'], [1000, 'a fair purse'], [-Infinity, 'thin reserves']],
    },
    labels: { ruler: 'you rule it', office: 'your office at its court', kin: 'your kin at its court', spy: 'your spies inside it', lease: 'you hold its mint', own: 'your own' },
};

const KINDS = ['books', 'mint', 'military', 'court'];

export const RealmIntel = {
    KINDS,

    config() {
        const d = (DataLoader._gamedata && DataLoader._gamedata.realmIntel) || {};
        return {
            roles: { ...DEFAULTS.roles, ...(d.roles || {}) },
            bands: { ...DEFAULTS.bands, ...(d.bands || {}) },
            labels: { ...DEFAULTS.labels, ...(d.labels || {}) },
        };
    },

    _kid(k) {
        return k && typeof k === 'object' ? k.id : k;
    },

    /** The realm the player rules, if it is this one. */
    rules(player, world, kid) {
        const k = Throne.ruledKingdom(player, world);
        return !!k && k.id === kid;
    },

    /** The player's office at this realm's court (its id), or null. */
    officeIn(player, kid) {
        if (!player || !kid || player.allegiance !== kid) return null;
        const t = player.currentTitle || player.kingdomTitle;
        return t && t !== 'citizen' ? String(t) : null;
    },

    /** A spy of the player's placed in one of the realm's towns, or on a mission against it. */
    spyCovered(player, world, kid) {
        const esp = player && player.espionage;
        if (!esp || !kid) return false;
        for (const spy of esp.spies || []) {
            const loc = spy && spy.location;
            const t = loc && world && world.getTile ? world.getTile(loc.q, loc.r) : null;
            if (t && t.settlement && t.settlement.kingdom === kid) return true;
        }
        for (const m of esp.activeMissions || []) if (m && m.targetKingdom === kid) return true;
        return false;
    },

    /** Married into the realm's royal house (a royal match: the ruler's own, or a child's). */
    royalKin(player, kid) {
        if (!player || !kid) return false;
        const spouse = player.spouse ? Relationships.getNPC(player.spouse) : null;
        if (spouse && spouse.royal && spouse.royal.kingdomId === kid) return true;
        for (const c of player.children || []) {
            const sp = c && c.upbringing && c.upbringing.spouse;
            if (sp && sp.kind === 'royal' && sp.kingdomId === kid && c.isAlive !== false) return true;
        }
        return false;
    },

    _leases(player, kid) {
        const lease = player && player.mints && player.mints.lease;
        return !!lease && lease.kingdomId === kid;
    },

    /** Why the player may read this kind of a realm's affairs: a label key, or null. */
    why(player, world, k, kind) {
        const kid = RealmIntel._kid(k);
        if (!player || !kid) return null;
        if (RealmIntel.rules(player, world, kid)) return 'ruler';
        const roles = RealmIntel.config().roles[kind] || [];
        const office = RealmIntel.officeIn(player, kid);
        if (office && (roles === '*' || roles.includes(office))) return 'office';
        if (kind === 'court' && RealmIntel.royalKin(player, kid)) return 'kin';
        if (kind === 'mint' && RealmIntel._leases(player, kid)) return 'lease';
        if (RealmIntel.spyCovered(player, world, kid)) return 'spy';
        return null;
    },

    /** May the player read this kind ('books', 'mint', 'military', 'court') of this realm's affairs? */
    can(player, world, k, kind) {
        return RealmIntel.why(player, world, k, kind) != null;
    },

    /** "your office at its court", for a tooltip. */
    whyLabel(player, world, k, kind) {
        const w = RealmIntel.why(player, world, k, kind);
        return w ? RealmIntel.config().labels[w] : '';
    },

    /** The street's word for a number: band('treasury', 1200) → 'lean coffers'. */
    band(kind, value) {
        const list = RealmIntel.config().bands[kind] || [];
        const v = _num(value);
        for (const [min, label] of list) if (v >= (min === null ? -Infinity : min)) return label;
        return list.length ? list[list.length - 1][1] : '';
    },

    /** The rough figure a rumour stands for: the floor of its band (0 for the lowest), for bars and rankings. */
    estimate(kind, value) {
        const list = RealmIntel.config().bands[kind] || [];
        const v = _num(value);
        for (const [min] of list) {
            const m = min === null ? -Infinity : min;
            if (v >= m) return Number.isFinite(m) ? m : 0;
        }
        return 0;
    },

    /**
     * A realm's number as the player may weigh it: { value, text, exact }.
     * The figure for an insider; the band's floor and its words for one who
     * knows of the realm (knows); null and 'unknown' otherwise.
     */
    seen(player, world, k, kind, band, value, knows) {
        if (RealmIntel.can(player, world, k, kind)) return { value: _num(value), text: Math.round(_num(value)).toLocaleString(), exact: true };
        if (knows) return { value: RealmIntel.estimate(band, value), text: RealmIntel.band(band, value), exact: false };
        return { value: null, text: 'unknown', exact: false };
    },

    /**
     * What the player may be told of one of a realm's numbers: the figure
     * (insiders), the rumour (who knows something of the realm), or nothing.
     * → { exact: bool, text: string|null, why: string }
     *   kind: 'books' | 'military' | ...; band: the band for the rumour;
     *   fmt: the exact figure's format; knows: the player knows of the realm.
     */
    tell(player, world, k, kind, value, { band = null, fmt = (v) => Math.round(_num(v)).toLocaleString(), knows = true } = {}) {
        const why = RealmIntel.whyLabel(player, world, k, kind);
        if (why) return { exact: true, text: fmt(value), why };
        if (band && knows) return { exact: false, text: RealmIntel.band(band, value), why: '' };
        return { exact: false, text: null, why: '' };
    },
};
