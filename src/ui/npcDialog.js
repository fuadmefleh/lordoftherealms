// ============================================
// NPC DIALOG SYSTEM — Conversations with NPCs
// ============================================

import { InnerMap } from '../world/innerMap.js';
import { ActionMenu } from './actionMenu.js';

/** Active dialog state */
let _active = false;
let _game = null;
let _npc = null;
let _lines = [];       // Array of { speaker, text, icon }
let _lineIndex = 0;    // Currently displayed line
let _overlay = null;    // DOM overlay element

// ── Dialog line pools per NPC type ──────────────────────────────────────────

const GREETINGS = {
    merchant:    ['Welcome! Looking to trade?', 'Fine goods at fair prices!', 'Step right up! What catches your eye?', 'Ah, a customer! What can I do for you?'],
    guard:       ['Halt. State your business.', 'Keep your weapons sheathed in town.', 'Move along, citizen.', 'No trouble here, I hope.'],
    farmer:      ['Good day! Harvest is coming along nicely.', '*wipes brow* Hard work, but honest.', 'Fields won\'t tend themselves!', 'Mornin\'. You here about the crops?'],
    priest:      ['Blessings upon you, child.', 'The gods watch over us all.', 'Peace be with you, traveler.', 'Come seeking wisdom, have you?'],
    blacksmith_npc: ['*clang clang* Ah, hello there!', 'Need something forged?', 'I can put an edge on any blade.', 'The forge runs hot today!'],
    villager:    ['Oh, hello there!', 'Nice day, isn\'t it?', 'Haven\'t seen you around before.', 'Good to see a fresh face!'],
    child:       ['*giggles* Hi!', 'Are you an adventurer?!', 'My mama says I shouldn\'t talk to strangers...', 'Wow, you look strong!'],
    noble:       ['Ah, a visitor. How delightful.', 'I trust you know proper etiquette.', 'One must maintain standards, you know.', 'Do you come bearing news from abroad?'],
    traveler:    ['Greetings, fellow wanderer!', 'The roads have been long.', 'I\'ve seen many lands on my journey.', 'Another traveler! Well met!'],
    beggar:      ['Spare a coin, kind soul?', '*coughs* Anything to eat?', 'The cold is terrible tonight...', 'Bless you if you can help...'],
};

const RUMORS = {
    merchant:    [
        'Business isn\'t what it used to be. Taxes are bleeding us dry.',
        'I heard a caravan from the east was robbed on the highway.',
        'If you\'re buying, I have some rare spices — fell off a cart, you know.',
        'The lord\'s been stockpiling weapons. Makes you wonder.',
        'Trade routes to the north have been dangerous of late.',
    ],
    guard:       [
        'We\'ve had reports of bandits in the forest nearby.',
        'There was a brawl at the tavern last night. Two men in the stocks.',
        'The captain wants patrols doubled. Something has him worried.',
        'If you see anything suspicious, report it to the barracks.',
        'A prisoner escaped from the dungeons. Keep your eyes open.',
    ],
    farmer:      [
        'The harvest festival should be grand this year, if the weather holds.',
        'Something\'s been getting into the grain stores. Rats, maybe worse.',
        'Old Thorvald says there\'ll be an early frost. He\'s usually right.',
        'We lost two goats last week. Wolves, the tracks suggest.',
        'They say the soil near the old ruins grows nothing but thorns.',
    ],
    priest:      [
        'Strange omens have appeared in the night sky. The faithful are uneasy.',
        'A pilgrim passed through with tales of miracles in the southern temple.',
        'The old scriptures speak of a darkness that returns every century.',
        'I pray for peace, but my heart tells me trials are coming.',
        'The relics in the church have been glowing faintly. A sign, perhaps.',
    ],
    blacksmith_npc: [
        'I got my hands on some fine ore from the mountains. Rare stuff.',
        'A knight ordered a sword last week. Paid triple for a rush job.',
        'The quality of iron from the mines has been declining lately.',
        'I could forge you something special, if you bring the right materials.',
        'They say dwarven steel never dulls. Wish I knew the secret.',
    ],
    villager:    [
        'Did you hear? They found a body by the river last week.',
        'My neighbor swears he saw lights in the old cemetery.',
        'The baker\'s daughter ran off with a traveling minstrel!',
        'Prices at market have been climbing. Hard times ahead, I reckon.',
        'There\'s talk of raising a militia. The lord must be expecting trouble.',
    ],
    child:       [
        'I found a shiny rock by the stream! Want to see?',
        'The other kids say there\'s a monster in the well. I don\'t believe them!',
        'My da says I\'ll be a knight someday! Or maybe a dragon rider!',
        'I saw a HUGE spider in the cellar! This big! *spreads arms*',
        'Do you know any magic? Please please please show me!',
    ],
    noble:       [
        'The court is abuzz with talk of alliances forming to the west.',
        'I suspect the chancellor is embezzling from the treasury.',
        'Do keep this between us — the lord\'s health is failing.',
        'The neighboring realm has been making rather bold territorial claims.',
        'One hears the most fascinating rumors at court dinners.',
    ],
    traveler:    [
        'I passed through a village two days\' ride from here — completely abandoned.',
        'The mountain pass to the north is blocked by an avalanche.',
        'I met a group of monks on the road. They spoke of an ancient prophecy.',
        'The taverns in the capital serve the best ale. Trust me on that.',
        'There\'s a bounty out for a notorious bandit chief. Quite a sum.',
    ],
    beggar:      [
        'I wasn\'t always like this. I used to be a soldier, you know.',
        'The rats in the sewers are getting bolder. Bigger, too.',
        'I see everything from down here. The rich don\'t bother watching their tongues.',
        'A kind stranger gave me bread yesterday. Gives you faith in people.',
        'I know where the thieves\' guild meets. That information costs, though.',
    ],
};

