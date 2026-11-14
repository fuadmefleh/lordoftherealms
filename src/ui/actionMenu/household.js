// ActionMenu — Your Household: the player's own house, lived in
// (player/household.js). Tabs: Rooms (mark the corner you stand in as a
// hall, bedchamber, kitchen, larder, study, chapel or nursery; inside the
// house), Servants (hire from the town's people, thank, raise, let go),
// Larder (stock from the packs or the market, the steward's allowance) and
// Hall (heirlooms and trophies on show, guests, open table). Opened from
// the action menu in a town where the player owns a home ('my_household').
// Buttons route through data-am-act → householdAct.
//
// Also sets InnerMap._householdHook: the inner map (world/innerMap/
// household.js) surveys a floor's rooms when the player comes in, and this
// hook turns the survey into room quality (player/household.js, which the
// world layer can't import).
import { ActionMenu } from './_ref.js';
import { InnerMap } from '../../world/innerMap.js';
import { Household } from '../../player/household.js';
import { esc, lede, chips, purse, card, rowList, sectionHead, price, panelTabs, kv } from './uiKit.js';

const TITLE = '🏡 Your Household';
const NOTE = 'font-size: 11px; color: var(--text-secondary);';
const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const pct = v => `${Math.round(_num(v) * 100)}%`;

InnerMap._householdHook = {
    resurvey(player, world, key, tallies) {
        const home = Household.home(player, key);
        if (!home) return null;
        for (const [id, tally] of Object.entries(tallies || {})) {
            const room = home.rooms.find(r => r.id === id);
            if (room) Household.resurvey(home, room, tally, world);
        }
        return { shown: Household.shown(player, home) };
    },
};

/** The home key of the house the player stands in on the inner map, or null. */
function _insideKey() {
    if (!InnerMap.active || !InnerMap._insideBuilding || !(InnerMap.isOwnHome && InnerMap.isOwnHome())) return null;
    return InnerMap.furnishHomeKey();
}

function _insideInfo() {
    const b = InnerMap._insideBuilding;
    const wt = InnerMap.currentWorldTile || {};
    const ref = InnerMap._currentWorldTileRef;
    return {
        name: String((b && b.name) || 'Home').replace(/ \((Yours|Rented|To Let|Building)\)$/, ''),
        town: (ref && ref.settlement && ref.settlement.name) || null,
        q: wt.q, r: wt.r,
    };
}

function _homesHere(game) {
    const { player } = game;
    const list = Household.homes(player);
    const ik = _insideKey();
    if (ik && !list.some(h => h.key === ik)) {
        const info = _insideInfo();
        list.unshift({ key: ik, ...info, rec: null });
    }
    return list;
}

function _floorName(f) {
    return f > 0 ? `floor ${f + 1}` : 'ground floor';
}

function _roomTypes(room) {
    const t = room && room.types ? Object.entries(room.types).filter(([, n]) => n > 0) : [];
    return t.length ? t.map(([k, n]) => `${n} ${k}`).join(', ') : 'nothing yet';
}

// The panel's state: the home shown, the tab, the role being hired, the last result
const _HH = { key: null, tab: 'rooms', hire: null, msg: null };

