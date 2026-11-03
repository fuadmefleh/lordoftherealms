// npcDialog — render functions.
import { InnerMap } from '../../world/innerMap.js';
import { ActionMenu } from '../actionMenu.js';
import { NpcFamily } from '../../systems/npcFamily.js';
import { NpcBrain } from '../../systems/npcBrain.js';
import { NpcDisposition } from '../../systems/npcDisposition.js';
import { Quests } from '../../systems/quests.js';
import { Townsfolk } from '../../systems/townsfolk.js';
import { NpcTasks } from '../../systems/npcTasks.js';
import { NpcKnowledge } from '../../systems/npcKnowledge.js';
import { Relationships } from '../../systems/relationships.js';
import { Fame } from '../../systems/fame.js';
import { StreetCrime } from '../../systems/streetCrime.js';
import { _suspectChoices } from './suspect.js';
import { GREETINGS, RETURNING_GREETINGS, RESPECTFUL_GREETINGS, HOSTILE_GREETINGS, RUMORS, FAREWELLS, THREAT_RESPONSES, THREAT_SUCCESS, FLATTER_RESPONSES, FLATTER_SUCCESS, TIME_COMMENTS, WEATHER_COMMENTS, NPC_QUEST_HOOKS, LOCATION_INFO, KINGDOM_INFO } from '../npcDialog.data.js';
import { dialogState } from './shared.js';
import { renderChoiceGrid, formatSpokenLine } from '../conversationScene.js';
import { NpcDialog } from './index.js'; // call-time facade ref (ESM cycle-safe)
import { _mem, _dispositionLabel, _pick, _getTimeOfDay, _getWeather, _getSettlement, _getKingdom, _skillCheck, _getAttributeBonus, _getSkillTotal, _getPlayerTitle, _isPlayerRenowned, _getGreeting, _getRumor, _getFarewell, _worldContext } from './helpers.js';
import { _handleChoice, _showGiftSubmenu, _giveGoldGift, _giveItemGift, _showAskAboutSubmenu, _showSkillCheckResult, _animateDispositionChange, _updateDispositionBar, _createOverlay, _taskChoice } from './choices.js';

