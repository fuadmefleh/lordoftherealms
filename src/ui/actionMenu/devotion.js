// DevotionPanel — prayer and meditation results, vows, omens, alms by
// recipient, pilgrimages (declare, kneel, offer), the temple's devotions and
// the soul pact. Logic lives in systems/devotion.js and systems/soulPact.js;
// this module only presents it. Not merged into ActionMenu (its members are
// fixed by actionMenu.structure.test.js): ActionMenu methods call in here.
import { ActionMenu } from './_ref.js';
import { Religion } from './_imports.js';
import { Devotion } from '../../systems/devotion.js';
import { SoulPact } from '../../systems/soulPact.js';
import { BTN_GOLD, BTN_PLAIN, BTN_RED, BTN_OFF, CARD, esc } from './uiKit.js';

const HEAD = 'font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin: 12px 0 4px; color: var(--text-secondary);';
const NOTE = 'font-size: 11px; color: var(--text-secondary); margin: 2px 0;';

function _btn(ok, label, call, style = BTN_GOLD, why = '') {
    return ok ? `<button onclick="${call}" style="${style}">${label}</button>` : `<button disabled title="${esc(why)}" style="${BTN_OFF}">${label}</button>`;
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
        let h = '<div style="text-align: left; padding: 8px 12px; background: rgba(255,255,255,0.04); border-radius: 6px; margin-bottom: 8px;">';
        if (res.heal) h += `<div>❤️ Healed: <span style="color: #2ecc71;">+${res.heal} HP</span></div>`;
        h += `<div>☯️ Karma: <span style="color: #3498db;">${res.karma ? `+${res.karma}` : 'none'}</span>${res.karma ? '' : ' <span style="font-size: 11px; color: var(--text-muted);">(no more today)</span>'}</div>`;
        if (res.faith) h += `<div style="color: #f5c542;">🙏 Your faith deepened (+${res.faith}).</div>`;
        if (res.intelligence) h += `<div style="color: #f5c542;">🧠 Your mind feels sharper (+${res.intelligence}).</div>`;
        if (res.standing) h += `<div style="${NOTE}">The clergy's regard for you grows (+${res.standing}).</div>`;
        if (res.fine) h += `<div style="color: #e07070;">💰 Fined ${res.fine} gold.</div>`;
        if (res.harm) h += `<div style="color: #e07070;">🩸 −${res.harm} health.</div>`;
        for (const n of res.notes || []) h += `<div style="${NOTE}">${esc(n)}</div>`;
        h += '</div>';
        if (res.omen) h += `<div style="${CARD} border-color: rgba(155,89,182,0.5);"><strong>${res.omen.icon} An omen</strong><div style="font-size: 12px; font-style: italic; margin-top: 4px;">${esc(res.omen.text)}</div>${res.omen.q != null ? '<div style="font-size: 10px; color: var(--text-muted);">The place is marked on your map.</div>' : ''}</div>`;
        if (res.vowOffers && res.vowOffers.length) h += DevotionPanel._vowOfferHtml(res.vowOffers);
        return h;
    },

    _vowOfferHtml(offers) {
        let h = `<div style="${CARD} border-color: rgba(245,197,66,0.4);"><strong>🙏 You feel moved to swear a vow</strong>`;
        h += '<div style="font-size: 11px; color: var(--text-secondary); margin: 2px 0 4px;">Kept, a vow is rewarded. Broken, it is not forgotten. You may take one today.</div>';
        for (const v of offers) {
            h += `<div style="margin-top: 4px; font-size: 12px;">${v.icon} <strong>${esc(v.name)}</strong> — ${esc(v.text)}</div>`;
            h += `<button onclick="window._devo.vow('${v.id}')" style="${BTN_PLAIN}">Swear it</button>`;
        }
        return h + '</div>';
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
                game.ui.showNotification('🥾 Pilgrimage', res.success ? `You swear to walk to ${res.target.name} within ${res.vow.days} days.` : res.reason, res.success ? 'success' : 'error');
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

    showResult(game, tile, res, { kind = 'pray', endDay = false, title = null } = {}) {
        let h = '<div>';
        h += DevotionPanel.resultHtml(res);
        h += `<button onclick="window._devo.journal()" style="${BTN_PLAIN}">📿 Your devotions</button>`;
        h += endDay
            ? `<button data-am-act="closePanelAndEndDay" style="${BTN_GOLD} width: 100%; padding: 9px; margin-top: 8px;">Continue</button>`
            : `<button data-am-act="closePanel" style="${BTN_GOLD} width: 100%; padding: 9px; margin-top: 8px;">Continue</button>`;
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
        h += `<div style="${CARD}"><strong>${creed ? `${creed.icon} ${esc(creed.name)}` : '— No creed —'}</strong>`;
        h += `<div style="${NOTE}">${creed ? (creed.own ? 'The faith you founded.' : 'The faith you keep. Its temples and shrines answer you best.') : 'You keep no faith. Prayers count for less, everywhere.'}</div>`;
        // Adopt the local faith
        const s = tile && tile.settlement;
        const k = s && s.kingdom && world.getKingdom ? world.getKingdom(s.kingdom) : null;
        const localFaith = (tile && tile.holySite && tile.holySite.faithId) || (k && k.religion && k.religion.faithId) || null;
        if (localFaith && (!creed || creed.id !== localFaith) && !player.religion) {
            const f = Religion.FAITHS[localFaith];
            const chk = Devotion.canAdopt(player, world, localFaith);
            if (f) h += _btn(chk.can, `${f.icon} Take up ${esc(f.name)}`, `window._devo.adopt('${localFaith}')`, BTN_PLAIN, chk.reason);
        }
        h += '</div>';

        // Vows
        h += `<div style="${HEAD}">Vows</div>`;
        const vows = Devotion.vows(player, world);
        if (!vows.length) h += `<div style="${NOTE}">You are bound by no vow.</div>`;
        for (const v of vows) {
            h += `<div style="${CARD}">${v.icon} <strong>${esc(v.name)}</strong> — ${esc(v.text)}<div style="${NOTE}">${v.daysLeft} day${v.daysLeft === 1 ? '' : 's'} left${v.id === 'alms' ? ` · given ${v.progress}/${v.gold} gold` : ''}</div></div>`;
        }
        const offers = Devotion.offeredVows(player, world);
        if (offers.length) h += DevotionPanel._vowOfferHtml(offers);

        // Pilgrimage
        h += `<div style="${HEAD}">Pilgrimage</div>`;
        const pil = Devotion.pilgrimage(player);
        if (pil) h += `<div style="${NOTE}">You are sworn to walk to ${esc(pil.site.name)} — ${Math.max(0, pil.until - world.day)} days left.</div>`;
        else {
            const targets = Devotion.pilgrimageTargets(player, world, 6);
            if (!targets.length) h += `<div style="${NOTE}">You know of no holy site to walk to.</div>`;
            for (const t of targets) {
                const tag = t.match === 'same' ? '<span style="color: #7fd07f;">your faith</span>' : t.faith ? esc(t.faith) : 'no faith';
                const risk = t.hostile ? ' · <span style="color: #e07070;">held by enemies</span>' : t.contested ? ' · <span style="color: #e0a040;">contested</span>' : '';
                h += `<div style="font-size: 12px; margin-top: 4px;">${t.icon} <strong>${esc(t.name)}</strong> · ${t.dist} hexes · ${tag}${risk}${t.visits ? ` · visited ${t.visits}×` : ''}</div>`;
                h += _btn(st.vows.length < (Devotion.config().maxVows || 2), `🥾 Swear to walk there (${t.days} days)`, `window._devo.swear(${t.q}, ${t.r})`, BTN_PLAIN, 'You are bound by as many vows as you can keep.');
            }
        }

        // Omens
        if (st.omens.length) {
            h += `<div style="${HEAD}">Omens</div>`;
            for (const o of st.omens.slice(0, 5)) h += `<div style="${NOTE}">${o.icon} Day ${o.day}: ${esc(o.text)}</div>`;
        }
        // Standing
        const stand = Object.entries(st.standing).filter(([, v]) => Math.abs(v) >= 1);
        if (stand.length) {
            h += `<div style="${HEAD}">Clergy standing</div>`;
            for (const [fid, v] of stand) {
                const f = Religion.FAITHS[fid];
                if (f) h += `<div style="${NOTE}">${f.icon} ${esc(f.name)}: ${Math.round(v)}</div>`;
            }
        }
        // The soul
        const pact = SoulPact.state(player);
        if (SoulPact.isSold(player)) {
            h += `<div style="${HEAD}">Your soul</div><div style="${NOTE} color: #e07070;">${esc(pact.buyer)} holds it${pact.state === 'cursed' ? ' — and you are cursed' : ''}. A temple can buy it back; so can a pilgrimage kept at a shrine of your own faith.</div>`;
        }
        h += `<div style="${HEAD}">Record</div><div style="${NOTE}">${st.stats.prayers} prayers · ${st.stats.meditations} meditations · ${st.stats.almsGiven} gold in alms · vows kept ${st.stats.vowsKept}, broken ${st.stats.vowsBroken} · ${st.stats.pilgrimages} pilgrimages</div>`;
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
        h += `<p style="font-size: 12px; color: var(--text-secondary); margin-top: 0;">Give gold in ${esc(s.name)}. Who receives it decides what it does.</p>`;
        if (factor < 0.95) h += `<div style="${NOTE} color: #e0a040;">You have given a great deal here lately: a gift counts for ${Math.round(factor * 100)}% of its worth.</div>`;
        for (const o of opts) {
            const on = chosen && o.id === chosen.id;
            h += `<div style="${CARD}${on ? ' border-color: var(--gold);' : ''}">${o.icon} <strong>${esc(o.label)}</strong><div style="${NOTE}">${esc(o.detail || '')}</div>`;
            if (!on) h += _btn(o.available, 'Choose', `window._devo.pick('${o.id}')`, BTN_PLAIN, o.reason || '');
            h += '</div>';
        }
        if (maxGive >= 5 && chosen) {
            const v = Math.min(50, maxGive);
            h += `<div style="margin: 10px 0;"><label style="font-size: 12px;">Amount for ${esc(chosen.label)}:</label><br>`;
            h += `<input type="range" id="devoAmount" min="5" max="${maxGive}" value="${v}" oninput="document.getElementById('devoLabel').textContent = this.value" style="width: 100%;">`;
            h += `<span id="devoLabel" style="color: var(--gold); font-weight: bold;">${v}</span> gold</div>`;
            h += `<button onclick="window._devo.give('${chosen.id}')" style="${BTN_GOLD} width: 100%; padding: 9px;">Give</button>`;
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
        h += `<div style="text-align: center; padding: 8px 0;"><div style="font-size: 40px;">${site.icon || '⛲'}</div><h3 style="margin: 6px 0; color: var(--gold);">${esc(site.name)}</h3>`;
        h += `<p style="font-size: 12px; color: var(--text-secondary);">${esc(site.description || '')}</p>`;
        if (faith) h += `<div style="font-size: 12px;">${faith.icon} ${esc(faith.name)} — ${pre.match === 'same' ? '<span style="color: #7fd07f;">your faith</span>' : pre.match === 'none' ? 'you keep no faith' : 'not your faith'}</div>`;
        h += `<div style="font-size: 12px;">${pre.risk.holder ? `Held by <strong>${esc(pre.risk.holder.name)}</strong>` : 'Unclaimed'}</div></div>`;
        if (pre.vowed) h += `<div style="${NOTE} color: #7fd07f;">🥾 You swore to come here. Kneel, and the vow is kept.</div>`;
        if (pre.visits) h += `<div style="${NOTE}">You have knelt here ${pre.visits} time${pre.visits === 1 ? '' : 's'} before; the shrine gives less to the familiar.</div>`;
        if (!pre.blessingReady) h += `<div style="${NOTE}">The shrine's great blessing is not given twice in a season.</div>`;
        if (pre.risk.hostile) h += `<div style="${NOTE} color: #e07070;">⚠️ Its holders are hostile to you: their wardens may fine or beat a pilgrim they recognise.</div>`;
        if (pre.risk.contested) h += `<div style="${NOTE} color: #e0a040;">⚔️ Contested: the crowds are tense. Braving it is talked of.</div>`;
        if (pre.risk.desecrated) h += `<div style="${NOTE}">The shrine is held by another faith and has soured.</div>`;
        if (pre.soul === 'sold' || pre.soul === 'due' || pre.soul === 'cursed') h += `<div style="${NOTE} color: #e07070;">Your soul is not your own. ${pre.vowed && pre.match === 'same' ? 'Keeping your vow at a shrine of your faith may win it back.' : 'Only a vowed pilgrimage to a shrine of your own faith could win it back.'}</div>`;
        h += `<div style="${HEAD}">Kneel and make an offering</div>`;
        for (const o of pre.offerings) h += _btn(o.can, `${esc(o.label)} (${o.gold}g)`, `window._devo.kneel('${o.id}')`, BTN_GOLD, `Costs ${o.gold} gold`);
        h += `<div style="margin-top: 8px;"><button onclick="window._devo.prayHere()" style="${BTN_PLAIN}">🙏 Pray here</button>`;
        h += `<button onclick="window._devo.journal()" style="${BTN_PLAIN}">📿 Your devotions</button></div>`;
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
            DevotionPanel.devote(game, tile, 'pray', { place: 'holy', endDay: false });
        };
    },

    _pilgrimResult(game, tile, r) {
        let h = '<div>';
        h += `<div style="${CARD}"><strong>🙏 ${esc(r.siteName)}</strong>`;
        h += `<div style="font-size: 12px; margin-top: 4px;">${r.offering ? `You leave ${r.offering} gold at the shrine. ` : ''}☯️ ${_signed(r.karma)} karma · ⭐ ${_signed(r.renown)} renown${r.faith ? ` · 🙏 faith +${r.faith}` : ''}</div>`;
        if (r.blessing) h += `<div style="font-size: 12px; color: #c9a0ff; margin-top: 4px;">✨ ${esc(r.blessing.text)}${r.blessing.effects.length ? ` (${esc(r.blessing.effects.join(', '))})` : ''}</div>`;
        if (r.vowKept) h += `<div style="font-size: 12px; color: #7fd07f; margin-top: 4px;">🥾 ${esc(r.vowKept)}</div>`;
        for (const n of r.notes) h += `<div style="${NOTE}">${esc(n)}</div>`;
        h += '</div>';
        const omen = r.blessing && r.blessing.omen;
        if (omen) h += `<div style="${CARD}"><strong>${omen.icon} A vision</strong><div style="font-size: 12px; font-style: italic;">${esc(omen.text)}</div></div>`;
        h += `<button data-am-act="closePanel" style="${BTN_GOLD} width: 100%; padding: 9px;">Continue</button></div>`;
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
        let h = `<div style="${CARD}"><div style="font-weight: bold;">🕯️ Devotions</div>`;
        h += `<div style="${NOTE}">Pray in the temple, give alms, swear vows, or walk a pilgrim's road.</div>`;
        h += `<button onclick="window._devo.templePray()" style="${BTN_PLAIN}">🙏 Pray</button>`;
        h += `<button onclick="window._devo.templeAlms()" style="${BTN_PLAIN}">💰 Alms</button>`;
        h += `<button onclick="window._devo.journal()" style="${BTN_PLAIN}">📿 Your devotions</button>`;
        if (SoulPact.isSold(player)) {
            const cost = SoulPact.redeemCost(player, Devotion.templeDiscount(player, fid));
            h += `<div style="margin-top: 6px; font-size: 12px; color: #e07070;">${esc(SoulPact.state(player).buyer)} holds your soul. The priests know a rite of redemption.</div>`;
            h += _btn((player.gold || 0) >= cost, `✝️ Redeem your soul (${cost}g)`, 'window._devo.redeem()', BTN_RED, `The rite takes ${cost} gold in offerings`);
        }
        return h + '</div>';
    },

    bindTemple(game, tile) {
        DevotionPanel._bind(game, tile);
        const s = tile && tile.settlement;
        const k = s && s.kingdom && game.world.getKingdom ? game.world.getKingdom(s.kingdom) : null;
        const fid = k && k.religion && k.religion.faithId;
        Object.assign(window._devo, {
            templePray: () => {
                if (!ActionMenu.commitPendingAP(game)) return;
                DevotionPanel.devote(game, tile, 'pray', { place: 'temple', endDay: false, title: '⛪ Prayer' });
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
            h += `<p style="font-size: 12px; font-style: italic;">In the corner sits ${esc(o.look)}. This is ${esc(o.name)}, and ${esc(o.name)} is very interested in you.</p>`;
            h += `<div style="${CARD}">"Your soul, friend. Not all at once — I'll come for the rest in time. <strong>${o.price} gold</strong>, here, tonight."`;
            h += `<div style="${NOTE}">Karma and renown fall at once. In a few weeks the debt comes due, and ${esc(o.name)} will want something. Refuse, and you will be cursed.</div></div>`;
            if (st.state === 'redeemed') h += `<div style="${NOTE}">You bought your soul back once. ${esc(o.name)} doesn't seem to mind.</div>`;
            h += `<button onclick="window._pact.sell()" style="${BTN_RED}">🔥 Shake the cold hand (${o.price}g)</button>`;
            h += `<button data-am-act="closePanel" style="${BTN_PLAIN}">Walk away</button>`;
        } else if (st.state === 'sold') {
            h += `<p style="font-size: 12px;">${esc(st.buyer)} raises a cup to you from the corner. "Not yet. Soon."</p>`;
            h += `<div style="${NOTE}">Your soul is held. A temple can buy it back; so can a pilgrimage kept at a shrine of your faith.</div>`;
        } else if (st.state === 'due') {
            const d = SoulPact.demand(player, world);
            h += `<div style="${CARD}"><strong>${d.icon} ${esc(st.buyer)} wants payment: ${esc(d.label)}</strong><div style="font-size: 12px; font-style: italic; margin: 4px 0;">${esc(d.text)}</div>`;
            h += `<div style="${NOTE}">${d.daysLeft} day${d.daysLeft === 1 ? '' : 's'} to answer.${d.deed ? ` Done so far: ${d.progress >= d.amount ? 'yes' : 'not yet'}.` : ''}</div></div>`;
            const gold = SoulPact.payCost(player);
            h += _btn((player.gold || 0) >= Math.round(gold), `💰 Pay ${Math.round(gold)} gold`, "window._pact.answer('pay')", BTN_GOLD, `You need ${Math.round(gold)} gold`);
            h += `<button onclick="window._pact.answer('refuse')" style="${BTN_RED}">✋ Refuse</button>`;
            if (d.deed) h += `<div style="${NOTE}">Or do what is asked before the days run out.</div>`;
        } else if (st.state === 'cursed') {
            h += `<p style="font-size: 12px; color: #e07070;">${esc(st.buyer)} is gone, and so is your luck. The curse holds until your soul is redeemed at a temple, or won back on a pilgrimage.</p>`;
        }
        if (st.history.length) {
            h += `<div style="${HEAD}">The bargain</div>`;
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
