// The rival lord's audience — meeting a rival House's head on the road, staged
// as a ConversationScene: their portrait, a mood ring for their regard (the
// feud against what they remember of you), their looks, temper, mood and
// memories beside it, and a conversation: talk (their errand, news, family,
// other Houses, what they think of you), the old acts (parley, gift, insult)
// answered in their own manner, flattery and threats, and the offers they
// make of their own accord (systems/rivalAudience.js). A duel is fought in the
// duel panel. The meeting's AP is paid on its first real act; talk is free.
import { ActionMenu } from './_ref.js';
import { ConversationScene } from '../conversationScene.js';
import { RivalHouses } from '../../systems/rivalHouses.js';
import { RivalAudience } from '../../systems/rivalAudience.js';
import { Duels } from '../../systems/duels.js';
import { NpcBrain } from '../../systems/npcBrain.js';
import { DuelPanel } from './duel.js';
import { esc } from './uiKit.js';

let _current = null; // { unitId, kingdomId, paid, scene, regard, asked }

const TITLES = { talk: 'Talk', offer: 'They propose', mend: 'Mend the feud', hard: 'Harder words', match: 'A match' };
const _sign = n => `${n >= 0 ? '+' : ''}${n}`;

function _ctx(game, state) {
    const { player, world } = game;
    const unit = RivalHouses.retinues(world).find(u => u.id === state.unitId);
    const rival = unit && RivalHouses.rivalOfUnit(player, unit);
    if (!rival || !rival.head || !RivalHouses.meetable(player, world).includes(unit)) return null;
    return { unit, rival };
}

function _factsHtml(game, rival) {
    const f = RivalAudience.facts(game.player, game.world, rival);
    const pip = (icon, label, v) => `<span class="npc-scene-stat" title="${label} ${v}/10">${icon}<b>${v}</b><i style="--v:${v * 10}%"></i></span>`;
    const traits = f.traits.map(t => `<span class="npc-dialog-trait">${t.icon} ${esc(t.name)}</span>`).join('');
    const badges = [];
    if (f.truce) badges.push(`<div class="npc-dialog-rel-badge" style="color:#9fd89f">🕊️ Truce: ${f.truce} days left</div>`);
    if (f.hunting) badges.push('<div class="npc-dialog-rel-badge" style="color:#f44336">🗡️ Hunting you</div>');
    if (f.ask) badges.push(`<div class="npc-dialog-rel-badge" style="color:#e0b040">🗡️ Asked you to act against ${esc(f.ask.target || 'a House')} (${f.ask.days} days)</div>`);
    if (f.owed) badges.push(`<div class="npc-dialog-rel-badge" style="color:#e08080">🧾 Owes you ${f.owed} gold</div>`);
    const mem = f.memories.map(m => `<div style="color:${m.good ? '#9fd89f' : '#e89090'}; font-size:11px;" title="${_sign(m.weight)} regard, fading with time">${m.good ? '🙂' : '😠'} Remembers ${esc(m.text)}.</div>`).join('');
    return `${badges.join('')}
        <div style="font-size:11px; color:var(--text-secondary); font-style:italic; margin:2px 0;">${esc(f.look[0].toUpperCase() + f.look.slice(1))}; ${esc(f.honour)}.</div>
        <div class="npc-dialog-visits">${f.mood.icon} ${esc(f.mood.label)} today · feud ${f.feud} · ${esc(f.wealth)}</div>
        <div class="npc-scene-stats">${pip('🗣️', 'Diplomacy', f.skills.diplomacy)}${pip('📊', 'Stewardship', f.skills.stewardship)}${pip('🗝️', 'Intrigue', f.skills.intrigue)}${pip('⚔️', 'Martial', f.skills.martial)}</div>
        ${traits ? `<div class="npc-dialog-traits">${traits}</div>` : ''}
        ${f.ambition ? `<div style="font-size:11px; margin-top:3px;">${f.ambition.icon} Wants to ${esc(f.ambition.name.toLowerCase())}</div>` : ''}
        <div style="margin-top:4px;">${mem}</div>`;
}

