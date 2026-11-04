// The Royal Audience — meeting a lord's party on the road, staged as a
// ConversationScene: the lord's own portrait and a mood ring for their regard
// (opinion + your reputation in the realm), with gifts, petitions, oaths and
// threats as choices whose outcomes play out in the transcript.
//
// ActionMenu.showLordMeetingMenu and the meeting* methods (combat.js) delegate
// here; one audience costs the meeting's AP once, on its first real act.
import { ActionMenu } from './_ref.js';
import { Languages } from '../../systems/languages.js';
import { ConversationScene } from '../conversationScene.js';
import { NPCLords, PlayerEffects, Treasures, Technology, Titles, Utils, Peoples, Religion } from './_imports.js';
import { Traits } from '../../systems/traits.js';
import { Coalitions } from '../../systems/coalitions.js';
import { Causes } from '../../player/causes.js';
import { whyIcon, opinionWhy } from '../whyPopover.js';

let _current = null; // the audience on stage: { unitId, used, paid, scene, total }

const TITLES = {
    talk: 'Converse', gift: 'Gifts', petition: 'Petitions', oath: 'Fealty', threat: 'Threats', office: 'Royal offices',
};

function _ctx(game, unitId) {
    const world = game.world;
    const unit = world.units.find(u => u.type === 'lord_party' && u.id === unitId && !u.destroyed);
    if (!unit) return null;
    const kingdom = world.getKingdom(unit.kingdomId);
    if (!kingdom || !kingdom.lord) return null;
    return { unit, kingdom, lord: kingdom.lord };
}

function _standing(player, kingdom, lord, world = null) {
    const opinion = NPCLords.getLordOpinion(lord, player, world) + PlayerEffects.lordOpinionBonus(player, lord);
    const reputation = player.reputation ? (player.reputation[kingdom.id] || 0) : 0;
    return { opinion, reputation, total: opinion + reputation };
}

const _has = (lord, id) => (lord.traits || []).some(t => t.id === id);
/** "the Kingdom of X" in a sentence; plain names stay bare. */
const _realm = k => (/^(Kingdom|Empire|Republic|Duchy|Principality|Realm|Dominion|Theocracy|Holds|Confederacy|Sultanate|Khanate|Caliphate|Free|Grand)\b/.test(k.name) ? `the ${k.name}` : k.name);
const _sign = n => `${n >= 0 ? '+' : ''}${n}`;
const _pct = p => Math.round(Math.max(0, Math.min(1, p)) * 100);
const _odds = c => (c >= 100 ? 'guaranteed' : c >= 60 ? 'likely' : 'risky');

function _armyStrength(player) {
    return player.army ? player.army.reduce((s, u) => s + (u.strength || 1), 0) : 0;
}

function _addRep(player, kingdomId, n) {
    if (!player.reputation) player.reputation = {};
    player.reputation[kingdomId] = (player.reputation[kingdomId] || 0) + n;
}

// ── Odds (the same formulas the old panel rolled against) ──

function _tradeChance(player, lord, total) {
    return Math.min(0.9, Math.max(0.1, 0.3 + total / 200 + lord.diplomacy / 40 + PlayerEffects.negotiationBonus(player)));
}
function _aidChance(player, lord, total) {
    return Math.min(0.8, Math.max(0.05, 0.2 + total / 150 + lord.martial / 50 + PlayerEffects.negotiationBonus(player)));
}
function _tributeChance(player, kingdom, lord) {
    const resistance = (kingdom.military || 10) + lord.martial * 3 + (_has(lord, 'brave') ? 20 : 0);
    return Math.min(0.85, (_armyStrength(player) / Math.max(1, resistance)) * 0.5);
}

// ── The stage ──

function _greeting(player, kingdom, lord, total) {
    if (player.allegiance === kingdom.id) {
        return _has(lord, 'cruel')
            ? '*looks down from the saddle* My vassal. I trust you come bearing something useful.'
            : 'Ah — one of my own. Rise, and speak freely.';
    }
    if (total >= 50) return 'You are always welcome at my side, friend. What brings you to me?';
    if (total >= 20) return 'Well met. Your name has reached my ears — kindly, for the most part.';
    if (total >= -10) {
        return _has(lord, 'cunning')
            ? '*studies you for a long moment* An audience on the open road. How unusual. Speak.'
            : '*reins in their horse* You wished an audience? Speak.';
    }
    if (total >= -40) return '*a cool silence* You have a moment. Do not waste it.';
    return '*a hand drifts to a sword hilt* Say what you came to say, and go.';
}

function _farewell(lord, total) {
    if (total >= 20) return 'Go well. My door stands open to you.';
    if (total >= -10) return _has(lord, 'cautious') ? 'Travel carefully. These roads are not what they were.' : 'Safe travels.';
    return '*turns away without a word*';
}

/** "He" or "She" for the ruler (characterData knows; lords default to He). */
function _pron(kingdom) {
    const r = kingdom && kingdom.characterData && kingdom.characterData.ruler;
    return r && r.gender === 'female' ? { he: 'She', his: 'Her', parent: 'mother' } : { he: 'He', his: 'His', parent: 'father' };
}