const FAREWELLS = {
    merchant:    ['Safe travels! Come back when you need supplies.', 'Good doing business!', 'May your purse stay heavy!'],
    guard:       ['Move along now.', 'Stay out of trouble.', 'Keep to the main roads after dark.'],
    farmer:      ['Well, back to work! Fields won\'t plow themselves.', 'Take care now!', 'If you need fresh produce, you know where to find me.'],
    priest:      ['Go with the gods\' blessing.', 'May light guide your path.', 'I shall pray for your safe journey.'],
    blacksmith_npc: ['*turns back to forge* Come again!', 'If you need repairs, I\'m your man.', 'Stay sharp out there!'],
    villager:    ['Well, nice chatting! I should be going.', 'Take care, stranger.', 'Hope to see you around!'],
    child:       ['Bye bye! *waves*', 'Come play again sometime!', 'I gotta go before mama finds me!'],
    noble:       ['It was... tolerable speaking with you.', 'Good day to you.', 'I have more pressing matters to attend to.'],
    traveler:    ['May the roads be kind to you!', 'Perhaps our paths will cross again.', 'Safe travels, friend.'],
    beggar:      ['Bless you... bless you...', '*shuffles away*', 'The gods remember kindness.'],
};

const PLAYER_RESPONSES = {
    ask_rumor: { label: 'What news do you have?', icon: '💬' },
    trade:     { label: 'Do you have anything to sell?', icon: '💰' },
    farewell:  { label: 'Farewell.', icon: '👋' },
    threat:    { label: '[Intimidate] Watch your tongue.', icon: '😠' },
    flatter:   { label: '[Charm] You seem wise — tell me more.', icon: '😊' },
};

const THREAT_RESPONSES = {
    merchant:    ['P-please! I\'m just a humble merchant! Don\'t hurt me!', 'Is that... is that a threat?! Guards! GUARDS!'],
    guard:       ['Oh, you want trouble? I\'ll give you trouble!', '*hand moves to sword hilt* Choose your next words very carefully.'],
    farmer:      ['*backs away* I-I don\'t want any trouble, friend...', 'What?! I\'ve done nothing to you!'],
    priest:      ['Violence is the refuge of the small-minded.', 'I will pray for your soul. You clearly need it.'],
    blacksmith_npc: ['*hefts hammer* I\'d rethink that if I were you.', 'You\'re threatening a man who bends iron for a living?'],
    villager:    ['*stammers* W-what did I do?!', 'Please, I have a family!'],
    child:       ['*lip trembles* I\'m telling my mama!', '*starts crying*'],
    noble:       ['How DARE you! Do you know who I am?!', 'I\'ll have you flogged for your insolence!'],
    traveler:    ['Easy now... I\'m no one\'s enemy.', 'We can settle this like civilized folk, can\'t we?'],
    beggar:      ['*cowers* I have nothing! Nothing!', 'Hit me then. I\'ve nothing left to lose.'],
};