Object.assign(ActionMenu, {
    showHousehold(game, keyOrMsg = null) {
        const { player, world } = game;
        const st = _HH;
        if (typeof keyOrMsg === 'string') st.key = keyOrMsg;
        const homes = _homesHere(game);
        if (!homes.length) {
            game.ui.showCustomPanel(TITLE, lede('You own no home to keep house in. Buy a house in a town (Manage House), rent or build one, and come back.'));
            return;
        }
        // The home you stand in or at, else the last one looked at, else the first
        const ik = _insideKey();
        const atHere = homes.find(h => h.q === player.q && h.r === player.r);
        if (ik) st.key = ik;
        else if (!st.key || !homes.some(h => h.key === st.key)) st.key = (atHere || homes[0]).key;
        const sel = homes.find(h => h.key === st.key) || homes[0];
        const home = Household.home(player, sel.key, true, { name: sel.name, town: sel.town, q: sel.q, r: sel.r });
        // Inside: the survey is fresh
        if (ik === home.key) {
            const tallies = InnerMap.surveyHomeRooms(home.rooms, player);
            InnerMap._householdHook.resurvey(player, world, home.key, tallies);
        }
        const v = Household.view(player, world, home.key);

        const tabs = [['rooms', '🏠 Rooms'], ['servants', '🧹 Servants'], ['larder', '🧺 Larder'], ['hall', '🏛️ Hall & Guests']];
        const tabRow = panelTabs(game, {
            id: 'household', title: TITLE, tabs, active: st.tab,
            go: (k) => { st.tab = k; st.hire = null; ActionMenu.showHousehold(game); },
            attrsFor: (k) => `data-am-act="householdAct" data-am-args='${JSON.stringify(['tab', k])}'`,
        });
        let html = `<div style="font-size:12px;">${tabRow}`;
        if (st.msg) { html += card(esc(st.msg.text), { tone: st.msg.ok ? 'good' : 'bad' }); st.msg = null; }
        html += chips([
            purse(player.gold),
            ['🧹', 'Servants', `${home.servants.length} · ${v.wages}g/day`],
            ['🧺', 'Larder', `${v.rations} days' food`, v.rations < v.mouths ? 'bad' : ''],
            ['✨', 'Clean', `${Math.round(_num(home.clean, 80))}%`],
            ['👥', 'Guests', home.guests.length],
        ]);
        if (homes.length > 1) {
            html += rowList(homes.map(h => ({
                icon: h.key === home.key ? '🏡' : '🏠', name: esc(h.name), desc: esc(h.town || ''),
                side: h.key === home.key ? 'shown' : '', act: h.key === home.key ? null : 'householdAct', args: ['home', h.key],
            })), 'Your homes');
        }
        if (st.tab === 'rooms') html += ActionMenu._hhRooms(game, home, v, ik === home.key);
        else if (st.tab === 'servants') html += ActionMenu._hhServants(game, home, v);
        else if (st.tab === 'larder') html += ActionMenu._hhLarder(game, home, v);
        else html += ActionMenu._hhHall(game, home, v);
        if (home.log.length) html += sectionHead('Of late') + `<div style="${NOTE}">${home.log.slice(0, 5).map(l => esc(l.text)).join('<br>')}</div>`;
        html += '</div>';
        game.ui.showCustomPanel(TITLE, html);
    },

    _hhRooms(game, home, v, inside) {
        let html = lede(`${esc(home.name)}${home.town ? ` in ${esc(home.town)}` : ''}. Stand in a corner of the house and mark it as a room: what furniture stands within a few steps of you makes it a good one or a poor one. Buy pieces from the Furniture Maker and set them down with <b>Furnish</b>.`);
        if (inside) {
            const here = InnerMap.householdSpot();
            html += rowList(Household.ROOM_KINDS.map(kind => {
                const def = Household.roomDef(kind) || {};
                const room = Household.room(home, kind);
                return {
                    icon: def.icon, name: `${room ? 'Move' : 'Mark'} the ${esc((def.name || kind).toLowerCase())} here`,
                    desc: esc(def.desc || ''), side: room ? pct(room.quality) : '',
                    act: 'householdAct', args: ['mark', kind, here.floor, here.q, here.r],
                };
            }), `📍 Where you stand (${_floorName(here.floor)})`);
        } else {
            html += `<div style="${NOTE} margin:6px 0;">Go inside the house to mark its rooms.</div>`;
        }
        const rows = home.rooms.map(room => {
            const def = Household.roomDef(room.kind) || {};
            const needs = room.quality <= 0 ? ` Needs ${(def.needs || []).map(t => `a ${t}`).join(' or ')}.` : '';
            return {
                icon: def.icon, name: `${esc(def.name || room.kind)} · ${_floorName(room.floor)}`,
                desc: `${esc(_roomTypes(room))}${room.value ? ` · worth ${room.value}g` : ''}${needs}`,
                note: esc(ActionMenu._hhRoomEffect(game, home, room)),
                side: pct(room.quality), tone: room.quality >= 0.6 ? 'good' : room.quality > 0 ? 'gold' : 'bad',
                act: 'householdAct', args: ['unmark', room.id], title: 'Unmark this room',
            };
        });
        html += rows.length ? rowList(rows, '🏠 Your rooms (click to unmark)') : sectionHead('🏠 Your rooms') + `<div style="${NOTE}">No rooms marked yet.</div>`;
        return html;
    },

    _hhRoomEffect(game, home, room) {
        const q = _num(room.quality);
        const E = Household.config().effects;
        switch (room.kind) {
            case 'bedchamber': return `Sleep here restores ${Math.round(Household.sleepBonus(game.player, home.key) * 100)}% more; +${Math.round(E.homeRestEnergy * q)} energy each day at home.`;
            case 'kitchen': return Household.servants(home, 'cook').length ? `Your cook's supper: +${Math.round(E.kitchenHunger * (1 + q))} hunger; the larder goes ${Math.round(E.kitchenStretch * q * 100)}% further.` : 'No cook: hire one to cook here.';
            case 'larder': return `Holds ${Household.capacity(home)} portions; food spoils ${Math.round(Household.config().larder.larderSpoilCut * q * 100)}% slower.`;
            case 'study': return `Your books each day at home: Intelligence and Diplomacy grow (${pct(q)} pace).`;
            case 'chapel': return 'Prayers each day at home: faith and standing with your god.';
            case 'nursery': return `The small children of the House grow healthier and sharper here${Household.servants(home, 'nurse').length ? ', the more with your nurse' : ''}.`;
            case 'hall': return `${Household.displaySlots(home)} display piece(s) for heirlooms and trophies; guests are received here.`;
            default: return '';
        }
    },

    _hhServants(game, home, v) {
        const { player, world } = game;
        const st = _HH;
        let html = lede('Servants are paid each day from your purse, wherever you are. Unpaid, unfed or overworked, they grumble; left resentful for days, they leave.');
        if (st.hire) {
            const def = Household.roleDef(st.hire) || {};
            const list = Household.candidates(player, world, home.key, st.hire);
            html += rowList(list.map(c => ({
                icon: def.icon, name: esc(c.name), desc: `${esc(c.was ? `now ${c.was}; ` : '')}skill ${'★'.repeat(c.skill)}${'☆'.repeat(Math.max(0, 5 - c.skill))}`,
                side: `${price(c.wage, player.gold >= c.wage)}<small>/day</small>`,
                off: !v.atHome, why: `You hire in ${esc(home.town || 'the town')} itself.`,
                act: 'householdAct', args: ['hire', st.hire, c.id],
            })), `${def.icon || ''} Who would serve as ${esc((def.name || st.hire).toLowerCase())}`);
            html += rowList([{ icon: '↩', name: 'Back', act: 'householdAct', args: ['hireBack'] }]);
            return html;
        }
        const rows = [];
        for (const s of home.servants) {
            const def = Household.roleDef(s.role) || {};
            rows.push({
                icon: def.icon, name: `${esc(s.name)}, ${esc((def.name || s.role).toLowerCase())}`,
                desc: `${esc(Household.moodWord(s.mood))} (${Math.round(s.mood)}) · skill ${s.skill}${s.unpaid ? ` · <b>unpaid ${s.unpaid} day(s)</b>` : ''}`,
                side: `${price(s.wage)}<small>/day</small>`, tone: s.mood < 35 ? 'bad' : s.mood >= 70 ? 'good' : 'gold',
            });
            rows.push(`<div style="margin:-2px 0 6px 34px;">${[
                ['praise', '🙂 Thank them'], ['raise', '💰 Raise wage'], ['dismiss', '✋ Let go'],
            ].map(([op, label]) => `<button class="pk-chip" style="cursor:pointer;" data-am-act="householdAct" data-am-args='${esc(JSON.stringify([op, s.id]))}'>${label}</button>`).join(' ')}</div>`);
        }
        html += rows.length ? rowList(rows, '🧹 In your service') : sectionHead('🧹 In your service') + `<div style="${NOTE}">No one yet.</div>`;
        html += rowList(Household.ROLES.map(role => {
            const def = Household.roleDef(role) || {};
            return { icon: def.icon, name: `Hire a ${esc((def.name || role).toLowerCase())}`, desc: esc(def.desc || ''), side: `~${def.wage}g/day`, act: 'householdAct', args: ['hireRole', role] };
        }), '➕ Take someone on');
        return html;
    },

    _hhLarder(game, home, v) {
        const { player, world } = game;
        const L = Household.config().larder;
        let html = lede(`Every mouth in the house eats from the larder each day: servants, guests, and you when home. ${v.mouths} at table today. Food spoils slowly; grain, beans, honey and salt fish keep.`);
        html += chips([['🧺', 'Holds', `${v.units}/${v.capacity}`], ['🍞', 'Days of food', v.rations], ['👥', 'Mouths', v.mouths]]);
        const inLarder = Object.entries(home.larder).filter(([, n]) => n > 0);
        html += inLarder.length ? rowList(inLarder.map(([g, n]) => ({
            icon: '🍖', name: esc(g.replace(/_/g, ' ')), desc: v.atHome ? 'Take one back into your packs' : '', side: `×${n}`,
            act: v.atHome ? 'householdAct' : null, args: ['take', g],
        })), '🧺 In the larder') : sectionHead('🧺 In the larder') + `<div style="${NOTE}">Bare.</div>`;
        if (v.atHome) {
            const packs = Object.entries(player.inventory || {}).filter(([g, n]) => n > 0 && Household.isFood(g));
            html += rowList(packs.map(([g, n]) => ({
                icon: '🎒', name: `Put by your ${esc(g.replace(/_/g, ' '))}`, desc: 'From your packs into the larder', side: `×${n}`,
                act: 'householdAct', args: ['stock', g],
            })), '🎒 From your packs');
            const market = Household.marketFood(player, world, home).slice(0, 8);
            html += rowList(market.map(g => {
                const n = Math.max(1, Math.min(g.quantity, 10));
                return {
                    icon: '🛒', name: `Buy ${n} ${esc(g.name.toLowerCase())}`, desc: `${g.quantity} on the stalls · straight to the larder`,
                    side: price(g.price * n, player.gold >= g.price * n), act: 'householdAct', args: ['buy', g.id, n],
                };
            }), `🛒 ${esc(home.town || 'The')} market`);
        } else {
            html += `<div style="${NOTE} margin:6px 0;">Be at the house to stock its larder yourself.</div>`;
        }
        const steward = Household.servants(home, 'steward')[0];
        html += sectionHead('🗝️ The steward\'s allowance');
        html += `<div style="${NOTE}">${steward ? `${esc(steward.name)} buys at the market whenever the larder falls below ${L.stewardTarget} days' food, up to the allowance a day.` : 'With a house steward, the larder is restocked from the market for you.'}</div>`;
        html += rowList([0, 20, 40, 80].map(g => ({
            icon: _num(home.allowance) === g ? '●' : '○', name: g ? `${g}g a day` : 'Nothing: I stock it myself', side: '',
            act: 'householdAct', args: ['allowance', g],
        })));
        return html;
    },

    _hhHall(game, home, v) {
        const { player } = game;
        let html = lede('Heirlooms and trophies stand in the hall, one on each rack, statue or banner there. Guests who see them speak of them: Prestige for the House, and a heirloom\'s legend grows. Kin, courtiers and rival envoys come to stay while you are home.');
        if (!Household.room(home, 'hall')) html += card('Mark a hall first (Rooms tab, inside the house).', { tone: 'bad' });
        const things = Household.displayables(player, home.key);
        html += kv('Display pieces in the hall', `${v.shown.length}/${v.slots}`);
        html += things.length ? rowList(things.map(t => ({
            icon: t.icon, name: esc(t.name), desc: t.kind === 'heirloom' ? 'Heirloom of the House' : 'Trophy',
            side: t.onShow ? 'on show' : '', tone: t.onShow ? 'good' : null,
            act: 'householdAct', args: ['display', t.ref, t.onShow ? 0 : 1],
        })), '🏺 To show') : `<div style="${NOTE}">The House has no heirlooms or trophies yet: win battles, hunt, forge heirlooms.</div>`;
        html += home.guests.length ? rowList(home.guests.map(g => ({
            icon: g.icon, name: esc(g.name[0].toUpperCase() + g.name.slice(1)), desc: `Staying till day ${g.leaves}${g.hungry ? ' · went hungry' : ''}`, side: esc(g.kind),
        })), '👥 Staying with you') : sectionHead('👥 Staying with you') + `<div style="${NOTE}">No guests.</div>`;
        html += rowList([{
            icon: '✉️', name: 'Keep open table', desc: 'Send word that guests are welcome: someone comes in a day or two',
            off: !v.atHome || !Household.room(home, 'hall'), why: !v.atHome ? 'Be at home to receive guests.' : 'Mark a hall first.',
            act: 'householdAct', args: ['invite'],
        }]);
        return html;
    },

    householdAct(game, op, a, b, c, d) {
        const { player, world } = game;
        const st = _HH;
        const key = st.key;
        let res = null;
        switch (op) {
            case 'tab': st.tab = a; st.hire = null; break;
            case 'home': st.key = a; st.hire = null; break;
            case 'mark': {
                const ik = _insideKey();
                if (!ik) { res = { success: false, text: 'Go inside the house to mark its rooms.' }; break; }
                const home = Household.home(player, ik, true, _insideInfo());
                const tmp = { id: '_new', kind: a, floor: b, q: c, r: d };
                const tallies = InnerMap.surveyHomeRooms([...home.rooms.filter(r => r.kind !== a), tmp], player);
                res = Household.designate(player, world, ik, { kind: a, floor: b, q: c, r: d, tally: tallies._new }, _insideInfo());
                st.key = ik;
                break;
            }
            case 'unmark': res = Household.unmark(player, key, a); break;
            case 'hireRole': st.hire = a; break;
            case 'hireBack': st.hire = null; break;
            case 'hire': res = Household.hire(player, world, key, a, b); if (res.success) st.hire = null; break;
            case 'praise': res = Household.praise(player, world, key, a); break;
            case 'raise': res = Household.raiseWage(player, world, key, a); break;
            case 'dismiss': res = Household.dismiss(player, world, key, a); break;
            case 'stock': res = Household.stock(player, key, a, null); break;
            case 'take': res = Household.take(player, key, a, 1); break;
            case 'buy': res = Household.buy(player, world, key, a, b); break;
            case 'allowance': res = Household.setAllowance(player, key, a); break;
            case 'display': res = Household.setDisplay(player, key, a, !!b); break;
            case 'invite': res = Household.invite(player, world, key); break;
            default: return;
        }
        if (res) st.msg = { ok: !!res.success, text: res.text };
        // Inside the house: the hall's display pieces show the change at once
        if (res && res.success && (op === 'mark' || op === 'unmark' || op === 'display') && _insideKey() && InnerMap.householdRelabel) InnerMap.householdRelabel(game);
        if (res && res.success && game.ui.updateStats) game.ui.updateStats(player, world);
        ActionMenu.showHousehold(game);
    },
});