/** What the lord remembers of you (NPCLords.memoryOf), as a few lines. */
function _memoryHtml(kingdom, lord, n = 3) {
    const mem = NPCLords.memoryOf(lord).slice(0, n);
    if (!mem.length) return '';
    const p = _pron(kingdom);
    const lines = mem.map(m => {
        const color = m.weight >= 0 ? '#9fd89f' : '#e89090';
        const text = m.inherited
            ? `${p.his} ${p.parent}${m.from ? `, ${m.from},` : ''} spoke of ${m.label}.`
            : `${p.he} remembers ${m.label}${m.note ? ` (${m.note})` : ''}.`;
        return `<div style="color:${color}; font-size:11px;" title="${m.weight >= 0 ? '+' : ''}${Math.round(m.weight)} opinion, fading with time">${m.icon} ${text}</div>`;
    }).join('');
    return `<div class="npc-dialog-memory" style="margin-top:4px;">${lines}</div>`;
}

/** A line the lord opens with when a memory weighs on them, or ''. */
function _recall(kingdom, lord) {
    const m = NPCLords.memoryOf(lord)[0];
    if (!m || Math.abs(m.weight) < 4) return '';
    if (m.inherited) {
        return `My ${_pron(kingdom).parent}${m.from ? `, ${m.from},` : ''} spoke of you — of ${m.label}. ${m.weight >= 0 ? 'Kindly.' : 'Not kindly.'} `;
    }
    return m.recall ? `${m.recall} ` : '';
}

function _factsHtml(player, kingdom, lord, st, world = null) {
    // "Why?": each part of his opinion, the deeds he remembers (player/causes.js)
    const why = whyIcon(opinionWhy(Causes.lordOpinion(world, lord, player)), 'Why does he think so?');
    const pip = (icon, label, v) => `<span class="npc-scene-stat" title="${label} ${v}/10">${icon}<b>${v}</b><i style="--v:${v * 10}%"></i></span>`;
    const traits = (lord.traits || []).map(t => `<span class="npc-dialog-trait" title="${t.description || ''}">${t.name}</span>`).join('');
    let tag = '';
    if (player.allegiance === kingdom.id) tag = '<div class="npc-dialog-rel-badge" style="color:#4fc3f7">🏳️ Your liege</div>';
    else if (player.allegiance && (kingdom.wars || []).includes(player.allegiance)) tag = '<div class="npc-dialog-rel-badge" style="color:#f44336">⚔️ At war with your realm</div>';
    return `${tag}
        <div class="npc-dialog-visits" title="The lord's own opinion, plus your reputation in ${kingdom.name}">💭 Opinion ${_sign(st.opinion)} · Rep ${_sign(st.reputation)}${why}</div>
        <div class="npc-scene-stats">${pip('⚔️', 'Martial', lord.martial)}${pip('🗣️', 'Diplomacy', lord.diplomacy)}${pip('📊', 'Stewardship', lord.stewardship)}</div>
        ${traits ? `<div class="npc-dialog-traits">${traits}</div>` : ''}
        ${_memoryHtml(kingdom, lord)}`;
}

export function openLordAudience(game, unitId) {
    const c = _ctx(game, unitId);
    if (!c) {
        game.ui.showNotification('👑 Audience', 'The lord has already departed — or rules no longer.', 'info');
        return;
    }
    const { kingdom, lord } = c;
    const player = game.player;
    const world = game.world;
    // A lord sworn into a league against you will not receive you (systems/coalitions.js)
    const refused = Coalitions.audienceRefused(player, world, kingdom.id);
    if (refused) {
        game.ui.showNotification('⚜️ No Audience', refused, 'warning');
        return;
    }
    // A court that shares no tongue with you can't hear your case (systems/languages.js)
    const tongue = Languages.canAudience(player, world, kingdom);
    if (!tongue.ok) {
        game.ui.showNotification('🗣️ No Common Tongue', tongue.reason, 'warning');
        return;
    }
    const st = _standing(player, kingdom, lord, world);
    const tile = world.getTile(player.q, player.r);
    const place = tile && tile.settlement ? tile.settlement.name : 'On the road';

    const state = { unitId, used: new Set(), paid: false, scene: null, total: st.total };
    state.scene = ConversationScene.open({
        variant: 'royal',
        name: lord.name,
        subtitle: `Ruler of <span style="color:${kingdom.color || '#4fc3f7'}">${kingdom.name}</span> · age ${lord.age}`,
        where: `${place} · Day ${world.day || 1}`,
        icon: '👑', badge: '👑',
        sprite: { type: 'noble', id: ConversationScene.seedOf(lord.name) },
        mood: ConversationScene.moodFromStanding(st.total),
        moodTitle: `How ${lord.name} regards you`,
        facts: _factsHtml(player, kingdom, lord, st, world),
        greeting: _recall(kingdom, lord) + _greeting(player, kingdom, lord, st.total),
        onClose: () => {
            // Leaving without asking anything costs nothing
            if (!state.paid) ActionMenu._pendingAP = null;
            game.ui.updateStats(player, world);
        },
    });
    _current = state;
    _choices(game, state);
}

/**
 * Perform one act of an audience by key ('gold', 't:<itemId>', 'trade', 'oath',
 * 'office', 'aid', 'tribute', 'realm'), opening the audience first if needed.
 */
