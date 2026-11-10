// DevotionPanel — prayer and meditation results, vows, omens, alms by
// recipient, pilgrimages (declare, kneel, offer), the temple's devotions and
// the soul pact. Logic lives in systems/devotion.js and systems/soulPact.js;
// this module only presents it. Not merged into ActionMenu (its members are
// fixed by actionMenu.structure.test.js): ActionMenu methods call in here.
import { ActionMenu } from './_ref.js';
import { Religion } from './_imports.js';
import { Devotion } from '../../systems/devotion.js';
import { SoulPact } from '../../systems/soulPact.js';
import { PerformTasks } from '../mapTasks/performTasks.js';
import { BTN_GOLD, esc, chips, lede, sectionHead, card, actRow, rowList, price, purse } from './uiKit.js';

// In the action menu's voice (ui/actionMenu/uiKit.js): cards for what happened,
// one row a thing to do, greyed with its reason when it can't be done
const NOTE = 'font-size: 11px; color: #9d937c; margin: 2px 0;';

/** A row that runs `call` (an inline onclick) when `ok`; greyed with `why` when not. */
function _row(ok, call, o) {
    return actRow({ ...o, off: !ok, attrs: ok ? `onclick="${call}"` : '' });
}

/** The panel's closing button (the one real button left: it ends the view). */
function _continue(act) {
    return `<button data-am-act="${act}" style="${BTN_GOLD} width: 100%; padding: 9px; margin-top: 8px;">Continue</button>`;
}

function _signed(n) {
    return `${n >= 0 ? '+' : ''}${n}`;
}

function _notify(game, title, res, okType = 'success') {
    if (!res) return;
    if (res.success === false) game.ui.showNotification(title, res.reason || 'Not now.', 'error');
    else game.ui.showNotification(title, res.text || 'Done.', okType);
}

/** A tile's place kind for devotion. */
function _placeOf(tile) {
    if (tile && tile.holySite) return 'holy';
    if (tile && tile.religiousBuilding) return 'temple';
    return 'field';
}

