// ActionMenu — 🌋 The Age: the crisis the world is living through (an
// invasion, a great plague, a schism, a famine decade, a gold rush), what of
// it is near the player, the choices open to them, and the crises on record.
// Logic lives in systems/crises.js; this panel presents it and composes the
// player-layer halves of two choices: the vanguard battle (PlayerMilitary.
// combat, its result handed to Crises.act) and the flight (the player moved
// to Crises.refuge). Rows route through data-am-act → ActionMenu.crisisAct.
//
// Opener: ActionMenu.showCrisesPanel(game).
import { ActionMenu } from './_ref.js';
import { PlayerMilitary, InnerMap } from './_imports.js';
import { Crises } from '../../systems/crises.js';
import { lede, chips, rowList, card, price, purse, esc } from './uiKit.js';

const PHASES = {
    omens: 'Omens', war: 'At war', spreading: 'Spreading', waning: 'Waning', dispute: 'The dispute',
    split: 'The split', strife: 'The strife', hungry: 'The hungry years', rush: 'The rush', bust: 'The bust', aftermath: 'Aftermath',
};
const OUTCOMES = { settled: 'the invaders settled', repelled: 'repelled', passed: 'passed', peace: 'the Peace of the Faiths', bust: 'boom and bust', lost: 'abandoned' };

const _cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '');
// The calendar year of a world day (as Annals.year / Calendar.date count it: baseYear + whole years)
let _world = null;
const _yr = (day) => (Number.isFinite(_world && _world.baseYear) ? _world.baseYear : 1) + Math.floor((Math.max(1, Math.floor(day || 1)) - 1) / 120);

/** Is the realm's timeline kept (and, given a day, does it reach back to it)? */
function _onTimeline(world, day = null) {
    const tl = world && world.timeline;
    return !!(tl && tl.base && (day == null || day >= tl.base.d - 120));
}

/** The timeline's jump to a crisis: its first day, its place ringed. */
function _jump(c) {
    const at = c.place || (c.data && c.data.at) || null;
    return { day: c.startDay, ...(at && Number.isFinite(at.q) ? { focus: { q: at.q, r: at.r } } : {}) };
}

function _outcome(o) {
    if (!o) return '';
    if (o.startsWith('triumph:')) return o.endsWith('reformed') ? 'the reformers triumphed' : 'the old church triumphed';
    return OUTCOMES[o] || o;
}

function _activeCard(game, c) {
    const world = game.world;
    const info = Crises.KIND_INFO[c.kind] || {};
    const d = c.data || {};
    const facts = [['⏳', 'Since year', _yr(c.startDay)], ['', 'Phase', PHASES[c.phase] || c.phase]];
    if (c.kind === 'invasion') {
        const hosts = Crises._hosts(world, c);
        facts.push(['⚔️', 'Hosts', `${hosts.length} · ${hosts.reduce((s, h) => s + (h.strength || 0), 0)} strong`]);
        if ((d.taken || []).length) facts.push(['🏰', 'Towns taken', d.taken.length]);
        if ((d.alliance || []).length) facts.push(['🤝', 'Alliance', d.alliance.map(id => (world.getKingdom(id) || {}).name).filter(Boolean).join(', ')]);
    } else if (c.kind === 'plague') {
        facts.push(['☠️', 'Towns struck', Object.keys(d.towns || {}).length], ['', 'Dead', Math.round(d.dead || 0).toLocaleString('en-US')]);
    } else if (c.kind === 'schism') {
        const sides = Object.values(d.sides || {});
        facts.push(['⛪', esc(_cap(d.reformedName)), sides.filter(s => s === 'reformed').length], ['', 'Old church', sides.filter(s => s === 'orthodox').length]);
    } else if (c.kind === 'famine') {
        facts.push(['🥀', 'Regions', (d.regions || []).length], ['', 'Years', d.years]);
    } else if (c.kind === 'rush') {
        facts.push(['⛏️', 'Boomtown', esc(d.town)], ['', 'Newcomers', d.gained || 0]);
    }
    const recent = c.log.slice(-5).reverse().map(e => `<div style="font-size:12px; margin:3px 0;"><span style="color:#a99a78;">Year ${_yr(e.day)}:</span> ${esc(Crises.line(world, c, e))}</div>`).join('');
    return card(`${chips(facts)}${recent}`, { icon: info.icon, title: esc(_cap(c.name)), side: info.label, tone: c.phase === 'aftermath' ? '' : 'bad' });
}

