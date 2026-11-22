// ============================================
// INNER MAP MAIMING — the knife, over someone on the ground
// ============================================
// The street map's half of systems/maiming.js. Standing over someone beaten
// senseless or bound (systems/downed.js), the menu offers "Maim Them…": a
// panel of the acts (a hand, an eye, an ear, the nose, the tongue, a foot, a
// brand on the face). Done:
//   - the body keeps it (a townsperson's roster entry: systems/maimMarks.js),
//     and a craftsman who can no longer work their trade loses it;
//   - the street sees it or doesn't (ui/innerMapReactions.js onViolence: an
//     assault on the record, the watch, the town's talk); those who saw are
//     cowed (threats fold easier: npcDisposition fearful);
//   - the victim and their kin remember (npcMemory, a grudge that may take
//     the same from you one day: InnerMapCombat._knockOutPlayer → Maiming.vengeance);
//   - the doer is branded (karma, cruelty, dread, the realm's regard, heat).
//
// Also here: the look of the maimed on the map (presetFor) — the stump, the
// hook, the wooden leg, the patch… drawn by ui/maimLook.js.

import { InnerMap } from '../world/innerMap.js';
import { Downed } from '../systems/downed.js';
import { MaimMarks } from '../systems/maimMarks.js';
import { Maiming } from '../systems/maiming.js';
import { StreetCrime } from '../systems/streetCrime.js';
import { NpcDisposition } from '../systems/npcDisposition.js';
import { InnerMapReactions } from './innerMapReactions.js';
import { InnerMapCharacters } from './innerMapCharacters.js';
import { MaimLook } from './maimLook.js';
import { ParentsGuard } from './parentsGuard.js';
import { lede, rowList, esc } from './actionMenu/uiKit.js';

export { EYE_PATCH_LAYER } from './maimLook.js';

const _cheb = (aq, ar, bq, br) => Math.max(Math.abs(aq - bq), Math.abs(ar - br));

