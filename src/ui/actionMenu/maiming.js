// ActionMenu — the knife (systems/maiming.js, systems/maimMarks.js).
//   showMaiming       "The Knife": your own body and the aids you wear, those in
//                     your power (the lords of your court, your own blood, the
//                     old line's pretender, a captive in your cellar, an outlaw
//                     taken for a bounty), what you have done, the name it left.
//                     Reached from Intrigue & the Law ('maiming') and the
//                     Faith & Healing folder ('maim_aids' when you are maimed).
//   showMaimTarget    the acts for one of them, with what each would cost.
//   showMaimAids      the aids this town's craftsmen can make you.
//   rivalCaptiveAct   ransom or release a rival House's child you took (systems/rivalCaptives.js).
//   rivalSeizeAct     seize a rival's child under guest-right (their retinue here; your table today).
//   streetMaimAct     a row of the street map's "Maim Them…" panel (ui/innerMapMaiming.js).
import { ActionMenu } from './_ref.js';
import { Maiming } from '../../systems/maiming.js';
import { MaimMarks } from '../../systems/maimMarks.js';
import { Atrocities } from '../../systems/atrocities.js';
import { RivalCaptives } from '../../systems/rivalCaptives.js';
import { MaimFaith } from '../../systems/maimFaith.js';
import { InnerMapMaiming } from '../innerMapMaiming.js';
import { lede, chips, card, rowList, price, esc } from './uiKit.js';

const KIND_WORD = { vassal: 'Lords of your court', kin: 'Your own blood', pretender: 'The old royal line', captive: 'In your cellar', bounty: 'Taken for a bounty', rival: 'Blood of the rival Houses' };

/** The realm you stand in (or rule): how its faith takes the knife. */
function _faithChip(game) {
    const { player, world } = game;
    const t = world && typeof world.getTile === 'function' ? world.getTile(player.q, player.r) : null;
    const ruling = player.throne && player.throne.ruling;
    const kid = ruling && ruling.kingdomId != null ? ruling.kingdomId : t && t.settlement ? t.settlement.kingdom : player.allegiance;
    const f = MaimFaith.realmFaith(world, kid);
    if (!f) return null;
    const d = MaimFaith.def(MaimFaith.stanceOfFaith(f));
    return [d.icon || '⚖️', MaimFaith.faithName(f), d.label];
}

function _town(game) {
    const t = game.world && typeof game.world.getTile === 'function' ? game.world.getTile(game.player.q, game.player.r) : null;
    return (t && t.settlement) || null;
}

function _bodyCard(player) {
    if (!MaimMarks.any(player)) return '';
    const fx = MaimMarks.effects(player);
    const parts = [];
    for (const [k, v] of Object.entries(fx.attrs)) if (v) parts.push(`${k} −${v}`);
    for (const [k, v] of Object.entries(fx.skills)) if (v) parts.push(`${k} −${v}`);
    if (fx.movement) parts.push(`${fx.movement} hex${fx.movement === 1 ? '' : 'es'} a day slower`);
    if (fx.battle) parts.push(`fighting power −${Math.round(fx.battle * 100)}%`);
    const flags = [];
    if (MaimMarks.blind(player)) flags.push('you cannot read');
    else if (!MaimMarks.canWrite(player)) flags.push('you cannot write');
    if (MaimMarks.mute(player)) flags.push('you cannot speak');
    if (MaimMarks.gelded(player)) flags.push('you will father no children');
    const aids = Object.keys(MaimMarks.aids(player)).map(id => (MaimMarks.aid(id) || {}).name).filter(Boolean);
    return card(`<div>${esc(MaimMarks.looks(player) || MaimMarks.tag(player))}.</div>`
        + `<div style="font-size:11px;color:var(--text-secondary);margin-top:3px;">${esc(parts.join(', ') || 'No lasting cost')}${flags.length ? ` · ${esc(flags.join(', '))}` : ''}</div>`
        + (aids.length ? `<div style="font-size:11px;margin-top:3px;">Wearing: ${esc(aids.join(', '))}</div>` : ''),
    { icon: '🤕', title: 'Your body', side: esc(MaimMarks.tag(player)), tone: 'warn' });
}

