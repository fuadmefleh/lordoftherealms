// Townsfolk of the overworld (systems/relationships) met face to face: a
// ConversationScene in place of the old character-profile panel. The ring is
// your standing with them; friendship, romance and the travel party are the
// choices, and each act plays out as a little exchange in the transcript.
import { ActionMenu } from './_ref.js';
import { ConversationScene } from '../conversationScene.js';
import { Relationships } from './_imports.js';
import { PlayerEffects } from '../../player/playerEffects.js';
import { npcVoice } from '../npcVoice.js';

const GROUPS = { matter: 'On their mind', talk: 'Friendship', romance: 'Romance', party: 'The road', hostile: 'Hostility' };

// What you say for each act (systems data has only labels)
const SAYS = {
    befriend: 'So — how is life treating you?',
    share_meal: 'Join me for a bite? My treat.',
    tell_stories: 'Have I told you about the time I…',
    train_together: 'Fancy a few rounds with the practice blades?',
    confide_secret: '*lowers voice* Can I trust you with something?',
    blood_oath: '*draws a knife across the palm* Swear it with me.',
    insult: 'You really are as dull as they say.',
    challenge: '*slaps down a glove* Draw, if you dare.',
    chat: 'Lovely day, isn\'t it?',
    compliment: 'You look wonderful today, you know.',
    gift: '*offers a small wrapped gift* I saw this and thought of you.',
    serenade: '*clears throat and begins to sing*',
    moonlight_walk: 'Walk with me tonight?',
    romantic_dinner: 'I\'ve reserved a table. Will you join me?',
    private_vows: '*takes their hands* Whatever comes, I am yours.',
    propose: '*kneels* Will you marry me?',
    quality_time: 'Let\'s spend the day together. Just us.',
};
const WARM = [
    '*laughs* You\'re good company, you know that?',
    'I\'m glad you came by.',
    '*smiles* We should do this more often.',
    'Ha! I haven\'t enjoyed myself like that in ages.',
];
const FOND = [
    '*blushes* You do know how to make someone feel special.',
    '*holds your gaze a moment longer than needed*',
    'I… I\'d like that very much.',
    '*smiles softly* Stay a little longer?',
];
const HOSTILE_ACTS = new Set(['insult', 'challenge']);

let _cur = null; // { npcId, tile, options, scene, total, noReturn }

const _pick = (arr, seed) => arr[Math.abs(seed) % arr.length];

function _spriteType(occupation) {
    const o = String(occupation || '').toLowerCase();
    if (/guard|knight|general/.test(o)) return 'guard';
    if (/merchant|diplomat|spymaster/.test(o)) return 'merchant';
    if (/priest|healer|scholar/.test(o)) return 'priest';
    if (/farmer|shepherd|miller|herbalist/.test(o)) return 'farmer';
    if (/smith|woodcutter|hunter/.test(o)) return 'blacksmith_npc';
    if (/noble|prince/.test(o)) return 'noble';
    return 'villager';
}

function _mood(rel) {
    const label = Relationships.getRelationLabel(rel.score || 0);
    const m = ConversationScene.moodFromStanding(rel.score || 0);
    return { ...m, label: label.label, icon: label.icon };
}

function _facts(game, npc, rel) {
    const player = game.player;
    const level = Relationships.getRelationshipLevel(rel.score || 0);
    const personality = Relationships._getPersonalities()[npc.personality] || { label: 'Unknown', icon: '❓' };
    const isSpouse = player.spouse === npc.id;
    const stage = rel.romantic || isSpouse ? Relationships.getCourtingStage(rel.affection || 0, isSpouse) : null;
    const tags = [];
    if (isSpouse) tags.push('<div class="npc-dialog-rel-badge" style="color:#ff80ab">💍 Your spouse</div>');
    if (Relationships.isInTravelParty(player, npc.id)) tags.push('<div class="npc-dialog-rel-badge" style="color:#81d4fa">🧭 Travels with you</div>');
    const matter = Relationships.matterView(player, npc.id);
    if (matter) tags.push(`<div class="npc-dialog-rel-badge" style="color:#ffcc80">${matter.icon} ${matter.title}</div>`);
    if (rel.debt) tags.push(`<div class="npc-dialog-rel-badge" style="color:#c5b358">💰 Owes you ${rel.debt.amount}g</div>`);
    const affection = rel.affection || 0;
    return `${tags.join('')}
        <div class="npc-dialog-visits">${level.icon} ${level.label}</div>
        ${stage || affection > 0 ? `<div class="npc-scene-affection" title="Affection ${affection}/100">
            <span>${stage ? `${stage.icon} ${stage.label}` : '💗 Affection'}</span><i style="--v:${affection}%"></i></div>` : ''}
        <div class="npc-dialog-traits">
            <span class="npc-dialog-trait">${personality.icon} ${personality.label}</span>
        </div>
        <div class="npc-dialog-family-tag">${npc.appearance.hair} hair · ${npc.appearance.eyes} eyes · ${npc.appearance.build}</div>`;
}

