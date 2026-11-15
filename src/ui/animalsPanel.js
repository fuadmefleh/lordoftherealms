// ============================================
// ANIMALS PANEL — your animals, the market's kennel, Who Walks With You
// ============================================
// Three views over systems/animalCompanions.js and systems/streetFollowers.js:
//
//   show(game, focusId)    Your Animals: a card for each (kind, age, bond,
//                          belly, health, what it does for you), with Pet,
//                          Feed, Rename, Keep at this house / Take along, Let go
//   showWhoWalks(game)     Who Walks With You: the whole party — travelling
//                          companions, the household guard, the animals —
//                          each walking the street map with you or waiting
//                          (at the inn, the camp, the edge of town)
//   marketHtml(game, s)    the dogs, cats and hawks a town's market sells
//                          this month, for the Livestock Market panel
//                          (ui/actionMenu/livestock.js)
//
// Opened from the Travel Party panel (ui/actionMenu/social.js), the street
// map (a pet's own menu: ui/innerMapPets.js) and the market. Buttons route
// through window._animalsAct (this layer's inline handlers).

import { AnimalCompanions } from '../systems/animalCompanions.js';
import { StreetFollowers } from '../systems/streetFollowers.js';
import { Companions } from '../systems/companions.js';
import { RealmEscort } from '../player/realmEscort.js';
import { Household } from '../player/household.js';
import { ActionMenu } from './actionMenu/_ref.js';
import { BTN_GOLD, BTN_PLAIN, BTN_DARK, BTN_OFF, BTN_RED, lede, sectionHead, card, actRow, rowList, esc } from './actionMenu/uiKit.js';

const NOTE = 'font-size:11px; color:#9d937c;';
const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _pct = v => Math.round(Math.max(0, Math.min(100, _num(v))));

function _btn(label, op, id = '', arg = '', style = BTN_PLAIN, title = '') {
    const a = (x) => esc(JSON.stringify(String(x)));
    return `<button onclick="window._animalsAct(${a(op)}, ${a(id)}, ${a(arg)})" style="${style}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
}

function _bar(v, color) {
    return `<span style="display:inline-block; vertical-align:middle; width:60px; height:5px; border-radius:3px; background:rgba(0,0,0,0.45); overflow:hidden; margin:0 4px;"><span style="display:block; height:100%; width:${_pct(v)}%; background:${color};"></span></span>`;
}

/** What it does for you, in words (the numbers the game reads). */
function _effectsText(a, world) {
    const fx = (k) => AnimalCompanions.effectOf(a, k, world);
    const out = [];
    const pc = v => `${Math.round(v * 100)}%`;
    if (a.species === 'horse') out.push('Your mount: more movement each day, room in your packs, a quicker escape');
    if (fx('huntQty') > 0) {
        const sp = AnimalCompanions.species(a.species) || {};
        const items = sp.effects && sp.effects.huntItems;
        out.push(`+${pc(fx('huntQty'))} chance of an extra cut ${items ? 'of small game (meat, feathers, hides)' : 'from a hunt'}`);
    }
    if (fx('theftWarn') > 0) out.push(`+${pc(fx('theftWarn'))} to catching a cutpurse's hand (walking the streets with you)`);
    if (fx('roadWarn') > 0) out.push(`+${pc(fx('roadWarn'))} to slipping away from a band on the road`);
    if (fx('beastGuard') > 0) out.push(`takes ${pc(Math.min(0.6, fx('beastGuard')))} of a beast's mauling on itself`);
    if (AnimalCompanions.streetDamage(a, world) > 0) out.push(`fights beside you on the street map (a ${Math.round(AnimalCompanions.streetDamage(a, world))}-point bite)`);
    if (fx('mouser') > 0) out.push(`kept at a house, cuts its larder's spoilage by ${pc(Math.min(0.8, fx('mouser')))}`);
    return out;
}

