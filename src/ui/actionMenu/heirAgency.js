// ActionMenu — playing the heir before they inherit, and a child's reign:
//   _familyAgencyHtml  a child's page (showChildPanel): fostering a child at a
//                      court, betrothal, commissions (command, envoy, a
//                      holding), ransom, their record and what it will carry
//                      into a reign (systems/heirAgency.js)
//   _regencyChoiceHtml the death screen's regent picker (systems/regency.js)
//   showRegencyPanel   Dynasty → Regency: the regent, their loyalty and
//                      ambition, the child's court's options, the choice at
//                      majority
// Logic lives in the systems; these panels present it, in the action menu's
// voice (ui/actionMenu/uiKit.js): rows to click, cards for the forms.
import { ActionMenu } from './_ref.js';
import { HeirAgency } from '../../systems/heirAgency.js';
import { Regency } from '../../systems/regency.js';
import { Heirs } from '../../systems/heirs.js';
import { Upbringing } from '../../systems/upbringing.js';
import { BTN_GOLD, esc, sectionHead, lede, card, actRow, rowList, price } from './uiKit.js';
import { Names } from '../../core/names.js';

const SEL = 'width:100%; padding:5px 6px; background:rgba(0,0,0,0.35); color:#ece2c8; border:1px solid rgba(245,197,66,0.18); border-radius:6px; margin-top:6px; font-family:var(--font-body); font-size:12px;';
const MUTED = 'color:#9d937c; font-size:11px;';

function _bar(v, color) {
    const pct = Math.max(0, Math.min(100, Math.round(v || 0)));
    return `<div style="background:rgba(0,0,0,0.35); border-radius:3px; height:5px; margin:3px 0 6px;"><div style="width:${pct}%; height:5px; border-radius:3px; background:${color};"></div></div>`;
}

function _kingdomOptions(player, world) {
    const rivals = (player.house && player.house.rivals) || {};
    return Heirs.kingdoms(player, world).map(k => {
        const rep = Math.round((player.reputation || {})[k.id] || 0);
        const kin = Heirs.kinshipWith(player, k.id);
        return `<option value="${esc(k.id)}">${esc(k.name)} (rep ${rep}${rivals[k.id] ? ', rival House' : ''}${kin ? `, ${kin}` : ''})</option>`;
    }).join('');
}

