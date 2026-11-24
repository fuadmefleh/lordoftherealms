// ============================================
// INNER MAP — the scaffold and the pillory, up close
// ============================================
// The gallows, the block or the stake a proclaimed execution raises in the
// town's square, and the pillory beside it while someone sits in the stocks
// (world/scaffolds.js lays them; systems/executions.js and
// systems/peopleCrimes.js keep who and when). Clicking one says who it stands
// for; the panel (ActionMenu.showScaffoldHere) lists the condemned, today's
// crowd (watch, or cry out for mercy: Executions.attend), the deaths and
// punishments the realm's law allows; your own sentence opens its page.

import { InnerMap } from '../world/innerMap.js';
import { Executions } from '../systems/executions.js';
import { ActionMenu } from './actionMenu.js';

const SCAFFOLD_IDS = new Set(['ex_gallows', 'ex_block', 'ex_stake']);

export const InnerMapScaffold = {
    isScaffoldDef(def) { return !!(def && SCAFFOLD_IDS.has(def.id)); },
    isPilloryDef(def) { return !!(def && def.id === 'ex_pillory'); },

    /** Menu entries for a scaffold or pillory prop at its anchor (q, r). */
    menuItems(game, def, q, r) {
        if (!game || !game.player || !game.world) return [];
        const scaffold = InnerMapScaffold.isScaffoldDef(def);
        const pillory = InnerMapScaffold.isPilloryDef(def);
        if (!scaffold && !pillory) return [];
        const tile = InnerMap.getTile(q, r);
        const obj = tile && tile.customObject;
        const { player, world } = game;
        const at = Executions.atTown(player, world, player.q, player.r);
        const day = Number.isFinite(world.day) ? world.day : 0;
        const out = [];
        if (scaffold) {
            const scId = obj && obj.scaffold;
            const mine = at.condemned.filter(c => `${c.kind === 'yours' ? 'p' : 'a'}${c.id}` === scId);
            const list = mine.length ? mine : at.condemned;
            for (const c of list.slice(0, 3)) {
                const when = c.today ? 'today' : `day ${c.day}, in ${c.day - day} day${c.day - day === 1 ? '' : 's'}`;
                out.push({ type: 'disabled', label: `${c.icon} ${c.name}: ${c.methodLabel.toLowerCase()} for ${c.crimeLabel}, ${when}` });
                if (c.kind === 'realm' && c.today) {
                    out.push({ type: 'action', action: 'scaffold_watch', label: `Watch ${c.name} Die`, icon: '👁️', desc: 'Stand in the crowd to the end', pubId: c.id });
                    out.push({ type: 'action', action: 'scaffold_mercy', label: 'Cry Out for Mercy', icon: '🕊️', desc: 'The crowd may take it up; the crown will not thank you (reputation, heat)', pubId: c.id });
                }
                if (c.kind === 'yours') out.push({ type: 'action', action: 'scaffold_mine', label: 'Your Sentence', icon: '📜', desc: `${c.name}: the place, the manner, or a mercy`, condemnedId: c.id });
            }
            if (!list.length) out.push({ type: 'disabled', label: '🕊️ No one is to die here now' });
        } else {
            const ref = obj && obj.pillory;
            const st = (player.peopleCrimes && player.peopleCrimes.stocks) || [];
            const x = st.find(o => o.q === player.q && o.r === player.r && String(o.ref) === String(ref)) || null;
            // (a court's sentence: the pillory, the post, the iron — systems/penalLabour.js writes settlement.pillory with a 'pen' ref)
            const wt = world.getTile(player.q, player.r);
            const pl = !x && wt && wt.settlement && wt.settlement.pillory && String(wt.settlement.pillory.ref || '').startsWith('pen') && Number(wt.settlement.pillory.until) >= day ? wt.settlement.pillory : null;
            if (x) out.push({ type: 'disabled', label: `🔒 ${x.name} sits in the stocks for the rent owed you, until day ${x.until}${x.winter ? ' (the cold can kill)' : ''}` });
            else if (pl) out.push({ type: 'disabled', label: pl.why === 'flogging' ? `🩸 ${pl.name} was flogged at the post today` : pl.why === 'the iron' ? `🔥 ${pl.name} was branded here today` : `🔒 ${pl.name} sits in the pillory for ${pl.why}, until day ${pl.until}` });
            else out.push({ type: 'disabled', label: '🔒 The pillory stands empty' });
        }
        out.push({ type: 'action', action: 'scaffold_panel', label: scaffold ? 'Who Is Condemned, and the Law' : 'The Law Here', icon: '⚖️', desc: 'The condemned, the deaths and punishments the realm\'s law allows' });
        if (Executions.canJudge(player, world)) out.push({ type: 'action', action: 'scaffold_justice', label: 'Your Scaffold', icon: '⚖️', desc: 'The condemned awaiting your word' });
        return out;
    },

    /** Run scaffold_*. Returns true when it was ours. */
    handle(game, item) {
        if (!item || !/^scaffold_/.test(item.action || '')) return false;
        if (item.action === 'scaffold_watch' || item.action === 'scaffold_mercy') {
            ActionMenu.scaffoldCrowdAct(game, item.pubId, item.action === 'scaffold_mercy' ? 'mercy' : 'watch', 'here');
        } else if (item.action === 'scaffold_mine') {
            ActionMenu.showCondemned(game, item.condemnedId);
        } else if (item.action === 'scaffold_justice') {
            ActionMenu.showExecutions(game);
        } else {
            ActionMenu.showScaffoldHere(game);
        }
        return true;
    },
};
