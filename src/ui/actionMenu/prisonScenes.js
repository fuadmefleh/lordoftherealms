// ActionMenu — the prison and servitude as choice scenes (player/prison.js).
//
//   'prison'     the cell: cellmates (talk, share food, ask for tools), bribe a
//                guard (look away tonight / tools / lost papers), dig the
//                tunnel or labour in the yard (each takes the day), plan the
//                break-out (once a night), post bail, serve the day.
//   'servitude'  bound to a captor: slip away at night, bribe an overseer,
//                work for an earlier release, buy your freedom.
//
// ActionMenu.attemptJailbreak(game, phase) opens the prison scene (the
// break-out by default, 'cell' for the cell), postBail and
// attemptServitudeEscape act through the same domain calls.
import { ActionMenu } from './_ref.js';
import { registerScene } from './choiceScenes.js';
import { Prison } from '../../player/prison.js';
import { PlayerMilitary } from '../../player/playerMilitary.js';

const _day = (game) => (game.world && game.world.day) || 0;
const _back = { id: 'back', icon: '↩️', label: 'Back', chance: null, odds: false };

function _cellView(game, st) {
    const { player, world } = game;
    const jail = player.jailState;
    if (!jail) return null;
    const pr = Prison.state(player, world);
    const stats = [`🔒 ${jail.daysRemaining} day(s) left`, `💰 ${Math.floor(player.gold || 0)}`, `❤️ ${Math.round(player.health || 0)}`];
    if (pr.tools > 0 || pr.tunnel > 0) stats.push(`⛏️ tunnel ${pr.tunnel}% · 🔧 ${pr.tools}`);
    const base = { icon: '🧱', title: `The Jail of ${jail.settlement}`, panelTitle: '🔒 In Jail', stats, log: pr.log };
    const triedTonight = !Prison.canBreakToday(player, world);

    if (st.phase === 'mates') {
        const options = [];
        const lines = [];
        for (const m of pr.cellmates) {
            const def = Prison.archetype(m.archetype);
            lines.push(`${def.icon} ${m.name} — ${def.label}${m.friend ? ' (a friend)' : ` (${m.rapport}/${def.friendAt} to win over)`}${m.sold ? ' — sold you out' : ''}. ${def.blurb || ''}`);
            const talked = m.talkedDay === _day(game);
            const why = m.sold ? 'Will not speak to you' : talked ? 'You spoke today' : '';
            options.push({ id: `talk:${m.id}`, icon: '🗣️', label: `Talk with ${m.name}`, hint: 'Charisma and diplomacy win them over.', chance: Prison.talkChance(player), can: !why, reason: why });
            const food = Prison._food(player);
            options.push({ id: `food:${m.id}`, icon: '🍞', label: `Share food with ${m.name}`, hint: 'A sure way to a prisoner\'s heart.', chance: null, can: !why && !!food, reason: why || 'No food in your packs' });
            if (m.archetype === 'smuggler' && m.friend) {
                const cost = Prison.archetype('smuggler').toolsCost || 20;
                options.push({ id: `tools:${m.id}`, icon: '🔧', label: `Ask ${m.name} for tools`, hint: 'Brought in tomorrow, baked into the bread.', chance: null, cost: `${cost} gold`, can: pr.toolsDueDay == null && (player.gold || 0) >= cost, reason: pr.toolsDueDay != null ? 'Already on the way' : `Needs ${cost} gold` });
            }
        }
        options.push(_back);
        return { ...base, text: 'The men you share the straw with:', lines, options };
    }
    if (st.phase === 'bribe') {
        const chance = Prison.bribeChance(player, world);
        const opt = (id, icon, label, hint) => {
            const cost = Prison.bribeCost(player, world, id);
            return { id: `bribe:${id}`, icon, label, hint, chance, cost: `${cost} gold`, can: (player.gold || 0) >= cost, reason: `The guard wants ${cost} gold` };
        };
        const o = [
            opt('lookaway', '🙈', 'Look the other way tonight', 'A much better chance to slip out tonight.'),
            opt('tools', '🔧', 'Bring you tools', 'Something to dig with.'),
            opt('release', '📜', 'Lose your papers', 'Walk out before dawn, as if you had served your time.'),
        ];
        if (pr.lookAwayDay === _day(game)) o[0] = { ...o[0], can: false, reason: 'A guard already owes you tonight' };
        return { ...base, text: 'The guards are paid little and drink much. A refusal means a report, and more days.', options: [...o, _back] };
    }
    if (st.phase === 'break') {
        const why = triedTonight ? 'The guards are wary after tonight\'s attempt' : '';
        const options = [
            { id: 'break:slip', icon: '🌑', label: 'Slip out at the change of the watch', hint: 'Stealth — a bribed guard and friends inside help.', chance: Prison.breakChance(player, world, 'slip'), can: !why, reason: why },
            { id: 'break:rush', icon: '👊', label: 'Rush the guard', hint: 'Combat and strength. Fail and they search the cell.', chance: Prison.breakChance(player, world, 'rush'), can: !why, reason: why },
        ];
        if (pr.tunnel >= 100) options.unshift({ id: 'break:tunnel', icon: '🕳️', label: 'Out through the tunnel', hint: 'The work of many nights.', chance: Prison.breakChance(player, world, 'tunnel'), can: !why, reason: why });
        options.push(_back);
        return { ...base, text: 'Escaping is a crime of its own: the crown will hunt you, and the gaoler will post a bounty.', footer: 'One attempt a night. Failure adds days to your sentence.', options };
    }
    // The cell
    const options = [
        { id: 'mates', icon: '👥', label: 'Your cellmates', hint: pr.cellmates.map(m => m.name).join(', '), chance: null, odds: false },
        { id: 'bribe', icon: '💰', label: 'Bribe a guard', hint: 'Coin opens doors — sometimes.', chance: null, odds: false },
        { id: 'dig', icon: '⛏️', label: 'Work on the tunnel', hint: `Behind the loose stone (${pr.tunnel}%). Takes the day; a search or a snitch may find it.`, chance: null, can: pr.tools > 0 && pr.tunnel < 100, reason: pr.tunnel >= 100 ? 'The tunnel is through' : 'You need tools' },
        { id: 'work', icon: '🧱', label: 'Labour in the yard', hint: 'Takes the day; it counts double against your sentence.', chance: null },
        { id: 'break', icon: '🏃', label: 'Plan the break-out', hint: 'Once a night.', chance: null, odds: false, can: !triedTonight, reason: 'The guards are wary after tonight\'s attempt' },
    ];
    if (jail.bailCost) options.push({ id: 'bail', icon: '💰', label: 'Post bail', chance: null, cost: `${jail.bailCost} gold`, can: (player.gold || 0) >= jail.bailCost, reason: `You need ${jail.bailCost} gold` });
    options.push({ id: 'wait', icon: '🔒', label: 'Serve the day', hint: 'Sit it out.', chance: null });
    return { ...base, text: `Offence: ${jail.offense || 'unknown'} (#${jail.offenseNumber || 1}). The straw is damp, the bread is stale.`, options };
}

