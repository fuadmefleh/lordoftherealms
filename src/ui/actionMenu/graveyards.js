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
import { Burials } from '../../world/burials.js';
import { esc, lede, bullets, card, chips, rowList, sectionHead, more } from './uiKit.js';

// In the action menu's voice (ui/actionMenu/uiKit.js): a card a place, one row
// a thing to do with its price at the right; the trade's fine print in titles.
const NOTE = 'font-size: 11px; color: var(--text-secondary);';

/** A gravesAct row: data-am-act="gravesAct" data-am-args=[op, q, r, ...]. */
function opRow(o, args) {
    return { ...o, act: 'gravesAct', args };
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
    const facts = [
        `${v.freeInTown} free in town in all`,
        `${v.deathsPerYear} deaths a year`,
        `a 25-year plot ${v.parish}g at the parish (${v.scarcity >= 1.2 ? 'dear' : v.scarcity <= 0.8 ? 'cheap' : 'the usual'}, ×${v.scarcity})`,
    ];
    if (v.expired) facts.push(`${v.expired} lease${v.expired === 1 ? '' : 's'} run out`);
    if (v.pit) facts.push(`<span style="color:#e08080;">${v.pit} in the common pit</span>`);
    if (v.opened) facts.push(`new ground opened ${v.opened}×`);
    let html = card(`<div style="${NOTE}">${facts.join(' · ')}</div>`, {
        icon: '⛪', title: `The churchyard of ${esc(s.name)}`, side: `${v.used}/${v.cap} plots${v.full ? ', full' : ''}`, tone: v.full ? 'warn' : null,
    });
    html += chips([['🦴', 'Charnel', `${v.charnel} sets`], ['💰', 'Town purse', `${v.purse}g`], { icon: '🌾', label: 'Soil', value: v.soil.toFixed(2), cls: '' }]);
    const rows = [];
    const pay = Math.round(Number(GraveBook.byType(C.gravedigger.payPerGrave, s.type)) || 4);
    rows.push(opRow({
        icon: '⛏️', name: 'Dig graves for the sexton', desc: `Up to ${C.gravedigger.maxPerDay} a day, paid from the town's purse. Hard work.`,
        off: !(v.digWork > 0), why: 'No graves want digging today.', side: v.digWork > 0 ? `${pay}g each · ${v.digWork} waiting` : '',
    }, ['dig', s.q, s.r]));
    const bones = Math.floor(Number(player.inventory && player.inventory.bones) || 0);
    const meal = Math.floor(Number(player.inventory && player.inventory.bone_meal) || 0);
    if (v.charnel > 0) rows.push(opRow({ icon: '🦴', name: 'Buy five sets of bones from the charnel', desc: 'Into the town\'s purse', side: `${C.bones.charnelPrice}g a set` }, ['buyBones', s.q, s.r, 5]));
    if (bones) {
        rows.push(opRow({ icon: '🕯️', name: `Give your ${bones} bones to the charnel`, desc: 'No coin: the town thinks the better of you' }, ['giveBones', s.q, s.r, bones]));
        if (v.bonePrice != null) rows.push(opRow({ icon: '💰', name: `Sell your ${bones} bones to the bone-grinder`, desc: 'Paid from the town\'s purse; the more you sell, the less each fetches', side: `${v.bonePrice}g a set`, tone: 'gold' }, ['sellBones', s.q, s.r, bones]));
    }
    if (meal) rows.push(opRow({ icon: '🌾', name: `Sell ${meal} bone meal to the farmers`, desc: 'Their fields the richer at the next harvest', side: `~${v.mealPrice}g each`, tone: 'gold' }, ['sellMeal', s.q, s.r, meal]));
    html += rowList(rows);
    // Lots of yours here to put to the trade
    const lots = freeLotsHere(game, s);
    if (lots.length) {
        const fee = Graveyards.consecrateFee(s);
        const mc = Math.round(Number(GraveBook.byType(C.mill.cost, s.type)) || 0);
        const oc = Math.round(Number(GraveBook.byType(C.ossuary.cost, s.type)) || 0);
        for (const l of lots) {
            const plots = l.w ? GraveBook.plotCount(l.w, l.h) : '?';
            html += rowList([
                opRow({ icon: '⛪', name: 'Consecrate it as a burial ground', desc: `The priest's blessing: ${plots} plots to lease to the town's families`, side: `${fee}g`, tone: 'gold' }, ['consecrate', s.q, s.r, l.id]),
                opRow({ icon: '🦴', name: 'Build a bone mill', desc: 'Grinds bones into meal for the farms', side: `${mc}g + wood, stone` }, ['buildMill', s.q, s.r, l.id]),
                opRow({ icon: '⚱️', name: 'Build an ossuary shrine', desc: 'The town\'s people pay to pray for their dead', side: `${oc}g + stone, ${C.ossuary.foundBones} bones` }, ['buildOssuary', s.q, s.r, l.id]),
            ], `📜 Your empty lot ${esc(String(l.id).replace(/^lot/, '#'))}${l.w ? ` (${l.w}×${l.h})` : ''}`);
        }
    }
    return html;
}