const FLATTER_RESPONSES = {
    merchant:    ['Well now, aren\'t you sweet! Here, let me show you my finest wares...', 'Ha! Flattery will get you a discount, friend!'],
    guard:       ['*stands a little taller* Well, I do try to keep informed...', 'Hmph. At least someone appreciates the watch.'],
    farmer:      ['*blushes* Oh, go on! I\'m just a simple farmer...', 'Wise? Me? Well, I suppose I do know a thing or two about the land.'],
    priest:      ['Your words are kind. Wisdom comes from the gods, not from me.', 'How gracious of you. Let me share a blessing in return.'],
    blacksmith_npc: ['*grins* You want the best steel? You\'ve come to the right forge!', 'Well, I won\'t deny I know my craft!'],
    villager:    ['Oh my! *giggles* You\'re too kind, really!', 'Well aren\'t you charming! What do you want to know?'],
    child:       ['*beams* Really?! Nobody ever says that to me!', 'You\'re nice! Want to be friends?'],
    noble:       ['At last, someone with taste and breeding.', '*nods approvingly* You clearly understand quality.'],
    traveler:    ['Ha! You\'re a good sort. Let me buy you a drink sometime.', 'Indeed I am! *chuckles* Here, let me tell you something useful...'],
    beggar:      ['*eyes well up* Nobody\'s spoken kindly to me in... so long.', 'You... you mean that? Truly?'],
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function _pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function _getGreeting(type) {
    return _pick(GREETINGS[type] || GREETINGS.villager);
}
function _getRumor(type) {
    return _pick(RUMORS[type] || RUMORS.villager);
}
function _getFarewell(type) {
    return _pick(FAREWELLS[type] || FAREWELLS.villager);
}
function _getThreatResponse(type) {
    return _pick(THREAT_RESPONSES[type] || THREAT_RESPONSES.villager);
}
function _getFlatterResponse(type) {
    return _pick(FLATTER_RESPONSES[type] || FLATTER_RESPONSES.villager);
}

// ── Build & render ───────────────────────────────────────────────────────────

function _buildConversation(npc) {
    const type = npc.type || 'villager';
    // Opening greeting from NPC
    _lines = [{
        speaker: npc.name,
        icon: npc.icon,
        text: _getGreeting(type),
        isNpc: true,
    }];
    _lineIndex = 0;
}

function _render() {
    if (!_overlay) return;
    const box = _overlay.querySelector('.npc-dialog-box');
    if (!box) return;

    const line = _lines[_lineIndex];
    if (!line) return;

    // Speaker label
    const speakerEl = box.querySelector('.npc-dialog-speaker');
    if (speakerEl) {
        speakerEl.textContent = line.isNpc ? `${line.icon} ${line.speaker}` : '🧑 You';
        speakerEl.style.color = line.isNpc ? 'var(--gold)' : '#4FC3F7';
    }

    // Dialog text
    const textEl = box.querySelector('.npc-dialog-text');
    if (textEl) {
        textEl.textContent = '';
        // Typewriter effect
        _typewrite(textEl, line.text, 0);
    }

    // Response options
    _renderChoices(box);
}

let _typewriteTimer = null;
function _typewrite(el, text, idx) {
    if (_typewriteTimer) clearTimeout(_typewriteTimer);
    if (idx >= text.length) return;
    el.textContent += text[idx];
    _typewriteTimer = setTimeout(() => _typewrite(el, text, idx + 1), 18);
}

function _skipTypewrite(el, text) {
    if (_typewriteTimer) clearTimeout(_typewriteTimer);
    _typewriteTimer = null;
    el.textContent = text;
}

function _renderChoices(box) {
    const choicesEl = box.querySelector('.npc-dialog-choices');
    if (!choicesEl) return;
    choicesEl.innerHTML = '';

    const line = _lines[_lineIndex];
    if (!line || !line.isNpc) return; // Only show choices after NPC speaks

    const npcType = _npc.type || 'villager';

    // Build available choices
    const choices = [];

    // Always offer "ask rumor" unless we already asked
    const askedRumor = _lines.some(l => l._action === 'ask_rumor');
    if (!askedRumor) {
        choices.push({ ...PLAYER_RESPONSES.ask_rumor, action: 'ask_rumor' });
    }

    // Offer trade for merchants, blacksmiths, and travellers
    if (npcType === 'merchant' || npcType === 'blacksmith_npc' || npcType === 'traveler') {
        choices.push({ ...PLAYER_RESPONSES.trade, action: 'trade' });
    }

    // Flatter (once)
    const flattered = _lines.some(l => l._action === 'flatter');
    if (!flattered) {
        choices.push({ ...PLAYER_RESPONSES.flatter, action: 'flatter' });
    }

    // Threaten (once)
    const threatened = _lines.some(l => l._action === 'threat');
    if (!threatened) {
        choices.push({ ...PLAYER_RESPONSES.threat, action: 'threat' });
    }

    // Farewell always
    choices.push({ ...PLAYER_RESPONSES.farewell, action: 'farewell' });

    for (const choice of choices) {
        const btn = document.createElement('button');
        btn.className = 'npc-dialog-choice';
        btn.innerHTML = `<span class="npc-dialog-choice-icon">${choice.icon}</span> ${choice.label}`;
        btn.addEventListener('click', () => _handleChoice(choice.action));
        choicesEl.appendChild(btn);
    }
}

function _handleChoice(action) {
    const npcType = _npc.type || 'villager';

    // Add player line
    const playerText = PLAYER_RESPONSES[action] ? PLAYER_RESPONSES[action].label : action;
    _lines.push({ speaker: 'You', text: playerText, isNpc: false, _action: action });
    _lineIndex = _lines.length - 1;

    // Brief pause then NPC response
    const box = _overlay.querySelector('.npc-dialog-box');
    const choicesEl = box.querySelector('.npc-dialog-choices');
    if (choicesEl) choicesEl.innerHTML = '';

    // Show player line briefly
    const speakerEl = box.querySelector('.npc-dialog-speaker');
    const textEl = box.querySelector('.npc-dialog-text');
    if (speakerEl) { speakerEl.textContent = '🧑 You'; speakerEl.style.color = '#4FC3F7'; }
    if (textEl) { _skipTypewrite(textEl, ''); textEl.textContent = playerText; }

    setTimeout(() => {
        let responseText;
        let shouldClose = false;

        switch (action) {
            case 'ask_rumor':
                responseText = _getRumor(npcType);
                break;
            case 'trade':
                responseText = 'Let me show you what I have...';
                // After this dialog, open trade menu
                shouldClose = 'trade';
                break;
            case 'farewell':
                responseText = _getFarewell(npcType);
                shouldClose = true;
                break;
            case 'threat':
                responseText = _getThreatResponse(npcType);
                // Threatening affects karma and social need
                if (_game && _game.player) {
                    _game.player.karma = (_game.player.karma || 0) - 1;
                    if (_game.player.modifyNeed) _game.player.modifyNeed('social', -5);
                }
                break;
            case 'flatter':
                responseText = _getFlatterResponse(npcType);
                if (_game && _game.player) {
                    if (_game.player.modifyNeed) {
                        _game.player.modifyNeed('social', 8);
                        _game.player.modifyNeed('fun', 5);
                    }
                }
                break;
            default:
                responseText = 'Hmm...';
        }

        // Add NPC response
        const npcLine = { speaker: _npc.name, icon: _npc.icon, text: responseText, isNpc: true, _action: action };
        _lines.push(npcLine);
        _lineIndex = _lines.length - 1;
        _render();

        // If should close, auto-close after a delay
        if (shouldClose) {
            setTimeout(() => {
                // Capture refs before close() nulls them
                const game = _game;
                const npc = _npc;
                NpcDialog.close();
                if (shouldClose === 'trade' && game) {
                    // If the NPC has a personal shop inventory, use the NPC trade menu
                    if (npc && npc.shopInventory && Object.keys(npc.shopInventory).length > 0) {
                        ActionMenu.showNpcTradeMenu(game, npc);
                    } else {
                        // Fallback to settlement market
                        const worldTile = game.world ? game.world.getTile(game.player.q, game.player.r) : null;
                        if (worldTile) ActionMenu.showTradeMenu(game, worldTile);
                    }
                }
            }, 1800);
        }
    }, 500);
}

// ── DOM creation ─────────────────────────────────────────────────────────────

function _createOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'npcDialogOverlay';

    overlay.innerHTML = `
        <div class="npc-dialog-backdrop"></div>
        <div class="npc-dialog-box">
            <div class="npc-dialog-header">
                <div class="npc-dialog-portrait">
                    <span class="npc-dialog-portrait-icon">${_npc.icon}</span>
                </div>
                <div class="npc-dialog-header-info">
                    <div class="npc-dialog-name">${_npc.name}</div>
                    <div class="npc-dialog-title">${(InnerMap.NPC_TYPES[_npc.type] || {}).name || _npc.type}</div>
                </div>
                <button class="npc-dialog-close" title="End conversation">✕</button>
            </div>
            <div class="npc-dialog-body">
                <div class="npc-dialog-speaker"></div>
                <div class="npc-dialog-text"></div>
            </div>
            <div class="npc-dialog-choices"></div>
        </div>
    `;

    // Close button
    overlay.querySelector('.npc-dialog-close').addEventListener('click', () => NpcDialog.close());

    // Clicking backdrop closes
    overlay.querySelector('.npc-dialog-backdrop').addEventListener('click', () => NpcDialog.close());

    // ESC key closes
    overlay._escHandler = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); NpcDialog.close(); }
    };
    window.addEventListener('keydown', overlay._escHandler, true);

    document.body.appendChild(overlay);
    return overlay;
}