function _greeting(game, npc, rel) {
    const player = game.player;
    const score = rel.score || 0;
    // Something to settle comes first (systems/relationships/matters.js)
    const matter = Relationships.matterView(player, npc.id);
    if (matter && matter.line) return matter.line;
    if (player.spouse === npc.id) return '*brightens* There you are, love.';
    if (Relationships.isInTravelParty(player, npc.id)) return 'Ready to move on when you are.';
    if (score >= 50) return 'Well, look who it is! Come here, friend.';
    if (score >= 20) return 'Good to see you again.';
    if (score <= -40) return '*scowls* You. What do you want?';
    if (score <= -10) return '*folds arms* Something you need?';
    return `*looks up* Hm? I'm ${npc.firstName} — ${npc.occupation} hereabouts. Can I help you?`;
}

/** The chance an act lands, mirroring systems/relationships/actions.js. */
function _chance(player, action, court) {
    if (!action.failChance) return 100;
    if (!court) return Math.round((1 - action.failChance) * 100);
    const stat = action.statBonus ? (player[action.statBonus] || player.skills?.[action.statBonus] || 5) : 5;
    return Math.round((1 - Math.max(0.02, action.failChance - stat * 0.01)) * 100);
}

function _actionChoice(game, npc, action, court) {
    const chance = _chance(game.player, action, court);
    const pills = [];
    if (action.cost) pills.push(`${action.cost}g`);
    if (action.apCost != null) pills.push(`${action.apCost} AP`);
    const hostile = HOSTILE_ACTS.has(action.id);
    return {
        icon: action.icon, label: action.label,
        group: hostile ? 'hostile' : court ? 'romance' : 'talk',
        cls: hostile ? 'npc-dialog-choice-dark' : court ? 'npc-scene-choice-romance' : '',
        extra: pills.length ? `<span class="npc-dialog-price">${pills.join(' · ')}</span>` : '',
        chance: action.unlocked && chance < 100 ? chance : null,
        skillTag: chance >= 100 ? 'guaranteed' : chance >= 60 ? 'likely' : 'risky',
        tooltip: action.description || action.label,
        disabled: !action.unlocked, disabledReason: action.lockReason || 'not yet',
        onPick: () => _act(game, npc.id, action.id, court),
    };
}

function _choices(game) {
    const st = _cur;
    if (!st || !st.scene.isOpen) return;
    const player = game.player;
    const npc = Relationships.getNPC(st.npcId);
    if (!npc || !npc.isAlive) { st.scene.leave(); return; }
    const acts = [
        ...Relationships.getSocialActionAvailability(player, npc.id).map(a => _actionChoice(game, npc, a, false)),
        ...Relationships.getCourtActionAvailability(player, npc.id, { world: game.world }).map(a => _actionChoice(game, npc, a, true)),
    ];
    // What you can do now takes the number keys; of what's locked, each group
    // shows only the next step, as something to work toward
    const list = [];
    for (const g of ['talk', 'romance', 'hostile']) {
        const inGroup = acts.filter(c => c.group === g);
        list.push(...inGroup.filter(c => !c.disabled), ...inGroup.filter(c => c.disabled).slice(0, 1));
    }

    // What they've brought to you: answered before anything else (a fight is
    // reckoned with your arms' quality, mood and treasures)
    const matter = Relationships.matterView(player, npc.id, { duelMods: PlayerEffects.duelModifiers(player) });
    if (matter) {
        list.unshift(...matter.options.map(o => ({
            icon: o.icon, label: o.label, group: 'matter',
            cls: o.lie ? 'npc-dialog-choice-dark' : '',
            extra: o.cost ? `<span class="npc-dialog-price">${o.cost}g</span>` : '',
            chance: o.chance != null ? o.chance : null,
            skillTag: o.chance == null ? 'guaranteed' : o.chance >= 60 ? 'likely' : 'risky',
            tooltip: o.lie ? 'A lie. If they see through it, it will cost you.' : o.label,
            disabled: !!o.disabled, disabledReason: o.reason || 'not possible',
            onPick: () => _matter(game, npc.id, o),
        })));
    }

    if (Relationships.isInTravelParty(player, npc.id)) {
        list.push({
            icon: '👋', label: 'Time we parted ways.', group: 'party', cls: 'npc-dialog-choice-muted',
            tooltip: `${npc.firstName} leaves your travel party.`,
            onPick: () => _party(game, npc.id, false),
        });
    } else {
        list.push({
            icon: '🧭', label: 'Come travel with me.', group: 'party',
            tooltip: 'Ask them to join your travel party. Whether they agree depends on how they feel about you.',
            onPick: () => _party(game, npc.id, true),
        });
    }
    list.push({
        icon: '🚶', label: 'I should be going.', group: 'leave',
        onPick: () => {
            const rel = Relationships.getRelationship(player, npc.id);
            st.scene.clearChoices();
            st.scene.player('I should be going.');
            st.scene.npc((rel.score || 0) >= 20 ? 'Come back soon!' : (rel.score || 0) <= -20 ? '*turns away*' : 'Take care.');
            st.scene.leave(700);
        },
    });
    st.scene.choices(list, { titles: GROUPS, hint: `Spend time with ${npc.firstName} — press 1–9, or Esc to go.` });
}

