// ActionMenu — Claims & Crowns: claims on thrones, succession crises, the war
// for a crown, and ruling a realm. Logic lives in systems/throne.js; this
// panel presents it in the action menu's voice (ui/actionMenu/uiKit.js).
import { ActionMenu } from './_ref.js';
import { Sieges } from '../../systems/sieges.js';
import { Throne, PlayerMilitary, House } from './_imports.js';
import { chips, purse, sectionHead, card, actRow, rowList, price, BTN_GOLD, BTN_DARK, BTN_RED, BTN_OFF } from './uiKit.js';

const MUTED = 'color: #9d937c; font-size: 11px;';
const AP = { battle: 2 };

const _esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));

function _btn(label, call, enabled = true, style = BTN_GOLD, title = '') {
    return `<button${title ? ` title="${_esc(title)}"` : ''} onclick="${enabled ? call : ''}" style="${enabled ? style : BTN_OFF}" ${enabled ? '' : 'disabled'}>${label}</button>`;
}

function _bar(value, min, max, color) {
    const pct = Math.round(((value - min) / Math.max(1, max - min)) * 100);
    return `<div style="height:5px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;margin:3px 0 5px;">
        <div style="width:${Math.max(0, Math.min(100, pct))}%;height:100%;background:${color};"></div></div>`;
}

function _side(side, wavering) {
    if (wavering) return '<span style="color:#f0b35a;">wavering</span>';
    return side === 'pretender' ? '<span style="color:#8fd18a;">for you</span>' : '<span style="color:#e0846a;">for the crown</span>';
}

/** A compact read-out of how a realm's towns and great lords lean. */
function _leanings(fc, sides = null) {
    const towns = fc.settlements.map(s => ({ ...s, side: sides ? (sides[s.key] || 'loyalist') : s.side, wavering: sides ? false : s.wavering }));
    const forYou = towns.filter(s => s.side === 'pretender').length;
    let html = `<div style="${MUTED}margin-top:4px;">Towns: ${forYou}/${towns.length} for you · Great lords: ${fc.advisors.filter(a => a.side === 'pretender').length}/${fc.advisors.length}</div>`;
    html += '<div style="display:flex;flex-wrap:wrap;gap:2px 10px;font-size:11px;margin-top:2px;color:#cbbf9f;">';
    for (const s of towns.slice(0, 12)) {
        html += `<span>${s.isCapital ? '👑' : '🏘️'} ${_esc(s.name)}: ${_side(s.side, s.wavering)}</span>`;
    }
    if (towns.length > 12) html += `<span style="${MUTED}">…and ${towns.length - 12} more</span>`;
    html += '</div>';
    if (fc.advisors.length) {
        html += '<div style="display:flex;flex-wrap:wrap;gap:2px 10px;font-size:11px;margin-top:2px;color:#cbbf9f;">';
        for (const a of fc.advisors) html += `<span>🎖️ ${_esc(a.roleName)} ${_esc(a.name)}: ${_side(a.side, a.wavering)}</span>`;
        html += '</div>';
    }
    return html;
}