export function _buildConversation(npc) {
    // First impressions: the player's name here, and a rival House's feud (systems/fame.js)
    const g0 = dialogState._game;
    if (g0 && g0.player) NpcDisposition.seedFromStanding(npc, g0.player, Fame._kingdomAt(g0.world, g0.player.q, g0.player.r));
    const mem = _mem(npc);
    // A newly titled player is congratulated (and liked a little more)
    const titleNews = NpcDisposition.notePlayerTitle(npc, _getPlayerTitle());
    mem.timesSpoken++;

    // What they saw of the player's violence in the street, or have heard of it
    const gw = g0 && g0.world;
    dialogState._street = g0 && g0.player
        ? StreetCrime.dialogFor(npc, g0.player, gw, { key: `${g0.player.q},${g0.player.r}`, day: (gw && gw.day) || 0 })
        : null;
    const street = dialogState._street;

    let greeting = _getGreeting(npc);
    // A task done for this NPC (systems/quests.js) is remembered warmly
    const player = dialogState._game && dialogState._game.player;
    const thanks = player ? Quests.collectThanks(player, npc) : null;
    if (thanks) {
        NpcDisposition.adjustDisposition(npc, NpcTasks.config().thanksDisposition, player);
        mem.questAccepted = false;
        greeting = 'You kept your word — I won\'t forget what you did for me! ' + greeting;
    }
    // A task left undone, or a betrayal heard of (systems/quests.js grievances)
    const grievance = player ? Quests.collectGrievance(player, npc) : null;
    if (grievance) {
        if (grievance.delta) NpcDisposition.adjustDisposition(npc, grievance.delta, player);
        if (grievance.kind === 'wronged') mem.wronged = true;
        mem.questAccepted = false;
        greeting = `${grievance.text} ` + greeting;
    } else if (player) {
        // The giver asks after a task still under way
        const pending = NpcTasks.pendingFor(player, npc);
        if (pending && pending.objectives[0]) greeting = `Any word yet? (${pending.objectives[0].text}.) ` + greeting;
    }
    // A favour's coin long overdue (systems/npcKnowledge.js → mem.owed)
    const dun = NpcKnowledge.dunning(mem, (dialogState._game && dialogState._game.world && dialogState._game.world.day) || 0);
    if (dun) greeting = `${dun} ` + greeting;
    if (titleNews.changed && !mem.grudge && !mem.threatened && !street) {
        greeting = `I hear you're ${titleNews.title} now — congratulations! ` + greeting;
    }
    // Townsfolk remember the player across the years (systems/townsfolk.js)
    const world = dialogState._game && dialogState._game.world;
    if (world && !mem.threatened) {
        const reunion = street && street.kind === 'witness' ? null : Townsfolk.reunionLine(npc, world);
        if (reunion) greeting = reunion + ' ' + greeting;
        Townsfolk.noteSeen(npc, world.day || 1);
    }
    dialogState._lines = [{
        speaker: npc.name,
        icon: npc.icon,
        text: greeting,
        isNpc: true,
    }];
    dialogState._lineIndex = 0;

    // LLM voice (Spec 2): for major NPCs, when the brain is enabled, request a
    // bespoke greeting and swap it in when it arrives. The template shows
    // immediately and stays if the model is off, slow, or offline.
    if (typeof NpcBrain !== 'undefined' && NpcBrain.isEnabled() && NpcBrain.isMajor(npc)) {
        const disposition = _dispositionLabel(mem.disposition || 0);
        NpcBrain.generateNpcLine(npc, { topic: 'a fitting greeting', disposition, fallback: greeting, worldContext: _worldContext(npc) })
            .then((line) => {
                // Only swap if the dialog is still open on the greeting line.
                if (!line || line === greeting) return;
                if (dialogState._lineIndex !== 0 || !dialogState._lines[0]) return;
                dialogState._lines[0].text = line;
                const box = dialogState._overlay && dialogState._overlay.querySelector('.npc-dialog-box');
                const textEl = box && box.querySelector('.npc-dialog-text');
                if (textEl) {
                    textEl.textContent = '';
                    dialogState._typewriteComplete = false;
                    _typewrite(textEl, line, 0);
                }
            })
            .catch(() => { /* keep the template greeting */ });
    }
}

export function _render() {
    if (!dialogState._overlay) return;
    const box = dialogState._overlay.querySelector('.npc-dialog-box');
    if (!box) return;
    if (!dialogState._lines[dialogState._lineIndex]) return;

    _updateDispositionBar();
    _syncTranscript(box);
    _renderChoices(box);
}

/** Escape a line, then set its *stage directions* in italics. */
function _formatLine(text) {
    return formatSpokenLine(text);
}

function _scrollLog() {
    const log = dialogState._overlay && dialogState._overlay.querySelector('.npc-dialog-transcript');
    if (log) log.scrollTop = log.scrollHeight;
}

function _setSpeaking(on) {
    const portrait = dialogState._overlay && dialogState._overlay.querySelector('.npc-dialog-portrait');
    if (portrait) portrait.classList.toggle('speaking', on);
}

/**
 * Append every line of the conversation not yet in the transcript. The newest
 * NPC line is typed out; anything older appears at once.
 */
export function _syncTranscript(box) {
    const overlay = dialogState._overlay;
    const log = box && box.querySelector('.npc-dialog-transcript');
    if (!overlay || !log) return;
    log.querySelectorAll('.npc-dialog-thinking').forEach(el => el.remove());

    const from = overlay._shown || 0;
    const lines = dialogState._lines;
    for (let i = from; i < lines.length; i++) {
        const line = lines[i];
        const entry = document.createElement('div');
        entry.className = `npc-dialog-line ${line.isNpc ? 'is-npc' : 'is-player'}`;
        const textEl = document.createElement('div');
        textEl.className = 'npc-dialog-line-text';
        entry.appendChild(textEl);
        log.appendChild(entry);

        const typeIt = line.isNpc && i === lines.length - 1;
        if (typeIt) {
            // Only the line being spoken carries .npc-dialog-text (the LLM voice swaps into it)
            log.querySelectorAll('.npc-dialog-text').forEach(el => el.classList.remove('npc-dialog-text'));
            textEl.classList.add('npc-dialog-text');
            dialogState._typewriteComplete = false;
            _typewrite(textEl, line.text, 0);
        } else {
            textEl.innerHTML = _formatLine(line.text);
        }
    }
    overlay._shown = lines.length;
    _scrollLog();
}

