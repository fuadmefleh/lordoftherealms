// ActionMenu — heirs: a child's upbringing (focus, tutor, childhood dilemmas),
// a grown child's placement (office, match, wardship), the House Chronicle
// and the epitaph when the line ends. Logic lives in systems/upbringing.js,
// systems/heirs.js and systems/legacy.js; these panels present it.
import { ActionMenu } from './_ref.js';
import { House } from './_imports.js';
import { Upbringing } from '../../systems/upbringing.js';
import { Heirs } from '../../systems/heirs.js';
import { Legacy } from '../../systems/legacy.js';
import { Annals } from '../../systems/annals.js';
import { LlmProse } from '../../systems/llmProse.js';
import { Afterlife } from '../../player/afterlife.js';
import { endIronmanRun } from '../game/ironman.js';
import { HallChronicles } from '../hallChronicles.js';
import { Companions } from '../../systems/companions.js';
import { Traits } from '../../systems/traits.js';
import { Throne } from '../../systems/throne.js';
import { BTN_DARK, BTN_RED, sectionHead, lede, chips, card, actRow, rowList, price } from './uiKit.js';

const MUTED = 'color:#9d937c; font-size:11px;';
const SEL = 'width:100%; padding:5px 6px; background:rgba(0,0,0,0.35); color:#ece2c8; border:1px solid rgba(245,197,66,0.18); border-radius:6px; font-family:var(--font-body); font-size:12px;';

const STAT_ICONS = { strength: '💪', charisma: '✨', intelligence: '🧠', faith: '🙏', luck: '🍀' };
const SKILL_ICONS = { combat: '⚔️', commerce: '💰', leadership: '👑', diplomacy: '🤝', stealth: '🕵️', cartography: '🗺️' };

function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _traitChips(list) {
    if (!list || !list.length) return '<span style="color:#9d937c;">none yet</span>';
    return list.map(t => `<span title="${_esc((Traits.TRAITS[t.id] || {}).description || '')}">${t.icon} ${_esc(t.name)}</span>`).join(', ');
}

/** A stat chip with a tooltip: "💪 6". */
function _statChip(icon, value, title, dim = false) {
    return `<span class="pk-chip${dim ? ' dim' : ''}" title="${_esc(title)}">${icon} <b>${value}</b></span>`;
}

/** Compact one-card profile, reused by the death screen. */
function _profileBlock(p) {
    let h = '<div class="pk-chips" style="margin:6px 0 4px;">';
    for (const [k, v] of Object.entries(p.stats)) h += _statChip(STAT_ICONS[k] || k, v, k);
    h += _statChip('❤️', p.maxHealth, 'max health');
    for (const [k, v] of Object.entries(p.skills)) h += _statChip(SKILL_ICONS[k] || k, v, k, true);
    h += '</div>';
    h += `<div style="font-size:11px; color:#cbbf9f;">${p.comeOfAge ? 'Traits' : 'Childhood traits'}: ${_traitChips(p.traits)}</div>`;
    return h;
}

/** A House's crest block: sigil, name, motto, a line under. */
function _crest(icon, name, motto, sub) {
    let h = '<div style="text-align:center; margin:2px 0 10px;">';
    h += `<div style="font-size:28px; line-height:1.2;">${icon || '🛡️'}</div>`;
    h += `<div style="font-family:var(--font-display); font-weight:600; letter-spacing:0.5px; color:#ffe9a8; font-size:16px;">${name}</div>`;
    if (motto) h += `<div style="font-style:italic; color:#cbbf9f; font-size:12px;">&ldquo;${motto}&rdquo;</div>`;
    if (sub) h += `<div style="margin-top:6px; display:flex; justify-content:center;">${sub}</div>`;
    return h + '</div>';
}

const BACK_TO_DYNASTY = { icon: '←', name: 'Back to Dynasty', act: 'openTileMenu', args: ['showDynastyMenu'] };