function _cellAct(game, st, choice) {
    const { player, world } = game;
    if (!player.jailState) return { notification: { title: 'Free', body: 'You are no longer in jail.', type: 'info' } };
    const pr = Prison.state(player, world);
    const [what, arg] = String(choice).split(':');
    const stay = (phase = st.phase) => ({ state: { ...st, phase } });
    const fail = (reason) => ({ invalid: true, notification: { title: 'Not Possible', body: reason, type: 'error' } });
    if (choice.startsWith('bribe:')) {
        const r = Prison.bribe(player, world, arg);
        if (!r.success) return fail(r.reason);
        if (r.released) return { notification: { title: '📜 Papers Lost', body: r.text, type: 'success' } };
        return stay('cell');
    }
    if (choice.startsWith('break:')) {
        const r = Prison.breakout(player, world, arg);
        if (!r.success) return fail(r.reason);
        if (r.escaped) return { notification: { title: '🏃 Jailbreak!', body: r.text, type: 'success' } };
        return { notification: { title: '❌ Jailbreak Failed', body: r.text, type: 'error' } };
    }
    switch (what) {
        case 'back': return stay('cell');
        case 'mates': case 'bribe': case 'break': return stay(what);
        case 'talk': case 'food': {
            const r = Prison.talk(player, world, arg, what);
            return r.success ? stay() : fail(r.reason);
        }
        case 'tools': {
            const r = Prison.orderTools(player, world, arg);
            return r.success ? stay() : fail(r.reason);
        }
        case 'dig': {
            const r = Prison.dig(player, world);
            return r.success ? { endDay: true, notification: { title: '⛏️ The Tunnel', body: r.text, type: 'info' } } : fail(r.reason);
        }
        case 'work': {
            const r = Prison.work(player, world);
            return r.success ? { endDay: true, notification: { title: '🧱 The Yard', body: r.text, type: 'info' } } : fail(r.reason);
        }
        case 'bail': {
            const r = Prison.postBail(player, world);
            return r.success ? { notification: { title: '💰 Bail Posted', body: r.text, type: 'success' } } : fail(r.reason);
        }
        case 'wait': return { endDay: true, notification: { title: '🔒 Another Day', body: `You sit out the day. ${pr.cellmates.length} men snore around you.`, type: 'info' } };
        default: break;
    }
    return fail('That cannot be done now.');
}