function _nearHtml(game, here) {
    const bits = [];
    if (here.host) bits.push(`⚔️ ${esc(here.host.name)} (${here.host.strength} strong) is ${here.dist} hexes from you.`);
    if (here.plague) bits.push(`☠️ The plague is in ${esc(here.plague.name)}, ${here.dist} hexes away.`);
    if (here.region) bits.push(`🥀 You stand in the famine lands (${esc(here.region)}).`);
    return bits.length ? lede(bits.join(' ')) : '';
}

Object.assign(ActionMenu, {
    /** The Age panel: the running crisis, your choices, the crises on record. */
    showCrisesPanel(game, message = null) {
        const { player, world } = game;
        if (!player || !world) return;
        _world = world;
        const v = Crises.view(player, world);
        let html = '<div style="font-size:12px; max-height:560px; overflow-y:auto;">';
        if (message) html += card(esc(message.text), { tone: message.ok ? 'good' : 'warn' });
        const c = v.active;
        if (!c) {
            html += lede('No great crisis grips the world. The years run quiet, as they do between the storms: invasions, great plagues, schisms, famines and gold rushes come a few times a century.');
        } else {
            html += _activeCard(game, c);
            html += _nearHtml(game, v.here || {});
            html += chips([purse(player.gold)]);
            const rows = v.choices.map(ch => ({
                icon: ch.icon, name: esc(ch.label), desc: esc(ch.desc), off: !ch.ok, why: esc(ch.why),
                side: ch.cost ? price(ch.cost, (player.gold || 0) >= ch.cost) : '',
                act: 'crisisAct', args: [ch.id, ...(ch.args || [])],
            }));
            html += rowList(rows, 'What you can do');
            // Where it began, on the Timeline of the Realm (ui/actionMenu/timeline.js)
            if (_onTimeline(world)) html += rowList([{ icon: '🗺️', name: 'See it on the timeline', desc: `The realm as it stood when ${esc(c.name)} began, and where`, act: 'showTimeline', args: [_jump(c)], side: '›' }]);
        }
        const past = v.history || [];
        if (past.length) {
            const rows = past.slice(0, 12).map(h => ({
                icon: (Crises.KIND_INFO[h.kind] || {}).icon, name: esc(_cap(h.name)),
                desc: `Years ${_yr(h.startDay)}–${_yr(h.endDay)}: ${esc(_outcome(h.outcome))}`,
                // (each opens the Timeline of the Realm at its start, while the record reaches back that far)
                ...(_onTimeline(world, h.startDay) ? { act: 'showTimeline', args: [_jump(h)], side: '🗺️', title: 'See it on the timeline' } : {}),
            }));
            html += rowList(rows, 'The crises on record');
            html += `<div style="font-size:11px; color:var(--text-secondary);">Each is a chapter in the Annals.</div>`;
        }
        html += '</div>';
        game.ui.showCustomPanel('🌋 The Age', html);
    },

    /** The panel's rows: a choice id and its arguments. */
    crisisAct(game, id, ...args) {
        const { player, world } = game;
        let res;
        if (id === 'rally') {
            const near = Crises.near(player, world);
            if (!near.host) return ActionMenu.showCrisesPanel(game, { ok: false, text: 'No host is near.' });
            const van = Math.round((near.host.strength || 0) * Crises.config().choices.vanguardShare);
            const tile = world.getTile(near.host.q, near.host.r);
            const fight = PlayerMilitary.combat(player, van, `the vanguard of ${near.host.name}`, { world, terrainId: tile && tile.terrain && tile.terrain.id });
            if (fight.reason) return ActionMenu.showCrisesPanel(game, { ok: false, text: fight.reason });
            res = Crises.act(player, world, 'rally', { victory: !!fight.victory });
        } else {
            if (id === 'flee' && InnerMap && InnerMap.active) return ActionMenu.showCrisesPanel(game, { ok: false, text: 'Leave the town streets first: the carters wait at the gate.' });
            res = Crises.act(player, world, id, ...args);
            if (res.success && res.refuge) {
                // The road to safety: the player is set down in the refuge town
                if (typeof player.cancelTravel === 'function') player.cancelTravel();
                player.prevQ = player.q;
                player.prevR = player.r;
                player.q = res.refuge.q;
                player.r = res.refuge.r;
                if (typeof player.revealArea === 'function') player.revealArea(world, 4);
                if (typeof player.updateVisibility === 'function') player.updateVisibility(world);
                if (game.renderer && typeof player.getReachableHexes === 'function') game.renderer.reachableHexes = player.getReachableHexes(world);
                if (typeof game.recenterCamera === 'function') game.recenterCamera();
            }
        }
        if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(player, world);
        ActionMenu.showCrisesPanel(game, { ok: !!res.success, text: res.text });
    },
});