/** Three bobbing dots while the NPC considers their answer. */
export function _showThinking(box) {
    const log = box && box.querySelector('.npc-dialog-transcript');
    if (!log || log.querySelector('.npc-dialog-thinking')) return;
    const dots = document.createElement('div');
    dots.className = 'npc-dialog-line is-npc npc-dialog-thinking';
    dots.innerHTML = '<span></span><span></span><span></span>';
    log.appendChild(dots);
    _scrollLog();
}

export function _typewrite(el, text, idx) {
    if (dialogState._typewriteTimer) clearTimeout(dialogState._typewriteTimer);
    if (idx === 0) _setSpeaking(true);
    // Stage-direction asterisks are hidden while typing and italicised at the end
    while (idx < text.length && text[idx] === '*') idx++;
    if (idx >= text.length) {
        el.innerHTML = _formatLine(text);
        dialogState._typewriteTimer = null;
        dialogState._typewriteComplete = true;
        _setSpeaking(false);
        _scrollLog();
        return;
    }
    const ch = text[idx];
    el.textContent += ch;
    if (idx % 12 === 0) _scrollLog();
    // Speech has rhythm: a beat after sentences, a breath after commas
    const delay = '.!?'.includes(ch) && text[idx + 1] === ' ' ? 170 : ',;—'.includes(ch) ? 70 : 15;
    dialogState._typewriteTimer = setTimeout(() => _typewrite(el, text, idx + 1), delay);
}

export function _skipTypewrite(el, text) {
    if (dialogState._typewriteTimer) clearTimeout(dialogState._typewriteTimer);
    dialogState._typewriteTimer = null;
    el.innerHTML = _formatLine(text);
    dialogState._typewriteComplete = true;
    _setSpeaking(false);
    _scrollLog();
}

const GROUP_OF = {
    ask_rumor: 'talk', ask_location: 'talk', ask_kingdom: 'talk', ask_folk_news: 'talk',
    ask_family: 'talk', ask_about_npc: 'talk',
    trade: 'deal', ask_quest: 'deal', accept_quest: 'deal', decline_quest: 'deal', give_gift: 'deal', bargain: 'deal', ask_favour: 'deal', repay_favour: 'deal',
    flatter: 'sway', threat: 'sway', persuade: 'sway',
    farewell: 'leave',
};
const GROUP_TITLES = { task: 'Your Task', talk: 'Converse', deal: 'Dealings', sway: 'Sway', gift: 'Coin', goods: 'Goods', people: 'Ask about…' };

/** Odds of a skill check as a choice tag: guaranteed / likely / risky. */
function _oddsTag(chance) {
    return chance >= 100 ? 'guaranteed' : chance >= 60 ? 'likely' : 'risky';
}

/**
 * Lay out choices as grouped, numbered buttons (keys 1–9; the farewell or
 * back option sits on Esc). `opts.back` makes Esc return instead of closing.
 */
export function _renderChoiceList(choicesEl, choices, opts = {}) {
    renderChoiceGrid(dialogState._overlay, choicesEl, choices, {
        ...opts,
        titles: GROUP_TITLES,
        groupOf: c => c.group || GROUP_OF[c.action] || 'talk',
        onPick: c => _handleChoice(c.action),
    });
}