function _mood(game, rival) {
    return ConversationScene.moodFromStanding(RivalHouses.regard(rival, game.world), { warm: 'Friendly', fav: 'Civil', neutral: 'Wary', cool: 'Cold', hostile: 'Hostile' });
}

/** Pay the meeting's AP on its first real act. */
function _pay(game, state) {
    if (state.paid) return true;
    const cost = ActionMenu._pendingAP;
    if (cost && (game.player.actionPoints || 0) < cost) return false;
    if (!ActionMenu.commitPendingAP(game)) return false;
    state.paid = true;
    return true;
}

function _refresh(game, state, rival) {
    const regard = RivalHouses.regard(rival, game.world);
    const delta = Math.round(regard - state.regard);
    state.regard = regard;
    state.scene.setMood(_mood(game, rival), delta);
    const facts = state.scene.overlay && state.scene.overlay.querySelector('.npc-dialog-facts');
    if (facts) facts.innerHTML = _factsHtml(game, rival);
    if (game.ui.updateStats) game.ui.updateStats(game.player, game.world);
}

function _after(game, state) {
    const c = _ctx(game, state);
    if (c) _refresh(game, state, c.rival);
    state.scene.afterSpoken(250, () => _choices(game, state));
}

/** Do a real act (pays the AP first). */
function _act(game, state, playerLine, fn) {
    if (!_pay(game, state)) {
        state.scene.note('⚡ You have no time left today for this meeting.', 'bad');
        return;
    }
    state.scene.exchange(playerLine, () => {
        const c = _ctx(game, state);
        if (!c) { state.scene.npc('*The retinue has ridden on.*'); state.scene.leave(); return; }
        fn(c.rival);
        _after(game, state);
    });
}

export function openRivalAudience(game, unitId) {
    const { player, world } = game;
    const unit = RivalHouses.retinues(world).find(u => u.id === unitId);
    const rival = unit && RivalHouses.rivalOfUnit(player, unit);
    if (!rival || !rival.head || !RivalHouses.meetable(player, world).includes(unit)) {
        game.ui.showNotification('On the Road', 'The retinue has ridden on.', 'info');
        return null;
    }
    const tile = world.getTile(player.q, player.r);
    const place = tile && tile.settlement ? tile.settlement.name : 'On the road';
    const greeting = RivalAudience.greeting(player, world, rival);
    const voiced = NpcBrain.isEnabled();
    const state = { unitId, kingdomId: rival.kingdomId, paid: false, scene: null, regard: RivalHouses.regard(rival, world), asked: false };
    state.scene = ConversationScene.open({
        variant: 'royal',
        name: RivalHouses.headName(rival),
        subtitle: `Head of ${esc(rival.name)} · age ${rival.head.age}${rival.seat ? ` · seat at ${esc(rival.seat.name)}` : ''}`,
        where: `${place} · Day ${world.day || 1}`,
        icon: '🏰', badge: '🏰',
        sprite: { type: 'noble', id: ConversationScene.seedOf(`${rival.houseKey}:${rival.head.firstName}`) },
        mood: _mood(game, rival),
        moodTitle: `How ${RivalHouses.headName(rival)} regards you: the feud against what they remember`,
        facts: _factsHtml(game, rival),
        greeting: voiced ? null : greeting,
        onClose: () => {
            if (!state.paid) ActionMenu._pendingAP = null;
            if (game.ui.updateStats) game.ui.updateStats(player, world);
            if (_current === state) _current = null;
        },
    });
    _current = state;
    if (voiced) {
        // A local model voices the greeting (systems/npcBrain.js); the template stands in when it is off or slow
        state.scene.thinking();
        const npc = { id: `rivalHead:${rival.houseKey}:${rival.head.firstName}`, firstName: RivalHouses.headName(rival), isRival: true, traits: (rival.head.traits || []).map(t => (RivalHouses.config().traits[t] || {}).name || t) };
        NpcBrain.generateNpcLine(npc, {
            topic: `a greeting to the head of a rival House you meet on the road, in a ${RivalHouses.manner(rival)} manner`,
            disposition: RivalAudience.stance(state.regard), fallback: greeting, worldContext: RivalAudience.llmContext(player, world, rival),
        }).then((line) => {
            if (!state.scene.isOpen) return;
            state.scene.npc(line || greeting);
            state.scene.afterSpoken(200, () => _choices(game, state));
        });
        return state.scene;
    }
    _choices(game, state);
    return state.scene;
}