/** A form card: a blurb, its selects, and one button. */
function _formCard(icon, title, blurb, fields, button) {
    return card(`<div style="color:#cbbf9f;">${blurb}</div>${fields}<div style="margin-top:6px;">${button}</div>`, { icon, title });
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
        let html = sectionHead(`The House's Use of ${esc(child.firstName)}`);
        const status = HeirAgency.status(player, world, child);
        if (status) html += lede(`<span style="color:#cfe0ff;">${esc(status)}</span>`);

        const rows = [];
        if (a.captive) {
            const ok = (player.gold || 0) >= a.captive.ransom;
            const note = `Unpaid by day ${a.captive.until}, they are let go — and the House shamed.`;
            rows.push({
                icon: '🕊️', name: 'Pay the ransom', desc: note,
                off: !ok, why: `Not enough gold. ${note}`,
                attrs: `onclick="window._familyUI.ransom('${child.id}')"`,
                side: price(a.captive.ransom, ok),
            });
        }

        let forms = '';
        if (!up.comeOfAge) {
            // A child: fostered at a court, or promised in marriage
            if (!away && !up.fostered && (child.age || 0) >= cfg.fosterMinAge && opts) {
                forms += _formCard('🏰', 'Foster at a court',
                    `Foster ${esc(child.firstName)} at a ruler's court: the host's court becomes the tutor, a bond grows with its lord (who will remember it when ${esc(child.firstName)} rules), and a rival House's feud cools. If that court turns cold toward you, ${esc(child.firstName)} becomes a hostage.`,
                    `<select id="familyFosterKingdom" style="${SEL}">${opts}</select>`
                    + `<select id="familyFosterYears" style="${SEL}">${(cfg.fosterYears || [2]).map(y => `<option value="${y}">${y} year${y === 1 ? '' : 's'}</option>`).join('')}</select>`,
                    `<button onclick="window._familyUI.foster('${child.id}')" style="${BTN_GOLD}">🏰 Send to be fostered</button>`);
            }
            if (!a.betrothal && !up.spouse && (child.age || 0) >= cfg.betrothalMinAge && opts) {
                const gift = Math.round((Heirs.config().allianceDowry || 0) * cfg.betrothalDowryShare);
                forms += _formCard('💍', 'Betrothal',
                    `Promise ${esc(child.firstName)} to a realm's nobility: the match is made at coming of age. A realm bound by betrothal is slower to join a league against you.`,
                    `<select id="familyBetrothKingdom" style="${SEL}">${opts}</select>`,
                    `<button onclick="window._familyUI.betroth('${child.id}')" style="${BTN_GOLD}">💍 Betroth (${gift}g, +${cfg.betrothalReputation} rep)</button>`);
            }
            if (a.betrothal) {
                rows.push({
                    icon: '💔', name: 'Break the betrothal', desc: a.betrothal.name ? `Promised to ${esc(a.betrothal.name)}` : '',
                    attrs: `onclick="window._familyUI.unbetroth('${child.id}')"`,
                    side: `${cfg.betrothalBreakReputation} rep`, tone: 'bad',
                });
            }
        } else if (!away) {
            // A grown child at home: a commission with real stakes
            const cmd = a.commission && a.commission.kind === 'command';
            const mult = cmd ? HeirAgency.commandMultiplier(player) : null;
            if (cmd) {
                rows.push({
                    icon: '⚔️', name: 'Relieve of command',
                    desc: `Leads the company: battle power ×${mult.toFixed(2)} (combat ${(child.skills || {}).combat || 0}, leadership ${(child.skills || {}).leadership || 0}). Every battle risks wounds, capture or death.`,
                    attrs: `onclick="window._familyUI.relieve('${child.id}')"`,
                    side: 'commanding', tone: 'gold',
                });
            } else if (!a.wounded) {
                rows.push({
                    icon: '⚔️', name: 'Give command of the company',
                    desc: 'Field battles use their martial skill; they may be wounded, captured or killed.',
                    title: 'Field battles use their martial skill; they may be wounded, captured or killed.',
                    attrs: `onclick="window._familyUI.command('${child.id}')"`,
                });
            }
            if (opts && !a.wounded) {
                forms += _formCard('📜', 'Send as envoy',
                    `${cfg.envoyDays} days at court: standing, the lord's memory, a bond. A realm that turns to war keeps them.`,
                    `<select id="familyEnvoyKingdom" style="${SEL}">${opts}</select>`,
                    `<button onclick="window._familyUI.envoy('${child.id}')" title="${cfg.envoyDays} days at court: standing, the lord's memory, a bond. A realm that turns to war keeps them." style="${BTN_GOLD}">📜 Send as envoy (${cfg.envoyCost}g, ${cfg.envoyDays} days)</button>`);
            }
            forms += `<div style="${MUTED} margin:4px 2px 8px;">🏛️ To have ${esc(child.firstName)} steward a holding, appoint them governor from that holding's panel — days in office teach commerce and count toward their record.</div>`;
        } else if (a.commission && a.commission.kind === 'envoy') {
            rows.push({
                icon: '📜', name: 'Recall the envoy',
                attrs: `onclick="window._familyUI.recall('${child.id}')"`,
                side: 'no gain',
            });
        }
        html += rowList(rows);
        html += forms;

        // The record so far
        const lines = [];
        for (const f of rec.fostered) lines.push(`🏰 Fostered at the court of ${esc(f.lordName)}${f.recalled ? ' (recalled)' : ''}`);
        for (const [kid, bond] of Object.entries(rec.bonds)) {
            const k = world.getKingdom ? world.getKingdom(kid) : null;
            if (bond > 0 && k) lines.push(`🤝 Bond with the court of ${esc(Names.realm(k.name))}: ${bond}`);
        }
        if (rec.battles.fought) lines.push(`⚔️ ${rec.battles.fought} battles led, ${rec.battles.won} won${rec.wounds ? `, wounded ${rec.wounds}×` : ''}${rec.captured ? `, captured ${rec.captured}×` : ''}`);
        for (const e of rec.envoys) lines.push(`📜 Envoy to ${esc(e.kingdomName)} (+${e.reputation} rep)`);
        if (rec.stewardDays) lines.push(`🏛️ ${rec.stewardDays} days governing a holding`);
        if (lines.length) html += card(lines.map(l => `<div>${l}</div>`).join(''), { icon: '📖', title: 'Record' });

        // What it would carry into a reign
        const plan = HeirAgency.payoff(player, world, child);
        if (plan.lines.length) {
            html += card(plan.lines.map(l => `<div style="color:#ece2c8;">${l.icon} ${esc(l.text)}</div>`).join(''), {
                icon: '👑', title: `Should ${esc(child.firstName)} inherit`, tone: 'gold',
                side: plan.prestige ? `⭐${plan.prestige > 0 ? '+' : ''}${plan.prestige} Prestige` : '',
            });
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
        let html = `<div style="font-size:12px; color:#9d937c; margin-top:4px;">Who will rule in ${esc(child.firstName)}'s name? You will play the child's court until they come of age: the regent may serve, skim, or plot. No war may be declared and no siege laid while a regent rules.</div>`;
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
        let html = '<div style="font-size: 12px;">';
        if (message) html += `<div class="pk-card" style="color:#ece2c8; border-color:rgba(245,197,66,0.4);">${message}</div>`;
        let body = '';
        if (v.active) {
            body += `<div style="${MUTED}">Rules in your name until you come of age at ${v.majority} (${v.yearsLeft} year${v.yearsLeft === 1 ? '' : 's'}).</div>`;
            body += `<div style="margin-top:6px;">Loyalty <b>${r.loyalty}</b> <span style="color:#9d937c;">(settling toward ${v.loyaltyTarget})</span></div>${_bar(r.loyalty, r.loyalty < cfg.plotBelow ? '#e0846a' : r.loyalty < cfg.embezzleBelow ? '#f0b35a' : '#8fd18a')}`;
            body += `<div>Ambition <b>${r.ambition}</b></div>${_bar(r.ambition, '#b39ddb')}`;
            if (v.embezzled) body += `<div style="color:#f0b35a;">🧾 ${v.embezzled} gold has gone missing from the treasury under this regency.</div>`;
            if (v.rumoured) body += '<div style="color:#e0846a;">🕵️ It is whispered the regent plots to rule in more than name.</div>';
            if (v.coups) body += `<div style="color:#e0846a;">🗡️ ${v.coups} coup${v.coups === 1 ? '' : 's'} already.</div>`;
            body += `<div style="${MUTED} margin-top:4px;">Not of age: you cannot ${v.forbidden.map(f => (f === 'siege' ? 'lay a siege' : f === 'war' ? 'declare war' : f)).join(' or ')}; your company fights under the regent's captains unless one of your blood commands it.</div>`;
        }
        html += card(body, { icon: '👑', title: esc(r.name), side: esc(r.label) });

        if (v.active) {
            const gold = (player.gold || 0) >= cfg.giftGold;
            const prestige = (player.house && player.house.prestige) || 0;
            const exposed = v.rumoured || v.coups > 0;
            const replaceCost = exposed ? cfg.replaceExposedPrestige : cfg.replacePrestige;
            const canReplace = prestige >= replaceCost;
            const rows = [
                {
                    icon: '🎁', name: 'A gift', desc: `+${cfg.giftLoyalty} loyalty`,
                    off: !gold, why: `Not enough gold · +${cfg.giftLoyalty} loyalty`,
                    attrs: 'onclick="window._regencyUI.favour(\'gift\')"',
                    side: price(cfg.giftGold, gold),
                },
                {
                    icon: '🎖️', name: 'Public honours', desc: `+${cfg.honourLoyalty} loyalty`,
                    off: prestige < cfg.honourPrestige, why: `Not enough Prestige · +${cfg.honourLoyalty} loyalty`,
                    attrs: 'onclick="window._regencyUI.favour(\'honour\')"',
                    side: `⭐${cfg.honourPrestige}`, tone: 'gold',
                },
                {
                    icon: '🗡️', name: 'Put the regent aside', desc: `${exposed ? 'Plot exposed · ' : ''}choose who rules in their place: a sibling, a courtier or the council`,
                    off: !canReplace, why: `Not enough Prestige${exposed ? ' · plot exposed' : ''}`,
                    attrs: 'onclick="window._regencyUI.pickReplace()"',
                    side: `⭐${replaceCost}`, tone: 'bad',
                },
            ];
            if (v.canAssert) {
                const canAssert = prestige >= cfg.earlyMajorityPrestige;
                rows.push({
                    icon: '👑', name: 'Assert your majority',
                    off: !canAssert, why: 'Not enough Prestige',
                    attrs: 'onclick="window._regencyUI.assert()"',
                    side: `⭐${cfg.earlyMajorityPrestige}`, tone: 'gold',
                });
            }
            html += rowList(rows, 'The Child\'s Court');
        }
        if (v.ending) {
            html += sectionHead('👑 Coming of Age');
            html += lede(`The regency is over. What becomes of ${esc(r.name)}'s men? (decide by day ${v.ending.due}, or they stay)`);
            html += rowList(v.choices.map(c => {
                const ok = !c.gold || (player.gold || 0) >= c.gold;
                return {
                    icon: c.id === 'keep' ? '🤝' : '⚖️', name: esc(c.label), desc: esc(c.blurb), title: c.blurb,
                    off: !ok, why: `Not enough gold — ${esc(c.blurb)}`,
                    attrs: `onclick="window._regencyUI.end('${c.id}')"`,
                    side: c.gold ? price(c.gold, ok) : '', tone: c.id === 'keep' ? '' : 'gold',
                };
            }));
        }
        html += rowList([{ icon: '←', name: 'Back to Dynasty', act: 'openTileMenu', args: ['showDynastyMenu'] }]);
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
            replace: (id) => done(Regency.replace(player, world, id || null)),
            // Who takes over: a grown sibling, a courtier of the House (systems/court.js) or a council lord
            pickReplace: () => {
                const list = Regency.replacements(player, world);
                let h = '<div style="font-size: 12px;">';
                h += lede(`Who will rule in ${esc(r.name)}'s place until you come of age?`);
                h += rowList(list.map(c => ({
                    icon: c.kind === 'courtier' ? '👥' : c.kind === 'sibling' ? '🧑' : '🏛️',
                    name: c.kind === 'council' ? 'A lord of the regency council' : esc(c.name),
                    desc: c.kind === 'council' ? 'The council names one of its own' : `${esc(c.blurb)} · loyalty ${c.loyalty}, ambition ${c.ambition}`,
                    attrs: c.kind === 'council' ? 'onclick="window._regencyUI.replace()"' : `onclick="window._regencyUI.replace('${esc(c.id)}')"`,
                    side: 'Name ›', tone: c.kind === 'council' ? '' : 'gold',
                })), 'A New Regent');
                h += rowList([{ icon: '←', name: 'Back to the Regency', act: 'showRegencyPanel' }]);
                h += '</div>';
                game.ui.showCustomPanel('👑 Regency', h);
            },
            assert: () => done(Regency.assertMajority(player, world)),
            end: (choice) => done(Regency.resolveEnding(player, world, choice)),
        };
        game.ui.showCustomPanel('👑 Regency', html);
    },
});