export function _renderChoices(box) {
    const choicesEl = box.querySelector('.npc-dialog-choices');
    if (!choicesEl) return;
    choicesEl.innerHTML = '';

    const line = dialogState._lines[dialogState._lineIndex];
    if (!line || !line.isNpc || dialogState._overlay._closing) return;

    const npcType = dialogState._npc.type || 'villager';
    const mem = _mem(dialogState._npc);
    const choices = [];

    // The watch: a guard who knows of your violence in the street moves to arrest you
    const street = dialogState._street;
    const game0 = dialogState._game;
    if (street && street.arrest && game0 && game0.player && !game0.player.jailState) {
        const day0 = (game0.world && game0.world.day) || 0;
        const inc = StreetCrime.pendingAt(game0.player, `${game0.player.q},${game0.player.r}`, day0);
        if (inc) {
            const open = () => {
                const guard = dialogState._npc;
                NpcDialog.close();
                ActionMenu.showScene(game0, 'street_watch', { incidentId: inc.id, guardId: guard.id, guardName: guard.name || 'The guard' });
            };
            choices.push({ group: 'task', icon: '⛓️', label: inc.k === 'murder' ? 'I\'ll come quietly.' : 'What do you want of me?', cls: 'npc-dialog-choice-urgent', tooltip: 'Answer to the watch: give yourself up, pay, run, or fight.', onPick: open });
            choices.push({ icon: '👋', label: 'Farewell.', action: 'farewell', tooltip: 'Walk away. The guard will not let it rest.' });
            _renderChoiceList(choicesEl, choices, { hint: 'The watch has you.' });
            return;
        }
    }

    // A terrified or hateful NPC won't talk — only amends (a gift) or leaving
    if (((mem.threatened || mem.grudge) && mem.disposition < 15) || StreetCrime.refusesTalk(dialogState._npc)) {
        if (dialogState._game?.player?.gold > 0 || _hasGiftableInventory()) {
            choices.push({ icon: '🎁', label: 'Let me make amends.', action: 'give_gift', tooltip: 'Gifts are the only way back into their good graces.' });
        }
        choices.push({ icon: '👋', label: 'Farewell.', action: 'farewell' });
        _renderChoiceList(choicesEl, choices, { hint: (StreetCrime.config().lines || {}).refuseTalk || 'They want nothing to do with you.' });
        return;
    }

    // ── Tasks: hand one in to its giver, deliver to / fetch from the person it names ──
    const game = dialogState._game;
    if (game && game.player) {
        const present = new Set((InnerMap.npcs || []).map(n => n && n.uid).filter(Boolean));
        for (const opt of NpcTasks.talkOptions(game.player, dialogState._npc, { q: game.player.q, r: game.player.r }, present)) {
            for (const c of _taskChoices(opt)) choices.push(c);
        }
        // A townsperson named in a rival House's plot (systems/schemes.js)
        for (const c of _suspectChoices()) choices.push(c);
    }

    // ── Ask for rumors (can ask multiple unique ones) ──
    if (mem.rumorsTold < 3) {
        choices.push({
            icon: '💬', label: 'What news do you have?', action: 'ask_rumor',
            tooltip: `News and rumour — they have told you ${mem.rumorsTold} of 3.`,
        });
    }

    // ── Ask about location ──
    const askedLocation = dialogState._lines.some(l => l._action === 'ask_location');
    if (!askedLocation) {
        choices.push({ icon: '🗺️', label: 'Tell me about this place.', action: 'ask_location', tooltip: 'Learn about the settlement around you.' });
    }

    // ── Ask about kingdom ──
    const kingdom = _getKingdom();
    const askedKingdom = dialogState._lines.some(l => l._action === 'ask_kingdom');
    if (kingdom && !askedKingdom && (npcType === 'noble' || npcType === 'guard' || npcType === 'merchant' || npcType === 'traveler' || npcType === 'priest')) {
        choices.push({
            icon: '👑', label: `What do you know about ${kingdom.name}?`, action: 'ask_kingdom',
            tooltip: `Adds to what you know of ${kingdom.name}.`,
        });
    }

    // ── Ask about family (if NPC has family members, living or dead) ──
    const person = dialogState._npc._person;
    const hasFamily = (dialogState._npc.spouseId != null || (dialogState._npc.childIds && dialogState._npc.childIds.length > 0) ||
        (dialogState._npc.parentIds && dialogState._npc.parentIds.length > 0) || (dialogState._npc.siblingIds && dialogState._npc.siblingIds.length > 0) ||
        !!(person && (person.spouse != null || person.kids.length || person.parents.length)));

    // ── What has become of the townsfolk since the player was last here ──
    const askedFolk = dialogState._lines.some(l => l._action === 'ask_folk_news');
    const world = dialogState._game && dialogState._game.world;
    if (!askedFolk && dialogState._npc._folk && npcType !== 'child' && Townsfolk.townNews(dialogState._npc._folk, world, 1, dialogState._npc._person).length) {
        const folk = dialogState._npc._folk;
        choices.push({
            icon: '🕯️', label: folk.prevVisit != null ? 'What\'s become of folk here since I was last through?' : 'What\'s happened among the folk here?',
            action: 'ask_folk_news', tooltip: 'Births, deaths, weddings and comings and goings.',
        });
    }
    const askedFamily = dialogState._lines.some(l => l._action === 'ask_family');
    if (hasFamily && !askedFamily) {
        choices.push({
            icon: '👨‍👩‍👧', label: 'Tell me about your family.', action: 'ask_family',
            tooltip: 'Learn about their relatives.',
        });
    }

    // ── Ask about someone (gossip about another NPC) ──
    const knownNpcs = NpcFamily.getKnownNpcs(dialogState._npc, InnerMap.npcs || []);
    const askedAbout = dialogState._lines.some(l => l._action === 'ask_about_npc');
    if (!askedAbout && knownNpcs.length > 0) {
        choices.push({
            icon: '🗣️', label: 'What do you think of the people here?', action: 'ask_about_npc',
            tooltip: `They know ${knownNpcs.length} ${knownNpcs.length === 1 ? 'person' : 'people'} here.`,
        });
    }

    // ── Into the player's life: friendship, courtship, the road (systems/relationships/folk.js) ──
    const folkOf = dialogState._npc._folk;
    if (person && folkOf && dialogState._game && Relationships.canKnow(folkOf, person, world).ok
        && (Relationships.npcForPerson(folkOf, person) || (_mem(dialogState._npc).disposition >= 45 && _mem(dialogState._npc).timesSpoken >= 2))) {
        const linked = Relationships.npcForPerson(folkOf, person);
        choices.push({
            icon: '🤝', label: linked ? 'Let\'s spend some time together.' : 'I\'d like to know you better.',
            tooltip: 'Friendship, courtship, an invitation to the road.',
            onPick: () => _knowBetter(),
        });
    }

    // ── Trade (merchants, blacksmiths, travelers) ──
    if (npcType === 'merchant' || npcType === 'blacksmith_npc' || npcType === 'traveler') {
        const g0 = dialogState._game;
        const pm = NpcDisposition.getPriceModifiers(dialogState._npc, g0 && g0.player ? { player: g0.player, kingdomId: Fame._kingdomAt(g0.world, g0.player.q, g0.player.r) } : null);
        if (pm.refuses) {
            choices.push({ icon: '🚫', label: 'Show me your wares.', action: 'trade', tooltip: pm.refuseReason, cls: 'npc-dialog-choice-muted' });
        } else {
            const why = pm.reasons.map(r => `${r.label} ${r.pct > 0 ? '+' : ''}${r.pct}%`).join(', ');
            const extra = pm.pct === 0 ? ''
                : `<span class="npc-dialog-price ${pm.pct > 0 ? 'is-up' : 'is-down'}">${pm.pct > 0 ? '+' : ''}${pm.pct}%</span>`;
            choices.push({ icon: '💰', label: 'Show me your wares.', action: 'trade', extra, tooltip: why ? `Prices: ${why}.` : 'Fair prices.' });
        }
    }

    // ── Quest hook (once per NPC, disposition >= 40) ──
    if (!mem.questOffered && !mem.wronged && mem.disposition >= 40 && NPC_QUEST_HOOKS[npcType]) {
        choices.push({
            icon: '📜', label: 'Do you need any help?', action: 'ask_quest',
            tooltip: 'Ask if they have a task for you.',
        });
    }

    // ── Accept / decline a pending quest ──
    if (mem.pendingHook && !mem.questAccepted) {
        choices.push({ icon: '✅', label: "I'll help you.", action: 'accept_quest', cls: 'npc-dialog-choice-urgent', tooltip: 'Take on their task.' });
        choices.push({ icon: '❌', label: "That's not for me.", action: 'decline_quest', tooltip: 'They will be a little disappointed.' });
    }

    // ── Give gift ──
    const hasGiftableItems = dialogState._game?.player?.gold > 0 || _hasGiftableInventory();
    if (hasGiftableItems && mem.disposition < 95) {
        choices.push({
            icon: '🎁', label: 'I have something for you.', action: 'give_gift',
            tooltip: 'Coin or goods. Each gift makes the next count for more.',
        });
    }

    // ── Spend goodwill: a bargain from a trader, a favour from anyone else ──
    const day = (world && world.day) || 0;
    // ── Pay back a favour's coin (systems/npcKnowledge.js) ──
    const owed = NpcKnowledge.owedTo(mem, day);
    if (owed) {
        choices.push({
            icon: '💰', label: `Here's the ${owed.amount} gold I owe you.`, action: 'repay_favour',
            tooltip: owed.overdue ? 'Late — they asked for it already.' : `Due by day ${owed.due}: paid on time, they'll think the better of you.`,
        });
    }
    if (NpcKnowledge.canBargain(dialogState._npc, mem)) {
        choices.push({
            icon: '⚖️', label: 'Surely you can do better on the price?', action: 'bargain',
            tooltip: `Spend a little of their goodwill (−${NpcKnowledge.config().favour.bargainCost}) for a better price this visit.`,
        });
    } else if (NpcKnowledge.canAskFavour(dialogState._npc, mem, day)) {
        choices.push({
            icon: '🙏', label: 'Could I ask a favour of you?', action: 'ask_favour',
            tooltip: `They like you enough to help (−${NpcKnowledge.config().favour.cost} goodwill; once a month).`,
        });
    }

    // ── Charm / Flatter [Diplomacy check] ──
    const flattered = dialogState._lines.some(l => l._action === 'flatter');
    if (!flattered) {
        const diplomacyTotal = _getSkillTotal('diplomacy');
        const sd = NpcKnowledge.socialDifficulty(dialogState._npc, mem, 'flatter');
        const difficulty = sd.difficulty;
        const chance = Math.min(100, Math.round((diplomacyTotal / difficulty) * 100));
        choices.push({
            icon: '😊', check: 'Charm', label: 'You seem wise — tell me more.', action: 'flatter',
            skillTag: _oddsTag(chance), chance,
            tooltip: `Diplomacy ${diplomacyTotal} against ${difficulty}${sd.reasons.length ? ` (${sd.reasons.join(', ')})` : ''}: ${chance}% chance. Success warms them and they may make good on a promise.`,
        });
    }

    // ── Intimidate [Combat check] ──
    const threatened = dialogState._lines.some(l => l._action === 'threat');
    if (!threatened) {
        const combatTotal = _getSkillTotal('combat');
        const baseDifficulty = npcType === 'guard' || npcType === 'blacksmith_npc' ? 5 : npcType === 'noble' ? 4 : 2;
        const difficulty = dialogState._npc ? NpcDisposition.threatDifficulty(dialogState._npc, baseDifficulty, dialogState._game?.player) : baseDifficulty;
        const cowed = difficulty < baseDifficulty ? ' They already fear you.' : '';
        const chance = Math.min(100, Math.round((combatTotal / difficulty) * 100));
        choices.push({
            icon: '😠', check: 'Intimidate', label: 'Watch your tongue.', action: 'threat',
            skillTag: _oddsTag(chance), chance, cls: 'npc-dialog-choice-dark',
            tooltip: `Combat ${combatTotal} against ${difficulty}: ${chance}% chance.${cowed} Success: they hand over coin. ⚠ They will like you less and may report you to the guard.`,
        });
    }

    // ── Persuade [Diplomacy check] — convince NPC to reveal deeper secrets ──
    if (mem.disposition >= 60 && !dialogState._lines.some(l => l._action === 'persuade')) {
        const diplomacyTotal = _getSkillTotal('diplomacy');
        const sd = NpcKnowledge.socialDifficulty(dialogState._npc, mem, 'persuade');
        const difficulty = sd.difficulty;
        const chance = Math.min(100, Math.round((diplomacyTotal / difficulty) * 100));
        choices.push({
            icon: '🤝', check: 'Persuade', label: 'I need your trust on something important.', action: 'persuade',
            skillTag: _oddsTag(chance), chance,
            tooltip: `Diplomacy ${diplomacyTotal} against ${difficulty}${sd.reasons.length ? ` (${sd.reasons.join(', ')})` : ''}: ${chance}% chance. They may share a map, a cache, true intel or a discount.`,
        });
    }

    // ── Farewell ──
    choices.push({ icon: '👋', label: 'Farewell.', action: 'farewell', tooltip: 'End the conversation politely.' });

    _renderChoiceList(choicesEl, choices);
}