function _choices(game, state) {
    const scene = state.scene;
    if (!scene.isOpen) return;
    const c = _ctx(game, state);
    if (!c) { scene.npc('*The retinue moves on.*'); scene.leave(); return; }
    const { player, world } = game;
    const { rival } = c;
    const v = RivalHouses.view(player, world, rival);
    const list = [];

    // ── Talk (free) ──
    for (const t of RivalAudience.topics(player, world, rival)) {
        list.push({
            icon: t.icon, label: t.label, group: 'talk',
            onPick: () => scene.exchange(t.label, () => {
                const r = _ctx(game, state);
                if (!r) return;
                for (const line of RivalAudience.topic(player, world, r.rival, t.id).lines) scene.npc(line);
                _after(game, state);
            }),
        });
    }

    // ── Their offers ──
    for (const o of RivalAudience.offers(player, world, rival, { asked: state.asked })) {
        list.push({
            icon: o.icon, label: _offerLabel(o), group: 'offer', tooltip: o.terms,
            onPick: () => _offer(game, state, o),
        });
    }

    // ── Mend ──
    const met = rival.metDay === world.day;
    if (v.feud > 0) {
        list.push({
            icon: '🤝', label: 'Let us put this quarrel behind us.', group: 'mend',
            check: 'Parley', chance: met ? null : v.parleyChance, skillTag: v.parleyChance >= 60 ? 'likely' : 'risky',
            tooltip: `${v.parleyChance}%: success cools the feud (−8); failure sours it (+3). Their mood, their memory of you and their own good sense all weigh in.`,
            disabled: met, disabledReason: 'you have spoken of it today',
            onPick: () => _act(game, state, 'Let us put this quarrel behind us.', (r) => _play(game, state, RivalAudience.act(player, world, r, 'parley'))),
        });
        list.push({
            icon: '🎁', label: 'Accept this token of good will.', group: 'mend',
            extra: `<span class="npc-dialog-price">${v.giftCost}g</span>`,
            tooltip: RivalHouses.recalls(rival, world, 'gift', 30) ? 'A second gift within the month buys only half as much.' : 'A gift to their purse cools the feud (−15).',
            disabled: (player.gold || 0) < v.giftCost, disabledReason: `you need ${v.giftCost} gold`,
            onPick: () => _act(game, state, `*offers a purse of ${v.giftCost} gold*`, (r) => _play(game, state, RivalAudience.act(player, world, r, 'gift'))),
        });
    }
    if (!RivalAudience.used(rival, world, 'flatter')) {
        const ch = Math.round(RivalAudience.flatterChance(player, rival, world) * 100);
        list.push({
            icon: '🌹', label: `They say ${rival.name} has never been in better hands.`, group: 'mend',
            check: 'Charm', chance: ch, skillTag: ch >= 60 ? 'likely' : 'risky',
            tooltip: `${ch}%: they warm a little (feud −3), or see through it. Proud heads like it; courtly and scheming ones are harder to fool.`,
            onPick: () => _act(game, state, `They say ${rival.name} has never been in better hands.`, (r) => {
                const res = RivalAudience.flatter(player, world, r);
                scene.seal('Charm', res.ok ? 'Pleased' : 'Unmoved', res.ok);
                scene.npc(res.line);
                scene.note(res.text, res.ok ? 'good' : 'bad');
            }),
        });
    }
    if (v.feud >= 45 && !RivalAudience.used(rival, world, 'terms') && !state.asked) {
        list.push({
            icon: '❔', label: 'What would it take to end this?', group: 'mend',
            onPick: () => scene.exchange('What would it take to end this?', () => {
                const r = _ctx(game, state);
                if (!r) return;
                const res = RivalAudience.askTerms(player, world, r.rival);
                state.asked = true;
                scene.npc(res.line);
                _after(game, state);
            }),
        });
    }

    // ── A match (from your side) ──
    const theirs = RivalHouses.matchableChildren(rival);
    const M = RivalHouses.config().meet.match;
    if (v.feud <= M.maxFeud) {
        for (const ch of RivalAudience._myChildren(player)) {
            for (const t of theirs.filter(x => x.gender !== ch.gender)) {
                list.push({
                    icon: '💍', label: `Would ${t.firstName} wed my ${ch.firstName}?`, group: 'match',
                    extra: `<span class="npc-dialog-price">${M.dowry}g</span>`,
                    tooltip: `A ${M.dowry} gold dowry: feud ${M.feud}, +${M.prestige} Prestige, and the two Houses are bound by blood.`,
                    disabled: (player.gold || 0) < M.dowry, disabledReason: `the dowry is ${M.dowry} gold`,
                    onPick: () => _act(game, state, `Would ${t.firstName} wed my ${ch.firstName}?`, (r) => {
                        const res = RivalHouses.proposeMatch(player, world, r.kingdomId, ch.id, t.idx);
                        if (!res.success) { scene.note(res.reason, 'bad'); return; }
                        scene.npc('*takes your hand in both of theirs* Then let it be. Blood binds better than words.');
                        scene.note(esc(res.text), 'gold');
                    }),
                });
            }
        }
    }

    // ── Harder words ──
    const owed = RivalAudience.owed(rival);
    if (owed && !RivalAudience.used(rival, world, 'demand')) {
        list.push({
            icon: '🧾', label: `You owe me ${owed} gold. Pay it.`, group: 'hard',
            tooltip: 'They pay if your strength cows them or their honour shames them; else the feud flares (+5).',
            onPick: () => _act(game, state, `You owe me ${owed} gold. Pay it.`, (r) => {
                const res = RivalAudience.demandRepayment(player, world, r);
                scene.npc(res.line);
                scene.note(res.text, res.ok ? 'good' : 'bad');
            }),
        });
    }
    if (RivalHouses._playerStrength(player) > 0 && !RivalAudience.used(rival, world, 'threaten')) {
        const ch = Math.round(RivalAudience.threatChance(player, rival) * 100);
        list.push({
            icon: '🛡️', label: 'Look at my men. Cross me again and you will regret it.', group: 'hard', cls: 'npc-dialog-choice-dark',
            check: 'Threat', chance: ch, skillTag: ch >= 60 ? 'likely' : 'risky',
            tooltip: `${ch}% (your army against their retinue of ${RivalHouses.strength(rival)}): cowed, they keep their blades and plots away for 60 days (feud +5); defiant, feud +10.`,
            onPick: () => _act(game, state, 'Look at my men. Cross me again and you will regret it.', (r) => {
                const res = RivalAudience.threaten(player, world, r);
                scene.seal('Threat', res.ok ? 'Cowed' : 'Defiant', res.ok);
                scene.npc(res.line);
                scene.note(res.text, res.ok ? 'good' : 'bad');
            }),
        });
    }
    if (v.feud >= 30 && game.world.day - (rival.lastDuelDay ?? -1e9) > 120 && !RivalAudience.allOffers(player, world, rival).some(o => o.kind === 'duel')) {
        list.push({
            icon: '⚔️', label: 'Draw your sword. We settle this now.', group: 'hard', cls: 'npc-dialog-choice-dark',
            tooltip: 'A duel to first blood with the head. Win: feud −20, +5 renown. Lose: feud −12. Either way you take some hurt.',
            onPick: () => _act(game, state, '*draws steel* Draw your sword. We settle this now.', (r) => {
                scene.npc('*a slow smile* Gladly.');
                _duel(game, state, r);
            }),
        });
    }
    if (!met) {
        list.push({
            icon: '😤', label: `Everyone knows what ${rival.name} is.`, group: 'hard', cls: 'npc-dialog-choice-dark',
            tooltip: `+3 renown with the crowd; feud +${RivalHouses.has(rival.head, 'proud') ? 15 : 10}.`,
            onPick: () => _act(game, state, `*loudly, for the crowd* Everyone knows what ${rival.name} is.`, (r) => _play(game, state, RivalAudience.act(player, world, r, 'insult'))),
        });
    }

    list.push({
        icon: '🙇', label: 'I will not keep you.', group: 'leave',
        onPick: () => {
            scene.clearChoices();
            scene.skip();
            scene.player('I will not keep you.');
            const r = _ctx(game, state);
            if (r) scene.npc(RivalAudience.farewell(player, world, r.rival));
            scene.leave();
        },
    });

    scene.choices(list, { groups: TITLES, hint: 'Choose your words — press 1–9, or Esc to take your leave.' });
}