function siteCard(game, v) {
    const { player } = game;
    const here = player.q === v.q && player.r === v.r;
    const args = (op, ...rest) => [op, v.q, v.r, v.lot, ...rest];
    const where = `${esc(v.town)}${here ? ' (here)' : ''}`;
    const going = v.ready ? '' : ' · going up';
    const bones = Math.floor(Number(player.inventory && player.inventory.bones) || 0);
    if (v.kind === 'ground') {
        const g = v.ground;
        let body = `<div style="${NOTE}">${g.free} free · the parish asks ${v.parish}g for 25 years${g.crypt ? ` · family crypt ${g.crypt.used}/${g.crypt.holds}` : ''}</div>`;
        body += `<div style="${NOTE}">A family pays: ${v.prices.map(p => `${termName(p.term)} ${p.price}g`).join(', ')}</div>`;
        let html = card(body, { icon: '⛪', title: `Your burial ground · ${where}`, side: `${g.used}/${g.cap} plots${g.open ? '' : ' · being blessed'}` });
        const POLICY = { cheap: 'Undercut the parish: more burials, less each', fair: 'The going rate', dear: 'Fewer burials, more each; when the churchyard is full they come anyway' };
        const rows = ['cheap', 'fair', 'dear'].map(p => (p === g.policy
            ? { icon: '●', name: `Priced ${p}`, desc: POLICY[p], side: 'now', tone: 'gold' }
            : opRow({ icon: '○', name: `Price it ${p}`, desc: POLICY[p] }, args('policy', p))));
        if (!g.crypt) rows.push(opRow({ icon: '🏛️', name: 'Raise a family crypt', desc: 'At the back of the ground: your own dead lie there, eight to a crypt' }, args('crypt')));
        const lapsed = v.graves.filter(x => x.expired && !x.kin);
        for (const x of lapsed.slice(0, 6)) rows.push(opRow({ icon: '⚰️', name: `Clear ${esc(x.name)}'s grave`, desc: `The lease ran out. The sexton's fee to the town; the bones${x.goods ? ' and grave goods' : ''} to you.` }, args('clear', x.i)));
        html += rowList(rows);
        if (lapsed.length > 6) html += `<div style="${NOTE}">…and ${lapsed.length - 6} more leases run out.</div>`;
        const resting = v.graves.filter(x => !x.expired).slice(0, 5);
        if (resting.length) html += `<div style="${NOTE}">Lying here: ${resting.map(x => esc(x.name)).join(', ')}${v.graves.length > 5 ? '…' : ''}</div>`;
        return html;
    }
    if (v.kind === 'mill') {
        let html = card(`<div style="${NOTE}">Grinds ${GraveBook.config().mill.grindPerDay} sets a day</div>`, { icon: '🦴', title: `Your bone mill · ${where}`, side: `${Math.floor(v.hopper || 0)} in the hopper · ${Math.floor(v.meal || 0)} meal${going}` });
        if (here) {
            html += rowList([
                bones ? opRow({ icon: '🦴', name: `Tip in your ${bones} bones` }, args('load', bones)) : null,
                (v.meal || 0) >= 1 ? opRow({ icon: '🌾', name: `Bag the meal (${Math.floor(v.meal)})`, tone: 'gold' }, args('collect')) : null,
            ]);
        }
        return html;
    }
    if (v.kind === 'ossuary') {
        let html = card(`<div style="${NOTE}">One visitor a day for every ${GraveBook.config().ossuary.bonesPerVisitor} sets laid in</div>`, { icon: '⚱️', title: `Your ossuary shrine · ${where}`, side: `${Math.floor(v.bones || 0)} sets · ${Math.floor(v.visitors || 0)} visitors${going}` });
        if (here && bones) html += rowList([opRow({ icon: '🦴', name: `Lay in your ${bones} bones` }, args('lay', bones))]);
        return html;
    }
    return '';
}