Object.assign(ActionMenu, {
    /** The Knife: your body, those in your power, what you have done. */
    showMaiming(game, flash = '') {
        const { player, world } = game;
        const st = Maiming.state(player);
        const inf = Atrocities.infamy(player);
        let html = lede('A hand, an eye, the nose, the tongue. The old punishments, and the old politics: a blinded prince never rules. Whatever you take is carried for a lifetime, by them and by you.');
        html += chips([
            [inf.icon || '⚔️', 'Your name', esc(inf.label || 'unremarked')],
            ['⚔️', 'Cruelty', inf.butcher],
            ['🔪', 'Maimed by you', st.stats.total || 0],
        ].concat(_faithChip(game) ? [_faithChip(game)] : []));
        if (flash) html += card(esc(flash), { icon: '🔪', title: 'Done', tone: 'bad' });
        html += _bodyCard(player);
        if (MaimMarks.any(player)) html += rowList([{ icon: '🦵', name: 'Aids for your losses', desc: 'An eye patch, a hook, a wooden leg: made by a town\'s craftsmen', act: 'showMaimAids', side: '›' }]);
        const targets = Maiming.targets(player, world);
        const groups = {};
        for (const t of targets) (groups[t.kind] || (groups[t.kind] = [])).push(t);
        for (const [kind, list] of Object.entries(groups)) {
            html += rowList(list.map(t => ({
                icon: t.icon, name: esc(t.name), desc: esc(t.desc), side: '›', tone: t.lawful ? '' : 'warn',
                act: 'showMaimTarget', args: [t.kind, t.id], note: t.lawful ? 'The crown\'s justice' : '',
            })), `${KIND_WORD[kind] || kind}`);
        }
        // Within reach under guest-right: a rival's retinue here (a visit, an audience, your own table today)
        const reach = Object.values((player.house && player.house.rivals) || {}).map(r => RivalCaptives.seizeChance(player, world, r)).filter(x => x && !x.tried);
        if (reach.length) {
            html += rowList(reach.flatMap(sz => sz.can.map(c => ({
                icon: '⛓️', name: esc(`Seize ${c.firstName} of ${sz.rival.name}`), tone: 'bad',
                desc: esc(`${sz.feast ? 'At your table tonight' : 'Their retinue is here'}. Breaks guest-right: every House and realm hears of it.`),
                side: `${Math.round(sz.chance * 100)}%`, act: 'rivalSeizeAct', args: [sz.rival.kingdomId, c.firstName],
            }))), '🍷 Under your roof');
        }
        if (!targets.length) html += card('No one is in your power: a lord of your court, your own blood, a captive in your cellar, an outlaw you have taken, a child of a rival House taken when you beat their retinue. On the street, anyone you beat down or tie up.', { icon: '🛡️' });
        if (st.history.length) {
            html += rowList(st.history.slice(0, 10).map(h => ({
                icon: (MaimMarks.act(h.act) || {}).icon || '🔪', name: esc(h.name), desc: `${esc(MaimMarks._shortOf(h.act, h.n))}${h.place ? ` · ${esc(h.place)}` : ''} · day ${h.day}`,
                side: h.lawful ? 'Lawful' : h.seen ? 'Known' : 'Unseen', tone: h.lawful ? '' : 'bad',
            })), '📜 What you have done');
        }
        game.ui.showCustomPanel('🔪 The Knife', html);
    },

    /** The acts for one in your power. */
    showMaimTarget(game, kind, id, flash = '') {
        const { player, world } = game;
        const t = Maiming.targets(player, world).find(x => x.kind === kind && String(x.id) === String(id));
        if (!t) { ActionMenu.showMaiming(game, flash); return; }
        const she = t.gender === 'female';
        const He = she ? 'She' : 'He', his = she ? 'her' : 'his';
        const warn = {
            vassal: t.lawful ? `${He} is a rebel, or broken for one: the crown's justice. The other lords will be cowed.` : `${He} has done nothing the court can name. The lords will be cowed, and hate you; ${his} kin will want blood.`,
            kin: 'Your own blood. A child blinded, slit-nosed or gelded can never sit the seat. The household will know, and the realm will hear.',
            pretender: 'The old way to end a claim: no one so marked may wear a crown. Every court will hear of it.',
            captive: 'No one sees it done in the dark. If they ever go free, they will tell.',
            bounty: 'The magistrate pays the same for what is left; a sword you take into your company fights as what is left.',
            rival: `${t.ward ? `Raised under your roof, kept as a hostage: to do it is to break guest-right.` : `While you hold ${his === 'her' ? 'her' : 'him'} whole, ${t.house} dares not strike at you.`} Maim ${his === 'her' ? 'her' : 'him'} and ${t.house} is your blood enemy; a blinded, slit-nosed, tongueless, gelded or handless heir can never head it. Every House will hear.`,
        }[kind] || '';
        let html = lede(`${esc(t.name)}: ${esc(t.desc)}.`);
        if (flash) html += card(esc(flash), { icon: '🔪', title: 'Done', tone: 'bad' });
        html += card(esc(warn), { icon: t.icon, tone: t.lawful ? '' : 'bad' });
        // (a claimant is blinded outright: both eyes at once, Maiming.maimPretender)
        const blindAll = kind === 'pretender';
        html += rowList(t.acts.map(a => ({
            icon: a.icon, name: esc(blindAll && a.id === 'eye' ? `Put out ${his} eyes` : a.label),
            desc: esc(blindAll && a.id === 'eye' ? 'blinded' : ((MaimMarks.act(a.id) || {}).short || '')), off: !a.ok, why: esc(a.why),
            tone: a.ok ? 'bad' : '', act: 'maimingAct', args: [kind, t.id, a.id],
        })), '🔪 What to take');
        if (kind === 'rival' && t.captiveId != null) {
            html += rowList([
                { icon: '💰', name: 'Ransom', desc: `${esc(t.house)} pays out of its coffers and ${He.toLowerCase()} rides home`, side: t.ransom > 0 ? price(t.ransom, true) : 'Nothing to pay', off: !(t.ransom > 0), why: `${esc(t.house)} has nothing left to pay.`, act: 'rivalCaptiveAct', args: [t.captiveId, 'ransom'] },
                { icon: '🕊️', name: 'Let them go', desc: 'Home for nothing: the feud cools, and it is remembered', act: 'rivalCaptiveAct', args: [t.captiveId, 'release'], tone: 'good' },
            ], '⛓️ Or');
        }
        // (the dungeon: put them to the question instead — ui/actionMenu/interrogation.js)
        const dkey = kind === 'captive' ? `cap:${t.id}` : kind === 'bounty' ? `bty:${t.id}` : kind === 'rival' && t.captiveId != null ? `riv:${t.captiveId}` : null;
        if (dkey && typeof ActionMenu.showDungeonPrisoner === 'function') html += rowList([{ icon: '🔗', name: 'Put them to the question', desc: 'The dungeon: make them tell what they know', act: 'showDungeonPrisoner', args: [dkey], side: '›' }]);
        html += '<button data-am-act="showMaiming" style="width:100%;padding:8px;margin-top:10px;background:#444;border:1px solid #666;border-radius:6px;color:#eee;cursor:pointer;">Back</button>';
        game.ui.showCustomPanel(`🔪 ${esc(t.name)}`, html);
    },

    /** A row: do it. */
    maimingAct(game, kind, id, act) {
        const r = Maiming.act(game.player, game.world, kind, id, act);
        if (!r.success) { game.ui.showNotification('🔪 The Knife', r.reason || 'It cannot be done.', 'error'); return; }
        game.ui.updateStats(game.player, game.world);
        ActionMenu.showMaimTarget(game, kind, id, r.message);
    },

    /** Ransom or release a rival House's child you hold. */
    rivalCaptiveAct(game, capId, what) {
        const r = what === 'ransom' ? RivalCaptives.ransom(game.player, game.world, capId) : RivalCaptives.release(game.player, game.world, capId);
        if (!r.success) { game.ui.showNotification('⛓️ Captive', r.reason || 'It cannot be done.', 'error'); return; }
        game.ui.updateStats(game.player, game.world);
        ActionMenu.showMaiming(game, r.text);
    },

    /** Seize a rival House's child under guest-right. */
    rivalSeizeAct(game, kingdomId, childName) {
        const r = RivalCaptives.seize(game.player, game.world, kingdomId, childName);
        if (!r.success) { game.ui.showNotification('⛓️ Seize', r.reason || 'It cannot be done.', 'error'); return; }
        game.ui.updateStats(game.player, game.world);
        ActionMenu.showMaiming(game, r.text);
    },

    /** The aids this town's craftsmen can make for your losses. */
    showMaimAids(game, flash = '') {
        const { player, world } = game;
        const s = _town(game);
        let html = lede(s ? `${esc(s.name)}'s craftsmen can make something for what you lost. It will not give it back; it gives back a little.` : 'Only a town\'s craftsmen make these. Go into a town.');
        if (flash) html += card(esc(flash), { icon: '🦵', title: 'Fitted', tone: 'good' });
        html += _bodyCard(player);
        const opts = Maiming.aidOptions(player, world, s);
        html += rowList(opts.map(o => ({
            icon: o.icon, name: esc(o.name), desc: esc(o.desc), note: o.maker ? `Made by ${esc(o.maker)}` : '', off: !o.ok, why: esc(o.why),
            side: o.worn ? 'Worn' : price(o.cost, (player.gold || 0) >= o.cost), act: 'maimAidAct', args: [o.id], tone: o.worn ? 'good' : '',
        })), 'What can be made');
        if (!opts.length) html += card('Nothing made by hand would help what you have lost.', { icon: '🤕' });
        html += '<button data-am-act="showMaiming" style="width:100%;padding:8px;margin-top:10px;background:#444;border:1px solid #666;border-radius:6px;color:#eee;cursor:pointer;">Back</button>';
        game.ui.showCustomPanel('🦵 Aids for the Maimed', html);
    },

    maimAidAct(game, aidId) {
        const r = Maiming.buyAid(game.player, game.world, _town(game), aidId);
        if (!r.success) { game.ui.showNotification('🦵 Aids', r.reason || 'It cannot be made here.', 'error'); return; }
        game.ui.updateStats(game.player, game.world);
        ActionMenu.showMaimAids(game, r.message);
    },

    /** The street map's "Maim Them…" row (ui/innerMapMaiming.js). */
    streetMaimAct(game, npcId, act) {
        InnerMapMaiming.doMaim(game, npcId, act);
    },
});
