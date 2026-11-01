// ActionMenu — playing the heir before they inherit, and a child's reign:
//   _familyAgencyHtml  a child's page (showChildPanel): fostering a child at a
//                      court, betrothal, commissions (command, envoy, a
//                      holding), ransom, their record and what it will carry
//                      into a reign (systems/heirAgency.js)
//   _regencyChoiceHtml the death screen's regent picker (systems/regency.js)
//   showRegencyPanel   Dynasty → Regency: the regent, their loyalty and
//                      ambition, the child's court's options, the choice at
//                      majority
// Logic lives in the systems; these panels present it.
import { ActionMenu } from './_ref.js';
import { HeirAgency } from '../../systems/heirAgency.js';
import { Regency } from '../../systems/regency.js';
import { Heirs } from '../../systems/heirs.js';
import { Upbringing } from '../../systems/upbringing.js';
import { BTN_GOLD, BTN_DARK, BTN_OFF, BTN_RED, CARD, esc } from './uiKit.js';

const HEAD = 'font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--gold); margin: 10px 0 4px;';
const SEL = 'width:100%; padding:4px; background:#222; color:#eee; border:1px solid #555; border-radius:4px; margin-top:4px;';

function _bar(v, color) {
    const pct = Math.max(0, Math.min(100, Math.round(v || 0)));
    return `<div style="background:rgba(255,255,255,0.08); border-radius:3px; height:6px; margin:2px 0 4px;"><div style="width:${pct}%; height:6px; border-radius:3px; background:${color};"></div></div>`;
}

function _kingdomOptions(player, world) {
    const rivals = (player.house && player.house.rivals) || {};
    return Heirs.kingdoms(player, world).map(k => {
        const rep = Math.round((player.reputation || {})[k.id] || 0);
        const kin = Heirs.kinshipWith(player, k.id);
        return `<option value="${esc(k.id)}">${esc(k.name)} (rep ${rep}${rivals[k.id] ? ', rival House' : ''}${kin ? `, ${kin}` : ''})</option>`;
    }).join('');
}