export function lordAudienceAct(game, unitId, key) {
    if (!_current || !_current.scene.isOpen || _current.unitId !== unitId) openLordAudience(game, unitId);
    const state = _current;
    if (!state || !state.scene.isOpen || state.unitId !== unitId) return;
    state.scene.afterSpoken(0, () => {
        const c = _ctx(game, unitId);
        if (!c || state.used.has(key)) return;
        if (key === 'office') { _officeMenu(game, state); return; }
        if (key.startsWith('t:')) { const id = key.slice(2); _do(game, state, key, (g, s) => _presentTreasure(g, s, id)); return; }
        const pledged = game.player.allegiance === c.kingdom.id;
        const acts = {
            gold: _giftGold, trade: _requestTrade, oath: pledged ? _renounce : _pledge,
            aid: _requestAid, tribute: _demandTribute, realm: _askRealm,
        };
        if (acts[key]) _do(game, state, key, acts[key]);
    });
}

/** Repaint the ring after an act and float the change. */
function _refreshMood(game, state) {
    const c = _ctx(game, state.unitId);
    if (!c) return;
    const st = _standing(game.player, c.kingdom, c.lord, game.world);
    const delta = Math.round(st.total - state.total);
    state.total = st.total;
    state.scene.setMood(ConversationScene.moodFromStanding(st.total), delta);
    const facts = state.scene.overlay.querySelector('.npc-dialog-facts');
    if (facts) facts.innerHTML = _factsHtml(game.player, c.kingdom, c.lord, st, game.world);
}

/** Pay the audience's AP on its first real act. False if it can't be paid. */
function _pay(game, state) {
    if (state.paid) return true;
    // Check first: commitPendingAP clears the pending cost even when it can't
    // be paid, which would make the audience's next act free
    const cost = ActionMenu._pendingAP;
    if (cost && (game.player.actionPoints || 0) < cost) return false;
    if (!ActionMenu.commitPendingAP(game)) return false;
    state.paid = true;
    return true;
}

function _choices(game, state) {
    const scene = state.scene;
    if (!scene.isOpen) return;
    const c = _ctx(game, state.unitId);
    if (!c) { scene.npc('*The retinue moves on.*'); scene.leave(); return; }
    const { kingdom, lord } = c;
    const player = game.player;
    const total = _standing(player, kingdom, lord, game.world).total;
    const pledged = player.allegiance === kingdom.id;
    const used = state.used;
    const act = (key, fn) => () => _do(game, state, key, fn);
    const list = [];

    if (!used.has('realm')) {
        list.push({
            icon: '📜', label: 'Tell me of your realm.', group: 'talk',
            tooltip: `Hear of ${kingdom.name}'s peoples, faith, strength and history. They say more to those they favour.`,
            disabled: total < -40, disabledReason: 'they will not speak of it to you',
            onPick: act('realm', _askRealm),
        });
    }

    if (!used.has('gold')) {
        const amount = Math.min(player.gold, Math.max(50, Math.floor(player.gold * 0.1)));
        list.push({
            icon: '💰', label: 'Accept a gift of gold.', group: 'gift',
            extra: `<span class="npc-dialog-price">${amount}g</span>`,
            tooltip: `Give ${amount} gold (a tenth of your purse, at least 50) for reputation in ${kingdom.name}.`,
            disabled: player.gold < 50, disabledReason: 'you need at least 50 gold',
            onPick: act('gold', _giftGold),
        });
    }
    for (const gift of Treasures.giftable(player).slice(0, 4)) {
        if (used.has(`t:${gift.id}`)) continue;
        list.push({
            icon: gift.def.icon || '🎁', label: `Present the ${gift.def.name}.`, group: 'gift',
            extra: `<span class="npc-dialog-price is-good">+${gift.value}</span>`,
            tooltip: `A gift worthy of a crown: about +${gift.value} reputation. You carry ${gift.qty}.`,
            onPick: act(`t:${gift.id}`, (g, s) => _presentTreasure(g, s, gift.id)),
        });
    }

    if (!used.has('trade')) {
        const active = player.tradeAgreements && player.tradeAgreements[kingdom.id]
            && player.tradeAgreements[kingdom.id].expires > (game.world.day || 0);
        const chance = _pct(_tradeChance(player, lord, total));
        list.push({
            icon: '⚖️', label: 'Grant me favourable trade terms.', group: 'petition',
            check: 'Petition', chance: active || total < -10 ? null : chance, skillTag: _odds(chance),
            tooltip: `10% better prices in ${kingdom.name} for 90 days. ${chance}% chance — their diplomacy and regard for you weigh in.`,
            disabled: active || total < -10, disabledReason: active ? 'an agreement is already in force' : 'they think too little of you',
            onPick: act('trade', _requestTrade),
        });
    }
    if (pledged && !player.currentTitle && typeof Titles !== 'undefined' && !used.has('office')) {
        list.push({
            icon: '🏅', label: 'Appoint me to royal office.', group: 'petition',
            tooltip: 'Ask for a title with a salary and duties.',
            disabled: total < 10, disabledReason: 'they need to favour you more (10+)',
            onPick: () => _officeMenu(game, state),
        });
    }
    if (pledged && player.army && player.army.length > 0 && !used.has('aid')) {
        const chance = _pct(_aidChance(player, lord, total));
        list.push({
            icon: '🛡️', label: 'Lend me soldiers for my host.', group: 'petition',
            check: 'Petition', chance: total < 20 ? null : chance, skillTag: _odds(chance),
            tooltip: `Levies join your army; spends a little favour. ${chance}% chance — their martial skill and regard weigh in.`,
            disabled: total < 20, disabledReason: 'they need to favour you (20+)',
            onPick: act('aid', _requestAid),
        });
    }

    if (!used.has('oath')) {
        if (!pledged) {
            list.push({
                icon: '🏳️', label: `I would swear fealty to ${_realm(kingdom)}.`, group: 'oath',
                tooltip: `Become a vassal of ${kingdom.name}: +20 reputation, +5 renown. Your old liege will resent it.`,
                disabled: total < 0, disabledReason: 'they must at least be on neutral terms with you',
                onPick: act('oath', _pledge),
            });
        } else {
            list.push({
                icon: '💔', label: 'I renounce my oath.', group: 'oath', cls: 'npc-dialog-choice-dark',
                tooltip: `Leave ${kingdom.name}'s service: −25 reputation, any office is lost, and an oath broken marks you.`,
                onPick: act('oath', _renounce),
            });
        }
    }

    if (_armyStrength(player) >= 30) {
        const chance = _pct(_tributeChance(player, kingdom, lord));
        list.push({
            icon: '🗡️', label: 'Pay tribute, or face my army.', group: 'threat', cls: 'npc-dialog-choice-dark',
            check: 'Threat', chance, skillTag: _odds(chance),
            tooltip: `${chance}% they pay (your army against their realm's might). Either way: heavy reputation and karma losses.`,
            onPick: act('tribute', _demandTribute),
        });
    }

    list.push({
        icon: '🙇', label: 'By your leave, my lord.', group: 'leave',
        onPick: () => {
            scene.clearChoices();
            scene.skip();
            scene.player('By your leave.');
            scene.npc(_farewell(lord, total));
            scene.leave();
        },
    });

    scene.choices(list, { titles: TITLES, hint: 'Address the lord — press 1–9, or Esc to take your leave.' });
}

