// ActionMenu — the Discoveries log (Journal → Discoveries): places on no map
// that the player has found or heard of, who found them, what is there,
// whether they are claimed, and what can be done about them from here —
// name, gather, sell the chart, found a colony, pay off a contest.
// Logic lives in systems/discovery.js; this panel presents it.
import { ActionMenu } from './_ref.js';
import { Discovery } from './_imports.js';
import { BTN_GOLD, BTN_DARK, CARD } from './uiKit.js';

const HEAD = 'font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin: 10px 0 4px;';

function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _claimText(world, site) {
    if (!site.claim) return '<span style="color:#9ab;">Unclaimed</span>';
    if (site.claim.by === 'player') return `<span style="color:#7fd07f;">Yours — colony of ${_esc(site.claim.colony ? site.claim.colony.name : '?')}</span>`;
    const k = world.getKingdom && world.getKingdom(site.claim.by);
    return `<span style="color:#e0b040;">Claimed by ${_esc(k ? k.name : site.claim.name || 'a realm')}</span>`;
}

function _siteCard(player, world, site) {
    const def = Discovery.kind(site.kind);
    let html = `<div style="${CARD}">`;
    html += `<div style="display:flex; justify-content:space-between; gap:8px;"><strong style="color:var(--gold); font-size:13px;">${def.icon} ${_esc(site.name)}</strong>`;
    html += `<span style="color:#aaa; white-space:nowrap; font-size:11px;">${_esc(def.label)} · (${site.q}, ${site.r})</span></div>`;
    const by = site.discovered
        ? (site.discovered.by === 'player' ? `Found by you on day ${site.discovered.day}` : `Found by ${_esc(site.discovered.byName)} on day ${site.discovered.day}`)
        : 'Not yet found';
    html += `<div style="font-size:11px; color:#999;">${by} · ${_claimText(world, site)}`;
    if (site.discovered && site.discovered.by === 'player') {
        html += site.knownBy.length
            ? ` · <span style="color:#c9a;">known to ${site.knownBy.map(id => _esc((world.getKingdom(id) || { name: id }).name)).join(', ')}</span>`
            : ' · <span style="color:#7fd07f;">your secret</span>';
    }
    html += '</div>';
    const features = Discovery.describeFeatures(site);
    html += `<div style="font-size:12px; color:#ddd; margin-top:4px;">${features.length ? features.map(_esc).join(' · ') : 'Nothing of note.'}</div>`;
    if (site.features.goods.length && site.discovered) {
        const stock = site.features.goods.map(g => `${(Discovery.good(g) || {}).icon || ''} ${site.stock[g] || 0}`).join('  ');
        html += `<div style="font-size:11px; color:#aaa;">Ready to gather: ${stock}</div>`;
    }
    if (site.contest) {
        html += `<div style="font-size:11px; color:#e08080; margin-top:4px;">⚔️ ${_esc(site.contest.kingdomName)} contests your claim — their ships (≈${site.contest.fleet}) come on day ${site.contest.deadline}.</div>`;
        html += `<button onclick="window._disc.tribute('${site.id}')" style="${BTN_DARK}">💰 Pay ${site.contest.tribute}g to renounce it</button>`;
    }

    // Naming
    if (site.naming) {
        html += `<div style="${HEAD} color:var(--gold);">Name your discovery</div>`;
        site.nameOptions.forEach((n, i) => {
            html += `<button onclick="window._disc.name('${site.id}', ${i})" style="${n === site.name ? BTN_GOLD : BTN_DARK}">${_esc(n)}</button>`;
        });
        html += `<div style="font-size:10px; color:#888;">Unnamed by day ${site.naming.untilDay}, it keeps the first.</div>`;
    }

    // What can be done from here
    const acts = [];
    if (!Discovery.gatherReason(player, world, site)) acts.push(`<button onclick="window._disc.gather('${site.id}')" style="${BTN_GOLD}">🧺 Gather</button>`);
    const offer = Discovery.archiveOffer(player, world, site);
    if (!offer.reason) acts.push(`<button onclick="window._disc.sell('${site.id}')" style="${BTN_GOLD}">📜 Sell chart to ${_esc(offer.kingdom.name)} (${offer.price}g)</button>`);
    const colonyWhy = Discovery.colonyReason(player, world, site);
    if (!colonyWhy) acts.push(`<button onclick="window._disc.colony('${site.id}')" style="${BTN_GOLD}">🏕️ Found a colony here</button>`);
    if (acts.length) html += `<div style="margin-top:4px;">${acts.join('')}</div>`;
    html += '</div>';
    return html;
}

Object.assign(ActionMenu, {
    /** Journal → Discoveries: places found and heard of, and what can be done about them. */
    showDiscoveries(game, message = null) {
        const player = game.player;
        const world = game.world;
        const j = Discovery.journal(player);
        let html = '<div style="max-height: 560px; overflow-y: auto; font-size: 12px;">';
        if (message) html += `<div style="${CARD} border-color: rgba(245,197,66,0.4); color:#eee;">${_esc(message)}</div>`;
        html += '<p style="margin:0 0 6px; color:var(--text-secondary);">Some places are on no map. Sail far from the ports, explore the open sea, follow rumours from tavern notice boards and old maps — before the other adventurers do. The finder names a place; its chart can be sold to a realm\'s archive or kept secret; a colony there keeps its riches for you.</p>';
        html += `<div style="font-size:11px; color:#aaa;">Found ${j.stats.found} · named ${j.stats.named} · charts sold ${j.stats.sold} · gathered ${j.stats.gathered} · rivals' finds ${j.stats.rivalFinds} · still uncharted: ${j.uncharted}</div>`;

        html += `<div style="${HEAD} color: var(--gold);">Known Places</div>`;
        if (!j.known.length) html += `<div style="${CARD} color:#999;">You know of no uncharted places yet.</div>`;
        for (const s of j.known) html += _siteCard(player, world, s);

        if (j.hinted.length) {
            html += `<div style="${HEAD} color:#9ab;">Rumours & Charts</div>`;
            for (const s of j.hinted) {
                const def = Discovery.kind(s.kind);
                const where = s.hint === 'charted' ? `charted at (${s.q}, ${s.r})` : `somewhere within ${s.hintRadius} leagues of (${s.hintQ}, ${s.hintR})`;
                html += `<div style="${CARD}">${s.hint === 'charted' ? '📜' : '🗣️'} A ${_esc(def.label.toLowerCase())}, ${where}. ${def.icon}<div style="font-size:10px; color:#888;">Sail there (Board Ship → Voyage → Expeditions) or walk there to find it.</div></div>`;
            }
        }
        if (j.log.length) {
            html += `<div style="${HEAD} color:#999;">Log</div>`;
            for (const e of j.log) html += `<div style="font-size:11px; color:#bbb; padding:2px 0;">${e.icon} <span style="color:#777;">day ${e.day}</span> ${_esc(e.text)}</div>`;
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
