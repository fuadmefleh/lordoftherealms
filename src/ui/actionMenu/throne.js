// ActionMenu — Claims & Crowns: claims on thrones, succession crises, the war
// for a crown, and ruling a realm. Logic lives in systems/throne.js; this
// panel presents it.
import { ActionMenu } from './_ref.js';
import { Throne, PlayerMilitary, House } from './_imports.js';

const BTN = 'padding: 5px 9px; margin: 4px 4px 0 0; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px;';
const BTN_GOLD = BTN + 'background: var(--gold); color: #1a1a1a;';
const BTN_RED = BTN + 'background: #8e2b2b; color: #fff;';
const BTN_DIM = BTN + 'background: rgba(255,255,255,0.08); color: var(--text-secondary); cursor: default;';
const CARD = 'background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 8px 10px; margin: 8px 0;';
const MUTED = 'color: var(--text-secondary); font-size: 11px;';
const AP = { battle: 2 };

const _esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));

function _btn(label, call, enabled = true, style = BTN_GOLD) {
    return `<button onclick="${enabled ? call : ''}" style="${enabled ? style : BTN_DIM}" ${enabled ? '' : 'disabled'}>${label}</button>`;
}

function _bar(value, min, max, color) {
    const pct = Math.round(((value - min) / Math.max(1, max - min)) * 100);
    return `<div style="height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;margin:3px 0 5px;">
        <div style="width:${Math.max(0, Math.min(100, pct))}%;height:100%;background:${color};"></div></div>`;
}

function _side(side, wavering) {
    if (wavering) return '<span style="color:#f1c40f;">wavering</span>';
    return side === 'pretender' ? '<span style="color:#8fd88f;">for you</span>' : '<span style="color:#e88;">for the crown</span>';
}