/** Run one act: pay once, mark it used, then let the scene play it out. */
function _do(game, state, key, fn) {
    const c = _ctx(game, state.unitId);
    if (!c) return;
    // Hearing about the realm is free; everything else is the audience's business
    if (key !== 'realm' && !_pay(game, state)) {
        state.scene.note('⚡ You have no time left today for an audience.', 'bad');
        return;
    }
    state.used.add(key);
    fn(game, state, c);
}

/** After an act: refresh the ring, then offer what is left once it's been said. */
function _after(game, state) {
    _refreshMood(game, state);
    game.ui.updateStats(game.player, game.world);
    state.scene.afterSpoken(250, () => _choices(game, state));
}

// ── Acts ──

function _giftGold(game, state, { kingdom, lord }) {
    const player = game.player;
    const scene = state.scene;
    const amount = Math.min(player.gold, Math.max(50, Math.floor(player.gold * 0.1)));
    player.gold -= amount;
    // A skilled diplomat (Diplomacy Mastery) makes each gold buy more goodwill
    const repBoost = PlayerEffects.scaleReputationGain(player, Math.floor(amount / (10 * Technology.getAllianceCostMultiplier(player))));
    _addRep(player, kingdom.id, repBoost);
    const giftDef = NPCLords.deedDef('gift');
    NPCLords.rememberDeed(game.world, lord, 'gift', { weight: giftDef ? Math.round(giftDef.weight * Utils.clamp(amount / 100, 0.5, 3) * 10) / 10 : undefined, note: `${amount} gold` });
    scene.exchange(`*offers a purse of ${amount} gold* A token of my esteem.`, () => {
        scene.npc(_has(lord, 'greedy') ? '*weighs the purse* Most generous… I shall remember this kindness.'
            : _has(lord, 'honorable') ? 'I accept your gift in the spirit of friendship.'
                : _has(lord, 'cruel') ? 'A wise tribute. See that it continues.'
                    : 'Thank you. You are welcome in our lands.');
        scene.note(`💰 −${amount} gold · 📈 Reputation ${_sign(repBoost)}`, 'good');
        _after(game, state);
    });
}

function _presentTreasure(game, state, itemId) {
    const { kingdom } = _ctx(game, state.unitId);
    const player = game.player;
    const scene = state.scene;
    const result = Treasures.presentToLord(player, kingdom, itemId, (p, g) => PlayerEffects.scaleReputationGain(p, g));
    if (!result.success) {
        scene.note(result.reason, 'bad');
        state.used.delete(`t:${itemId}`);
        return;
    }
    NPCLords.rememberDeed(game.world, kingdom.lord, 'gift_treasure', { note: result.item });
    scene.exchange(`*presents the ${result.item}*`, () => {
        scene.npc('*turns it over in the light* A gift worthy of a crown. You honour this court.');
        scene.note(`📈 Reputation with ${kingdom.name} ${_sign(result.reputation)}`, 'good');
        _after(game, state);
    });
}