function _note(game, title, body, kind = 'info') {
    if (game && game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification(title, body, kind);
}

export const InnerMapMaiming = {
    // ──────────── THE MENU ────────────

    /** "Maim Them…" on someone downed (unconscious, bleeding, bound). */
    menuItems(game, npc) {
        if (!npc || !Downed.isDown(npc) || !Maiming.enabled() || npc.type === 'child') return [];
        const tag = MaimMarks.tag(npc._person || npc);
        return [{ type: 'action', action: 'maim_menu', label: 'Maim Them…', icon: '🔪', desc: tag ? `Already ${tag}` : 'A hand, an eye, the nose, the tongue: marked for life', npc }];
    },

    /** Handle a maiming order from the menu. Returns true when it was one. */
    handle(game, item) {
        if (item.action !== 'maim_menu') return false;
        const npc = item.npc;
        if (!npc) return true;
        const open = () => { if (Downed.isDown(npc)) this.showPanel(game, npc); };
        if (_cheb(npc.q, npc.r, InnerMap.playerInnerQ, InnerMap.playerInnerR) <= 1) open();
        else if (InnerMap.approachAndThen(npc.q, npc.r, open) === 'unreachable') _note(game, 'Blocked', `You can't reach ${npc.name}.`, 'error');
        return true;
    },

    /** The body the deed is done to: the townsperson's roster entry, else the walking NPC itself. */
    _body(npc) { return (npc && npc._person) || npc; },

    showPanel(game, npc, flash = '') {
        const body = this._body(npc);
        const tag = MaimMarks.tag(body);
        let html = lede(`${esc(npc.name)} lies at your feet${tag ? `, already ${esc(tag)}` : ''}. Whatever you take, they carry for the rest of their life, and so do their kin.`);
        if (flash) html += `<div style="margin:6px 0;padding:6px 8px;border-left:3px solid #a33;background:rgba(120,20,20,0.15);">${esc(flash)}</div>`;
        const rows = Maiming.acts().map(a => {
            const why = MaimMarks.whyNot(body, a.id);
            return { icon: a.icon, name: esc(a.label), desc: esc(why || `${a.short || ''}${(MaimMarks.act(a.id).counts || [])[0] && (MaimMarks.act(a.id).counts[0].barsRule) ? ' · never fit to rule' : ''}`), off: !!why, why: esc(why || ''), tone: why ? '' : 'bad', act: 'streetMaimAct', args: [npc.id, a.id] };
        });
        html += rowList(rows, '🔪 What to take');
        if (game.ui && typeof game.ui.showCustomPanel === 'function') game.ui.showCustomPanel(`🔪 ${esc(npc.name)}`, html);
    },

    /** Do it: the body, the street, the kin, the brand. → the result text, or null. */
    doMaim(game, npcId, act) {
        const npc = (InnerMap.npcs || []).find(n => n.id === npcId);
        if (!game || !game.player || !npc || !Downed.isDown(npc)) { _note(game, 'Gone', 'They are no longer at your feet.', 'warning'); return null; }
        if (_cheb(npc.q, npc.r, InnerMap.playerInnerQ, InnerMap.playerInnerR) > 1) { _note(game, 'Too far', `You must stand over ${npc.name}.`, 'warning'); return null; }
        if (!ParentsGuard.ok(game, 'assault', null, { each: true })) return null;
        const body = this._body(npc);
        const why = MaimMarks.whyNot(body, act);
        if (why) { _note(game, 'It cannot be done', why, 'warning'); return null; }
        const player = game.player;
        const world = game.world;
        // The street sees it, or doesn't: an assault on the record, the watch, the talk
        const seenBy = StreetCrime.selectWitnesses(InnerMap.npcs || [], { q: npc.q, r: npc.r, indoors: !!InnerMap._insideBuilding }, npc).filter(w => w.seen);
        if (seenBy.length) InnerMapReactions.onViolence(game, npc, 'assault');
        const ref = InnerMap._currentWorldTileRef;
        const settlement = (ref && ref.settlement) || (InnerMap.currentWorldTile && InnerMap.currentWorldTile.settlement) || null;
        let res;
        if (npc._person && npc._folk) {
            res = Maiming.maimFolk(player, world, { settlement, folk: npc._folk, person: npc._person, act, seen: seenBy.length > 0, rank: npc.type === 'noble' ? 'noble' : 'commoner' });
        } else {
            MaimMarks.mark(npc, act, { day: (world && world.day) || 0, by: player.name || null });
            const n = MaimMarks.count(npc, act);
            Maiming.brand(player, world, act, { name: npc.name, rank: npc.type === 'noble' ? 'noble' : 'commoner', settlement, q: settlement ? settlement.q : null, r: settlement ? settlement.r : null }, { seen: seenBy.length > 0, n });
            const def = MaimMarks.act(act) || {};
            res = { ok: true, text: String(def.done || 'It is done.').replace('{victim}', npc.name) };
        }
        if (!res || !res.ok) { _note(game, 'It cannot be done', (res && res.reason) || '', 'warning'); return null; }
        // Their own memory, and their kin's: a grudge that names what was taken
        const mem = NpcDisposition.getMemory(npc);
        mem.disposition = Math.max(0, (Number(mem.disposition) || 50) - 60);
        mem.maimedBy = { act, day: (world && world.day) || 0 };
        const ripple = NpcDisposition.onNpcHarmed(npc, InnerMap.npcs || [], 'maimed');
        for (const a of ripple.affected) {
            const kin = (InnerMap.npcs || []).find(n => n.id === a.id);
            const g = kin && NpcDisposition.getMemory(kin).grudge;
            if (g && g.severity === 'maimed') g.act = act;
        }
        // Those who saw it are afraid of you
        for (const w of seenBy) { const m = NpcDisposition.getMemory(w.npc); if (m) m.fearful = true; }
        if (npc.state !== 'unconscious') InnerMapReactions.bark(npc, 'AAAGH!', 3);
        if (typeof game.ui.hideCustomPanel === 'function') game.ui.hideCustomPanel();
        _note(game, `${(MaimMarks.act(act) || {}).icon || '🔪'} ${npc.name}`, `${res.text}${seenBy.length ? ` ${seenBy.length} saw it done.` : ' No one saw.'}`, seenBy.length ? 'error' : 'warning');
        if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(player, world);
        return res.text;
    },

    // ──────────── THE LOOK ────────────

    /**
     * The preset to draw an NPC with: their own, with what they lost laid over it
     * (a stump, a hook, a wooden leg, a crutch, the patch, a blindfold, the marks on
     * the face: ui/maimLook.js). Composited once per look; until it is ready the
     * plain look is drawn.
     */
    presetFor(npc) {
        // (the child sprites are another sheet: none of it fits them)
        if (!npc || !npc.preset || npc.type === 'child' || String(npc.preset).startsWith('child:')) return npc ? npc.preset : null;
        const body = this._body(npc);
        if (!body || !body.maimed) return npc.preset;
        // (the look as it is drawn: the era's fitting of the preset once it is made — innerMapCharacters _live)
        const drawn = typeof InnerMapCharacters._live === 'function' ? InnerMapCharacters._live(npc.preset) : npc.preset;
        return MaimLook.presetOver(drawn, body) || npc.preset;
    },

    /** Draw-time (called with the NPC each frame it is drawn): the maimed look once it is ready. */
    drawPreset(npc) { return this.presetFor(npc); },
};