function kinCard(game, s, k) {
    const { player, world } = game;
    let html = card(s ? '' : `<div style="${NOTE}">Go to a town to lay them to rest.</div>`, { icon: '🕯️', title: esc(k.name), side: `your ${esc(k.rel || 'kin')}${k.cause ? `, taken by ${esc(k.cause)}` : ''}` });
    const rows = [];
    if (s) {
        const grounds = GraveBook.grounds(s).filter(g => g.owner === 'town' || g.owner === 'player');
        for (const g of grounds) {
            const markers = [...(GraveBook.config().kinMarkers || [])];
            if (g.crypt) markers.push('crypt');
            const where = g.owner === 'town' ? 'the churchyard' : 'your ground';
            let any = false;
            for (const m of markers) {
                const q = Graveyards.kinQuote(player, world, s, g.id, m);
                if (!q.ok) continue;
                any = true;
                const name = m === 'crypt' ? 'In the crypt' : esc((GraveBook.markerDef(m) || {}).name || m);
                rows.push(opRow({
                    icon: '⚰️', name: `Bury them — ${name}`, desc: `In ${where}: coffin and marker ${q.goodsCost}g of the town's planks${q.mason ? `, the mason ${q.mason}g` : ''}${q.fee ? `, the parish ${q.fee}g` : ''}`,
                    side: `${q.total}g`, tone: 'gold',
                }, ['buryKin', s.q, s.r, k.key, g.id, m]));
            }
            if (!any) rows.push({ icon: '⚰️', name: `Bury them in ${where}`, off: true, why: 'No room, or not the stores for it' });
        }
    }
    rows.push(opRow({ icon: '🙏', name: 'Leave them to the parish', desc: 'A pauper\'s grave, and no more on your mind', tone: 'bad' }, ['dismissKin', player.q, player.r, k.key]));
    return html + rowList(rows);
}

/** Where the player has put things in the ground: their own burials and caches, by place (world/burials.js). */
function hiddenCard(game) {
    const { world } = game;
    const day = world.day || 0;
    const where = (hex, q, r) => {
        const [wq, wr] = String(hex).split(',').map(Number);
        const t = world.getTile && world.getTile(wq, wr);
        return `${t && t.settlement ? esc(t.settlement.name) : `the wilds (${wq}, ${wr})`}, at ${q},${r}`;
    };
    const rows = [];
    for (const { hex, q, r, grave } of Burials.burials(world)) {
        const state = grave.open != null ? ' — <span style="color:#e0a080;">dug open</span>' : grave.robbed != null ? ' — <span style="color:#e0a080;">robbed</span>' : '';
        const goods = grave.goods && !Burials.isEmpty(grave.goods) ? `, with ${esc(Burials.describe(grave.goods))}` : '';
        rows.push(`<div style="${NOTE}">⚰️ ${esc(Burials.label(grave, day))}${grave.name ? ` (${esc(grave.name)})` : ''}${goods} — ${where(hex, q, r)}${state}</div>`);
    }
    for (const { hex, q, r, cache } of Burials.caches(world)) {
        const seen = (cache.seen || []).length ? ` <span style="color:#e0a080;">(${esc(cache.seen.map(w => w.name).join(', '))} saw you)</span>` : '';
        rows.push(`<div style="${NOTE}">📦 ${cache.open ? 'In an open hole' : 'Buried'}: ${esc(Burials.isEmpty(cache) ? 'something' : Burials.describe(cache))} — ${where(hex, q, r)}${seen}</div>`);
    }
    if (!rows.length) return '';
    return more(`🕳️ What you have put in the ground (${rows.length})`, rows.join(''));
}

Object.assign(ActionMenu, {
    /** Graveyards & the Dead: the town's churchyard, the bone trade, your grounds and works, your own dead. */
    showGraveyards(game, message = null) {
        const { world, player } = game;
        const s = hereTown(game);
        let html = '<div style="font-size:12px;">';
        if (message) html += card(esc(message.text), { tone: message.ok ? 'good' : 'bad' });
        const kin = Graveyards.kinWaiting(player);
        // Your own dead first: they are why most come here
        if (kin.length) {
            html += sectionHead('🕯️ Your dead, awaiting burial');
            for (const k of kin) html += kinCard(game, s, k);
        }
        if (s) html += townCard(game, s);
        // A rival House's crypt, where this is its seat (ui/actionMenu/profane.js)
        if (s && ActionMenu._profaneCryptHtml) html += ActionMenu._profaneCryptHtml(game);
        const sites = Graveyards.sitesView(world, player);
        html += sectionHead('⚰️ Your grounds & works');
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
        html += hiddenCard(game);
        html += '</div>';
        game.ui.showCustomPanel('⚰️ Graveyards & the Dead', html);
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