export const DevotionPanel = {
    // ──────────── RESULTS ────────────

    /** The outcome of one prayer/meditation as HTML (for the meditation result and the furniture panels). */
    resultHtml(res) {
        let h = chips([
            res.heal ? { icon: '❤️', label: 'Healed', value: `<span style="color: #8fd18a;">+${res.heal} HP</span>` } : null,
            { icon: '☯️', label: 'Karma', value: res.karma ? `+${res.karma}` : 'none', cls: res.karma ? 'gold' : 'dim' },
        ]);
        if (!res.karma) h += `<div style="${NOTE}">(no more today)</div>`;
        const lines = [];
        if (res.faith) lines.push(`<div style="color: #ffcf6a;">🙏 Your faith deepened (+${res.faith}).</div>`);
        if (res.intelligence) lines.push(`<div style="color: #ffcf6a;">🧠 Your mind feels sharper (+${res.intelligence}).</div>`);
        if (res.standing) lines.push(`<div style="${NOTE}">The clergy's regard for you grows (+${res.standing}).</div>`);
        if (res.fine) lines.push(`<div style="color: #e0846a;">💰 Fined ${res.fine} gold.</div>`);
        if (res.harm) lines.push(`<div style="color: #e0846a;">🔴 −${res.harm} health.</div>`);
        for (const n of res.notes || []) lines.push(`<div style="${NOTE}">${esc(n)}</div>`);
        if (lines.length) h += `<div style="font-size: 12px; margin: 4px 0 8px;">${lines.join('')}</div>`;
        if (res.omen) {
            h += card(`<div style="font-size: 12px; font-style: italic; color: #cbbf9f;">${esc(res.omen.text)}</div>${res.omen.q != null ? `<div style="${NOTE}">The place is marked on your map.</div>` : ''}`,
                { icon: res.omen.icon, title: 'An omen' });
        }
        if (res.vowOffers && res.vowOffers.length) h += DevotionPanel._vowOfferHtml(res.vowOffers);
        return h;
    },

    _vowOfferHtml(offers) {
        let h = sectionHead('🙏 You feel moved to swear a vow');
        h += `<div style="${NOTE}">Kept, a vow is rewarded. Broken, it is not forgotten. You may take one today.</div>`;
        return h + rowList(offers.map(v => actRow({
            icon: v.icon, name: esc(v.name), desc: esc(v.text), side: 'Swear it', tone: 'gold',
            attrs: `onclick="window._devo.vow('${v.id}')"`,
        })));
    },

    _bind(game, tile) {
        const reopenJournal = () => DevotionPanel.showJournal(game, tile);
        window._devo = Object.assign(window._devo || {}, {
            vow: (id) => {
                const r = Devotion.takeVow(game.player, game.world, id);
                game.ui.showNotification('🙏 Vow', r.success ? `You swore the ${r.vow.name}: ${r.vow.text}` : r.reason, r.success ? 'success' : 'error');
                if (r.success) reopenJournal();
            },
            journal: reopenJournal,
            adopt: (faithId) => {
                const r = Devotion.adoptFaith(game.player, game.world, faithId);
                game.ui.showNotification('🙏 Faith', r.success ? `You take up ${r.faith.name}.${r.karma ? ` (${r.karma} karma for leaving your old faith)` : ''}` : r.reason, r.success ? 'success' : 'error');
                game.ui.updateStats(game.player, game.world);
                reopenJournal();
            },
            swear: (q, r) => {
                const res = Devotion.declarePilgrimage(game.player, game.world, q, r);
                game.ui.showNotification('👣 Pilgrimage', res.success ? `You swear to walk to ${res.target.name} within ${res.vow.days} days.` : res.reason, res.success ? 'success' : 'error');
                reopenJournal();
            },
        });
    },

    /**
     * Pray or meditate here (the world-map Meditate action, the temple, an
     * altar). quality 0..1 is the minigame's score; endDay ends the day after.
     */
    devote(game, tile, kind, { quality = 0.5, place = null, placeKey = null, endDay = true, title = null } = {}) {
        const res = Devotion.devote(game.player, game.world, { kind, place: place || _placeOf(tile), tile, quality, placeKey });
        DevotionPanel.showResult(game, tile, res, { kind, endDay, title });
        return res;
    },

    /**
     * Pray as a rite done in person on the street map (ui/mapTasks/performTasks.js):
     * light a candle at the church, walk the circuit, kneel at the steps. The
     * rite's quality 0..1 goes to the devotion model.
     */
    rite(game, tile, place, title) {
        PerformTasks.rite(game, {
            place,
            title: title.replace(/^\S+\s/, ''),
            icon: title.split(' ')[0],
            stat: game.player.faith || 5,
            onQuality: (quality) => DevotionPanel.devote(game, tile, 'pray', { place, quality, endDay: false, title }),
            onAbandon: () => game.ui.showNotification('🙏 Prayer', 'You leave the rite unfinished. The candle gutters out.', 'warning'),
        });
    },

    showResult(game, tile, res, { kind = 'pray', endDay = false, title = null } = {}) {
        let h = '<div>';
        h += DevotionPanel.resultHtml(res);
        h += rowList([{ icon: '📿', name: 'Your devotions', desc: 'Creed, vows, pilgrimage, omens', attrs: 'onclick="window._devo.journal()"' }]);
        h += _continue(endDay ? 'closePanelAndEndDay' : 'closePanel');
        h += '</div>';
        game.ui.showCustomPanel(title || (kind === 'meditate' ? '🧘 Meditation' : '🙏 Prayer'), h);
        DevotionPanel._bind(game, tile);
        game.ui.updateStats(game.player, game.world);
    },

    // ──────────── JOURNAL ────────────

    /** Creed, vows, pilgrimage, omens, clergy standing, the soul. */
    showJournal(game, tile) {
        const player = game.player;
        const world = game.world;
        const st = Devotion.state(player);
        const creed = Devotion.creed(player);
        let h = '<div>';
        h += lede(`<strong style="color: #ffcf6a;">${creed ? `${creed.icon} ${esc(creed.name)}` : '— No creed —'}</strong> · ${creed ? (creed.own ? 'The faith you founded.' : 'The faith you keep. Its temples and shrines answer you best.') : 'You keep no faith. Prayers count for less, everywhere.'}`);
        // Adopt the local faith
        const s = tile && tile.settlement;
        const k = s && s.kingdom && world.getKingdom ? world.getKingdom(s.kingdom) : null;
        const localFaith = (tile && tile.holySite && tile.holySite.faithId) || (k && k.religion && k.religion.faithId) || null;
        if (localFaith && (!creed || creed.id !== localFaith) && !player.religion) {
            const f = Religion.FAITHS[localFaith];
            const chk = Devotion.canAdopt(player, world, localFaith);
            if (f) h += rowList([_row(chk.can, `window._devo.adopt('${localFaith}')`, { icon: f.icon, name: `Take up ${esc(f.name)}`, desc: 'The faith kept here', why: esc(chk.reason || '') })]);
        }

        // Vows
        h += sectionHead('Vows');
        const vows = Devotion.vows(player, world);
        if (!vows.length) h += `<div style="${NOTE}">You are bound by no vow.</div>`;
        h += rowList(vows.map(v => actRow({
            icon: v.icon, name: esc(v.name), desc: esc(v.text),
            side: `${v.daysLeft} day${v.daysLeft === 1 ? '' : 's'} left`, tone: v.daysLeft <= 3 ? 'warn' : null,
            note: v.id === 'alms' ? `given ${v.progress}/${v.gold} gold` : '',
        })));
        const offers = Devotion.offeredVows(player, world);
        if (offers.length) h += DevotionPanel._vowOfferHtml(offers);

        // Pilgrimage
        h += sectionHead('Pilgrimage');
        const pil = Devotion.pilgrimage(player);
        if (pil) h += `<div style="${NOTE}">You are sworn to walk to ${esc(pil.site.name)} — ${Math.max(0, pil.until - world.day)} days left.</div>`;
        else {
            const targets = Devotion.pilgrimageTargets(player, world, 6);
            if (!targets.length) h += `<div style="${NOTE}">You know of no holy site to walk to.</div>`;
            const canVow = st.vows.length < (Devotion.config().maxVows || 2);
            h += rowList(targets.map(t => {
                const tag = t.match === 'same' ? '<span style="color: #8fd18a;">your faith</span>' : t.faith ? esc(t.faith) : 'no faith';
                const risk = t.hostile ? ' · <span style="color: #e0846a;">held by enemies</span>' : t.contested ? ' · <span style="color: #f0b35a;">contested</span>' : '';
                const where = `${t.dist} hexes · ${tag}${risk}${t.visits ? ` · visited ${t.visits}×` : ''}`;
                return _row(canVow, `window._devo.swear(${t.q}, ${t.r})`, {
                    icon: t.icon, name: esc(t.name), desc: `${where} · 👣 Swear to walk there`,
                    why: `${where} · You are bound by as many vows as you can keep.`,
                    side: `${t.days} days`, tone: 'gold',
                });
            }));
        }

        // Omens
        if (st.omens.length) {
            h += sectionHead('Omens');
            for (const o of st.omens.slice(0, 5)) h += `<div style="${NOTE}">${o.icon} Day ${o.day}: ${esc(o.text)}</div>`;
        }
        // Standing
        const stand = Object.entries(st.standing).filter(([, v]) => Math.abs(v) >= 1);
        if (stand.length) {
            h += sectionHead('Clergy standing');
            h += chips(stand.map(([fid, v]) => {
                const f = Religion.FAITHS[fid];
                return f ? [f.icon, esc(f.name), Math.round(v)] : null;
            }));
        }
        // The soul
        const pact = SoulPact.state(player);
        if (SoulPact.isSold(player)) {
            h += `${sectionHead('Your soul')}<div style="${NOTE} color: #e0846a;">${esc(pact.buyer)} holds it${pact.state === 'cursed' ? ' — and you are cursed' : ''}. A temple can buy it back; so can a pilgrimage kept at a shrine of your own faith.</div>`;
        }
        const rec = (icon, label, n) => [icon, label, n, n ? '' : 'dim'];
        h += sectionHead('Record') + chips([
            rec('🙏', 'Prayers', st.stats.prayers), rec('🕯️', 'Meditations', st.stats.meditations), ['💰', 'Alms', `${st.stats.almsGiven}g`, st.stats.almsGiven ? '' : 'dim'],
            rec('📜', 'Vows kept', st.stats.vowsKept), rec('💔', 'Broken', st.stats.vowsBroken), rec('⛪', 'Pilgrimages', st.stats.pilgrimages),
        ]);
        h += '</div>';
        game.ui.showCustomPanel('📿 Devotions', h);
        DevotionPanel._bind(game, tile);
    },

    // ──────────── ALMS ────────────

    showDonate(game, tile, sel = null) {
        const player = game.player;
        const world = game.world;
        const s = tile && tile.settlement;
        if (!s) {
            game.ui.showNotification('💰 Alms', 'There is no one here to give to.', 'info');
            return;
        }
        const opts = Devotion.donationOptions(player, world, tile);
        const chosen = opts.find(o => o.id === sel && o.available) || opts.find(o => o.available);
        const factor = Devotion.donationFactor(player, world, tile);
        const maxGive = Math.max(0, Math.min(Math.floor(player.gold || 0), 500));
        let h = '<div>';
        h += lede(`Give gold in ${esc(s.name)}. Who receives it decides what it does.`);
        h += chips([purse(player.gold)]);
        if (factor < 0.95) h += `<div style="${NOTE} color: #f0b35a;">You have given a great deal here lately: a gift counts for ${Math.round(factor * 100)}% of its worth.</div>`;
        h += rowList(opts.map(o => {
            const on = chosen && o.id === chosen.id;
            if (on) return actRow({ icon: o.icon, name: esc(o.label), desc: esc(o.detail || ''), side: '✓ Chosen', tone: 'gold' });
            return _row(o.available, `window._devo.pick('${o.id}')`, {
                icon: o.icon, name: esc(o.label), desc: esc(o.detail || ''),
                why: `${esc(o.detail || '')}${o.reason ? ` — ${esc(o.reason)}` : ''}`, side: 'Choose',
            });
        }), 'Who receives it');
        if (maxGive >= 5 && chosen) {
            const v = Math.min(50, maxGive);
            let form = `<label style="font-size: 12px; color: #cbbf9f;">Amount for ${esc(chosen.label)}:</label>`;
            form += `<input type="range" id="devoAmount" min="5" max="${maxGive}" value="${v}" oninput="document.getElementById('devoLabel').textContent = this.value" style="width: 100%; margin: 6px 0 2px; accent-color: #f5c542;">`;
            form += `<div><span id="devoLabel" style="color: #ffcf6a; font-weight: bold;">${v}</span> gold</div>`;
            form += `<button onclick="window._devo.give('${chosen.id}')" style="${BTN_GOLD} width: 100%; padding: 9px; margin-top: 8px;">Give</button>`;
            h += card(form, { icon: chosen.icon, title: 'The gift' });
        } else {
            h += `<div style="${NOTE}">You have nothing to give.</div>`;
        }
        h += '</div>';
        game.ui.showCustomPanel('💰 Alms', h);
        DevotionPanel._bind(game, tile);
        window._devo.pick = (id) => DevotionPanel.showDonate(game, tile, id);
        window._devo.give = (id) => {
            if (!ActionMenu.commitPendingAP(game)) return;
            const el = typeof document !== 'undefined' && document.getElementById ? document.getElementById('devoAmount') : null;
            const amount = parseInt((el && el.value) || 50, 10);
            const r = Devotion.donate(player, world, tile, id, amount);
            if (!r.success) {
                game.ui.showNotification('💰 Alms', r.reason, 'error');
                return;
            }
            const msg = `You gave ${r.amount} gold to ${r.recipient.label}.${r.karma ? ` +${r.karma} karma.` : ''} ${r.notes.join(' ')}`;
            game.ui.showNotification('💰 Alms', msg.trim(), 'success');
            for (const n of r.vowNotices || []) game.ui.showNotification(`${n.icon} ${n.title}`, n.text, n.type);
            game.ui.hideCustomPanel();
            game.ui.updateStats(player, world);
        };
    },

    // ──────────── PILGRIMAGE ────────────

    showPilgrimage(game, tile) {
        const player = game.player;
        const world = game.world;
        const pre = Devotion.pilgrimagePreview(player, world, tile);
        if (!pre) return;
        const site = pre.site;
        const faith = site.faithId ? Religion.FAITHS[site.faithId] : null;
        let h = '<div>';
        h += `<div style="text-align: center; padding: 4px 0 2px;"><div style="font-size: 40px;">${site.icon || '⛲'}</div><div style="margin: 4px 0; font-family: var(--font-display); font-size: 16px; color: #ffe9a8;">${esc(site.name)}</div></div>`;
        h += lede(esc(site.description || ''));
        h += chips([
            faith ? { icon: faith.icon, label: esc(faith.name), value: pre.match === 'same' ? '<span style="color: #8fd18a;">your faith</span>' : pre.match === 'none' ? 'you keep no faith' : 'not your faith' } : null,
            pre.risk.holder ? { icon: '🏰', label: 'Held by', value: esc(pre.risk.holder.name) } : { icon: '🏰', label: 'Unclaimed' },
            pre.visits ? ['🙏', 'Visits', pre.visits] : null,
        ]);
        if (pre.vowed) h += `<div style="${NOTE} color: #8fd18a;">👣 You swore to come here. Kneel, and the vow is kept.</div>`;
        if (pre.visits) h += `<div style="${NOTE}">You have knelt here ${pre.visits} time${pre.visits === 1 ? '' : 's'} before; the shrine gives less to the familiar.</div>`;
        if (!pre.blessingReady) h += `<div style="${NOTE}">The shrine's great blessing is not given twice in a season.</div>`;
        if (pre.risk.hostile) h += `<div style="${NOTE} color: #e0846a;">⚠️ Its holders are hostile to you: their wardens may fine or beat a pilgrim they recognise.</div>`;
        if (pre.risk.contested) h += `<div style="${NOTE} color: #f0b35a;">⚔️ Contested: the crowds are tense. Braving it is talked of.</div>`;
        if (pre.risk.desecrated) h += `<div style="${NOTE}">The shrine is held by another faith and has soured.</div>`;
        if (pre.soul === 'sold' || pre.soul === 'due' || pre.soul === 'cursed') h += `<div style="${NOTE} color: #e0846a;">Your soul is not your own. ${pre.vowed && pre.match === 'same' ? 'Keeping your vow at a shrine of your faith may win it back.' : 'Only a vowed pilgrimage to a shrine of your own faith could win it back.'}</div>`;
        h += rowList(pre.offerings.map(o => _row(o.can, `window._devo.kneel('${o.id}')`, {
            icon: '🕯️', name: esc(o.label), why: `Costs ${o.gold} gold`,
            side: price(o.gold, (player.gold || 0) >= o.gold),
        })), 'Kneel and make an offering');
        h += rowList([
            { icon: '🙏', name: 'Pray here', desc: 'A rite at the shrine', attrs: 'onclick="window._devo.prayHere()"' },
            { icon: '📿', name: 'Your devotions', desc: 'Creed, vows, pilgrimage, omens', attrs: 'onclick="window._devo.journal()"' },
        ]);
        h += '</div>';
        game.ui.showCustomPanel('⛲ Holy Site', h);
        DevotionPanel._bind(game, tile);
        window._devo.kneel = (id) => {
            if (!ActionMenu.commitPendingAP(game)) return;
            const r = Devotion.completePilgrimage(player, world, tile, id);
            if (!r.success) { game.ui.showNotification('⛲ Pilgrimage', r.reason, 'error'); return; }
            DevotionPanel._pilgrimResult(game, tile, r);
        };
        window._devo.prayHere = () => {
            if (!ActionMenu.commitPendingAP(game)) return;
            DevotionPanel.rite(game, tile, 'holy', '⛲ Prayer at the Shrine');
        };
    },

    _pilgrimResult(game, tile, r) {
        let h = '<div>';
        let body = r.offering ? `<div style="${NOTE}">You leave ${r.offering} gold at the shrine.</div>` : '';
        body += chips([
            ['☯️', 'Karma', _signed(r.karma)],
            ['⭐', 'Renown', _signed(r.renown)],
            r.faith ? ['🙏', 'Faith', `+${r.faith}`, 'gold'] : null,
        ]);
        if (r.blessing) body += `<div style="font-size: 12px; color: #c9a0ff; margin-top: 4px;">✨ ${esc(r.blessing.text)}${r.blessing.effects.length ? ` (${esc(r.blessing.effects.join(', '))})` : ''}</div>`;
        if (r.vowKept) body += `<div style="font-size: 12px; color: #8fd18a; margin-top: 4px;">👣 ${esc(r.vowKept)}</div>`;
        for (const n of r.notes) body += `<div style="${NOTE}">${esc(n)}</div>`;
        h += card(body, { icon: '🙏', title: esc(r.siteName) });
        const omen = r.blessing && r.blessing.omen;
        if (omen) h += card(`<div style="font-size: 12px; font-style: italic; color: #cbbf9f;">${esc(omen.text)}</div>`, { icon: omen.icon, title: 'A vision' });
        h += `${_continue('closePanel')}</div>`;
        game.ui.showCustomPanel('⛲ Pilgrimage', h);
        game.ui.updateStats(game.player, game.world);
    },

    // ──────────── TEMPLE ────────────

    /** The temple's devotions card (inside the temple service panel). */
    templeCardHtml(game, tile) {
        const player = game.player;
        const s = tile && tile.settlement;
        const k = s && s.kingdom && game.world.getKingdom ? game.world.getKingdom(s.kingdom) : null;
        const fid = k && k.religion && k.religion.faithId;
        let h = sectionHead('🕯️ Devotions');
        h += `<div style="${NOTE}">Pray in the temple, give alms, swear vows, or walk a pilgrim's road.</div>`;
        const rows = [
            { icon: '🙏', name: 'Pray', desc: 'A rite in the temple', attrs: 'onclick="window._devo.templePray()"' },
            { icon: '💰', name: 'Alms', desc: 'Give gold; who receives it decides what it does', attrs: 'onclick="window._devo.templeAlms()"' },
            { icon: '📿', name: 'Your devotions', desc: 'Creed, vows, pilgrimage, omens', attrs: 'onclick="window._devo.journal()"' },
        ];
        if (SoulPact.isSold(player)) {
            const cost = SoulPact.redeemCost(player, Devotion.templeDiscount(player, fid));
            const holds = `${esc(SoulPact.state(player).buyer)} holds your soul. The priests know a rite of redemption.`;
            rows.push(_row((player.gold || 0) >= cost, 'window._devo.redeem()', {
                icon: '✝️', name: 'Redeem your soul', desc: `<span style="color: #e0846a;">${holds}</span>`,
                why: `${holds} The rite takes ${cost} gold in offerings.`,
                side: price(cost, (player.gold || 0) >= cost),
            }));
        }
        return h + rowList(rows);
    },

    bindTemple(game, tile) {
        DevotionPanel._bind(game, tile);
        const s = tile && tile.settlement;
        const k = s && s.kingdom && game.world.getKingdom ? game.world.getKingdom(s.kingdom) : null;
        const fid = k && k.religion && k.religion.faithId;
        Object.assign(window._devo, {
            templePray: () => {
                if (!ActionMenu.commitPendingAP(game)) return;
                DevotionPanel.rite(game, tile, 'temple', '⛪ Prayer');
            },
            templeAlms: () => DevotionPanel.showDonate(game, tile, 'temple'),
            redeem: () => {
                const r = SoulPact.redeem(game.player, game.world, 'temple', Devotion.templeDiscount(game.player, fid));
                _notify(game, '✝️ Redemption', r);
                game.ui.updateStats(game.player, game.world);
                if (r.success) game.ui.hideCustomPanel();
            },
        });
    },

    // ──────────── THE SOUL PACT ────────────

    showSoulPact(game, tile) {
        const player = game.player;
        const world = game.world;
        const st = SoulPact.state(player);
        const o = SoulPact.offer(player, world, tile);
        let h = '<div>';
        if (st.state === 'none' || st.state === 'redeemed') {
            h += lede(`<i>In the corner sits ${esc(o.look)}. This is ${esc(o.name)}, and ${esc(o.name)} is very interested in you.</i>`);
            h += card(`<div style="font-size: 12px; font-style: italic; color: #cbbf9f;">"Your soul, friend. Not all at once — I'll come for the rest in time. <strong style="color: #ffcf6a;">${o.price} gold</strong>, here, tonight."</div>`
                + `<div style="${NOTE}">Karma and renown fall at once. In a few weeks the debt comes due, and ${esc(o.name)} will want something. Refuse, and you will be cursed.</div>`,
            { icon: '🔥', title: esc(o.name) });
            if (st.state === 'redeemed') h += `<div style="${NOTE}">You bought your soul back once. ${esc(o.name)} doesn't seem to mind.</div>`;
            h += rowList([
                { icon: '🔥', name: 'Shake the cold hand', desc: 'Sell your soul', side: `${o.price}g`, tone: 'bad', attrs: 'onclick="window._pact.sell()"' },
                { icon: '🚶', name: 'Walk away', act: 'closePanel' },
            ]);
        } else if (st.state === 'sold') {
            h += lede(`${esc(st.buyer)} raises a cup to you from the corner. "Not yet. Soon."`);
            h += `<div style="${NOTE}">Your soul is held. A temple can buy it back; so can a pilgrimage kept at a shrine of your faith.</div>`;
        } else if (st.state === 'due') {
            const d = SoulPact.demand(player, world);
            h += card(`<div style="font-size: 12px; font-style: italic; margin: 0 0 4px; color: #cbbf9f;">${esc(d.text)}</div>`
                + `<div style="${NOTE}">${d.daysLeft} day${d.daysLeft === 1 ? '' : 's'} to answer.${d.deed ? ` Done so far: ${d.progress >= d.amount ? 'yes' : 'not yet'}.` : ''}</div>`,
            { icon: d.icon, title: `${esc(st.buyer)} wants payment: ${esc(d.label)}`, side: `${d.daysLeft}d`, tone: d.daysLeft <= 2 ? 'bad' : 'warn' });
            const gold = Math.round(SoulPact.payCost(player));
            h += rowList([
                _row((player.gold || 0) >= gold, "window._pact.answer('pay')", { icon: '💰', name: `Pay ${gold} gold`, why: `You need ${gold} gold`, side: price(gold, (player.gold || 0) >= gold) }),
                { icon: '✋', name: 'Refuse', desc: 'And be cursed', side: 'refuse', tone: 'bad', attrs: 'onclick="window._pact.answer(\'refuse\')"' },
            ]);
            if (d.deed) h += `<div style="${NOTE}">Or do what is asked before the days run out.</div>`;
        } else if (st.state === 'cursed') {
            h += lede(`<span style="color: #e0846a;">${esc(st.buyer)} is gone, and so is your luck. The curse holds until your soul is redeemed at a temple, or won back on a pilgrimage.</span>`);
        }
        if (st.history.length) {
            h += sectionHead('The bargain');
            for (const e of st.history.slice(0, 4)) h += `<div style="${NOTE}">Day ${e.d}: ${esc(e.text)}</div>`;
        }
        h += '</div>';
        game.ui.showCustomPanel('🔥 The Stranger', h);
        window._pact = {
            sell: () => {
                const r = SoulPact.sell(player, world, tile);
                _notify(game, '🔥 Soul Sold', r, 'warning');
                game.ui.updateStats(player, world);
                DevotionPanel.showSoulPact(game, tile);
            },
            answer: (choice) => {
                const r = SoulPact.answer(player, world, choice);
                _notify(game, '🔥 The Stranger', r, r && r.cursed ? 'error' : 'info');
                game.ui.updateStats(player, world);
                DevotionPanel.showSoulPact(game, tile);
            },
        };
    },
};

if (typeof window !== 'undefined') window.DevotionPanel = DevotionPanel;