registerScene('prison', { view: _cellView, act: _cellAct });

// ── The march: in chains from a village with no jail to the nearest town with one ──
registerScene('prison_transport', {
    view(game) {
        const { player } = game;
        const jail = player.jailState;
        const tr = jail && jail.transport;
        if (!tr || tr.done) return null;
        const ev = tr.event;
        const odds = Prison.transportOdds(player);
        const stats = [`🛤️ Day ${tr.day} of ${tr.days}`, `🔒 ${jail.daysRemaining} day(s) to serve`, `💰 ${Math.floor(player.gold || 0)}`, `❤️ ${Math.round(player.health || 0)}`];
        const base = { icon: '⛓️', title: `In Chains on the Road to ${tr.to.name}`, panelTitle: '⛓️ The March', stats, log: tr.log.slice(-5) };
        const intro = tr.day === 0
            ? `${tr.from.name} has no jail. The guards chain your wrists and march you to ${tr.to.name} — ${tr.days} day(s) on the road. The days count against your sentence.`
            : (ev && ev.text) || 'The escort marches on.';
        const walk = { id: 'walk', icon: '🚶', label: tr.days - tr.day <= 1 ? `On to ${tr.to.name}` : 'Walk on', hint: 'Another day on the road (ends the day).', chance: null, odds: false, isDefault: true };
        if (ev && ev.choice && !ev.resolved) {
            if (ev.kind === 'raid') {
                return { ...base, text: `${intro}${ev.raiders ? ` (${ev.raiders} band${ev.raiders === 1 ? '' : 's'} of raiders about these parts.)` : ''}`, options: [
                    { id: 'slip', icon: '🏃', label: 'Slip your chains in the fight', hint: 'Stealth and agility. Out — and wanted for it.', chance: odds.slip },
                    { id: 'fight', icon: '⚔️', label: 'Fight beside the guards', hint: 'Combat. The captain may shorten your sentence for it.', chance: odds.fight },
                    { id: 'stay', icon: '🙇', label: 'Keep your head down', hint: 'The guards may drive them off… or the raiders may take you, or your purse.', chance: null, odds: false },
                ] };
            }
            const can = (player.gold || 0) >= ev.cost;
            return { ...base, text: intro, options: [
                { id: 'pay', icon: '💰', label: 'Pay him', cost: `${ev.cost} gold`, hint: 'Loosed in the night — an escape in the crown\'s eyes.', chance: null, odds: false, can, reason: `He wants ${ev.cost} gold` },
                { id: 'refuse', icon: '✋', label: 'Keep your coin', chance: null, odds: false },
            ] };
        }
        const text = ev && ev.outcome ? `${intro} ${ev.outcome}` : intro;
        return { ...base, text, options: [walk] };
    },
    act(game, st, choice) {
        const { player, world } = game;
        if (!player.jailState || !player.jailState.transport) return { notification: { title: 'Free', body: 'You are no longer in chains.', type: 'info' } };
        if (choice === 'walk') {
            return { after(g) { g.ui.hideCustomPanel(); g.endDay(); } };
        }
        const r = Prison.transportChoice(player, world, choice);
        if (!r.success) return { invalid: true, notification: { title: 'Not Possible', body: r.reason, type: 'error' } };
        game.ui.updateStats(player, world);
        if (r.escaped) return { notification: { title: '🏃 Away!', body: r.text, type: 'success' } };
        if (r.captured) return { notification: { title: '⛓️ Taken by Raiders', body: r.text, type: 'error' } };
        if (r.freed) return { notification: { title: '🛤️ Left on the Road', body: r.text, type: 'warning' } };
        return { state: { ...st, seen: (st.seen || 0) + 1 } };
    },
    abandon() {
        // Walked away: a choice not made is made the quiet way at the day's end (Prison.transportStep)
        return null;
    },
});