function _refresh(game, prevScore) {
    const st = _cur;
    const npc = Relationships.getNPC(st.npcId);
    if (!npc) return;
    const rel = Relationships.getRelationship(game.player, npc.id);
    st.scene.setMood(_mood(rel), Math.round((rel.score || 0) - prevScore));
    const facts = st.scene.overlay.querySelector('.npc-dialog-facts');
    if (facts) facts.innerHTML = _facts(game, npc, rel);
    game.ui.updateStats(game.player, game.world);
    st.scene.afterSpoken(250, () => _choices(game));
}

function _act(game, npcId, actionId, court) {
    const st = _cur;
    const scene = st.scene;
    const player = game.player;
    const defs = court ? Relationships._getCourtActions() : Relationships._getSocialActions();
    const def = defs[actionId] || {};
    const apCost = def.apCost != null ? def.apCost : 1;
    if ((player.actionPoints || 0) < apCost) {
        scene.note(`⚡ You need ${apCost} AP for that — you have ${player.actionPoints || 0}.`, 'bad');
        return;
    }
    player.actionPoints -= apCost;
    const before = Relationships.getRelationship(player, npcId).score || 0;
    const result = court
        ? Relationships.performCourtAction(player, npcId, actionId, { world: game.world })
        : Relationships.performSocialAction(player, npcId, actionId);
    const npc = Relationships.getNPC(npcId);
    if (npc) npc.lastInteraction = game.world?.day || 0;
    const seed = (game.world?.day || 0) + actionId.length;
    const how = { topic: actionId, asked: (SAYS[actionId] || def.label || actionId).replace(/\*[^*]*\*\s*/g, '').trim() || def.label };

    scene.exchange(SAYS[actionId] || `*${(def.label || actionId).toLowerCase()}*`, () => {
        if (result.success && result.married) {
            const marry = Relationships.marry(player, npcId, game.world);
            if (marry.success) {
                scene.seal('Proposal', 'Accepted', true);
                scene.npc('*tears in their eyes* Yes. Yes, a thousand times!', how);
                st.noReturn = true;
                scene.afterSpoken(1200, () => { scene.close(); ActionMenu._showMarriageCelebration(game, marry.npc); });
                return;
            }
        }
        how.outcome = result.success ? (result.gain < 0 ? 'it offended you' : court ? 'it charmed you' : 'it went well, you warmed to them')
            : result.failed ? (court ? 'it fell flat and made things awkward' : 'it fell flat and was awkward') : null;
        if (result.success) {
            if (court) {
                scene.npc(_pick(FOND, seed), how);
                scene.note(`💗 Affection +${result.gain} · ${result.stage.icon} ${result.stage.label}${result.charismaUp ? ' · Charisma improved!' : ''}`, 'good');
                if (result.affairRumor) scene.note('👀 Someone saw the two of you together. People will talk, and your spouse has ears.', 'bad');
            } else if (result.gain < 0) {
                scene.npc(actionId === 'insult' ? '*bristles* How dare you!' : '*grimaces* You\'ll regret that.', how);
                scene.note(`💢 Relationship ${result.gain}`, 'bad');
            } else {
                scene.npc(_pick(WARM, seed), how);
                scene.note(`🤝 Relationship +${result.gain}${result.skillUp ? ' · Diplomacy improved!' : ''}`, 'good');
            }
        } else if (result.failed) {
            if (actionId === 'propose') scene.seal('Proposal', 'Refused', false);
            scene.npc(court ? `*${result.reason.replace(/\.$/, '')}*` : '*an awkward pause* …Right.', how);
            scene.note(`😬 It went poorly${result.penalty ? ` · ${court ? 'Affection' : 'Relationship'} ${result.penalty}` : ''}`, 'bad');
        } else {
            player.actionPoints += apCost; // nothing happened — the time is not spent
            scene.note(result.reason || 'Not possible.', 'bad');
        }
        _refresh(game, before);
    }, 650);
}

