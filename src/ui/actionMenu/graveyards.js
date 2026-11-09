// ActionMenu — Graveyards & the Dead (systems/graveyards.js): the town's
// churchyard (how full, what a plot costs, the charnel house, the sexton's
// work), the trade in bones (the charnel house, a city's bone-grinder, the
// farmers' bone meal), the lots of yours here that could be consecrated or
// built on (a bone mill, an ossuary shrine), every burial ground, mill and
// ossuary you hold (prices, leases run out, the crypt, the hopper), and your
// own dead awaiting burial. Opened from the town's action menu ('graveyards')
// and from a grave on the town map (ui/innerMapGraves.js). Buttons route
// through data-am-act → gravesAct.
import { ActionMenu } from './_ref.js';
import { Graveyards } from '../../systems/graveyards.js';
import { GraveBook } from '../../world/graveBook.js';
import { LotBook } from '../../world/lotBook.js';
import { OddJobs } from '../../player/oddJobs.js';
import { InnerMap } from '../../world/innerMap.js';
import { BTN_GOLD, BTN_PLAIN, BTN_RED, CARD, esc, lede, bullets } from './uiKit.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';
const H = 'font-weight:bold; color:var(--gold); margin:8px 0 3px;';

function act(label, args, style = BTN_PLAIN, title = '') {
    return `<button data-am-act="gravesAct" data-am-args='${esc(JSON.stringify(args))}' style="${style}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
}

function termName(id) {
    const t = GraveBook.term(id);
    return t ? t.name : id;
}

function hereTown(game) {
    const t = game.world.getTile(game.player.q, game.player.r);
    return (t && t.settlement) || null;
}

/** The lots of the player's in this town with nothing on them yet: [{ id, w, h }]. */
function freeLotsHere(game, s) {
    const known = (s.lotBook && s.lotBook.known && s.lotBook.known.lots) || [];
    const out = [];
    for (const h of game.player.lotHoldings || []) {
        if (h.kind !== 'lot' || h.q !== s.q || h.r !== s.r) continue;
        const rec = LotBook.lot(s, h.id);
        if (!LotBook.isPlayer(rec) || rec.built) continue;
        const dims = known.find(l => l.id === h.id);
        out.push({ id: h.id, w: dims ? dims.w : null, h: dims ? dims.h : null });
    }
    return out;
}

function townCard(game, s) {
    const { player, world } = game;
    const v = Graveyards.townView(world, s);
    const C = GraveBook.config();
    let html = `<div style="${CARD}">`;
    html += `<div style="font-weight:bold; color:var(--gold);">⛪ The Churchyard of ${esc(s.name)}</div>`;
    const facts = [
        `${v.used} of ${v.cap} plots taken${v.full ? ' — <span style="color:#e0a080;">full</span>' : ''}`,
        `${v.freeInTown} free in town in all`,
        `${v.deathsPerYear} deaths a year`,
        `a 25-year plot ${v.parish}g at the parish (plots ${v.scarcity >= 1.2 ? 'dear' : v.scarcity <= 0.8 ? 'cheap' : 'at the usual'}: ×${v.scarcity})`,
    ];
    if (v.expired) facts.push(`${v.expired} lease${v.expired === 1 ? '' : 's'} run out`);
    if (v.pit) facts.push(`<span style="color:#e08080;">${v.pit} in the common pit</span>`);
    if (v.opened) facts.push(`new ground opened ${v.opened}×`);
    html += `<div style="${NOTE}">${facts.join(' · ')}</div>`;
    html += `<div style="${NOTE}">Charnel house: ${v.charnel} sets of bones · Town purse ${v.purse}g · Soil ${v.soil.toFixed(2)}</div>`;
    const btns = [];
    const pay = Math.round(Number(GraveBook.byType(C.gravedigger.payPerGrave, s.type)) || 4);
    if (v.digWork > 0) btns.push(act(`⛏️ Dig Graves for the Sexton (${v.digWork} waiting, ${pay}g each)`, ['dig', s.q, s.r], BTN_GOLD, `Up to ${C.gravedigger.maxPerDay} a day, paid from the town's purse. Hard work.`));
    else btns.push(`<span style="${NOTE}">No graves want digging today.</span>`);
    const bones = Math.floor(Number(player.inventory && player.inventory.bones) || 0);
    const meal = Math.floor(Number(player.inventory && player.inventory.bone_meal) || 0);
    if (v.charnel > 0) btns.push(act(`🦴 Buy Bones from the Charnel (${C.bones.charnelPrice}g a set)`, ['buyBones', s.q, s.r, 5], BTN_PLAIN, 'Five sets, into the town\'s purse'));
    if (bones) {
        btns.push(act(`🕯️ Give Your ${bones} Bones to the Charnel`, ['giveBones', s.q, s.r, bones], BTN_PLAIN, 'No coin: the town thinks the better of you'));
        if (v.bonePrice != null) btns.push(act(`💰 Sell Bones to the Bone-Grinder (${v.bonePrice}g a set)`, ['sellBones', s.q, s.r, bones], BTN_GOLD, 'Paid from the town\'s purse; the more you sell, the less each fetches. He grinds them for the farms.'));
    }
    if (meal) btns.push(act(`🌾 Sell ${meal} Bone Meal to the Farmers (~${v.mealPrice}g each)`, ['sellMeal', s.q, s.r, meal], BTN_GOLD, 'Their fields the richer: next harvest\'s yields follow the soil'));
    html += `<div style="margin-top:4px;">${btns.join('')}</div>`;
    // Lots of yours here to put to the trade
    const lots = freeLotsHere(game, s);
    if (lots.length) {
        const fee = Graveyards.consecrateFee(s);
        const mc = Math.round(Number(GraveBook.byType(C.mill.cost, s.type)) || 0);
        const oc = Math.round(Number(GraveBook.byType(C.ossuary.cost, s.type)) || 0);
        for (const l of lots) {
            const plots = l.w ? GraveBook.plotCount(l.w, l.h) : '?';
            html += `<div style="${NOTE} margin-top:6px;">📜 Your empty lot ${esc(String(l.id).replace(/^lot/, '#'))}${l.w ? ` (${l.w}×${l.h})` : ''}:</div><div>`;
            html += act(`⛪ Consecrate as a Burial Ground (${fee}g)`, ['consecrate', s.q, s.r, l.id], BTN_GOLD, `The priest's blessing, a fee to the temple: ${plots} plots to lease to the town's families`);
            html += act(`🦴 Build a Bone Mill (${mc}g + wood & stone)`, ['buildMill', s.q, s.r, l.id], BTN_PLAIN, 'Grinds bones into bone meal for the farms');
            html += act(`⚱️ Build an Ossuary Shrine (${oc}g + stone, ${C.ossuary.foundBones} bones)`, ['buildOssuary', s.q, s.r, l.id], BTN_PLAIN, 'The town\'s people pay to pray for their dead');
            html += '</div>';
        }
    }
    html += '</div>';
    return html;
}