registerScene('servitude', {
    view(game) {
        const { player, world } = game;
        const s = player.indenturedServitude;
        if (!s) return null;
        const tried = !Prison.canTryServitudeEscape(player, world);
        const why = tried ? 'You have tried your luck today' : '';
        const cost = Prison.servitudeBribeCost(player);
        const options = [
            { id: 'slip', icon: '🌑', label: 'Slip away at night', hint: 'Caught, they beat you and add days.', chance: s.escapeChance, can: !why, reason: why },
            { id: 'bribe', icon: '💰', label: 'Bribe an overseer', hint: 'He reports you "dead of fever". Or takes the coin and tells your master.', chance: Prison.servitudeBribeChance(player), cost: `${cost} gold`, can: !why && (player.gold || 0) >= cost, reason: why || `He wants ${cost} gold` },
            { id: 'work', icon: '🧱', label: 'Work for an earlier release', hint: 'Takes the day; it counts double against your bond.', chance: null },
        ];
        if (s.canBuyFreedom) options.push({ id: 'buy', icon: '💰', label: 'Buy your freedom', chance: null, cost: `${s.freedomCost} gold`, can: (player.gold || 0) >= s.freedomCost, reason: `You need ${s.freedomCost} gold` });
        return {
            icon: '⛓️', title: `Bound to ${s.captor}`, panelTitle: '⛓️ Indentured Servitude',
            stats: [`${s.daysRemaining} day(s) left`, `💰 ${Math.floor(player.gold || 0)}`, `❤️ ${Math.round(player.health || 0)}`],
            text: 'You toil from dawn to dusk under the overseers\' eyes.', options,
        };
    },
    act(game, st, choice) {
        const { player, world } = game;
        const s = player.indenturedServitude;
        if (!s) return { notification: { title: 'Free', body: 'You are no longer bound.', type: 'info' } };
        const fail = (reason) => ({ invalid: true, notification: { title: 'Not Possible', body: reason, type: 'error' } });
        if (choice === 'slip') {
            if (!Prison.canTryServitudeEscape(player, world)) return fail('You have tried your luck today.');
            s.lastEscapeDay = world.day;
            const r = PlayerMilitary.attemptEscape(player);
            return { notification: { title: r.success ? '🏃 Escaped!' : '❌ Escape Failed', body: r.message, type: r.success ? 'success' : 'error' } };
        }
        if (choice === 'bribe') {
            const r = Prison.bribeOverseer(player, world);
            if (!r.success) return fail(r.reason);
            return { notification: { title: r.freed ? '💰 Bribed Free' : '❌ Betrayed', body: r.text, type: r.freed ? 'success' : 'error' } };
        }
        if (choice === 'work') {
            const r = Prison.servitudeWork(player);
            return r.success ? { endDay: true, notification: { title: '🧱 Hard Labour', body: r.text, type: 'info' } } : fail(r.reason);
        }
        if (choice === 'buy') {
            const r = PlayerMilitary.buyFreedom(player);
            return r.success ? { notification: { title: 'Freedom Bought!', body: r.message, type: 'success' } } : fail(r.reason);
        }
        return fail('That cannot be done now.');
    },
});

Object.assign(ActionMenu, {
    /** Post bail and walk out (befriended cellmates follow up). */
    postBail(game) {
        const r = Prison.postBail(game.player, game.world);
        if (!r.success) {
            game.ui.showNotification('Cannot Post Bail', r.reason, 'error');
            return;
        }
        if (game._scene && game._scene.kind === 'prison') game._scene = null;
        game.ui.showNotification('💰 Bail Posted', r.text, 'success');
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Walk the jail: the cell, cellmates and gaoler on the map (ui/innerMapJail.js);
     * the panel if the map can't be had. Sentenced where there's no jail, the
     * march to the nearest town with one comes first.
     */
    async enterJailMap(game) {
        if (!game.player.jailState) return;
        if (Prison.needsTransport(game.player, game.world)) {
            ActionMenu.beginMarch(game);
            return;
        }
        const ok = typeof game.enterJailMap === 'function' ? await game.enterJailMap() : false;
        if (!ok) ActionMenu.attemptJailbreak(game, 'cell');
    },

    /** In chains for the march: off the street map, the road scene. */
    beginMarch(game) {
        if (!Prison.beginTransport(game.player, game.world)) return false;
        const InnerMap = game.innerMapMode ? true : false;
        if (InnerMap && typeof game.exitInnerMap === 'function') game.exitInnerMap({ force: true });
        ActionMenu.showScene(game, 'prison_transport', {});
        return true;
    },

    /** After a day on the road: the day's event, or (arrived) into the jail. */
    showMarch(game, march) {
        const player = game.player;
        if (!player.jailState) {
            if (player.indenturedServitude) ActionMenu.attemptServitudeEscape(game);
            return;
        }
        if (march && march.arrived) {
            game.ui.showNotification('⛓️ Arrived', march.text, 'warning');
            ActionMenu.enterJailMap(game);
            return;
        }
        ActionMenu.showScene(game, 'prison_transport', {});
    },

    /** The prison scene: the break-out by default, or the cell ('cell'). */
    attemptJailbreak(game, phase = 'break') {
        if (!game.player.jailState) return;
        Prison.state(game.player, game.world);
        const p = phase === 'cell' || !Prison.canBreakToday(game.player, game.world) ? 'cell' : 'break';
        ActionMenu.showScene(game, 'prison', { phase: p });
    },

    /** Servitude: slip away, bribe an overseer, work, or buy your freedom. */
    attemptServitudeEscape(game) {
        if (!game.player.indenturedServitude) return;
        ActionMenu.showScene(game, 'servitude', {});
    },
});