/** Answer what they brought to you: their reply, and what it cost or won. */
function _matter(game, npcId, option) {
    const st = _cur;
    const scene = st.scene;
    const player = game.player;
    const before = Relationships.getRelationship(player, npcId).score || 0;
    const res = Relationships.resolveMatter(player, npcId, option.id, game.world, { duelMods: PlayerEffects.duelModifiers(player) });
    scene.exchange(option.label, () => {
        if (!res.ok) {
            scene.note(res.reason || 'Not possible.', 'bad');
        } else {
            scene.npc(res.reply, { topic: 'matter', asked: option.label });
            scene.note(res.note, res.tone === 'good' ? 'good' : res.tone === 'bad' ? 'bad' : 'info');
            if (res.divorced) {
                scene.seal('Marriage', 'Ended', false);
                scene.afterSpoken(1400, () => scene.leave());
                game.ui.updateStats(player, game.world);
                return;
            }
        }
        _refresh(game, before);
    }, 650);
}

function _party(game, npcId, join) {
    const st = _cur;
    const scene = st.scene;
    const player = game.player;
    const before = Relationships.getRelationship(player, npcId).score || 0;
    if (!join) {
        const r = Relationships.removeFromTravelParty(player, npcId);
        scene.exchange('Time we parted ways, I think.', () => {
            if (r.success) {
                scene.npc('It was a good road. Look me up, if you pass this way again.', { topic: 'travel', asked: join ? 'Come travel with me.' : 'Time we parted ways.' });
                scene.note('🧭 They leave your travel party', 'info');
            } else scene.note(r.reason, 'bad');
            _refresh(game, before);
        });
        return;
    }
    const r = Relationships.requestJoinTravelParty(player, npcId, game.world);
    scene.exchange('Come travel with me. The road is better with company.', () => {
        if (!r.success) {
            scene.note(r.reason, 'bad');
        } else if (r.accepted) {
            scene.seal('Companion', 'Joined', true);
            scene.npc('*grins* Give me a moment to pack.', { topic: 'travel', asked: join ? 'Come travel with me.' : 'Time we parted ways.' });
            scene.note('🧭 They join your travel party', 'good');
        } else {
            scene.npc(`*shakes their head* ${r.reason}`, { topic: 'travel', asked: join ? 'Come travel with me.' : 'Time we parted ways.' });
        }
        _refresh(game, before);
    }, 700);
}

/** Open the scene with one of the townsfolk. options.returnTo: 'meet' | 'relationships' | 'travel_party'. */
export function openPersonScene(game, tile, npcId, options = {}) {
    const npc = Relationships.getNPC(npcId);
    if (!npc || !npc.isAlive) {
        game.ui.showNotification('Unavailable', 'This character is no longer available.', 'warning');
        return;
    }
    const player = game.player;
    const rel = Relationships.getRelationship(player, npcId);
    const settlement = tile && tile.settlement;
    const state = { npcId, tile, options, scene: null, noReturn: false };
    _cur = state;
    state.scene = ConversationScene.open({
        name: `${npc.firstName} ${npc.dynasty}`,
        subtitle: `${npc.occupation.charAt(0).toUpperCase()}${npc.occupation.slice(1)} · age ${npc.age} · ${npc.gender === 'male' ? '♂' : '♀'}`,
        where: settlement ? settlement.name : '',
        icon: npc.gender === 'male' ? '👨' : '👩',
        sprite: { type: _spriteType(npc.occupation), id: ConversationScene.seedOf(npc.id), gender: npc.gender },
        mood: _mood(rel),
        moodTitle: `How ${npc.firstName} feels about you`,
        facts: _facts(game, npc, rel),
        greeting: _greeting(game, npc, rel),
        // Their own words, by the AI brain when it is on (ui/npcVoice.js)
        voice: npcVoice({
            id: npc.id,
            firstName: npc.firstName,
            traits: () => [npc.personality, ...(npc.traits || [])].filter(Boolean).map(t => t.name || t),
            role: `a ${npc.occupation || 'townsperson'} of ${settlement ? settlement.name : 'these parts'}, aged ${npc.age}`,
            disposition: () => Relationships.getRelationLabel(Relationships.getRelationship(player, npcId).score || 0).label.toLowerCase(),
        }),
        onClose: () => {
            if (_cur === state) _cur = null;
            game.ui.updateStats(player, game.world);
            if (state.noReturn || !tile) return;
            // Back to the list they were picked from
            if (options.returnTo === 'relationships') ActionMenu.showRelationshipsMenu(game, tile);
            else if (options.returnTo === 'travel_party') ActionMenu.showTravelPartyMenu(game, tile);
            else if (options.returnTo === 'meet') ActionMenu.showMeetPeopleMenu(game, tile);
        },
    });
    _choices(game);
}

/** A person's sprite description for portrait cards in the lists. */
export function personSprite(npc) {
    return { type: _spriteType(npc.occupation), id: ConversationScene.seedOf(npc.id), gender: npc.gender };
}