export const AnimalsPanel = {
    _game: null,

    _bind(game) {
        AnimalsPanel._game = game;
        if (typeof window === 'undefined') return;
        window._animalsAct = (op, id, arg) => AnimalsPanel.act(AnimalsPanel._game, op, id, arg);
    },

    /** Your Animals. */
    show(game, focusId = null, msg = null) {
        AnimalsPanel._bind(game);
        AnimalsPanel._view = 'animals';
        const { player, world } = game;
        const list = AnimalCompanions.list(player, world);
        const st = AnimalCompanions.state(player);
        let html = '<div style="font-size:12px;">';
        if (msg) html += `<div style="margin-bottom:6px; color:${msg.ok ? '#8fd18a' : '#f0b4a2'};">${esc(msg.text)}</div>`;
        html += lede('The animals that are yours: fed from your packs (or bought scraps in town), they grow closer to you by the day — and older. A year is 120 days.');
        html += `<div style="margin:4px 0 8px;">${_btn('🚶 Who Walks With You', 'whoWalks', '', '', BTN_GOLD, 'Choose who goes about the streets with you and who waits')}</div>`;
        if (!list.length) {
            html += card(`<div style="${NOTE}">You have no animals. A town's Livestock Market sells pups, kittens and (in the bigger towns) a falconer's hawk; a stable or the market a horse to ride. Now and then a stray dog noses about a town's streets: feed it and it may follow you home.</div>`);
        }
        const homes = Household.homes(player).filter(h => Household.isHome(player, h));
        for (const a of list) {
            const kind = AnimalCompanions.kindName(a);
            const kept = a.keptAt ? Household.homes(player).find(h => h.key === a.keptAt) : null;
            const walks = StreetFollowers.walks(player, StreetFollowers.animalKey(a.id));
            let body = `<div style="${NOTE}">${esc(kind)} · ${a.sex === 'f' ? 'female' : 'male'} · ${esc(AnimalCompanions.ageText(a, world))}`
                + `${a.from === 'stray' ? ' · a stray you won over' : ''}${a.keptAt ? ` · kept at ${esc(kept ? `${kept.name}${kept.town ? `, ${kept.town}` : ''}` : 'a house of yours')}` : walks ? ' · walks with you' : ' · waits at your lodging'}</div>`;
            body += `<div style="margin-top:4px; font-size:11px;">💛 Bond${_bar(a.bond, '#e5b83a')}${_pct(a.bond)} &nbsp; 🍖 Belly${_bar(a.hunger, '#6fcf4f')}${_pct(a.hunger)} &nbsp; ❤️ Health${_bar(a.health, '#e0473a')}${_pct(a.health)}</div>`;
            const fx = _effectsText(a, world);
            if (fx.length) body += `<div style="margin-top:4px; font-size:11px; color:#cdb;">${fx.map(t => `• ${esc(t)}`).join('<br>')}</div>`;
            const foods = AnimalCompanions.foodsFor(player, a);
            const btns = [];
            btns.push(_btn('🤚 Pet', 'pet', a.id));
            btns.push(foods.length ? _btn(`🍖 Feed (${esc(foods[0].id.replace(/_/g, ' '))})`, 'feed', a.id, '', BTN_PLAIN, foods.map(f => `${f.id.replace(/_/g, ' ')} ×${f.have}`).join(', '))
                : `<button style="${BTN_OFF}" title="Nothing in your packs it eats">🍖 Feed</button>`);
            if (a.id !== 'mount') {
                if (a.keptAt) btns.push(_btn('🧭 Take Along', 'keep', a.id, '', BTN_PLAIN, 'It travels with you again'));
                else for (const h of homes) btns.push(_btn(`🏠 Keep at ${esc(h.name)}`, 'keep', a.id, h.key, BTN_PLAIN, a.species === 'cat' ? 'A cat keeps the rats out of the larder there; it eats from the larder' : 'It stays there and eats from the larder'));
            }
            btns.push(_btn(walks ? '🏠 Wait in Town' : '🚶 Walk With Me', 'walk', a.id, '', BTN_DARK, 'On the street map: walks with you, or waits at your lodging'));
            const rename = `<span style="display:inline-flex; gap:4px; align-items:center; margin-top:4px;"><input id="am-pet-name-${esc(a.id)}" value="${esc(a.name)}" maxlength="24" style="width:110px; padding:3px 6px; background:rgba(0,0,0,0.35); border:1px solid rgba(245,197,66,0.18); border-radius:5px; color:#ece2c8; font-size:12px;">${_btn('✏️ Rename', 'rename', a.id)}</span>`;
            if (a.id !== 'mount') btns.push(_btn('Let Go', 'release', a.id, '', BTN_RED, 'Set it loose for good'));
            body += `<div style="margin-top:6px;">${btns.join('')}</div>${rename}`;
            html += card(body, { title: `${esc(a.name)}${a.id === focusId ? ' ◂' : ''}`, icon: AnimalCompanions.icon(a) });
        }
        if (st.gone.length) {
            html += sectionHead('Remembered');
            html += `<div style="${NOTE}">${st.gone.slice().reverse().map(g => `${esc(g.name)} (${esc(g.species)}): ${esc(g.how)}, day ${g.day}`).join(' · ')}</div>`;
        }
        html += '</div>';
        game.ui.showCustomPanel('🐾 Your Animals', html);
    },

    /** Who Walks With You: everyone in the party, walking or waiting. */
    showWhoWalks(game, msg = null) {
        AnimalsPanel._bind(game);
        AnimalsPanel._view = 'walk';
        const { player, world } = game;
        let html = '<div style="font-size:12px;">';
        if (msg) html += `<div style="margin-bottom:6px; color:${msg.ok ? '#8fd18a' : '#f0b4a2'};">${esc(msg.text)}</div>`;
        html += lede('Who goes about the streets with you, and who waits for you at the inn, the camp or the edge of town. Out on the road everyone travels together.');
        const row = (icon, name, desc, key) => {
            const on = StreetFollowers.walks(player, key);
            return actRow({ icon, name, desc: `${desc} · <b style="color:${on ? '#8fd18a' : '#d8ccaf'};">${on ? 'walks with you' : 'waits'}</b>`,
                side: _btn(on ? 'Wait' : 'Walk With Me', 'toggle', key, '', on ? BTN_PLAIN : BTN_GOLD) });
        };
        let members = [];
        try { members = Companions.members(player, world).filter(n => n && n.isAlive !== false); } catch { members = []; }
        const people = members.map(n => row('🧭', esc(n.firstName || n.name || 'Companion'), esc(n.occupation || 'companion'), StreetFollowers.npcKey(n.id)));
        const g = RealmEscort.guard(player);
        if (g && RealmEscort.units(player).length) people.push(row('🛡️', esc(g.kingdomName ? `The guard of ${g.kingdomName}` : 'Your household guard'), `${RealmEscort.units(player).length} compan${RealmEscort.units(player).length === 1 ? 'y' : 'ies'}`, StreetFollowers.GUARD));
        html += rowList(people, 'People') || `<div style="${NOTE}">No companions or guard travel with you.</div>`;
        const beasts = AnimalCompanions.travelling(player, world).map(a => row(AnimalCompanions.icon(a), esc(a.name), esc(AnimalCompanions.kindName(a)), StreetFollowers.animalKey(a.id)));
        html += rowList(beasts, 'Animals') || `<div style="${NOTE} margin-top:6px;">No animals travel with you.</div>`;
        const all = [...members.map(n => StreetFollowers.npcKey(n.id)), ...(g ? [StreetFollowers.GUARD] : []), ...AnimalCompanions.travelling(player, world).map(a => StreetFollowers.animalKey(a.id))];
        if (all.length) html += `<div style="margin-top:8px;">${_btn('Everyone Walks', 'all', '', '1', BTN_GOLD)}${_btn('Everyone Waits', 'all', '', '0', BTN_PLAIN)}${_btn('🐾 Your Animals', 'animals', '', '', BTN_DARK)}</div>`;
        html += '</div>';
        game.ui.showCustomPanel('🚶 Who Walks With You', html);
    },

    /** The town's dogs, cats and hawks for sale, as a section of the Livestock Market. */
    marketHtml(game, s) {
        AnimalsPanel._bind(game);
        AnimalsPanel._market = s;
        const { player, world } = game;
        const offers = AnimalCompanions.market(world, s);
        let html = sectionHead('Dogs, cats & hawks');
        if (!offers.length) return html + `<div style="${NOTE}">No pups, kittens or hawks for sale here this month.</div>`;
        const full = AnimalCompanions.state(player).list.length >= AnimalCompanions.config().maxAnimals;
        html += rowList(offers.map(o => actRow({
            icon: o.icon, name: `${esc(o.name)}${o.young ? ` <span style="${NOTE}">(young)</span>` : ''}`,
            desc: `${esc(o.desc)} · ${o.stock} here`,
            side: full ? `<button style="${BTN_OFF}" title="You have as many animals as you can look after">${o.price}g</button>`
                : _btn(`Buy (${o.price}g)`, 'buy', o.key, '', _num(player.gold) >= o.price ? BTN_GOLD : BTN_PLAIN),
        })));
        return html;
    },

    /** Every button of these panels. */
    act(game, op, id, arg) {
        if (!game) return;
        const { player, world } = game;
        let res = null;
        switch (op) {
            case 'whoWalks': AnimalsPanel.showWhoWalks(game); return;
            case 'animals': AnimalsPanel.show(game); return;
            case 'pet': res = AnimalCompanions.pet(player, id, world); break;
            case 'feed': res = AnimalCompanions.feed(player, id, null, world); break;
            case 'keep': res = AnimalCompanions.keepAt(player, id, arg || null); break;
            case 'release': res = AnimalCompanions.release(player, id, world); break;
            case 'walk': {
                const on = StreetFollowers.toggle(player, StreetFollowers.animalKey(id));
                const a = AnimalCompanions.get(player, id);
                res = { success: true, text: `${a ? a.name : 'It'} ${on ? 'walks the streets with you' : 'waits for you in town'}.` };
                break;
            }
            case 'rename': {
                const el = typeof document !== 'undefined' ? document.getElementById(`am-pet-name-${id}`) : null;
                res = AnimalCompanions.rename(player, id, el ? el.value : arg);
                break;
            }
            case 'toggle': {
                StreetFollowers.toggle(player, id);
                AnimalsPanel.showWhoWalks(game);
                return;
            }
            case 'all': {
                const keys = [];
                try { for (const n of Companions.members(player, world)) keys.push(StreetFollowers.npcKey(n.id)); } catch { /* none */ }
                if (RealmEscort.guard(player)) keys.push(StreetFollowers.GUARD);
                for (const a of AnimalCompanions.travelling(player, world)) keys.push(StreetFollowers.animalKey(a.id));
                for (const k of keys) StreetFollowers.set(player, k, arg === '1');
                AnimalsPanel.showWhoWalks(game, { ok: true, text: arg === '1' ? 'Everyone walks with you.' : 'Everyone waits for you in town.' });
                return;
            }
            case 'buy': {
                const s = AnimalsPanel._market;
                res = AnimalCompanions.buy(world, player, s, id);
                if (game.ui.updateStats) game.ui.updateStats(player, world);
                const msg = { ok: !!res.success, text: res.success ? res.text : res.reason };
                if (typeof ActionMenu.showLivestockMarket === 'function') { ActionMenu.showLivestockMarket(game, msg); return; }
                AnimalsPanel.show(game, res.animal && res.animal.id, msg);
                return;
            }
            default: return;
        }
        if (game.ui.updateStats) game.ui.updateStats(player, world);
        AnimalsPanel.show(game, id, res ? { ok: !!res.success, text: res.success ? res.text : res.reason } : null);
    },
};