/** The choices one task option offers (systems/npcTasks.js talkOptions). */
function _taskChoices(opt) {
    const q = opt.quest;
    const o = opt.obj;
    const item = q.carrying || o.item || q.item || 'it';
    const giver = (q.giver && q.giver.name) || 'them';
    const base = { group: 'task', cls: 'npc-dialog-choice-urgent', tooltip: `${q.title}: ${o.text}.` };
    if (opt.kind === 'return') {
        const label = q.person ? `I found ${q.person.name} — safe and well.` : q.carrying ? `I've brought back ${q.carrying}.` : 'It\'s done, as you asked.';
        return [{ ...base, icon: '📜', label, onPick: () => _taskChoice(opt, 'return') }];
    }
    if (opt.kind === 'deliver') {
        return [{ ...base, icon: '✉️', label: `I bring ${item} from ${giver}.`, onPick: () => _taskChoice(opt, 'ask') }];
    }
    if (opt.kind === 'proxy') {
        return [{ ...base, icon: '✉️', label: `I've ${item} for ${o.person}. Will you see it reaches them?`, onPick: () => _taskChoice(opt, 'ask') }];
    }
    // fetch / proxy_fetch
    const out = [{
        ...base, icon: '📜', onPick: () => _taskChoice(opt, 'ask'),
        label: opt.kind === 'proxy_fetch' ? `I'm looking for ${o.person} — ${giver} sent me for ${item}.` : `${giver} sent me for ${item}.`,
    }];
    if (o.guarded) {
        const total = _getSkillTotal('stealth');
        const chance = Math.min(100, Math.round((total / 5) * 100));
        out.push({
            ...base, cls: 'npc-dialog-choice-dark', icon: '🤫', check: 'Stealth', skillTag: _oddsTag(chance), chance,
            label: `*Lift ${item} while they look away*`,
            tooltip: `Stealth ${total} against 5: ${chance}% chance. ⚠ If caught they will hate you.`,
            onPick: () => _taskChoice(opt, 'steal'),
        });
        if ((dialogState._game?.player?.gold || 0) >= 80) {
            out.push({ ...base, icon: '💰', label: `What would ${item} cost me? (80 gold)`, onPick: () => _taskChoice(opt, 'bribe') });
        }
    }
    return out;
}

export function _hasGiftableInventory() {
    if (!dialogState._game?.player?.inventory) return false;
    return Object.values(dialogState._game.player.inventory).some(qty => qty > 0);
}

/** Cross from the street conversation into the relationship scene with this person. */
function _knowBetter() {
    const game = dialogState._game;
    const npc = dialogState._npc;
    const folk = npc && npc._folk;
    if (!game || !folk || !npc._person) return;
    const tile = game.world.getTile(folk.q, folk.r);
    const res = Relationships.fromTownsperson(game.player, game.world, folk, npc._person, tile && tile.settlement);
    if (!res.success) {
        game.ui.showNotification('🤝 Not now', res.reason, 'info');
        return;
    }
    NpcDialog.close();
    ActionMenu.showCharacterDataModal(game, tile, res.npc.id, {});
}