Object.assign(ActionMenu, {
    /** Heir profile HTML (used by the death screen's heir cards). */
    _heirProfileHtml(player, child) {
        const p = Upbringing.profile(player, child);
        if (!p) return '';
        let h = `<div style="font-size:11px; color:#c9b27a; margin-top:2px;">${_esc(Upbringing.summary(player, child))}${p.tutor ? ` · taught by ${_esc(p.tutor.name)}` : ''}</div>`;
        return h + _profileBlock(p);
    },

    /** One child's upbringing: focus, tutor, dilemmas — or, grown, their placement. */
    showChildPanel(game, childId, message = null) {
        const player = game.player;
        const world = game.world;
        const child = (player.children || []).find(c => c.id === childId);
        if (!child) return;
        const p = Upbringing.profile(player, child);
        const cfg = Upbringing.config();
        let html = '<div style="font-size: 12px;">';
        if (message) html += `<div class="pk-card" style="border-color:${message.color || 'rgba(245,197,66,0.4)'}; color:#ece2c8;">${message.html}</div>`;

        // Who they are
        const stageText = p.stage === 'infant' ? `An infant — education begins at ${cfg.startAge}.` : p.stage === 'child' ? `Coming of age at ${cfg.comeOfAgeAge}.` : 'Of age.';
        let who = `<div style="${MUTED}">${stageText}${p.role ? ` · 🏰 ${_esc((House.roleDefs()[p.role] || {}).label || p.role)}` : ''}${player.heir === p.id ? ' · <span style="color:#ffcf6a;">👑 Designated heir</span>' : ''}</div>`;
        if (p.birthTraits.length) who += `<div style="font-size:11px; margin-top:2px;">Born: ${p.birthTraits.map(t => `${t.icon} ${_esc(t.name)}`).join(', ')}</div>`;
        who += _profileBlock(p);
        if (p.leanings.length) who += `<div style="${MUTED}">Leaning toward: ${p.leanings.map(l => `${l.icon} ${_esc(l.name)} (${l.pct}%)`).join(', ')}</div>`;
        if (p.spouse) who += `<div style="font-size:11px; color:#ff9ad5; margin-top:2px;">💍 Wed to ${_esc(p.spouse.name)}${p.spouse.kind === 'royal' ? ' (royal)' : (p.spouse.kind === 'local' ? ` (of ${_esc(p.spouse.townName || 'town')})` : '')}</div>`;
        if (p.placement && p.placement.kind === 'ward') {
            who += `<div style="font-size:11px; color:#9cc8ff; margin-top:2px;">🏰 ${p.away ? `Fostering at the court of ${_esc(p.placement.lordName)} until day ${p.placement.until}` : `Fostered at the court of ${_esc(p.placement.lordName)}`}</div>`;
        }
        html += card(who, {
            icon: p.gender === 'female' ? '👧' : '👦', title: _esc(p.name),
            side: `${p.gender === 'female' ? '♀️' : '♂️'} Age ${p.age}${p.alive ? '' : ' · ⚰️ dead'}`,
        });

        // A dilemma waiting for the parent
        if (p.pending) {
            const ev = p.pending;
            html += sectionHead(`${ev.icon} ${_esc(ev.title)}`);
            html += lede(`${_esc(ev.text)} <span style="color:#9d937c;">(decide by day ${ev.expires})</span>`);
            html += rowList(ev.choices.map(c => ({
                icon: c.isDefault ? '·' : '✦',
                name: `${_esc(c.label)}${c.risky ? ' ⚠️' : ''}`,
                off: !c.affordable, why: 'Not enough gold',
                attrs: `onclick="window._heirsUI.choose('${child.id}','${c.id}')"`,
                side: c.cost ? price(c.cost, c.affordable) : '',
                tone: c.isDefault ? '' : 'gold',
            })));
        }

        if (p.alive && !p.comeOfAge) {
            // Education focus
            html += sectionHead('Education');
            html += lede(p.focus ? `${p.focus.icon} <b>${_esc(p.focus.name)}</b> — ${_esc((Upbringing.focus(p.focus.id) || {}).blurb || '')}` : 'No focus: a little of everything, slowly, and no particular character.');
            html += rowList(Object.entries(Upbringing.focuses()).map(([id, f]) => {
                const on = p.focus && p.focus.id === id;
                return {
                    icon: f.icon, name: _esc(f.name), desc: _esc(f.blurb), title: f.blurb,
                    attrs: `onclick="window._heirsUI.focus('${child.id}','${id}')"`,
                    side: on ? '✓ chosen' : '', tone: on ? 'gold' : '',
                };
            }));

            // Tutor
            html += sectionHead('Tutor');
            if (p.tutor) {
                const t = p.tutor;
                html += card(`${t.icon} <b>${_esc(t.name)}</b> — ${t.focus ? `teaches ${_esc((Upbringing.focus(t.focus) || {}).name || t.focus)}` : 'teaches a little of everything'}, learning ×${t.multiplier.toFixed(2)}${t.wage ? `, ${t.wage}g a month` : ''}${t.kind === 'companion' ? ' (while they travel with you)' : ''}.`
                    + ` <button onclick="window._heirsUI.dismiss('${child.id}')" style="${BTN_DARK}">Dismiss</button>`);
            } else {
                html += `<div style="${MUTED} margin:0 2px 6px;">No tutor. A tutor whose subject matches the focus speeds learning greatly.</div>`;
            }
            if (p.away) html += `<div style="color:#9cc8ff; margin:0 2px 6px;">Abroad, the host’s court teaches; tutors wait for the child’s return.</div>`;
            const tutorRows = [];
            for (const t of (p.away ? [] : Upbringing.tutors())) {
                const ok = (player.gold || 0) >= (t.hireCost || 0);
                const subj = t.focus ? (Upbringing.focus(t.focus) || {}).name || t.focus : 'All subjects';
                tutorRows.push({
                    icon: t.icon, name: `Hire the ${_esc(t.name)}`,
                    desc: `${_esc(subj)} · ×${t.quality} · ${t.wage}g/month`,
                    off: !ok, why: `Not enough gold · ${_esc(subj)} · ×${t.quality} · ${t.wage}g/month`,
                    attrs: `onclick="window._heirsUI.hire('${child.id}','${t.id}')"`,
                    side: price(t.hireCost, ok),
                });
            }
            const occ = Upbringing.data().companionOccupations || {};
            for (const npc of (p.away ? [] : Companions.members(player, world))) {
                const subj = occ[npc.occupation] ? (Upbringing.focus(occ[npc.occupation]) || {}).name : 'All subjects';
                tutorRows.push({
                    icon: '🧭', name: _esc(npc.firstName),
                    desc: `companion, ${_esc(npc.occupation || 'traveller')} · ${_esc(subj)}`,
                    attrs: `onclick="window._heirsUI.companion('${child.id}','${npc.id}')"`,
                    side: 'Ask to tutor',
                });
            }
            html += rowList(tutorRows);
        }

        if (p.alive && p.comeOfAge) {
            const kingdoms = Heirs.kingdoms(player, world);
            const opts = kingdoms.map(k => {
                const royal = Heirs.royalCandidates(world, k.id)[0];
                return `<option value="${k.id}">${_esc(k.name)} (rep ${Math.round((player.reputation || {})[k.id] || 0)}${royal ? `, royal: ${_esc(royal.firstName)}` : ''})</option>`;
            }).join('');
            const pl = Heirs.config();
            const tcfg = Throne.config();
            html += sectionHead('A Place in the World');
            html += lede('Offices are granted from the House panel; skills decide how well they serve.');
            html += rowList(House.ROLE_IDS.map(r => {
                const def = House.roleDefs()[r];
                const on = p.role === r;
                return {
                    icon: '🏰', name: _esc(def.label), desc: _esc(def.blurb), title: def.blurb,
                    attrs: `onclick="window._heirsUI.role('${child.id}','${r}')"`,
                    side: `${on ? '✓ ' : ''}${_esc(def.skill)} ${p.skills[def.skill] || 0}`, tone: on ? 'gold' : '',
                };
            }));
            if (!p.away && kingdoms.length) {
                html += `<div style="margin:2px 0 4px;"><select id="heirKingdomSel" style="${SEL}">${opts}</select></div>`;
                const placeRows = [];
                if (!p.spouse) {
                    placeRows.push({
                        icon: '💍', name: 'Alliance match', desc: `+${pl.allianceReputation} rep with the chosen realm`,
                        attrs: `onclick="window._heirsUI.place('${child.id}','alliance')"`,
                        side: price(pl.allianceDowry, (player.gold || 0) >= pl.allianceDowry),
                    });
                    placeRows.push({
                        icon: '👑', name: 'Royal match', desc: `⭐${tcfg.royalMatchPrestige}, and a claim on the throne`,
                        attrs: `onclick="window._heirsUI.place('${child.id}','royal')"`,
                        side: price(tcfg.royalMatchGold, (player.gold || 0) >= tcfg.royalMatchGold), tone: 'gold',
                    });
                }
                if (!(Upbringing.ensure(child).fostered)) {
                    placeRows.push({
                        icon: '🏰', name: 'Send as ward', desc: 'To be fostered at the chosen court',
                        attrs: `onclick="window._heirsUI.place('${child.id}','ward')"`,
                        side: `${pl.wardDays} days`,
                    });
                }
                html += rowList(placeRows);
            }
            // A match in town: one of the townsfolk (systems/townsfolk.js)
            if (!p.away && !p.spouse) {
                const local = Heirs.localMatches(player, world, child.id).slice(0, 6);
                html += sectionHead('A Match in Town');
                if (!local.length) {
                    html += `<div style="${MUTED} margin:0 2px 6px;">No one of the right age in the towns whose people you know. Walk among the townsfolk to meet more.</div>`;
                } else {
                    html += lede(`No dowry. ${pl.localPrestige < 0 ? `Costs ⭐${-pl.localPrestige} Prestige (a noble or merchant family adds ⭐${pl.localPrestigeGentle}),` : ''} +${pl.localReputation} standing with the town's realm, and their kin warm to you.`);
                    html += rowList(local.map(m => ({
                        icon: m.person.gender === 'female' ? '👩' : '👨', name: _esc(m.name),
                        desc: `${_esc(m.role)}, ${m.age} · ${_esc(m.town)}${m.known ? ' · you know them' : ''}${m.gentle ? ' · good family' : ''}`,
                        attrs: `onclick="window._heirsUI.local('${child.id}',${m.folk.q},${m.folk.r},${m.person.id})"`,
                        side: '💍 Wed',
                    })));
                }
            }
        }

        // Fostering, betrothal, commissions, the record and its payoff (ui/actionMenu/heirAgency.js)
        if (p.alive) html += ActionMenu._familyAgencyHtml(game, child);

        if (p.events.length) {
            html += rowList(p.events.map(e => ({
                icon: e.icon, name: `${_esc(e.title)} — <i style="font-weight:400;">${_esc(e.choice)}</i>`,
                desc: _esc(e.text), side: `Age ${e.age}`,
            })), 'Childhood');
        }
        html += rowList([BACK_TO_DYNASTY]);
        html += '</div>';

        const refresh = (msg) => {
            game.ui.updateStats(player, world);
            ActionMenu.showChildPanel(game, childId, msg);
        };
        const fail = (reason) => game.ui.showNotification('👶 Upbringing', reason, 'error');
        window._heirsUI = {
            focus: (id, focusId) => {
                const res = Upbringing.setFocus(player, id, focusId, world);
                if (!res.success) return fail(res.reason);
                refresh({ html: `${res.focus.icon} ${_esc(child.firstName)} will be raised in ${_esc(res.focus.name.toLowerCase())} arts.` });
            },
            hire: (id, tutorId) => {
                const res = Upbringing.hireCourtTutor(player, world, id, tutorId);
                if (!res.success) return fail(res.reason);
                refresh({ html: `${res.tutor.icon} The ${_esc(res.tutor.name)} takes up ${_esc(child.firstName)}'s education (−${res.cost}g).` });
            },
            companion: (id, npcId) => {
                const npc = Companions.members(player, world).find(n => n.id === npcId);
                const eff = npc ? Companions.effectiveness(player, npc) : 1;
                const res = Upbringing.hireCompanionTutor(player, world, id, npc, eff);
                if (!res.success) return fail(res.reason);
                refresh({ html: `🧭 ${_esc(res.tutor.name)} agrees to teach ${_esc(child.firstName)} on the road.` });
            },
            dismiss: (id) => {
                const res = Upbringing.dismissTutor(player, id);
                if (!res.success) return fail(res.reason);
                refresh({ html: `${_esc(res.tutor.name)} is dismissed.` });
            },
            choose: (id, choiceId) => {
                const res = Upbringing.resolveEvent(player, world, id, choiceId);
                if (!res.success) return fail(res.reason);
                refresh({ html: `${res.event.icon || '📜'} ${_esc(res.text)}`, color: res.died ? 'rgba(224,96,96,0.5)' : null });
            },
            role: (id, roleId) => {
                const res = House.assignRole(player, roleId, id);
                if (!res.success) return fail(res.reason);
                refresh({ html: `🏰 ${_esc(child.firstName)} is now ${_esc(House.roleDefs()[roleId].label)}.` });
            },
            local: (id, q, r, personId) => {
                const t = world.getTile(q, r);
                const folk = t && t.settlement && t.settlement.folk;
                const res = Heirs.marryTownsperson(player, world, id, folk, personId);
                if (!res.success) return fail(res.reason);
                refresh({ html: `💍 ${_esc(child.firstName)} weds ${_esc(res.spouse.name)}, ${_esc(res.spouse.role)} of ${_esc(res.spouse.townName)}${res.prestige ? ` (⭐${res.prestige > 0 ? '+' : ''}${res.prestige})` : ''}.` });
            },
            place: (id, kind) => {
                const sel = document.getElementById('heirKingdomSel');
                const kid = sel ? sel.value : null;
                if (!kid) return fail('Choose a kingdom.');
                let res;
                if (kind === 'alliance') res = Heirs.marryForAlliance(player, world, id, kid);
                else if (kind === 'royal') res = Heirs.arrangeRoyalMatch(player, world, id, kid);
                else res = Heirs.sendAsWard(player, world, id, kid);
                if (!res.success) return fail(res.reason);
                if (kind === 'ward') refresh({ html: `🏰 ${_esc(child.firstName)} leaves to foster at the court of ${_esc(res.placement.lordName)} until day ${res.placement.until}.` });
                else refresh({ html: `💍 ${_esc(child.firstName)} weds ${_esc(res.spouse.name)}${kind === 'royal' ? ` — the House now holds a claim of ${res.claim} on the throne of ${_esc(res.spouse.kingdomName)}` : ''}.` });
            },
        };
        game.ui.showCustomPanel(`👶 ${child.firstName}`, html);
    },

    /** The House Chronicle: every ruler's reign, and the House's legacy. */
    showHouseChronicle(game) {
        const player = game.player;
        const d = Legacy.describe(player, game.world);
        if (!d) {
            game.ui.showNotification('House', 'Your House has not yet been founded.', 'info');
            return;
        }
        let html = '<div style="font-size: 12px;">';
        html += _crest(d.sigil.icon, _esc(d.houseName), d.motto ? _esc(d.motto) : '', chips([
            ['🧬', 'Generation', d.generation],
            { icon: '⭐', label: 'Prestige', value: d.prestige, cls: 'gold' },
            ['📜', 'Legacy', d.score],
            [d.rank.icon, _esc(d.rank.label), ''],
        ]));
        html += sectionHead('Reigns');
        html += ActionMenu._reignsHtml(d.reigns);
        html += rowList([BACK_TO_DYNASTY]);
        html += '</div>';
        game.ui.showCustomPanel('📜 House Chronicle', html);
    },

    /** Reign cards, founder first. */
    _reignsHtml(reigns) {
        let html = '';
        for (const r of reigns) {
            let body = `<div style="${MUTED}">Day ${r.startDay}–${r.live ? 'now' : r.endDay} · ${r.years} years · age ${r.startAge}–${r.endAge}${r.cause ? ` · died of ${_esc(r.cause)}` : ''} · ${r.score} legacy</div>`;
            const traits = (r.traits || []).map(id => Traits.TRAITS[id]).filter(Boolean);
            if (traits.length) body += `<div style="font-size:11px;">${traits.map(t => `${t.icon} ${_esc(t.name)}`).join(', ')}</div>`;
            if (r.title || r.crown) body += `<div style="font-size:11px; color:#ffcf6a;">${r.crown ? `👑 Ruler of ${_esc(r.crown)}` : ''}${r.crown && r.title ? ' · ' : ''}${r.title ? `📜 ${_esc(r.title)}` : ''}</div>`;
            const deeds = [
                ['👑', r.crownsWon, 'crowns won'], ['🏰', r.settlements, 'settlements taken'], ['⚔️', r.battles, 'battles won'],
                ['🔥', r.wars, 'wars'], ['📜', r.quests, 'quests'], ['🎖️', r.titles, 'titles gained'],
                ['🕳️', r.delvesCleared, 'delves cleared'], ['🗡️', r.rivalsBested, 'rivals bested'], ['⚖️', r.petitionsRuled, 'petitions ruled'],
                ['👶', r.children, 'children born'], ['🏛️', r.ambitionMilestones, 'ambition milestones'],
                ['🏗️', r.holdingProjects, 'holding projects built'], ['🛡️', r.raidsRepelled, 'raids repelled'],
                ['🔥', r.rebellionsCrushed, 'rebellions crushed'], ['🏚️', r.holdingsLost, 'holdings lost'],
            ].filter(x => x[1] > 0);
            if (deeds.length) body += `<div style="font-size:11px; color:#cbbf9f; margin-top:2px;">${deeds.map(([i, v, l]) => `<span title="${l}">${i} ${v} ${l}</span>`).join(' · ')}</div>`;
            // The royal court this ruler kept, and crowns lost in the reign
            const c = r.court || {};
            const court = [
                ['📜', c.edictsPassed, 'edicts proclaimed'], ['🍖', c.feasts, 'royal feasts'], ['🗝️', c.plotsRevealed, 'plots uncovered'],
                ['👑', c.revoltsCrushed, 'revolts crushed'], ['🥀', c.revoltsConceded, 'revolts conceded'], ['⛓️', c.lordsBroken, 'lords broken'],
                ['💎', c.monopolyRevenue, 'g from crown monopolies'], ['🍞', c.doleGrain, 'grain given in the dole'],
            ].filter(x => x[1] > 0);
            if (court.length) body += `<div style="font-size:11px; color:#c9b27a;">🏛️ ${court.map(([i, v, l]) => `${i} ${v} ${l}`).join(' · ')}</div>`;
            for (const lost of r.crownsLost || []) body += `<div style="font-size:11px; color:#e0846a;">👑 The crown of ${_esc(lost.kingdomName)} ${lost.how === 'abdicated' ? 'set down' : 'lost'} after ${lost.days} days</div>`;
            if (r.prestigeGained) body += `<div style="font-size:11px; color:#cbbf9f;">⭐ ${r.prestigeGained > 0 ? '+' : ''}${r.prestigeGained} Prestige</div>`;
            for (const n of r.notableRulings || []) body += `<div style="font-size:11px; color:#b8b4c8;">⚖️ ${_esc(n.text)}</div>`;
            for (const h of r.highlights || []) body += `<div style="font-size:11px; color:#9d937c;">· ${_esc(h.text)}</div>`;
            // The realm in these years, on the Timeline of the Realm (ui/actionMenu/timeline.js)
            body += `<div data-am-act="showTimeline" data-am-args="${_esc(JSON.stringify([{ day: r.startDay }]))}" style="font-size:11px; color:#c9b27a; cursor:pointer; margin-top:3px;" title="Open the Timeline of the Realm at the start of this reign">🗺️ <u>See the realm in these years</u></div>`;
            const title = `${_esc(r.name)}${r.epithet ? ` <i style="color:#c9b27a; font-weight:400;">${_esc(r.epithet)}</i>` : ''}`;
            const block = card(body, { title, side: `Gen ${r.generation}${r.live ? ' · reigning' : ''}`, tone: r.live ? 'gold' : '' });
            html += r.live ? block.replace('class="pk-card', 'style="border-color: rgba(245,197,66,0.45);" class="pk-card') : block;
        }
        return html;
    },

    /** The line has ended: the House's epitaph and legacy score. */
    showEpitaph(game, cause = null) {
        const player = game.player;
        // No heir: the banks and creditors take their share, the rest goes to the crown (player/estateSettlement.js)
        const estate = Afterlife.settleEstate(player, game.world, cause);
        const e = Legacy.endDynasty(player, game.world, cause);
        let html = '<div style="font-size: 12px;">';
        if (!e) {
            html += lede('Without an heir, your story ends here.');
        } else {
            html += _crest(e.sigil.icon, _esc(e.houseName), e.motto ? _esc(e.motto) : '', chips([
                ['🧬', `${e.generations} generation${e.generations === 1 ? '' : 's'}`, ''],
                ['⏳', `${e.years} years`, ''],
                { icon: '⭐', label: 'Prestige', value: e.prestige, cls: 'gold' },
                e.crowns ? ['👑', `${e.crowns} crown${e.crowns === 1 ? '' : 's'}`, ''] : null,
            ]));
            html += '<div style="text-align:center; margin:0 0 10px;">';
            html += `<div style="font-size:22px;">${e.rank.icon}</div><div style="font-family:var(--font-display); color:#ffe9a8; font-size:15px; font-weight:600;">${_esc(e.rank.label)}</div>`;
            html += `<div style="color:#9d937c;">Legacy score ${e.score}</div>`;
            if (e.line) html += `<div style="color:#c9b27a; font-style:italic; margin-top:4px;">${_esc(e.line)}</div>`;
            // The court scribe's epitaph (systems/llmProse.js): shown when written, filled in if it comes while the page is open
            Annals.writeEpitaph(game.world, player, e);
            const epKey = Annals.epitaphKey(player);
            const writ = LlmProse.written(game.world, epKey);
            html += `<div id="epitaphProse" style="color:#e8dcc0; font-family: Georgia, serif; font-style:italic; margin-top:8px;${writ ? '' : ' display:none;'}">${writ ? `✒️ ${_esc(writ)}` : ''}</div>`;
            if (!writ && ['queued', 'writing'].includes(LlmProse.status(game.world, epKey)) && typeof setInterval === 'function') {
                let tries = 0;
                const poll = setInterval(() => {
                    const el = typeof document !== 'undefined' && document.getElementById('epitaphProse');
                    const t = LlmProse.written(game.world, epKey);
                    if (el && t) { el.textContent = `✒️ ${t}`; el.style.display = ''; }
                    if (t || !el || ++tries > 60 || !['queued', 'writing'].includes(LlmProse.status(game.world, epKey))) clearInterval(poll);
                }, 2500);
            }
            html += '</div>';
            html += sectionHead('Reigns');
            html += ActionMenu._reignsHtml(e.reigns);
        }
        // Filed in the Hall of Houses (systems/metaLegacy.js); an Ironman run ends here for good (ui/game/ironman.js)
        const run = game.world && game.world.run;
        const ironman = endIronmanRun(game);
        if (e && run) {
            // ...with its chronicle book, kept for the Hall (ui/hallChronicles.js; optional)
            HallChronicles.archive(game);
            html += `<div style="font-size:11px; color:#9d937c; text-align:center; margin-top:8px;">🏛️ ${_esc(e.houseName)} is entered in the Hall of Houses${run.tainted ? ' (a tainted run: it earns no legacy)' : ''}.</div>`;
        }
        if (ironman) html += '<div style="font-size:11px; color:#e0846a; text-align:center; margin-top:4px;">⚒️ Ironman: this run is over, and its save is gone.</div>';
        if (estate) html += ActionMenu._estateHtml(game.world, estate);
        html += `<button onclick="location.reload();" style="${BTN_RED} display:block; width:100%; margin-top:10px; padding:10px;">Start New Game</button>`;
        html += '</div>';
        game.ui.showCustomPanel('🕯️ The Line Ends', html, { locked: true });
    },
});