function _offerLabel(o) {
    switch (o.kind) {
        case 'bloodPrice': return `Hear their terms: a blood price of ${o.gold} gold.`;
        case 'loan': return `They ask to borrow ${o.gold} gold.`;
        case 'speak': return `They ask you to speak for them at ${o.realm}'s court.`;
        case 'buyEstate': return `They offer ${o.gold} gold for ${o.estate}.`;
        case 'match': return `They propose ${o.theirChild} for your ${o.yourChild}.`;
        case 'against': return `They ask you to act against ${o.other}.`;
        case 'duel': return 'They challenge you to a duel.';
        default: return o.kind;
    }
}

/** Their offer is raised: they make the pitch, the player accepts or declines. */
function _offer(game, state, offer) {
    const scene = state.scene;
    scene.clearChoices();
    scene.skip();
    scene.npc(offer.pitch);
    scene.note(esc(offer.terms), 'gold');
    scene.afterSpoken(150, () => {
        const yes = offer.kind === 'duel' ? 'So be it. Steel, then.' : offer.kind === 'against' ? 'Consider it done.' : 'Agreed.';
        scene.choices([
            {
                icon: '✅', label: yes, group: 'offer',
                onPick: () => _act(game, state, yes, (r) => {
                    const res = RivalAudience.accept(game.player, game.world, r, offer);
                    if (!res.success) { scene.note(esc(res.reason), 'bad'); return; }
                    if (res.line) scene.npc(res.line);
                    if (res.text) scene.note(esc(res.text), 'good');
                    if (res.duel) _duel(game, state, r);
                }),
            },
            {
                icon: '✋', label: 'No.', group: 'offer',
                onPick: () => scene.exchange('No.', () => {
                    const r = _ctx(game, state);
                    if (!r) return;
                    scene.npc(RivalAudience.decline(game.player, game.world, r.rival, offer).line);
                    _after(game, state);
                }),
            },
            { icon: '↩️', label: 'Let me think on it.', group: 'leave', onPick: () => _choices(game, state) },
        ], { groups: TITLES });
    });
}

