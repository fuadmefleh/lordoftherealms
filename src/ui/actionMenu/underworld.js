// ActionMenu — the Underworld panel: heat per realm, guild rank, jobs and
// heists, the fence and the black market. Logic lives in
// systems/underworld.js; this panel presents it.
import { ActionMenu } from './_ref.js';
import { Underworld } from '../../systems/underworld.js';

const BTN = 'padding: 4px 9px; margin: 2px 2px 0 0; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px;';
const BTN_GOLD = BTN + 'background: var(--gold); color: #1a1a1a;';
const BTN_RED = BTN + 'background: #8b0000; color: #fff;';
const BTN_DIM = BTN + 'background: rgba(255,255,255,0.08); color: var(--text-secondary); cursor: default;';
const CARD = 'background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 8px 10px; margin: 8px 0;';
const LEVEL_COLOR = { clear: '#7fd07f', watched: '#e0b040', poster: '#e08040', warrant: '#e05050' };
const LEVEL_LABEL = { clear: 'Clear', watched: 'Watched', poster: 'Wanted posters', warrant: 'Warrant' };
const STATUS_COLOR = { illegal: '#e05050', tariff: '#e0b040', legal: '#7fd07f' };

const pct = v => `${Math.round(v * 100)}%`;
const label = id => String(id).replace(/_/g, ' ');

function heatBar(heat, level) {
    return `<div style="background:rgba(255,255,255,0.06); border-radius:3px; height:6px; overflow:hidden; margin-top:2px;">
        <div style="width:${Math.min(100, heat)}%; height:100%; background:${LEVEL_COLOR[level]};"></div></div>`;
}