// ── Public API ───────────────────────────────────────────────────────────────

export const NpcDialog = {

    /** Whether a dialog is currently open.  */
    get active() { return _active; },

    /**
     * Open a dialog with an NPC.
     * @param {object} game — Game instance
     * @param {object} npc  — NPC object from InnerMap.npcs
     */
    open(game, npc) {
        if (_active) this.close();

        _game = game;
        _npc = npc;
        _active = true;

        // Freeze this NPC
        npc._dialogFrozen = true;
        npc._preDialogState = npc.state;
        npc.state = 'dialog';
        npc.path = null;
        npc.moveProgress = 0;

        // Make the NPC face the player
        const dq = InnerMap.playerInnerQ - npc.q;
        const dr = InnerMap.playerInnerR - npc.r;
        if (Math.abs(dq) >= Math.abs(dr)) {
            npc.facing = dq >= 0 ? 3 : 1; // RIGHT : LEFT
        } else {
            npc.facing = dr >= 0 ? 2 : 0; // DOWN : UP
        }

        // Build conversation
        _buildConversation(npc);

        // Create DOM
        _overlay = _createOverlay();

        // Initial render
        setTimeout(() => _render(), 50);

        // Satisfy social need slightly just for starting conversation
        if (_game.player && _game.player.modifyNeed) {
            _game.player.modifyNeed('social', 5);
        }
    },

    /**
     * Close the current dialog.
     */
    close() {
        if (!_active) return;

        // Unfreeze NPC
        if (_npc) {
            _npc._dialogFrozen = false;
            if (_npc.state === 'dialog') {
                _npc.state = 'idle';
                _npc.idleTimer = 2 + Math.random() * 3;
            }
        }

        // Clean up typewriter
        if (_typewriteTimer) { clearTimeout(_typewriteTimer); _typewriteTimer = null; }

        // Remove DOM
        if (_overlay) {
            if (_overlay._escHandler) window.removeEventListener('keydown', _overlay._escHandler, true);
            _overlay.remove();
            _overlay = null;
        }

        _active = false;
        _game = null;
        _npc = null;
        _lines = [];
        _lineIndex = 0;
    },
};