/** A parley / gift / insult answer: their line and the outcome. */
function _play(game, state, { res, line }) {
    const scene = state.scene;
    if (!res.success) { scene.note(esc(res.reason), 'bad'); return; }
    if (res.ok !== undefined) scene.seal('Parley', res.ok ? 'Heard' : 'Spurned', res.ok);
    if (line) scene.npc(line);
    scene.note(esc(res.text), res.ok === false ? 'bad' : 'good');
}

/** A duel to first blood with the head, in the duel panel; the scene closes for it. */
function _duel(game, state, rival) {
    const { player, world } = game;
    const kid = rival.kingdomId;
    state.scene.afterSpoken(400, () => {
        state.scene.close();
        DuelPanel.open(game, {
            a: Duels.fromPlayer(player), b: RivalHouses.duelist(rival),
            mode: 'firstBlood', title: `⚔️ ${RivalHouses.headName(rival)}`,
            intro: `🏰 <b>${esc(RivalHouses.headName(rival))}</b> salutes with the blade. Their retainers form a ring.`,
            onFinish: (outcome) => {
                const res = RivalHouses.settleDuel(player, world, kid, outcome);
                if (res.success) game.ui.showNotification(res.playerWon ? '⚔️ Honour Satisfied' : '🩸 First Blood to Them', res.text, res.playerWon ? 'success' : 'warning');
                if (game.ui.updateStats) game.ui.updateStats(player, world);
            },
        });
    });
}

/** The stage on view, for tests: { unitId, kingdomId, scene } or null. */
export function rivalAudienceState() {
    return _current;
}