function siteCard(game, v) {
    const { player } = game;
    const here = player.q === v.q && player.r === v.r;
    const args = (op, ...rest) => [op, v.q, v.r, v.lot, ...rest];
    let html = `<div style="${CARD}">`;
    const ready = v.ready ? '' : ` <span style="color:#f5c542;">(going up)</span>`;
    if (v.kind === 'ground') {
        const g = v.ground;
        html += `<div style="font-weight:bold; color:var(--gold);">⛪ Your Burial Ground <span style="font-weight:normal; color:#aaa;">· ${esc(v.town)}${here ? ' (here)' : ''}</span>${g.open ? '' : ' <span style="color:#f5c542;">(being blessed)</span>'}</div>`;
        html += `<div style="${NOTE}">${g.used} of ${g.cap} plots taken · ${g.free} free · priced <b>${g.policy}</b> · the parish asks ${v.parish}g for 25 years${g.crypt ? ` · family crypt ${g.crypt.used}/${g.crypt.holds}` : ''}</div>`;
        html += `<div style="${NOTE}">A family pays: ${v.prices.map(p => `${termName(p.term)} ${p.price}g`).join(', ')}</div>`;
        html += '<div style="margin-top:3px;">';
        for (const p of ['cheap', 'fair', 'dear']) html += act(p === g.policy ? `● ${p}` : p, args('policy', p), p === g.policy ? BTN_GOLD : BTN_PLAIN, p === 'cheap' ? 'Undercut the parish: more burials, less each' : p === 'dear' ? 'Fewer burials, more each — when the churchyard is full they come anyway' : 'The going rate');
        if (!g.crypt) html += act('🏛️ Raise a Family Crypt', args('crypt'), BTN_PLAIN, 'At the back of the ground: your own dead lie there, eight to a crypt');
        html += '</div>';
        const lapsed = v.graves.filter(x => x.expired && !x.kin);
        if (lapsed.length) {
            html += `<div style="${NOTE} margin-top:4px;">Leases run out:</div>`;
            for (const x of lapsed.slice(0, 6)) html += `<div style="${NOTE}">🪦 ${esc(x.name)}${x.goods ? ` (grave goods)` : ''} ${act('👷 Sexton: clear it', args('clear', x.i), BTN_PLAIN, 'His fee to the town; the bones (and goods) to you')}</div>`;
            if (lapsed.length > 6) html += `<div style="${NOTE}">…and ${lapsed.length - 6} more.</div>`;
        }
        const resting = v.graves.filter(x => !x.expired).slice(0, 5);
        if (resting.length) html += `<div style="${NOTE} margin-top:3px;">Lying here: ${resting.map(x => esc(x.name)).join(', ')}${v.graves.length > 5 ? '…' : ''}</div>`;
    } else if (v.kind === 'mill') {
        html += `<div style="font-weight:bold; color:var(--gold);">🦴 Your Bone Mill <span style="font-weight:normal; color:#aaa;">· ${esc(v.town)}${here ? ' (here)' : ''}</span>${ready}</div>`;
        html += `<div style="${NOTE}">Hopper: ${Math.floor(v.hopper || 0)} sets of bones · Ground: ${Math.floor(v.meal || 0)} bone meal · grinds ${GraveBook.config().mill.grindPerDay} a day</div>`;
        const bones = Math.floor(Number(player.inventory && player.inventory.bones) || 0);
        if (here) {
            html += '<div>';
            if (bones) html += act(`🦴 Tip In Your ${bones} Bones`, args('load', bones), BTN_GOLD);
            if ((v.meal || 0) >= 1) html += act(`🌾 Bag the Meal (${Math.floor(v.meal)})`, args('collect'), BTN_GOLD);
            html += '</div>';
        }
    } else if (v.kind === 'ossuary') {
        html += `<div style="font-weight:bold; color:var(--gold);">⚱️ Your Ossuary Shrine <span style="font-weight:normal; color:#aaa;">· ${esc(v.town)}${here ? ' (here)' : ''}</span>${ready}</div>`;
        html += `<div style="${NOTE}">${Math.floor(v.bones || 0)} sets of bones laid in · ${Math.floor(v.visitors || 0)} visitors so far (one for every ${GraveBook.config().ossuary.bonesPerVisitor} sets, a day)</div>`;
        const bones = Math.floor(Number(player.inventory && player.inventory.bones) || 0);
        if (here && bones) html += `<div>${act(`🦴 Lay In Your ${bones} Bones`, args('lay', bones), BTN_GOLD)}</div>`;
    }
    html += '</div>';
    return html;
}