Object.assign(ActionMenu, {
    /** Claims & Crowns: claims, crises, the war for a throne, and the realm you rule. */
    showClaimsPanel(game, tile) {
        const player = game.player;
        const world = game.world;
        const st = Throne.state(player);
        const cfg = Throne.config();
        const army = PlayerMilitary.getArmyStrength(player);
        const prestige = House.getPrestige(player);
        let html = '<div style="font-size:12px;">';
        html += chips([
            { icon: '⭐', label: 'Prestige', value: prestige, cls: 'gold' },
            ['⚔️', 'Army', army],
            purse(player.gold),
        ]);

        // ── The realm you rule ──
        const ruled = Throne.ruledKingdom(player, world);
        if (ruled) {
            const r = st.ruling;
            let body = `<div style="${MUTED}">Since day ${r.since}${r.founded ? ' · founded by your hand' : ''} · Treasury ${Math.floor(ruled.treasury || 0)}g · Army ${Math.floor(ruled.military || 0)} · Stability ${Math.round(ruled.stability || 0)} · Levy so far ${r.levyTotal || 0}g</div>`;
            // Why the levy is what it is (Throne.levyQuote): the rate, the realm's temper, the crown's upkeep
            const lq = Throne.levyQuote(player, world, ruled);
            const LIMIT = {
                rate: 'the tax policy',
                stability: `the realm's unrest (stability ${Math.round(lq.stability)}: ${Math.round(lq.stabilityMult * 100)}% of the dues reach you)`,
                surplus: lq.surplus > 0 ? `the crown's upkeep (only ${Math.floor(lq.surplus)}g a day is left over the army, court and works)` : `the crown's deficit (its upkeep ${Math.floor(lq.upkeep)}g a day outruns its ${Math.floor(lq.revenue)}g of revenue, so only the purse's first charge is paid)`,
                reserve: `the treasury's reserve (it keeps ${lq.reserve}g, ${cfg.ruling.levyReserveDays || 0} days of upkeep)`,
                cap: `the customary cap of ${lq.cap}g a day`,
            };
            body += `<div style="${MUTED}">Today's levy: <b>${lq.levy}g</b>, ${Math.round(lq.rate * 100)}% of the crown's ${Math.floor(lq.revenue)}g of daily dues, held down by ${LIMIT[lq.limit] || lq.limit}.</div>`;
            for (const axis of Throne.POLICY_AXES) {
                const def = Throne.policies()[axis];
                if (!def) continue;
                body += sectionHead(_esc(def.label));
                body += '<div>';
                for (const [id, opt] of Object.entries(def.options || {})) {
                    const active = r.policies[axis] === id;
                    body += `<button title="${_esc(opt.blurb || '')}" onclick="window._throne.policy('${axis}','${id}')" style="${active ? BTN_GOLD : BTN_DARK}">${opt.icon || ''} ${_esc(opt.label)}</button>`;
                }
                body += '</div>';
                const cur = def.options && def.options[r.policies[axis]];
                if (cur && cur.blurb) body += `<div style="${MUTED} margin-top:3px;">${_esc(cur.blurb)}</div>`;
            }
            const diplo = [];
            for (const d of Throne.diplomacyTargets(player, world)) {
                const status = d.atWar ? '<span style="color:#e0846a;">at war</span>' : d.allied ? '<span style="color:#8fd18a;">allied</span>' : d.truce ? '<span style="color:#9bc;">truce</span>' : `relations ${d.relations}`;
                let acts;
                if (d.atWar) {
                    acts = _btn(`🕊️ Propose peace (~${Math.round(Throne.peaceChance(player, world, d.kingdom.id) * 100)}%)`, `window._throne.peace('${d.kingdom.id}')`);
                } else {
                    acts = _btn('⚔️ Declare war', `window._throne.war('${d.kingdom.id}')`, !d.allied && !d.truce, BTN_RED)
                        + _btn('🤝 Propose alliance', `window._throne.ally('${d.kingdom.id}')`, !d.allied && d.relations >= cfg.ruling.allianceMinRelations)
                        + _btn(`🎁 Royal gifts (${cfg.ruling.giftCost}g)`, `window._throne.gift('${d.kingdom.id}')`, (ruled.treasury || 0) >= cfg.ruling.giftCost);
                }
                diplo.push(actRow({
                    icon: d.atWar ? '⚔️' : d.allied ? '🤝' : '🏰', name: _esc(d.kingdom.name),
                    desc: `${status} · army ${Math.floor(d.kingdom.military || 0)}`,
                    note: `<span style="display:block; margin-top:2px;">${acts}</span>`,
                }));
            }
            body += rowList(diplo, 'Diplomacy');
            body += rowList([
                { icon: '🏛️', name: 'Open the Royal Court', desc: 'The council, edicts, vassals and the realm', attrs: 'onclick="window._throne.court()"', side: '›', tone: 'gold' },
                { icon: '👑', name: 'Abdicate', desc: 'Lay down the crown', attrs: 'onclick="window._throne.abdicate()"', tone: 'bad' },
            ]);
            html += card(body, { icon: '👑', title: `${_esc(ruled.ruler)} — ${_esc(ruled.name)}`, tone: 'gold' });
        }

        // ── The war for a throne ──
        const cw = st.civilWar;
        const cwK = cw ? world.getKingdom(cw.kingdomId) : null;
        if (cw && cwK) {
            const fc = Throne.forecast(player, world, cw.kingdomId, { armyStrength: army });
            const days = world.day - cw.startDay;
            let body = `<div>Momentum <b style="color:${cw.momentum >= 0 ? '#8fd18a' : '#e0846a'};">${Math.round(cw.momentum)}</b> <span style="${MUTED}">(crowned at ${cfg.civilWar.victoryMomentum}, exile at ${cfg.civilWar.defeatMomentum})</span></div>`;
            body += _bar(cw.momentum, cfg.civilWar.defeatMomentum, cfg.civilWar.victoryMomentum, cw.momentum >= 0 ? '#8fd18a' : '#e0846a');
            body += `<div style="${MUTED}">Your levies ${Math.round(cw.levies)} + your army ${army} vs. loyalists ${Math.floor(cwK.military || 0)} · battles won ${cw.battlesWon}, lost ${cw.battlesLost}. Loyalist war hosts march on your holdings — break them in the field.</div>`;
            body += `<div style="${MUTED}">🏰 Or besiege a loyalist town: taken by storm or surrender, it declares for you (+${Sieges.config().civilWar.momentum} momentum, +${Sieges.config().civilWar.capitalMomentum} for the capital).</div>`;
            if (fc) body += _leanings(fc, cw.sides);
            const van = Throne.loyalistVanguard(player, world);
            body += rowList([
                { icon: '⚔️', name: 'Lead the assault', desc: `≈${van} strength`, off: !(army > 0), why: 'You have no army', attrs: 'onclick="window._throne.assault()"', side: `${AP.battle} AP`, tone: 'gold' },
                { icon: '🏳️', name: 'Abandon the claim', attrs: 'onclick="window._throne.abandon()"', tone: 'bad' },
            ]);
            html += card(body, { icon: '🚩', title: `War for the throne of ${_esc(cwK.name)}`, side: `day ${days}/${cfg.civilWar.maxDays}`, tone: 'bad' });
        }

        // ── Succession crises ──
        for (const c of st.crises) {
            const k = world.getKingdom(c.kingdomId);
            if (!k) continue;
            const total = c.claimants.reduce((s, x) => s + Math.max(1, x.support), 0);
            let body = `<div style="${MUTED}">${_esc(c.text)}</div>`;
            for (const cl of c.claimants) {
                const backed = c.backing && c.backing.claimantId === cl.id;
                const canBack = !c.backing || backed;
                body += `<div style="margin-top:8px;">${cl.isIncumbent ? '🏰' : '🗡️'} <b style="color:#ece2c8;">${_esc(cl.name)}</b><span style="${MUTED}">${cl.isIncumbent ? ' (holds the palace)' : ' (rival claimant)'} · support ${Math.round(cl.support)} (${Math.round(cl.support / total * 100)}%)</span>${backed ? ' · <span style="color:#8fd18a;">your choice</span>' : ''}</div>`;
                body += _bar(cl.support, 0, total, cl.isIncumbent ? '#9bc' : '#f0b35a');
                if (canBack) {
                    body += '<div>';
                    body += _btn(`💰 ${cfg.crisis.minGold}g`, `window._throne.back('${c.id}','${cl.id}','gold',${cfg.crisis.minGold})`, (player.gold || 0) >= cfg.crisis.minGold);
                    body += _btn(`💰 ${cfg.crisis.minGold * 3}g`, `window._throne.back('${c.id}','${cl.id}','gold',${cfg.crisis.minGold * 3})`, (player.gold || 0) >= cfg.crisis.minGold * 3);
                    body += _btn(`⭐ ${cfg.crisis.prestigeCost} Prestige`, `window._throne.back('${c.id}','${cl.id}','prestige')`, prestige >= cfg.crisis.prestigeCost);
                    body += _btn(`⚔️ Fight for them (${AP.battle} AP)`, `window._throne.backBattle('${c.id}','${cl.id}')`, army > 0);
                    body += '</div>';
                }
            }
            const strength = Throne.claimStrength(player, c.kingdomId);
            if (strength > 0) {
                const can = Throne.canPress(player, world, c.kingdomId, { armyStrength: army });
                body += rowList([{
                    icon: '🚩', name: 'Press your own claim',
                    desc: `You hold a claim of ${strength} on this throne. In a crisis the realm leans your way (+${cfg.lean.crisisBonus}).`,
                    note: can.ok ? '' : `<span style="color:#c98a6a;">${_esc(can.reason)}</span>`,
                    off: !can.ok, attrs: `onclick="window._throne.press('${c.kingdomId}')"`,
                    side: price(cfg.pressGold, (player.gold || 0) >= cfg.pressGold), tone: 'bad',
                }]);
            }
            html += card(body, { icon: '👑', title: `${_esc(c.causeLabel)} in ${_esc(k.name)}`, side: `${Math.max(0, c.endDay - world.day)} days left`, tone: 'warn' });
        }

        // ── Your claims ──
        const claims = Throne.claims(player, world).filter(c => !(cw && cw.kingdomId === c.kingdomId));
        html += sectionHead('📜 Your claims');
        if (!claims.length) html += `<div style="${MUTED} margin-bottom:8px;">You hold no claim on any throne. Earn one below, by marrying into a royal house, serving long in high office, or storming a capital.</div>`;
        for (const c of claims) {
            const fc = Throne.forecast(player, world, c.kingdomId, { armyStrength: army });
            const can = Throne.canPress(player, world, c.kingdomId, { armyStrength: army });
            let body = `<div style="${MUTED}">${c.sources.map(s => `${s.icon} ${_esc(s.label)} ${s.value}`).join(' · ')}</div>`;
            if (fc) {
                body += `<div style="margin-top:4px;">If you raised your banners today, <strong>${Math.round(fc.rebelShare * 100)}%</strong> of the realm would rise for you (appeal ${fc.appeal.value}).</div>`;
                body += `<div style="${MUTED}">${fc.appeal.parts.map(p => `${_esc(p.label)} ${p.value > 0 ? '+' : ''}${p.value}`).join(' · ')}</div>`;
                body += _leanings(fc);
            }
            body += rowList([{
                icon: '🚩', name: 'Press the claim', desc: 'Raise your banners for the throne',
                off: !can.ok, why: _esc(can.reason || ''), attrs: `onclick="window._throne.press('${c.kingdomId}')"`,
                side: price(cfg.pressGold, (player.gold || 0) >= cfg.pressGold), tone: 'bad',
            }]);
            html += card(body, { icon: '📜', title: _esc(c.kingdom.name), side: `<span style="color:${c.label.color};">${_esc(c.label.label)} claim (${c.strength})</span>` });
        }

        // ── Seek a claim ──
        {
            const spyChance = Math.round(Throne.forgeChance(player) * 100);
            html += sectionHead('🔎 Seek a claim');
            html += `<div style="${MUTED} margin-bottom:4px;">💍 Royal match: ${cfg.royalMatchPrestige} Prestige + ${cfg.royalMatchGold}g dowry, ${cfg.royalMatchMinReputation}+ reputation; wed them for a claim of ${cfg.marriageBase} (+${cfg.marriagePerChild} per child). 📜 Forgery: ${cfg.forgeGold}g and an idle spy (${spyChance ? `~${spyChance}%` : 'no idle spy'}), +${cfg.forgeStrength}. 🛡️ Heralds: ${cfg.purchasePrestige} Prestige, +${cfg.purchaseStrength}. 🏛️ Office: hold a royal office long enough.</div>`;
            const seek = [];
            for (const k of Throne.claimableKingdoms(player, world)) {
                const exiled = Throne.isExiledFrom(player, world, k.id);
                const royals = Throne.royalMatchCandidates(world, k.id);
                const desc = `${_esc(k.ruler || '')} · reputation ${Math.round((player.reputation && player.reputation[k.id]) || 0)}`;
                if (exiled) {
                    seek.push(actRow({ icon: '🏰', name: _esc(k.name), desc, note: '<span style="color:#e0846a;">exiled</span>' }));
                    continue;
                }
                const acts = _btn(`💍 Royal match${royals.length ? ` (${_esc(royals[0].firstName)})` : ''}`, `window._throne.match('${k.id}')`, !player.spouse && royals.length > 0)
                    + _btn('📜 Forge', `window._throne.forge('${k.id}')`, spyChance > 0 && (player.gold || 0) >= cfg.forgeGold)
                    + _btn('🛡️ Heralds', `window._throne.buy('${k.id}')`, prestige >= cfg.purchasePrestige);
                seek.push(actRow({ icon: '🏰', name: _esc(k.name), desc, note: `<span style="display:block; margin-top:2px;">${acts}</span>` }));
            }
            html += rowList(seek);
        }

        // ── Found your own kingdom ──
        if (!ruled) {
            const fs = Throne.foundingStatus(player, world);
            html += sectionHead('🏰 Found your own kingdom');
            html += `<div style="${MUTED}">Hold ${cfg.founding.minSettlements}+ settlements (colonies or conquered towns, you hold ${fs.held.length}) and ${cfg.founding.minPrestige}+ Prestige (costs ${cfg.founding.prestigeCost}). Proclaim it from one of your settlements with the Form Kingdom action.</div>`;
            if (!fs.ok) html += `<div style="font-size:11px; color:#c98a6a; margin-top:3px;">${fs.reasons.map(_esc).join(' ')}</div>`;
            else html += '<div style="color:#8fd18a; margin-top:3px;">You may proclaim your kingdom.</div>';
        }

        // ── Chronicle ──
        if (st.history.length) {
            html += sectionHead('📖 Of crowns and claims');
            for (const h of st.history.slice(-6).reverse()) html += `<div style="${MUTED} padding:2px 0;">Day ${h.day}: ${_esc(h.text)}</div>`;
        }
        html += '</div>';

        game.ui.showCustomPanel('👑 Claims & Crowns', html);
        const reopen = () => ActionMenu.showClaimsPanel(game, tile);
        const result = (title, res) => ActionMenu._realmResult(game, title, res, reopen);
        const spendAP = (cost) => {
            if ((player.actionPoints || 0) < cost) {
                game.ui.showNotification('⚡ Not Enough Action Points', `This needs ${cost} AP — rest to start a new day.`, 'error');
                return false;
            }
            player.actionPoints -= cost;
            return true;
        };
        // (the beaten are the realm's soldiers: their war chest is its treasury)
        const fight = (enemyStrength, name, realm = null) => {
            const t = world.getTile(player.q, player.r);
            return PlayerMilitary.combat(player, enemyStrength, name, { world, terrainId: t && t.terrain && t.terrain.id, lootKingdom: realm });
        };
        window._throne = {
            policy: (axis, id) => result('👑 Royal Policy', Throne.setPolicy(player, world, axis, id)),
            war: (id) => result('⚔️ War', Throne.declareRealmWar(player, world, id)),
            peace: (id) => result('🕊️ Peace', Throne.proposePeace(player, world, id)),
            ally: (id) => result('🤝 Alliance', Throne.proposeAlliance(player, world, id)),
            gift: (id) => result('🎁 Royal Gifts', Throne.sendRoyalGifts(player, world, id)),
            abdicate: () => result('👑 Abdication', Throne.abdicate(player, world)),
            court: () => ActionMenu.showRoyalCourt(game, tile),
            match: (id) => result('💍 Royal Match', Throne.arrangeRoyalMatch(player, world, id)),
            forge: (id) => result('📜 Forgery', Throne.forgeClaim(player, world, id)),
            buy: (id) => result('🛡️ Heralds', Throne.purchaseClaim(player, world, id)),
            press: (id) => result('🚩 Banners Raised', Throne.pressClaim(player, world, id, { armyStrength: PlayerMilitary.getArmyStrength(player) })),
            abandon: () => result('🏳️ Claim Abandoned', Throne.abandonClaim(player, world)),
            back: (crisisId, claimantId, kind, amount) => result('👑 Kingmaker', Throne.backClaimant(player, world, crisisId, claimantId, kind, { amount })),
            backBattle: (crisisId, claimantId) => {
                if (!spendAP(AP.battle)) return;
                const crisis = st.crises.find(c => c.id === crisisId);
                const k = crisis && world.getKingdom(crisis.kingdomId);
                if (!k) return;
                const battle = fight(Throne.vanguardStrength(k), `${k.name} partisans`, k);
                if (battle.reason) { game.ui.showNotification('⚔️ Battle', battle.reason, 'error'); return; }
                const res = Throne.backClaimant(player, world, crisisId, claimantId, 'battle', { victory: battle.victory });
                if (res.success && battle.casualties && battle.casualties.length) res.message += ` You lost ${battle.casualties.length} soldier(s).`;
                result('⚔️ Kingmaker', { ...res, failed: !battle.victory });
            },
            assault: () => {
                if (!spendAP(AP.battle)) return;
                const k = st.civilWar && world.getKingdom(st.civilWar.kingdomId);
                if (!k) return;
                const battle = fight(Throne.loyalistVanguard(player, world), `${k.name} loyalists`, k);
                if (battle.reason) { game.ui.showNotification('⚔️ Battle', battle.reason, 'error'); return; }
                const res = Throne.recordThroneBattle(player, world, battle.victory);
                if (res.success && battle.casualties && battle.casualties.length) res.message += ` You lost ${battle.casualties.length} soldier(s).`;
                result('🚩 Battle for the Throne', res);
            },
        };
    },
});