Object.assign(ActionMenu, {
    /** The Underworld panel for the settlement on `tile`. */
    showUnderworldPanel(game, tile) {
        const player = game.player;
        const world = game.world;
        const settlement = tile && tile.settlement;
        if (!settlement) return;
        const sum = Underworld.summary(player, world);
        const kingdom = settlement.kingdom && world.getKingdom ? world.getKingdom(settlement.kingdom) : null;
        const localHeat = Underworld.getHeat(player, settlement.kingdom);
        const guildHere = Underworld.hasGuildPresence(settlement);
        const fenceHere = Underworld.canUseFence(player, settlement);

        let html = '<div style="font-size:12px; max-height:520px; overflow-y:auto;">';

        // ── Guild standing ──
        html += `<div style="${CARD}">`;
        if (sum.member) {
            const next = sum.next ? ` — ${sum.standing}/${sum.next.standing} to ${sum.next.icon} ${sum.next.name}` : ' — the top of the guild';
            html += `<strong style="color:var(--gold);">${sum.rank.icon} ${sum.rank.name}</strong> of ${sum.guildName}<span style="color:#999;">${next}</span>`;
            if (sum.known) html += '<div style="font-size:11px; color:#e0b040;">Known as a guild man: guards and priests are cool to you, honorable lords frown, cunning ones smile.</div>';
            if (Underworld.isGuildmaster(player)) html += '<div style="font-size:11px; color:#7fd07f;">As Guildmaster you take a weekly cut of every job in the realms.</div>';
        } else if (sum.contactMet) {
            const fee = Underworld.cfg('guild').joinFee;
            html += `You have a contact in ${sum.guildName}, but you are not one of them.`;
            html += guildHere
                ? `<div><button onclick="window._uw.join()" style="${(player.gold || 0) >= fee ? BTN_GOLD : BTN_DIM}">Swear the oath (${fee}g)</button></div>`
                : '<div style="color:#999;">The guild meets in towns and cities.</div>';
        } else {
            html += `<span style="color:#999;">You have no friends in ${sum.guildName}. Ask a barkeep in a town or city tavern about "special work".</span>`;
        }
        html += '</div>';

        // ── Heat ──
        const lvl = Underworld.heatLevel(localHeat);
        html += '<h5 style="margin:10px 0 4px;">🔥 Heat</h5>';
        html += `<div style="${CARD}"><div style="display:flex; justify-content:space-between;"><span>${kingdom ? kingdom.name : 'Here'}</span>`;
        html += `<span style="color:${LEVEL_COLOR[lvl]};">${Math.round(localHeat)} · ${LEVEL_LABEL[lvl]}</span></div>${heatBar(localHeat, lvl)}`;
        const quote = Underworld.bribeCost(player, world, tile);
        if (quote) {
            html += `<button onclick="window._uw.bribe()" style="${(player.gold || 0) >= quote.gold ? BTN_GOLD : BTN_DIM}">💰 Bribe the watch: ${quote.gold}g (-${Math.round(quote.relief)} heat, ${pct(quote.fail)} it backfires)</button>`;
        }
        if (localHeat > 0) {
            const low = sum.lyingLow && sum.lyingLow.kingdom === settlement.kingdom;
            html += low
                ? `<div style="font-size:11px; color:#7fd07f;">Lying low until day ${sum.lyingLow.untilDay} — heat cools fast, no jobs here.</div>`
                : `<button onclick="window._uw.lieLow()" style="${BTN_GOLD}">🕯️ Lie low (${Underworld.cfg('heat').lieLowDays} days)</button>`;
        }
        html += '</div>';
        const others = sum.heat.filter(h => h.kingdomId !== settlement.kingdom);
        if (others.length) {
            html += '<div style="font-size:11px;">';
            for (const h of others) {
                html += `<div style="display:flex; justify-content:space-between;"><span>${h.name}</span><span style="color:${LEVEL_COLOR[h.level]};">${h.heat} · ${LEVEL_LABEL[h.level]}</span></div>${heatBar(h.heat, h.level)}`;
            }
            html += '</div>';
        }

        // ── Jobs ──
        if (sum.member && guildHere) {
            html += '<h5 style="margin:10px 0 4px;">🗝️ Jobs</h5>';
            for (const job of Underworld.availableJobs(player, world, tile)) {
                if (job.id === 'heist') continue;
                const can = !job.locked && (player.actionPoints || 0) >= job.ap;
                html += `<div style="${CARD}"><div style="display:flex; justify-content:space-between; gap:6px;"><strong>${job.icon} ${job.name}</strong>`;
                html += `<span style="color:#ccc; white-space:nowrap;">${pct(job.odds)} · ${job.ap} AP</span></div>`;
                html += `<div style="color:#aaa; font-size:11px;">${job.description}</div>`;
                html += can
                    ? `<button onclick="window._uw.job('${job.id}')" style="${BTN_RED}">Do it</button>`
                    : `<span style="font-size:11px; color:#999;">${job.locked || 'Not enough action points'}</span>`;
                html += '</div>';
            }

            // ── Heist ──
            const heistJob = Underworld.availableJobs(player, world, tile).find(j => j.id === 'heist');
            if (heistJob) {
                html += `<h5 style="margin:10px 0 4px;">${heistJob.icon} Heist</h5><div style="${CARD}">`;
                const plan = sum.heist;
                if (plan) {
                    const here = plan.key === `${tile.q},${tile.r}`;
                    html += `<strong>${plan.name}</strong> <span style="color:#999;">(planned day ${plan.startedDay})</span>`;
                    html += `<div style="font-size:11px; color:#aaa;">Done: ${plan.steps.length ? plan.steps.map(label).join(', ') : 'nothing yet'} · +${pct(plan.bonus)} odds</div>`;
                    if (here) {
                        for (const s of plan.open) {
                            const ok = (player.gold || 0) >= (s.gold || 0) && (player.actionPoints || 0) >= s.ap;
                            html += `<button ${ok ? `onclick="window._uw.step('${s.id}')"` : 'disabled'} style="${ok ? BTN_GOLD : BTN_DIM}" title="${s.description}">${s.icon} ${s.name} (${s.gold ? `${s.gold}g, ` : ''}${s.ap} AP, +${pct(s.bonus)})</button>`;
                        }
                        const odds = Underworld.heistOdds(player, world, tile);
                        html += `<div style="margin-top:6px;"><button onclick="window._uw.strike()" style="${BTN_RED}">Strike now — ${pct(odds)} (${heistJob.ap} AP)</button>`;
                    } else {
                        html += '<div style="font-size:11px; color:#e0b040;">Travel back to the target to keep planning or strike.</div><div>';
                    }
                    html += `<button onclick="window._uw.abandon()" style="${BTN_DIM} cursor:pointer;">Call it off</button></div>`;
                } else if (heistJob.locked) {
                    html += `<span style="color:#999;">${heistJob.locked}</span>`;
                } else {
                    html += '<div style="color:#aaa; font-size:11px;">Pick a mark, then plan: case it, buy tools, hire a crew, bribe an inside man, plan the getaway. Each step raises the odds.</div>';
                    for (const t of Underworld.heistTargets(settlement)) {
                        html += `<button onclick="window._uw.heist('${t.id}')" style="${BTN_GOLD}">${t.icon} ${t.name} (${t.gold[0]}–${t.gold[1]}g)</button>`;
                    }
                }
                html += '</div>';
            }
        }

        if (sum.rackets.length) {
            html += '<h5 style="margin:10px 0 4px;">🪓 Rackets</h5><div style="font-size:11px;">';
            for (const rk of sum.rackets) html += `<div>${rk.name}: ${rk.weekly}g / week</div>`;
            html += '</div>';
        }

        // ── Fence ──
        if (fenceHere) {
            html += '<h5 style="margin:10px 0 4px;">🧺 The Fence</h5>';
            html += `<div style="font-size:11px; color:#aaa;">Takes anything, hot or not, at ${pct(Underworld.fenceRate(player))} of its worth.</div>`;
            const hotIds = new Set(sum.hot.map(h => h.item));
            const goods = Object.entries(player.inventory || {}).filter(([id, q]) => id !== 'gold' && q > 0)
                .sort((a, b) => (hotIds.has(b[0]) ? 1 : 0) - (hotIds.has(a[0]) ? 1 : 0));
            if (!goods.length) html += '<div style="color:#999;">You carry nothing to sell.</div>';
            for (const [id, qty] of goods.slice(0, 14)) {
                const hot = sum.hot.find(h => h.item === id);
                const price = Underworld.fencePrice(player, id, game.world, tile);
                html += `<div style="display:flex; align-items:center; justify-content:space-between; padding:3px 0; border-bottom:1px solid rgba(255,255,255,0.05);">`;
                html += `<span>${label(id)} ×${qty}${hot ? ` <span style="color:#e08040;">🔥 hot ${hot.qty} (${hot.daysLeft}d)</span>` : ''}</span>`;
                html += `<span><span style="color:var(--gold);">${price}g</span> <button onclick="window._uw.fence('${id}', 1)" style="${BTN_GOLD}">1</button>`;
                if (qty > 1) html += `<button onclick="window._uw.fence('${id}', ${qty})" style="${BTN_GOLD}">All</button>`;
                html += '</span></div>';
            }
        }

        // ── Black market ──
        if (fenceHere) {
            const b = Underworld.blockadeAt(world, tile);
            html += '<h5 style="margin:10px 0 4px;">🏴‍☠️ The Black Market</h5>';
            const notes = [];
            if (b.blockaded) notes.push(b.closedPort ? 'The port is sealed by enemy fleets — anything that slips through sells dear, and the watch is everywhere' : 'The realm is blockaded — prices and patrols are up');
            if (sum.leanSeason) notes.push('Lean season — food and contraband fetch more');
            if (notes.length) html += `<div style="font-size:11px; color:#e0b040;">${notes.join('. ')}.</div>`;
            const offers = Underworld.blackMarketOffers(player, world, tile);
            if (!offers.length) html += '<div style="color:#999;">Nothing to offer them (hot goods go to the fence).</div>';
            for (const o of offers.slice(0, 14)) {
                html += `<div style="display:flex; align-items:center; justify-content:space-between; padding:3px 0; border-bottom:1px solid rgba(255,255,255,0.05);">`;
                html += `<span>${label(o.item)} ×${o.qty} <span style="color:${STATUS_COLOR[o.status]}; font-size:10px;">${o.status}</span></span>`;
                html += `<span><span style="color:var(--gold);">${o.price}g</span> <span style="color:#999; font-size:10px;">${pct(o.risk)} risk</span> <button onclick="window._uw.bm('${o.item}', 1)" style="${BTN_RED}">Sell 1</button></span></div>`;
            }
        }

        // ── Contraband here ──
        const list = Underworld.contrabandList(kingdom);
        if (list.illegal.length || list.tariff.length) {
            html += `<h5 style="margin:10px 0 4px;">📜 Contraband in ${kingdom ? kingdom.name : 'these lands'}</h5><div style="font-size:11px;">`;
            if (list.illegal.length) html += `<div><span style="color:${STATUS_COLOR.illegal};">Banned:</span> ${list.illegal.map(label).join(', ')}</div>`;
            if (list.tariff.length) html += `<div><span style="color:${STATUS_COLOR.tariff};">Tariffed:</span> ${list.tariff.map(label).join(', ')}</div>`;
            html += '</div>';
        }

        if (sum.log.length) {
            html += '<h5 style="margin:10px 0 4px;">📓 Lately</h5><div style="font-size:11px; color:#bbb;">';
            for (const e of sum.log) html += `<div>Day ${e.day}: ${e.text}</div>`;
            html += '</div>';
        }
        html += '</div>';
        game.ui.showCustomPanel('🗝️ The Underworld', html);

        const after = (title, res) => {
            if (!res || !res.success) {
                game.ui.showNotification(title, (res && res.reason) || 'Not possible.', 'error');
            } else {
                const bad = res.caught || res.outcome === 'caught' || res.outcome === 'failed' || res.accepted === false;
                game.ui.showNotification(title, res.text, bad ? 'error' : 'success');
            }
            game.ui.updateStats(player, world);
            if (player.jailState) {
                game.ui.hideCustomPanel();
                return;
            }
            ActionMenu.showUnderworldPanel(game, tile);
        };
        window._uw = {
            join: () => after('🗝️ The Guild', Underworld.joinGuild(player, world, tile)),
            job: (id) => after('🗝️ Job', Underworld.doJob(player, world, tile, id)),
            heist: (id) => after('💎 Heist', Underworld.startHeist(player, world, tile, id)),
            step: (id) => after('💎 Planning', Underworld.planStep(player, world, tile, id)),
            strike: () => after('💎 The Heist', Underworld.executeHeist(player, world, tile)),
            abandon: () => after('💎 Heist', Underworld.abandonHeist(player)),
            fence: (id, qty) => after('🧺 The Fence', Underworld.sellToFence(player, world, tile, id, qty)),
            bm: (id, qty) => after('🏴‍☠️ Black Market', Underworld.sellBlackMarket(player, world, tile, id, qty)),
            bribe: () => after('💰 Bribe', Underworld.bribeGuards(player, world, tile)),
            lieLow: () => after('🕯️ Lying Low', Underworld.lieLow(player, world, tile)),
        };
    },
});