function kinCard(game, s, k) {
    const { player, world } = game;
    let html = `<div style="${CARD}"><div style="font-weight:bold; color:var(--gold);">🕯️ ${esc(k.name)} <span style="font-weight:normal; color:#aaa;">· your ${esc(k.rel || 'kin')}${k.cause ? `, taken by ${esc(k.cause)}` : ''}</span></div>`;
    if (!s) {
        html += `<div style="${NOTE}">Go to a town to lay them to rest.</div>`;
    } else {
        const grounds = GraveBook.grounds(s).filter(g => g.owner === 'town' || g.owner === 'player');
        for (const g of grounds) {
            const btns = [];
            const markers = [...(GraveBook.config().kinMarkers || [])];
            if (g.crypt) markers.push('crypt');
            for (const m of markers) {
                const q = Graveyards.kinQuote(player, world, s, g.id, m);
                if (!q.ok) continue;
                const name = m === 'crypt' ? 'In the Crypt' : (GraveBook.markerDef(m) || {}).name || m;
                btns.push(act(`${name} (${q.total}g)`, ['buryKin', s.q, s.r, k.key, g.id, m], BTN_PLAIN, `Coffin and marker ${q.goodsCost}g of the town's planks${m !== 'crypt' ? ' and stone/wood' : ''}${q.mason ? `, the mason ${q.mason}g` : ''}${q.fee ? `, the parish ${q.fee}g` : ''}`));
            }
            html += `<div style="${NOTE} margin-top:3px;">${g.owner === 'town' ? 'The churchyard' : 'Your ground'}:</div><div>${btns.length ? btns.join('') : `<span style="${NOTE}">no room, or not the stores for it</span>`}</div>`;
        }
    }
    html += `<div>${act('Leave them to the parish', ['dismissKin', player.q, player.r, k.key], BTN_RED)}</div></div>`;
    return html;
}