function _requestTrade(game, state, { kingdom, lord }) {
    const player = game.player;
    const scene = state.scene;
    const total = _standing(player, kingdom, lord, game.world).total;
    const success = Math.random() < _tradeChance(player, lord, total);
    scene.exchange(`Let our merchants trade on better terms, my lord. ${kingdom.name} would profit as well as I.`, () => {
        scene.seal('Petition', success ? 'Granted' : 'Declined', success);
        if (success) {
            if (!player.tradeAgreements) player.tradeAgreements = {};
            player.tradeAgreements[kingdom.id] = { kingdom: kingdom.name, expires: game.world.day + 90 };
            const rep = PlayerEffects.scaleReputationGain(player, 5);
            _addRep(player, kingdom.id, rep);
            scene.npc('Very well. Let it be written: your goods pass at fair rates in my towns.');
            scene.note(`⚖️ 10% better prices in ${kingdom.name} for 90 days · 📈 Reputation ${_sign(rep)}`, 'good');
        } else {
            scene.npc(_has(lord, 'cautious') ? 'I must consider the risks more carefully.' : 'Perhaps another time.');
        }
        _after(game, state);
    }, 800);
}

function _pledge(game, state, { kingdom, lord }) {
    const player = game.player;
    const world = game.world;
    const scene = state.scene;
    const old = player.allegiance;
    player.allegiance = kingdom.id;
    player.kingdomTitle = 'citizen';
    player.title = `Citizen of ${kingdom.name}`;
    if (typeof Titles !== 'undefined') Titles.initialize(player);
    _addRep(player, kingdom.id, 20);
    // Diplomacy Mastery (allianceCost) softens the old crown's resentment
    const desertion = Math.round(15 * Technology.getAllianceCostMultiplier(player));
    const oldKingdom = old && old !== kingdom.id ? world.getKingdom(old) : null;
    if (oldKingdom) _addRep(player, old, -desertion);
    player.renown = (player.renown || 0) + 5;
    NPCLords.rememberDeed(world, lord, 'oath_sworn');
    // The crown you left remembers the desertion (half an oath broken)
    if (oldKingdom && oldKingdom.lord) {
        const broke = NPCLords.deedDef('oath_broken');
        NPCLords.rememberDeed(world, oldKingdom.lord, 'oath_broken', { weight: broke ? broke.weight / 2 : undefined, note: `went over to ${kingdom.name}` });
    }

    scene.exchange('*kneels* I offer you my sword and my loyalty.', () => {
        scene.seal('Oath', 'Sworn', true);
        scene.npc(_has(lord, 'honorable') ? 'Rise, friend. Your service honours us both.'
            : _has(lord, 'ambitious') ? 'Good. Together we shall build an empire.'
                : 'Welcome to our cause. Serve loyally and you will be rewarded.');
        scene.note(`🏳️ Sworn to ${kingdom.name} · 📈 Reputation +20 · ⭐ Renown +5`, 'good');
        if (oldKingdom) scene.note(`📉 Reputation −${desertion} with ${oldKingdom.name}`, 'bad');
        _after(game, state);
    }, 900);
}

function _renounce(game, state, { kingdom, lord }) {
    const player = game.player;
    const scene = state.scene;
    if (typeof Titles !== 'undefined' && player.currentTitle) Titles.resign(player, game.world);
    player.allegiance = null;
    player.kingdomTitle = null;
    player.title = 'Wanderer';
    Traits.recordDeed(player, 'deceit', 3); // an oath broken
    _addRep(player, kingdom.id, -25);
    NPCLords.rememberDeed(game.world, lord, 'oath_broken');
    scene.exchange('I release myself from your service.', () => {
        scene.seal('Oath', 'Broken', false);
        scene.npc(_has(lord, 'cruel') ? 'You dare betray me? You will regret this.'
            : 'So be it. Leave, and do not expect our welcome again.');
        scene.note(`💔 Reputation −25 with ${kingdom.name}`, 'bad');
        _refreshMood(game, state);
        game.ui.updateStats(player, game.world);
        scene.leave(1400);
    }, 800);
}

function _requestAid(game, state, { kingdom, lord }) {
    const player = game.player;
    const scene = state.scene;
    const total = _standing(player, kingdom, lord, game.world).total;
    const success = Math.random() < _aidChance(player, lord, total);
    scene.exchange('My host is thin, my lord. Lend me soldiers and I will put them to good use.', () => {
        scene.seal('Petition', success ? 'Granted' : 'Denied', success);
        if (success) {
            const count = Utils.randInt(3, 8 + Math.floor(lord.martial / 2));
            const strength = Utils.randInt(2, 4);
            for (let i = 0; i < count; i++) {
                player.army.push({
                    type: `${kingdom.name} Levy`, name: `${kingdom.name} Levy`, icon: '🛡️',
                    strength, morale: 70 + Utils.randInt(0, 20), upkeep: 1, experience: 0, level: 1,
                });
            }
            _addRep(player, kingdom.id, -5); // favour spent
            scene.npc(`*signals a captain* Take ${count} of my men. See they come home.`);
            scene.note(`🛡️ +${count} ${kingdom.name} Levy (strength ${strength} each) · 📉 Reputation −5 (favour spent)`, 'good');
        } else {
            scene.npc(_has(lord, 'cautious') ? 'Our own borders require protection. I cannot risk it.'
                : 'I sympathise, but my duty is to my own people first.');
        }
        _after(game, state);
    }, 800);
}