Object.assign(ActionMenu, {
    /** The family-agency section of a child's page. */
    _familyAgencyHtml(game, child) {
        const player = game.player;
        const world = game.world;
        if (!child || child.isAlive === false) return '';
        const cfg = HeirAgency.config();
        const up = Upbringing.ensure(child);
        const a = HeirAgency.ensure(child);
        const rec = a.record;
        const away = HeirAgency.isAway(child);
        const opts = _kingdomOptions(player, world);
        let html = `<div style="${HEAD}">The House's Use of ${esc(child.firstName)}</div>`;
        const status = HeirAgency.status(player, world, child);
        if (status) html += `<div style="color:#cfe0ff;">${esc(status)}</div>`;

        if (a.captive) {
            const ok = (player.gold || 0) >= a.captive.ransom;
            html += `<button ${ok ? `onclick="window._familyUI.ransom('${child.id}')"` : 'disabled'} style="${ok ? BTN_GOLD : BTN_OFF}">Pay the ransom (${a.captive.ransom}g)</button>`;
            html += `<div style="color:#999; font-size:11px;">Unpaid by day ${a.captive.until}, they are let go — and the House shamed.</div>`;
        }

        if (!up.comeOfAge) {
            // A child: fostered at a court, or promised in marriage
            if (!away && !up.fostered && (child.age || 0) >= cfg.fosterMinAge && opts) {
                html += `<div style="color:#bbb; margin-top:4px;">Foster ${esc(child.firstName)} at a ruler's court: the host's court becomes the tutor, a bond grows with its lord (who will remember it when ${esc(child.firstName)} rules), and a rival House's feud cools. If that court turns cold toward you, ${esc(child.firstName)} becomes a hostage.</div>`;
                html += `<select id="familyFosterKingdom" style="${SEL}">${opts}</select>`;
                html += `<select id="familyFosterYears" style="${SEL}">${(cfg.fosterYears || [2]).map(y => `<option value="${y}">${y} year${y === 1 ? '' : 's'}</option>`).join('')}</select>`;
                html += `<button onclick="window._familyUI.foster('${child.id}')" style="${BTN_DARK}">🏰 Send to be fostered</button>`;
            }
            if (!a.betrothal && !up.spouse && (child.age || 0) >= cfg.betrothalMinAge && opts) {
                const gift = Math.round((Heirs.config().allianceDowry || 0) * cfg.betrothalDowryShare);
                html += `<div style="color:#bbb; margin-top:6px;">Promise ${esc(child.firstName)} to a realm's nobility: the match is made at coming of age. A realm bound by betrothal is slower to join a league against you.</div>`;
                html += `<select id="familyBetrothKingdom" style="${SEL}">${opts}</select>`;
                html += `<button onclick="window._familyUI.betroth('${child.id}')" style="${BTN_DARK}">💍 Betroth (${gift}g, +${cfg.betrothalReputation} rep)</button>`;
            }
            if (a.betrothal) html += `<button onclick="window._familyUI.unbetroth('${child.id}')" style="${BTN_RED}">💔 Break the betrothal (${cfg.betrothalBreakReputation} rep)</button>`;
        } else if (!away) {
            // A grown child at home: a commission with real stakes
            const cmd = a.commission && a.commission.kind === 'command';
            const mult = cmd ? HeirAgency.commandMultiplier(player) : null;
            html += '<div style="margin-top:4px;">';
            if (cmd) {
                html += `<div style="color:#bbb;">Leads the company: battle power ×${mult.toFixed(2)} (combat ${(child.skills || {}).combat || 0}, leadership ${(child.skills || {}).leadership || 0}). Every battle risks wounds, capture or death.</div>`;
                html += `<button onclick="window._familyUI.relieve('${child.id}')" style="${BTN_DARK}">Relieve of command</button>`;
            } else if (!a.wounded) {
                html += `<button onclick="window._familyUI.command('${child.id}')" title="Field battles use their martial skill; they may be wounded, captured or killed." style="${BTN_DARK}">⚔️ Give command of the company</button>`;
            }
            if (opts && !a.wounded) {
                html += `<select id="familyEnvoyKingdom" style="${SEL}">${opts}</select>`;
                html += `<button onclick="window._familyUI.envoy('${child.id}')" title="${cfg.envoyDays} days at court: standing, the lord's memory, a bond. A realm that turns to war keeps them." style="${BTN_DARK}">📜 Send as envoy (${cfg.envoyCost}g, ${cfg.envoyDays} days)</button>`;
            }
            html += `<div style="color:#999; font-size:11px; margin-top:3px;">🏛️ To have ${esc(child.firstName)} steward a holding, appoint them governor from that holding's panel — days in office teach commerce and count toward their record.</div>`;
            html += '</div>';
        } else if (a.commission && a.commission.kind === 'envoy') {
            html += `<button onclick="window._familyUI.recall('${child.id}')" style="${BTN_DARK}">Recall the envoy (no gain)</button>`;
        }

        // The record so far
        const lines = [];
        for (const f of rec.fostered) lines.push(`🏰 Fostered at the court of ${esc(f.lordName)}${f.recalled ? ' (recalled)' : ''}`);
        for (const [kid, bond] of Object.entries(rec.bonds)) {
            const k = world.getKingdom ? world.getKingdom(kid) : null;
            if (bond > 0 && k) lines.push(`🤝 Bond with the court of ${esc(k.name)}: ${bond}`);
        }
        if (rec.battles.fought) lines.push(`⚔️ ${rec.battles.fought} battles led, ${rec.battles.won} won${rec.wounds ? `, wounded ${rec.wounds}×` : ''}${rec.captured ? `, captured ${rec.captured}×` : ''}`);
        for (const e of rec.envoys) lines.push(`📜 Envoy to ${esc(e.kingdomName)} (+${e.reputation} rep)`);
        if (rec.stewardDays) lines.push(`🏛️ ${rec.stewardDays} days governing a holding`);
        if (lines.length) html += `<div style="${CARD}"><div style="color:var(--gold); font-size:11px;">Record</div>${lines.map(l => `<div>${l}</div>`).join('')}</div>`;

        // What it would carry into a reign
        const plan = HeirAgency.payoff(player, world, child);
        if (plan.lines.length) {
            html += `<div style="${CARD} border-color: rgba(245,197,66,0.35);"><div style="color:var(--gold); font-size:11px;">Should ${esc(child.firstName)} inherit${plan.prestige ? ` (⭐${plan.prestige > 0 ? '+' : ''}${plan.prestige} Prestige)` : ''}</div>`;
            html += plan.lines.map(l => `<div style="color:#ddd;">${l.icon} ${esc(l.text)}</div>`).join('') + '</div>';
        }

        const refresh = (msg, color) => {
            game.ui.updateStats(player, world);
            ActionMenu.showChildPanel(game, child.id, { html: msg, color });
        };
        const fail = (reason) => game.ui.showNotification('👪 The House', reason, 'error');
        const sel = (id) => { const el = document.getElementById(id); return el ? el.value : null; };
        window._familyUI = {
            foster: (id) => {
                const res = HeirAgency.fosterChild(player, world, id, sel('familyFosterKingdom'), Number(sel('familyFosterYears')) || 2);
                if (!res.success) return fail(res.reason);
                refresh(`🏰 ${esc(child.firstName)} leaves to be raised at the court of ${esc(res.placement.lordName)} until day ${res.placement.until}.`);
            },
            betroth: (id) => {
                const res = HeirAgency.betroth(player, world, id, sel('familyBetrothKingdom'));
                if (!res.success) return fail(res.reason);
                refresh(`💍 ${esc(child.firstName)} is promised to ${esc(res.betrothal.name)} (−${res.cost}g).`);
            },
            unbetroth: (id) => {
                const res = HeirAgency.breakBetrothal(player, world, id);
                if (!res.success) return fail(res.reason);
                refresh(`💔 The betrothal to ${esc(res.betrothal.name)} is broken. ${esc(res.betrothal.kingdomName)} will remember.`, 'rgba(224,96,96,0.5)');
            },
            command: (id) => {
                const res = HeirAgency.giveCommand(player, world, id);
                if (!res.success) return fail(res.reason);
                refresh(`⚔️ ${esc(child.firstName)} takes command of the company.`);
            },
            relieve: (id) => {
                HeirAgency.endCommission(player, world, id);
                refresh(`${esc(child.firstName)} hands back the command.`);
            },
            envoy: (id) => {
                const res = HeirAgency.sendEnvoy(player, world, id, sel('familyEnvoyKingdom'));
                if (!res.success) return fail(res.reason);
                refresh(`📜 ${esc(child.firstName)} rides as envoy to ${esc(res.commission.kingdomName)} (back by day ${res.commission.until}).`);
            },
            recall: (id) => {
                HeirAgency.endCommission(player, world, id);
                refresh(`${esc(child.firstName)} is recalled from the embassy.`);
            },
            ransom: (id) => {
                const res = HeirAgency.ransom(player, world, id);
                if (!res.success) return fail(res.reason);
                refresh(`🕊️ ${esc(child.firstName)} is ransomed (−${res.cost}g) and comes home.`);
            },
        };
        return html;
    },

    /** The death screen's regency block: who rules in the child's name. */
    _regencyChoiceHtml(game, child) {
        const player = game.player;
        const list = Regency.candidates(player, game.world, child.id);
        let html = `<div style="font-size:12px; color:#aaa; margin-top:4px;">Who will rule in ${esc(child.firstName)}'s name? You will play the child's court until they come of age: the regent may serve, skim, or plot. No war may be declared and no siege laid while a regent rules.</div>`;
        html += `<select id="regentChoiceSel" style="${SEL}">`;
        for (const c of list) html += `<option value="${esc(c.id)}">${esc(c.name)} — ${esc(c.blurb)} (loyalty ${c.loyalty}, ambition ${c.ambition})</option>`;
        html += '</select>';
        return html;
    },

    /** Dynasty → Regency. */
    showRegencyPanel(game, message = null) {
        const player = game.player;
        const world = game.world;
        const v = Regency.view(player, world);
        if (!v) {
            game.ui.showNotification('👑 Regency', 'No regent rules in your name.', 'info');
            return;
        }
        const r = v.regent;
        const cfg = v.cfg;
        let html = '<div style="max-height: 540px; overflow-y: auto; font-size: 12px;">';
        if (message) html += `<div style="${CARD} color:#eee;">${message}</div>`;
        html += `<div style="${CARD}">`;
        html += `<div style="display:flex; justify-content:space-between;"><b style="font-size:14px;">👑 ${esc(r.name)}</b><span style="color:#999;">${esc(r.label)}</span></div>`;
        if (v.active) {
            html += `<div style="color:#999; font-size:11px;">Rules in your name until you come of age at ${v.majority} (${v.yearsLeft} year${v.yearsLeft === 1 ? '' : 's'}).</div>`;
            html += `<div>Loyalty ${r.loyalty} <span style="color:#888;">(settling toward ${v.loyaltyTarget})</span></div>${_bar(r.loyalty, r.loyalty < cfg.plotBelow ? '#c55' : r.loyalty < cfg.embezzleBelow ? '#d9a13a' : '#6b6')}`;
            html += `<div>Ambition ${r.ambition}</div>${_bar(r.ambition, '#a7c')}`;
            if (v.embezzled) html += `<div style="color:#e0a030;">🧾 ${v.embezzled} gold has gone missing from the treasury under this regency.</div>`;
            if (v.rumoured) html += '<div style="color:#e08080;">🕵️ It is whispered the regent plots to rule in more than name.</div>';
            if (v.coups) html += `<div style="color:#e08080;">🗡️ ${v.coups} coup${v.coups === 1 ? '' : 's'} already.</div>`;
            html += `<div style="color:#999; font-size:11px; margin-top:4px;">Not of age: you cannot ${v.forbidden.map(f => (f === 'siege' ? 'lay a siege' : f === 'war' ? 'declare war' : f)).join(' or ')}; your company fights under the regent's captains unless one of your blood commands it.</div>`;
        }
        html += '</div>';

        if (v.active) {
            html += `<div style="${HEAD}">The Child's Court</div>`;
            const gold = (player.gold || 0) >= cfg.giftGold;
            const prestige = (player.house && player.house.prestige) || 0;
            html += `<button ${gold ? 'onclick="window._regencyUI.favour(\'gift\')"' : 'disabled'} style="${gold ? BTN_DARK : BTN_OFF}">🎁 A gift (${cfg.giftGold}g, +${cfg.giftLoyalty} loyalty)</button>`;
            html += `<button ${prestige >= cfg.honourPrestige ? 'onclick="window._regencyUI.favour(\'honour\')"' : 'disabled'} style="${prestige >= cfg.honourPrestige ? BTN_DARK : BTN_OFF}">🎖️ Public honours (⭐${cfg.honourPrestige}, +${cfg.honourLoyalty} loyalty)</button>`;
            const exposed = v.rumoured || v.coups > 0;
            const replaceCost = exposed ? cfg.replaceExposedPrestige : cfg.replacePrestige;
            const canReplace = prestige >= replaceCost;
            html += `<button ${canReplace ? 'onclick="window._regencyUI.replace()"' : 'disabled'} style="${canReplace ? BTN_RED : BTN_OFF}">Put the regent aside (⭐${replaceCost}${exposed ? ', plot exposed' : ''})</button>`;
            if (v.canAssert) {
                const canAssert = prestige >= cfg.earlyMajorityPrestige;
                html += `<button ${canAssert ? 'onclick="window._regencyUI.assert()"' : 'disabled'} style="${canAssert ? BTN_GOLD : BTN_OFF}">👑 Assert your majority (⭐${cfg.earlyMajorityPrestige})</button>`;
            }
        }
        if (v.ending) {
            html += `<div style="${CARD} border-color: rgba(245,197,66,0.5);"><div style="font-weight:bold;">👑 Coming of Age</div>`;
            html += `<div style="color:#ddd; margin:4px 0;">The regency is over. What becomes of ${esc(r.name)}'s men? (decide by day ${v.ending.due}, or they stay)</div>`;
            for (const c of v.choices) {
                const ok = !c.gold || (player.gold || 0) >= c.gold;
                html += `<button ${ok ? `onclick="window._regencyUI.end('${c.id}')"` : 'disabled'} title="${esc(c.blurb)}" style="${ok ? (c.id === 'keep' ? BTN_DARK : BTN_GOLD) : BTN_OFF} display:block; width:100%; text-align:left;">${esc(c.label)} <span style="font-weight:normal;">— ${esc(c.blurb)}</span></button>`;
            }
            html += '</div>';
        }
        html += `<button data-am-act="openTileMenu" data-am-args='["showDynastyMenu"]' style="${BTN_DARK} width:100%; margin-top:8px;">← Back to Dynasty</button>`;
        html += '</div>';

        const done = (res) => {
            if (!res.success) return game.ui.showNotification('👑 Regency', res.reason, 'error');
            game.ui.updateStats(player, world);
            if (Regency.view(player, world)) ActionMenu.showRegencyPanel(game, esc(res.text));
            else {
                game.ui.showNotification('👑 Regency', res.text, 'success');
                ActionMenu.showDynastyMenu(game, null);
            }
        };
        window._regencyUI = {
            favour: (how) => done(Regency.favour(player, world, how)),
            replace: () => done(Regency.replace(player, world)),
            assert: () => done(Regency.assertMajority(player, world)),
            end: (choice) => done(Regency.resolveEnding(player, world, choice)),
        };
        game.ui.showCustomPanel('👑 Regency', html);
    },
});