Object.assign(ActionMenu, {
    /** Graveyards & the Dead: the town's churchyard, the bone trade, your grounds and works, your own dead. */
    showGraveyards(game, message = null) {
        const { world, player } = game;
        const s = hereTown(game);
        let html = '<div style="font-size:12px; max-height:560px; overflow-y:auto;">';
        if (message) html += `<div style="${CARD} border-color:${message.ok ? 'rgba(159,216,159,0.5)' : 'rgba(224,128,128,0.5)'};">${esc(message.text)}</div>`;
        if (s) html += townCard(game, s);
        const kin = Graveyards.kinWaiting(player);
        if (kin.length) {
            html += `<div style="${H}">🕯️ Your Dead, Awaiting Burial</div>`;
            for (const k of kin) html += kinCard(game, s, k);
        }
        const sites = Graveyards.sitesView(world, player);
        html += `<div style="${H}">⚰️ Your Grounds & Works</div>`;
        if (!sites.length) {
            html += lede('You hold no burial ground, bone mill or ossuary.') + bullets([
                'Buy a building lot in town, then consecrate it here: the town\'s families lease its plots.',
                'When a lease runs out unrenewed, clear the grave: the bones are yours.',
                'Bones go to the charnel house, a city\'s bone-grinder, your own bone mill (meal for the farms) or an ossuary shrine.',
            ]);
        } else {
            const b = player.graves && player.graves.book;
            if (b) html += `<div style="${NOTE}">All told: ${Math.round(b.leases || 0)}g in leases, ${Math.round(b.visits || 0)}g from visitors, ${b.bones || 0} graves cleared, ${b.meal || 0} meal ground, ${b.dug || 0} graves dug for the sexton.</div>`;
            const here = sites.filter(v => v.q === player.q && v.r === player.r);
            const away = sites.filter(v => !(v.q === player.q && v.r === player.r));
            for (const v of here.concat(away)) html += siteCard(game, v);
        }
        html += '</div>';
        game.ui.showCustomPanel('🪦 Graveyards & the Dead', html);
    },

    /** Every button on the panel: op, the town (q, r), then its own arguments. */
    gravesAct(game, op, q, r, ...rest) {
        const { world, player } = game;
        const t = world.getTile(q, r);
        const s = t && t.settlement;
        if (op === 'dismissKin') {
            const r0 = Graveyards.dismissKin(player, rest[0]);
            ActionMenu.showGraveyards(game, { ok: true, text: r0.text });
            return;
        }
        if (!s) return;
        let res;
        switch (op) {
            case 'dig': {
                res = Graveyards.workAsGravedigger(player, world, s);
                if (res.success) {
                    // A day with the spade builds the arm (player/oddJobs.js)
                    OddJobs.train(player, { stat: 'strength', difficulty: 4, practice: { endurance: 4 } }, 70);
                }
                break;
            }
            case 'buyBones': res = Graveyards.buyCharnelBones(player, world, s, rest[0]); break;
            case 'giveBones': res = Graveyards.giveBones(player, world, s, rest[0]); break;
            case 'sellBones': res = Graveyards.sellBones(player, world, s, rest[0]); break;
            case 'sellMeal': res = Graveyards.sellMeal(player, world, s, rest[0]); break;
            case 'consecrate': res = Graveyards.consecrate(player, world, s, rest[0]); break;
            case 'buildMill': res = Graveyards.buildMill(player, world, s, rest[0]); break;
            case 'buildOssuary': res = Graveyards.buildOssuary(player, world, s, rest[0]); break;
            case 'policy': res = Graveyards.setPolicy(player, world, s, rest[0], rest[1]); break;
            case 'crypt': res = Graveyards.raiseCrypt(player, world, s, rest[0]); break;
            case 'clear': res = Graveyards.clearPlot(player, world, s, rest[0], rest[1], 'sexton'); break;
            case 'load': res = Graveyards.loadMill(player, world, s, rest[0], rest[1]); break;
            case 'collect': res = Graveyards.collectMeal(player, world, s, rest[0]); break;
            case 'lay': res = Graveyards.layBones(player, world, s, rest[0], rest[1]); break;
            case 'buryKin': res = Graveyards.buryKin(player, world, s, rest[0], rest[1], rest[2]); break;
            default: return;
        }
        if (res.success && game.ui.updateStats) game.ui.updateStats(player, world);
        if (InnerMap.active && InnerMap.refreshGraves) InnerMap.refreshGraves(world);
        ActionMenu.showGraveyards(game, { ok: !!res.success, text: res.success ? res.text : res.reason });
    },
});