/** A compact read-out of how a realm's towns and great lords lean. */
function _leanings(fc, sides = null) {
    const towns = fc.settlements.map(s => ({ ...s, side: sides ? (sides[s.key] || 'loyalist') : s.side, wavering: sides ? false : s.wavering }));
    const forYou = towns.filter(s => s.side === 'pretender').length;
    let html = `<div style="${MUTED}margin-top:4px;">Towns: ${forYou}/${towns.length} for you · Great lords: ${fc.advisors.filter(a => a.side === 'pretender').length}/${fc.advisors.length}</div>`;
    html += '<div style="display:flex;flex-wrap:wrap;gap:2px 10px;font-size:11px;margin-top:2px;">';
    for (const s of towns.slice(0, 12)) {
        html += `<span>${s.isCapital ? '👑' : '🏘️'} ${_esc(s.name)}: ${_side(s.side, s.wavering)}</span>`;
    }
    if (towns.length > 12) html += `<span style="${MUTED}">…and ${towns.length - 12} more</span>`;
    html += '</div>';
    if (fc.advisors.length) {
        html += '<div style="display:flex;flex-wrap:wrap;gap:2px 10px;font-size:11px;margin-top:2px;">';
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
        html += `<div style="${MUTED}">⭐ Prestige ${prestige} · ⚔️ Army ${army} · 💰 ${Math.floor(player.gold || 0)}g</div>`;

        // ── The realm you rule ──
        const ruled = Throne.ruledKingdom(player, world);
        if (ruled) {
            const r = st.ruling;
            html += `<div style="${CARD}border-color:rgba(245,197,66,0.5);">`;
            html += `<div style="font-weight:bold;color:var(--gold);font-size:13px;">👑 ${_esc(ruled.ruler)} — ${_esc(ruled.name)}</div>`;
            html += `<div style="${MUTED}">Since day ${r.since}${r.founded ? ' · founded by your hand' : ''} · Treasury ${Math.floor(ruled.treasury || 0)}g · Army ${Math.floor(ruled.military || 0)} · Stability ${Math.round(ruled.stability || 0)} · Levy so far ${r.levyTotal || 0}g (${Math.round(Throne.levyRate(player) * 100)}% of the treasury's daily gain, up to ${cfg.ruling.levyCap}g)</div>`;
            for (const axis of Throne.POLICY_AXES) {
                const def = Throne.policies()[axis];
                if (!def) continue;
                html += `<div style="margin-top:6px;"><strong>${_esc(def.label)}</strong></div>`;
                for (const [id, opt] of Object.entries(def.options || {})) {
                    const active = r.policies[axis] === id;
                    html += `<button title="${_esc(opt.blurb || '')}" onclick="window._throne.policy('${axis}','${id}')" style="${active ? BTN_GOLD : BTN + 'background:#333;color:#ddd;'}">${opt.icon || ''} ${_esc(opt.label)}</button>`;
                }
                const cur = def.options && def.options[r.policies[axis]];
                if (cur && cur.blurb) html += `<div style="${MUTED}">${_esc(cur.blurb)}</div>`;
            }
            html += '<div style="margin-top:8px;"><strong>Diplomacy</strong></div>';
            for (const d of Throne.diplomacyTargets(player, world)) {
                const status = d.atWar ? '<span style="color:#e74c3c;">at war</span>' : d.allied ? '<span style="color:#8fd88f;">allied</span>' : d.truce ? '<span style="color:#9bc;">truce</span>' : `relations ${d.relations}`;
                html += `<div style="margin-top:4px;">${_esc(d.kingdom.name)} · ${status} · army ${Math.floor(d.kingdom.military || 0)}</div>`;
                if (d.atWar) {
                    html += _btn(`🕊️ Propose peace (~${Math.round(Throne.peaceChance(player, world, d.kingdom.id) * 100)}%)`, `window._throne.peace('${d.kingdom.id}')`);
                } else {
                    html += _btn('⚔️ Declare war', `window._throne.war('${d.kingdom.id}')`, !d.allied && !d.truce, BTN_RED);
                    html += _btn('🤝 Propose alliance', `window._throne.ally('${d.kingdom.id}')`, !d.allied && d.relations >= cfg.ruling.allianceMinRelations);
                    html += _btn(`🎁 Royal gifts (${cfg.ruling.giftCost}g)`, `window._throne.gift('${d.kingdom.id}')`, (ruled.treasury || 0) >= cfg.ruling.giftCost);
                }
            }
            html += `<div style="margin-top:8px;">${_btn('Abdicate', 'window._throne.abdicate()', true, BTN_RED)}</div>`;
            html += '</div>';
        }

        // ── The war for a throne ──
        const cw = st.civilWar;
        const cwK = cw ? world.getKingdom(cw.kingdomId) : null;
        if (cw && cwK) {
            const fc = Throne.forecast(player, world, cw.kingdomId, { armyStrength: army });
            const days = world.day - cw.startDay;
            html += `<div style="${CARD}border-color:rgba(231,76,60,0.5);">`;
            html += `<div style="font-weight:bold;color:#e74c3c;font-size:13px;">🚩 War for the throne of ${_esc(cwK.name)} · day ${days}/${cfg.civilWar.maxDays}</div>`;
            html += `<div>Momentum ${Math.round(cw.momentum)} <span style="${MUTED}">(crowned at ${cfg.civilWar.victoryMomentum}, exile at ${cfg.civilWar.defeatMomentum})</span></div>`;
            html += _bar(cw.momentum, cfg.civilWar.defeatMomentum, cfg.civilWar.victoryMomentum, cw.momentum >= 0 ? '#8fd88f' : '#e74c3c');
            html += `<div style="${MUTED}">Your levies ${Math.round(cw.levies)} + your army ${army} vs. loyalists ${Math.floor(cwK.military || 0)} · battles won ${cw.battlesWon}, lost ${cw.battlesLost}. Loyalist war hosts march on your holdings — break them in the field.</div>`;
            if (fc) html += _leanings(fc, cw.sides);
            const van = Throne.loyalistVanguard(player, world);
            html += _btn(`⚔️ Lead the assault (${AP.battle} AP, ≈${van} strength)`, 'window._throne.assault()', army > 0);
            html += _btn('🏳️ Abandon the claim', 'window._throne.abandon()', true, BTN_RED);
            html += '</div>';
        }

        // ── Succession crises ──
        for (const c of st.crises) {
            const k = world.getKingdom(c.kingdomId);
            if (!k) continue;
            const total = c.claimants.reduce((s, x) => s + Math.max(1, x.support), 0);
            html += `<div style="${CARD}border-color:rgba(241,196,15,0.45);">`;
            html += `<div style="font-weight:bold;color:#f1c40f;">👑 ${_esc(c.causeLabel)} in ${_esc(k.name)} · ${Math.max(0, c.endDay - world.day)} days left</div>`;
            html += `<div style="${MUTED}">${_esc(c.text)}</div>`;
            for (const cl of c.claimants) {
                const backed = c.backing && c.backing.claimantId === cl.id;
                const canBack = !c.backing || backed;
                html += `<div style="margin-top:6px;">${cl.isIncumbent ? '🏰' : '🗡️'} <strong>${_esc(cl.name)}</strong>${cl.isIncumbent ? ' (holds the palace)' : ' (rival claimant)'} · support ${Math.round(cl.support)} (${Math.round(cl.support / total * 100)}%)${backed ? ' · <span style="color:#8fd88f;">your choice</span>' : ''}</div>`;
                html += _bar(cl.support, 0, total, cl.isIncumbent ? '#9bc' : '#e67e22');
                if (canBack) {
                    html += _btn(`💰 ${cfg.crisis.minGold}g`, `window._throne.back('${c.id}','${cl.id}','gold',${cfg.crisis.minGold})`, (player.gold || 0) >= cfg.crisis.minGold);
                    html += _btn(`💰 ${cfg.crisis.minGold * 3}g`, `window._throne.back('${c.id}','${cl.id}','gold',${cfg.crisis.minGold * 3})`, (player.gold || 0) >= cfg.crisis.minGold * 3);
                    html += _btn(`⭐ ${cfg.crisis.prestigeCost} Prestige`, `window._throne.back('${c.id}','${cl.id}','prestige')`, prestige >= cfg.crisis.prestigeCost);
                    html += _btn(`⚔️ Fight for them (${AP.battle} AP)`, `window._throne.backBattle('${c.id}','${cl.id}')`, army > 0);
                }
            }
            const strength = Throne.claimStrength(player, c.kingdomId);
            if (strength > 0) {
                const can = Throne.canPress(player, world, c.kingdomId, { armyStrength: army });
                html += `<div style="margin-top:6px;">You hold a claim of ${strength} on this throne. In a crisis the realm leans your way (+${cfg.lean.crisisBonus}).</div>`;
                html += _btn(`🚩 Press your own claim (${cfg.pressGold}g)`, `window._throne.press('${c.kingdomId}')`, can.ok, BTN_RED);
                if (!can.ok) html += `<div style="${MUTED}">${_esc(can.reason)}</div>`;
            }
            html += '</div>';
        }

        // ── Your claims ──
        const claims = Throne.claims(player, world).filter(c => !(cw && cw.kingdomId === c.kingdomId));
        html += '<h5 style="margin:12px 0 4px;color:var(--gold);">📜 Your claims</h5>';
        if (!claims.length) html += `<div style="${MUTED}">You hold no claim on any throne. Earn one below, by marrying into a royal house, serving long in high office, or storming a capital.</div>`;
        for (const c of claims) {
            const fc = Throne.forecast(player, world, c.kingdomId, { armyStrength: army });
            const can = Throne.canPress(player, world, c.kingdomId, { armyStrength: army });
            html += `<div style="${CARD}">`;
            html += `<div style="font-weight:bold;">${_esc(c.kingdom.name)} · <span style="color:${c.label.color};">${_esc(c.label.label)} claim (${c.strength})</span></div>`;
            html += `<div style="${MUTED}">${c.sources.map(s => `${s.icon} ${_esc(s.label)} ${s.value}`).join(' · ')}</div>`;
            if (fc) {
                html += `<div style="margin-top:4px;">If you raised your banners today, <strong>${Math.round(fc.rebelShare * 100)}%</strong> of the realm would rise for you (appeal ${fc.appeal.value}).</div>`;
                html += `<div style="${MUTED}">${fc.appeal.parts.map(p => `${_esc(p.label)} ${p.value > 0 ? '+' : ''}${p.value}`).join(' · ')}</div>`;
                html += _leanings(fc);
            }
            html += _btn(`🚩 Press the claim (${cfg.pressGold}g)`, `window._throne.press('${c.kingdomId}')`, can.ok, BTN_RED);
            if (!can.ok) html += `<div style="${MUTED}">${_esc(can.reason)}</div>`;
            html += '</div>';
        }

        // ── Seek a claim ──
        {
            const spyChance = Math.round(Throne.forgeChance(player) * 100);
            html += '<h5 style="margin:12px 0 4px;color:#9bc;">🔎 Seek a claim</h5>';
            html += `<div style="${MUTED}">💍 Royal match: ${cfg.royalMatchPrestige} Prestige + ${cfg.royalMatchGold}g dowry, ${cfg.royalMatchMinReputation}+ reputation; wed them for a claim of ${cfg.marriageBase} (+${cfg.marriagePerChild} per child). 📜 Forgery: ${cfg.forgeGold}g and an idle spy (${spyChance ? `~${spyChance}%` : 'no idle spy'}), +${cfg.forgeStrength}. 🛡️ Heralds: ${cfg.purchasePrestige} Prestige, +${cfg.purchaseStrength}. 🏛️ Office: hold a royal office long enough.</div>`;
            for (const k of Throne.claimableKingdoms(player, world)) {
                const exiled = Throne.isExiledFrom(player, world, k.id);
                const royals = Throne.royalMatchCandidates(world, k.id);
                html += `<div style="margin-top:6px;">${_esc(k.name)} <span style="${MUTED}">· ${_esc(k.ruler || '')} · reputation ${Math.round((player.reputation && player.reputation[k.id]) || 0)}${exiled ? ' · <span style="color:#e88;">exiled</span>' : ''}</span></div>`;
                if (exiled) continue;
                html += _btn(`💍 Royal match${royals.length ? ` (${_esc(royals[0].firstName)})` : ''}`, `window._throne.match('${k.id}')`, !player.spouse && royals.length > 0);
                html += _btn('📜 Forge', `window._throne.forge('${k.id}')`, spyChance > 0 && (player.gold || 0) >= cfg.forgeGold);
                html += _btn('🛡️ Heralds', `window._throne.buy('${k.id}')`, prestige >= cfg.purchasePrestige);
            }
        }

        // ── Found your own kingdom ──
        if (!ruled) {
            const fs = Throne.foundingStatus(player, world);
            html += '<h5 style="margin:12px 0 4px;color:#c89b3c;">🏰 Found your own kingdom</h5>';
            html += `<div style="${MUTED}">Hold ${cfg.founding.minSettlements}+ settlements (colonies or conquered towns, you hold ${fs.held.length}) and ${cfg.founding.minPrestige}+ Prestige (costs ${cfg.founding.prestigeCost}). Proclaim it from one of your settlements with the Form Kingdom action.</div>`;
            if (!fs.ok) html += `<div style="${MUTED}color:#e88;">${fs.reasons.map(_esc).join(' ')}</div>`;
            else html += '<div style="color:#8fd88f;">You may proclaim your kingdom.</div>';
        }

        // ── Chronicle ──
        if (st.history.length) {
            html += '<h5 style="margin:12px 0 4px;">📖 Of crowns and claims</h5>';
            for (const h of st.history.slice(-6).reverse()) html += `<div style="${MUTED}">Day ${h.day}: ${_esc(h.text)}</div>`;
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
        const fight = (enemyStrength, name) => {
            const t = world.getTile(player.q, player.r);
            return PlayerMilitary.combat(player, enemyStrength, name, { world, terrainId: t && t.terrain && t.terrain.id });
        };
        window._throne = {
            policy: (axis, id) => result('👑 Royal Policy', Throne.setPolicy(player, world, axis, id)),
            war: (id) => result('⚔️ War', Throne.declareRealmWar(player, world, id)),
            peace: (id) => result('🕊️ Peace', Throne.proposePeace(player, world, id)),
            ally: (id) => result('🤝 Alliance', Throne.proposeAlliance(player, world, id)),
            gift: (id) => result('🎁 Royal Gifts', Throne.sendRoyalGifts(player, world, id)),
            abdicate: () => result('👑 Abdication', Throne.abdicate(player, world)),
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
                const battle = fight(Throne.vanguardStrength(k), `${k.name} partisans`);
                if (battle.reason) { game.ui.showNotification('⚔️ Battle', battle.reason, 'error'); return; }
                const res = Throne.backClaimant(player, world, crisisId, claimantId, 'battle', { victory: battle.victory });
                if (res.success && battle.casualties && battle.casualties.length) res.message += ` You lost ${battle.casualties.length} soldier(s).`;
                result('⚔️ Kingmaker', { ...res, failed: !battle.victory });
            },
            assault: () => {
                if (!spendAP(AP.battle)) return;
                const k = st.civilWar && world.getKingdom(st.civilWar.kingdomId);
                if (!k) return;
                const battle = fight(Throne.loyalistVanguard(player, world), `${k.name} loyalists`);
                if (battle.reason) { game.ui.showNotification('⚔️ Battle', battle.reason, 'error'); return; }
                const res = Throne.recordThroneBattle(player, world, battle.victory);
                if (res.success && battle.casualties && battle.casualties.length) res.message += ` You lost ${battle.casualties.length} soldier(s).`;
                result('🚩 Battle for the Throne', res);
            },
        };
    },
});
