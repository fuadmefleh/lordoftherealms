// ActionMenu — the Discoveries log (Journal → Discoveries): places on no map
// that the player has found or heard of, who found them, what is there,
// whether they are claimed, and what can be done about them from here —
// name, gather, sell the chart, found a colony, pay off a contest.
// Logic lives in systems/discovery.js; this panel presents it.
// The action menu's voice (uiKit.js): a card a place, what can be done as rows.
import { ActionMenu } from './_ref.js';
import { Discovery } from './_imports.js';
import { lede, chips, card, rowList, sectionHead, more, price, esc } from './uiKit.js';
import { Names } from '../../core/names.js';

const MUTED = 'font-size:11px; color:#a99a78;';

function _claimText(world, site) {
    if (!site.claim) return '<span style="color:#9ab;">unclaimed</span>';
    if (site.claim.by === 'player') return `<span style="color:#9fd89f;">yours — colony of ${esc(site.claim.colony ? site.claim.colony.name : '?')}</span>`;
    const k = world.getKingdom && world.getKingdom(site.claim.by);
    return `<span style="color:#e0b040;">claimed by ${esc(k ? k.name : site.claim.name || 'a realm')}</span>`;
}

function _siteCard(player, world, site) {
    const def = Discovery.kind(site.kind);
    const by = site.discovered
        ? (site.discovered.by === 'player' ? `Found by you, day ${site.discovered.day}` : `Found by ${esc(site.discovered.byName)}, day ${site.discovered.day}`)
        : 'Not yet found';
    let secret = '';
    if (site.discovered && site.discovered.by === 'player') {
        secret = site.knownBy.length
            ? ` · <span style="color:#c9a;">known to ${site.knownBy.map(id => esc((world.getKingdom(id) || { name: id }).name)).join(', ')}</span>`
            : ' · <span style="color:#9fd89f;">your secret</span>';
    }
    let body = `<div style="${MUTED}">${by} · ${_claimText(world, site)}${secret}</div>`;
    const features = Discovery.describeFeatures(site);
    body += `<div style="font-size:12px; margin-top:4px;">${features.length ? features.map(esc).join(' · ') : 'Nothing of note.'}</div>`;
    if (site.features.goods.length && site.discovered) {
        const stock = site.features.goods.map(g => `${(Discovery.good(g) || {}).icon || ''} ${site.stock[g] || 0}`).join('  ');
        body += `<div style="${MUTED}">Ready to gather: ${stock}</div>`;
    }

    const rows = [];
    // Naming: the finder's choice of the offered names
    if (site.naming) {
        site.nameOptions.forEach((n, i) => rows.push({
            icon: n === site.name ? '✔' : '✒️', name: esc(n), desc: n === site.name ? 'The name it bears now' : 'Name it so',
            attrs: n === site.name ? '' : `onclick="window._disc.name('${esc(site.id)}', ${i})"`,
        }));
    }
    const gatherWhy = Discovery.gatherReason(player, world, site);
    if (!gatherWhy) rows.push({ icon: '🧺', name: 'Gather', desc: 'Take what is ready here', attrs: `onclick="window._disc.gather('${esc(site.id)}')"` });
    const offer = Discovery.archiveOffer(player, world, site);
    if (!offer.reason) rows.push({ icon: '📜', name: `Sell the chart to ${esc(Names.realm(offer.kingdom.name))}`, desc: 'Their archive buys it; the place is no longer your secret', side: price(offer.price), attrs: `onclick="window._disc.sell('${esc(site.id)}')"` });
    const colonyWhy = Discovery.colonyReason(player, world, site);
    if (!colonyWhy) rows.push({ icon: '🏕️', name: 'Found a colony here', desc: 'A colony keeps its riches for you', attrs: `onclick="window._disc.colony('${esc(site.id)}')"` });
    if (site.contest) {
        rows.push({
            icon: '⚔️', name: `Pay ${esc(site.contest.kingdomName)} to drop the claim`,
            desc: `They contest it: their ships (≈${site.contest.fleet}) come on day ${site.contest.deadline}. Paying renounces it.`,
            side: price(site.contest.tribute, (player.gold || 0) >= site.contest.tribute), tone: 'bad',
            attrs: `onclick="window._disc.tribute('${esc(site.id)}')"`,
        });
    }
    body += rowList(rows, site.naming ? `Name it (by day ${site.naming.untilDay}, or it keeps the first)` : '');
    return card(body, { icon: def.icon, title: esc(site.name), side: `<span style="${MUTED}">${esc(def.label)} · (${site.q}, ${site.r})</span>` });
}

Object.assign(ActionMenu, {
    /** Journal → Discoveries: places found and heard of, and what can be done about them. */
    showDiscoveries(game, message = null) {
        const player = game.player;
        const world = game.world;
        const j = Discovery.journal(player);
        let html = '<div style="max-height: 560px; overflow-y: auto; font-size: 12px;">';
        if (message) html += card(esc(message), { tone: 'gold' });
        html += lede('Places on no map. Sail far from the ports and follow rumours and old charts to find them before rival adventurers do. The finder names a place; its chart can be sold or kept secret.');
        html += chips([
            ['🧭', 'Found', j.stats.found], ['✒️', 'Named', j.stats.named], ['📜', 'Charts sold', j.stats.sold],
            ['🧺', 'Gathered', j.stats.gathered], ['🏴', "Rivals' finds", j.stats.rivalFinds], ['❔', 'Uncharted', j.uncharted],
        ]);

        html += sectionHead('Known places');
        if (!j.known.length) html += lede('You know of no uncharted places yet.');
        for (const s of j.known) html += _siteCard(player, world, s);

        if (j.hinted.length) {
            html += rowList(j.hinted.map(s => {
                const def = Discovery.kind(s.kind);
                return {
                    icon: s.hint === 'charted' ? '📜' : '🗣️',
                    name: `A ${esc(def.label.toLowerCase())} ${def.icon}`,
                    desc: s.hint === 'charted' ? `Charted at (${s.q}, ${s.r})` : `Somewhere within ${s.hintRadius} leagues of (${s.hintQ}, ${s.hintR})`,
                    note: 'Sail there (Board Ship → Voyage → Expeditions) or walk there to find it.',
                };
            }), 'Rumours & charts');
        }
        if (j.log.length) {
            html += more(`Log (${j.log.length})`, rowList(j.log.map(e => ({ icon: e.icon, name: esc(e.text), side: `<span style="${MUTED}">day ${e.day}</span>` }))));
        }
        html += '</div>';

        const after = (res) => {
            if (!res.success) {
                game.ui.showNotification('🧭 Discoveries', res.message, 'error');
                return;
            }
            game.ui.updateStats(player, world);
            ActionMenu.showDiscoveries(game, res.message);
        };
        window._disc = {
            name: (id, i) => {
                const site = Discovery.get(player, id);
                after(Discovery.nameSite(player, world, id, site ? site.nameOptions[i] : null));
            },
            gather: (id) => after(Discovery.gather(player, world, id)),
            sell: (id) => after(Discovery.sellToArchive(player, world, id)),
            colony: (id) => after(Discovery.foundColony(player, world, id)),
            tribute: (id) => after(Discovery.payTribute(player, world, id)),
        };
        game.ui.showCustomPanel('🧭 Discoveries', html);
    },
});