function _demandTribute(game, state, { kingdom, lord }) {
    const player = game.player;
    const scene = state.scene;
    const success = Math.random() < _tributeChance(player, kingdom, lord);
    scene.exchange('*gestures at the army behind you* Your treasury, or your lands. Choose.', () => {
        scene.seal('Threat', success ? 'Paid' : 'Refused', success);
        if (success) {
            const gold = Utils.randInt(50, 200 + Math.floor(kingdom.treasury * 0.1));
            player.gold += gold;
            kingdom.treasury = Math.max(0, (kingdom.treasury || 0) - gold);
            _addRep(player, kingdom.id, -30);
            player.karma = (player.karma || 0) - 5;
            NPCLords.rememberDeed(game.world, lord, 'extorted', { note: `${gold} gold` });
            scene.npc(_has(lord, 'cruel') ? '*throws down a chest* You will pay for this humiliation… in time.'
                : '*throws down a chest* Take it and be gone, brigand.');
            scene.note(`💰 +${gold} gold · 📉 Reputation −30 with ${kingdom.name} · Karma −5`, 'gold');
        } else {
            _addRep(player, kingdom.id, -15);
            player.karma = (player.karma || 0) - 3;
            NPCLords.rememberDeed(game.world, lord, 'threat');
            scene.npc(_has(lord, 'brave') ? 'You think I fear you? Guards! Remove this fool!'
                : 'I… I will not be intimidated! Guards!');
            scene.note(`📉 Reputation −15 with ${kingdom.name} · Karma −3 · You are driven off`, 'bad');
        }
        _refreshMood(game, state);
        game.ui.updateStats(player, game.world);
        scene.leave(1400);
    }, 900);
}

function _officeMenu(game, state) {
    const scene = state.scene;
    const player = game.player;
    const world = game.world;
    Titles.initialize(player);
    const qualifying = [];
    for (const [id, def] of Object.entries(Titles.getTitleDefinitions())) {
        if (Titles.meetsRequirements(player, id, world).meets) qualifying.push({ id, ...def });
    }
    scene.exchange('I would serve you in some office, my lord.', () => {
        if (!qualifying.length) {
            state.used.add('office');
            scene.npc('You have not yet proven yourself worthy of any office. Gain more reputation and skill, then return.');
            _after(game, state);
            return;
        }
        scene.npc(qualifying.length > 1 ? 'There are offices I could entrust to you. Which would you take?' : 'There is one office I could entrust to you.');
        scene.afterSpoken(150, () => {
            const back = () => {
                scene.player('Perhaps another time.');
                _choices(game, state);
            };
            const list = qualifying.map(t => ({
                icon: t.icon || '🏅', label: t.name, group: 'office',
                extra: `<span class="npc-dialog-price is-good">${t.salary}g/day</span>`,
                tooltip: t.description,
                onPick: () => _do(game, state, 'office', (g, s) => _appoint(g, s, t)),
            }));
            list.push({ icon: '↩️', label: 'Perhaps another time.', group: 'leave', onPick: back });
            scene.choices(list, { titles: TITLES, back, hint: 'Each office pays a salary — and comes with duties.' });
        });
    });
}

function _appoint(game, state, t) {
    const scene = state.scene;
    const result = Titles.appoint(game.player, t.id, game.world);
    scene.exchange(`I accept the office of ${t.name}.`, () => {
        if (!result.success) {
            scene.npc('*frowns* On reflection — no. Not yet.');
            scene.note(result.reason, 'bad');
            _after(game, state);
            return;
        }
        const title = result.title;
        scene.seal('Office', 'Bestowed', true);
        scene.npc(`Then kneel, and rise ${title.name}. Do not make me regret it.`);
        scene.note(`${title.icon || '🏅'} ${title.name} · 💰 ${title.salary} gold a day · 📋 ${title.duties.type.replace(/_/g, ' ')} within ${title.duties.deadlineDays} days`, 'gold');
        _after(game, state);
    }, 700);
}

function _askRealm(game, state, { kingdom, lord }) {
    const player = game.player;
    const scene = state.scene;
    const learned = player.learnAboutKingdom(kingdom.id, ['basics', 'ruler', 'peoples', 'religion', 'military', 'diplomacy', 'economy']);
    const total = _standing(player, kingdom, lord, game.world).total;
    // More is shared with those the lord favours
    const detailLevel = total >= 50 ? 'full' : total >= 10 ? 'good' : 'basic';
    const tales = realmTalesHtml(game, kingdom, detailLevel);
    _addRep(player, kingdom.id, 2);

    scene.exchange('Tell me of your realm, my lord.', () => {
        scene.npc(_has(lord, 'pious') ? 'All that we are, we owe to the divine. Hear, then.'
            : _has(lord, 'ambitious') ? `${kingdom.name} grows stronger each day. Let me tell you how.`
                : _has(lord, 'honorable') ? 'We are a people of honour. You will see it, should you travel our lands.'
                    : _has(lord, 'cunning') ? 'Knowledge is the truest weapon. Use what I tell you wisely.'
                        : 'Now you will know something of us. May it serve you well.');
        scene.card(`<div class="npc-scene-card-title">📜 Tales of ${kingdom.name}</div>${tales}`);
        scene.note(`📖 Learned of ${kingdom.name}${learned.length ? `: ${learned.join(', ')}` : ''} · 📈 Reputation +2`, 'info');
        _after(game, state);
    }, 700);
}

/** The lord's account of their realm: peoples, faith, strength, neighbours and old tales. */
function realmTalesHtml(game, kingdom, detailLevel) {
    const player = game.player;
    const world = game.world;
    let html = '';
    // ── 1. The Peoples ──
    html += `<div style="background:#1a1a2e; padding:10px; border-radius:6px; margin-bottom:10px; border-left:3px solid #4fc3f7;">`;
    html += `<div style="color:#4fc3f7; font-weight:bold; margin-bottom:6px;">🏛️ The Peoples of ${kingdom.name}</div>`;

    if (typeof Peoples !== 'undefined') {
        const tribes = Peoples.getTribesForCulture(kingdom.culture);
        if (tribes.length > 0) {
            html += `<div style="color:#aaa; font-size:12px; margin-bottom:6px;">"Our realm was founded by the union of ancient peoples..."</div>`;
            for (const tribe of tribes) {
                html += `<div style="background:rgba(0,0,0,0.3); padding:6px 8px; border-radius:4px; margin-bottom:4px;">`;
                html += `<div style="color:#fff; font-size:13px;">${tribe.icon} <strong>${tribe.name}</strong></div>`;
                html += `<div style="color:#888; font-size:11px;">Origin: ${tribe.origin} | Traits: ${tribe.traits.join(', ')}</div>`;
                if (detailLevel !== 'basic') {
                    html += `<div style="color:#aaa; font-size:11px; font-style:italic; margin-top:2px;">"${tribe.proverb}"</div>`;
                }
                if (detailLevel === 'full') {
                    html += `<div style="color:#ffd700; font-size:10px; margin-top:2px;">🎨 ${tribe.artForms.join(', ')} | 🍲 ${tribe.cuisine.slice(0, 2).join(', ')}</div>`;
                }
                html += `</div>`;
            }
        } else {
            html += `<div style="color:#aaa; font-size:12px;">"Our people are of the <strong>${kingdom.culture}</strong> tradition."</div>`;
        }
    } else {
        html += `<div style="color:#aaa; font-size:12px;">"We are a proud <strong>${kingdom.culture}</strong> people."</div>`;
    }
    html += `</div>`;

    // ── 2. Religion ──
    html += `<div style="background:#1a1a2e; padding:10px; border-radius:6px; margin-bottom:10px; border-left:3px solid #e6c84c;">`;
    html += `<div style="color:#e6c84c; font-weight:bold; margin-bottom:6px;">🙏 Faith of the Realm</div>`;

    if (kingdom.religion && typeof Religion !== 'undefined') {
        const faith = Religion.FAITHS ? Religion.FAITHS[kingdom.religion.faithId] : null;
        const faithIcon = faith ? faith.icon : '🙏';
        html += `<div style="color:#aaa; font-size:12px;">"We follow the ways of <span style='color:#ffd700;'>${faithIcon} ${kingdom.religion.name}</span>."</div>`;
        html += `<div style="display:grid; grid-template-columns:1fr 1fr; gap:4px; margin-top:6px; font-size:11px;">`;
        html += `<div style="background:rgba(0,0,0,0.3); padding:4px 6px; border-radius:4px; color:#aaa;">🕊️ Piety: ${Math.floor(kingdom.religion.piety)}/100</div>`;
        html += `<div style="background:rgba(0,0,0,0.3); padding:4px 6px; border-radius:4px; color:#aaa;">⚖️ Unity: ${Math.floor(kingdom.religion.unity)}/100</div>`;
        html += `</div>`;
        if (detailLevel !== 'basic') {
            const holySiteCount = kingdom.religion.holySites ? kingdom.religion.holySites.length : 0;
            html += `<div style="color:#888; font-size:11px; margin-top:4px;">⛪ ${holySiteCount} holy site${holySiteCount !== 1 ? 's' : ''} under our protection.</div>`;
            const templeUnity = Religion.templeUnity(kingdom);
            if (templeUnity > 0) {
                html += `<div style="color:#888; font-size:11px; margin-top:2px;">🛕 Our ${kingdom.temples.length} temple${kingdom.temples.length !== 1 ? 's' : ''} bind the faithful together (+${Math.round(templeUnity * 10) / 10} unity).</div>`;
            }
            if (kingdom.playerFaith && kingdom.playerFaith.devoted > 0 && game.player.religion) {
                html += `<div style="color:#b39ddb; font-size:11px; margin-top:2px;">🙏 ${kingdom.playerFaith.devoted} of our towns follow your ${game.player.religion.name}${kingdom.playerFaith.stability > 0 ? ` (+${kingdom.playerFaith.stability} stability)` : ''}.</div>`;
            }
        }
        if (detailLevel === 'full' && kingdom.religion.heresies && kingdom.religion.heresies.length > 0) {
            html += `<div style="color:#e74c3c; font-size:11px; margin-top:4px;">⚠️ Heresies trouble the realm: ${kingdom.religion.heresies.map(h => h.name).join(', ')}</div>`;
        }
    } else {
        html += `<div style="color:#aaa; font-size:12px;">"Our people follow the old traditions, without a formal church."</div>`;
    }
    html += `</div>`;

    // ── 3. Kingdom Strength ──
    html += `<div style="background:#1a1a2e; padding:10px; border-radius:6px; margin-bottom:10px; border-left:3px solid #4caf50;">`;
    html += `<div style="color:#4caf50; font-weight:bold; margin-bottom:6px;">⚔️ Strength of the Realm</div>`;

    const settlements = world.getAllSettlements().filter(s => s.kingdom === kingdom.id);
    const totalPop = settlements.reduce((sum, s) => sum + s.population, 0);
    html += `<div style="display:grid; grid-template-columns:1fr 1fr; gap:4px; font-size:11px;">`;
    html += `<div style="background:rgba(0,0,0,0.3); padding:4px 6px; border-radius:4px; color:#aaa;">🏘️ Settlements: ${settlements.length}</div>`;
    html += `<div style="background:rgba(0,0,0,0.3); padding:4px 6px; border-radius:4px; color:#aaa;">👥 Population: ${Utils.formatNumber(totalPop)}</div>`;
    if (detailLevel !== 'basic') {
        html += `<div style="background:rgba(0,0,0,0.3); padding:4px 6px; border-radius:4px; color:#aaa;">🗺️ Territory: ${kingdom.territory ? kingdom.territory.length : 0} tiles</div>`;
        html += `<div style="background:rgba(0,0,0,0.3); padding:4px 6px; border-radius:4px; color:#aaa;">🛡️ Military: ${kingdom.military || 0}</div>`;
    }
    if (detailLevel === 'full') {
        html += `<div style="background:rgba(0,0,0,0.3); padding:4px 6px; border-radius:4px; color:#aaa;">💰 Treasury: ~${Utils.formatNumber(Math.round((kingdom.treasury || 0) / 100) * 100)}</div>`;
        const wars = kingdom.wars || [];
        const allies = kingdom.allies || [];
        if (wars.length > 0) {
            const warNames = wars.map(wId => world.getKingdom(wId)?.name || 'Unknown').join(', ');
            html += `<div style="background:rgba(0,0,0,0.3); padding:4px 6px; border-radius:4px; color:#e74c3c;">⚔️ At war with: ${warNames}</div>`;
        }
        if (allies.length > 0) {
            const allyNames = allies.map(aId => world.getKingdom(aId)?.name || 'Unknown').join(', ');
            html += `<div style="background:rgba(0,0,0,0.3); padding:4px 6px; border-radius:4px; color:#4caf50;">🤝 Allies: ${allyNames}</div>`;
        }
    }
    html += `</div></div>`;

    // ── 4. Diplomacy with Other Kingdoms ──
    if (detailLevel !== 'basic') {
        const otherKingdoms = world.kingdoms.filter(k => k.id !== kingdom.id && k.isAlive);
        if (otherKingdoms.length > 0) {
            html += `<div style="background:#1a1a2e; padding:10px; border-radius:6px; margin-bottom:10px; border-left:3px solid #9c27b0;">`;
            html += `<div style="color:#9c27b0; font-weight:bold; margin-bottom:6px;">🌍 Relations with Neighbors</div>`;
            for (const other of otherKingdoms) {
                const rel = kingdom.relations[other.id] || 0;
                const atWar = kingdom.wars && kingdom.wars.includes(other.id);
                let relText, relColor;
                if (atWar) { relText = '⚔️ At War'; relColor = '#e74c3c'; }
                else if (rel > 50) { relText = '🤝 Allied'; relColor = '#4caf50'; }
                else if (rel > 0) { relText = '😐 Neutral'; relColor = '#95a5a6'; }
                else if (rel > -50) { relText = '😠 Tense'; relColor = '#e67e22'; }
                else { relText = '💢 Hostile'; relColor = '#e74c3c'; }

                html += `<div style="display:flex; justify-content:space-between; padding:2px 0; font-size:11px;">`;
                html += `<span style="color:#aaa;"><span style="color:${other.color};">●</span> ${other.name}</span>`;
                html += `<span style="color:${relColor};">${relText}</span>`;
                html += `</div>`;
            }
            html += `</div>`;
        }
    }

    // ── 5. Discover World History Lore ──
    let discoveredEntries = [];
    if (typeof Peoples !== 'undefined') {
        // Lords share more lore at higher disposition: 1-3 entries
        const loreCount = detailLevel === 'full' ? 3 : detailLevel === 'good' ? 2 : 1;
        discoveredEntries = Peoples.discoverLore(player, world, {
            kingdom: kingdom.id,
            count: loreCount
        });
    }

    if (discoveredEntries.length > 0) {
        html += `<div style="background:#1a1a2e; padding:10px; border-radius:6px; margin-bottom:10px; border-left:3px solid #ff9800;">`;
        html += `<div style="color:#ff9800; font-weight:bold; margin-bottom:6px;">📖 Histories Revealed (${discoveredEntries.length})</div>`;
        html += `<div style="color:#888; font-size:11px; margin-bottom:6px;">"Let me share some tales of our past..."</div>`;
        for (const entry of discoveredEntries) {
            html += `<div style="background:rgba(0,0,0,0.3); padding:6px 8px; border-radius:4px; margin-bottom:4px;">`;
            html += `<div style="color:#ffd700; font-size:10px;">Year ${entry.year}</div>`;
            html += `<div style="color:#ddd; font-size:12px; line-height:1.4;">${entry.text}</div>`;
            html += `</div>`;
        }
        html += `<div style="color:#666; font-size:10px; font-style:italic; margin-top:4px;">View all in 📜 World History panel</div>`;
        html += `</div>`;
    }

    return html;
}
