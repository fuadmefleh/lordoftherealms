// ActionMenu — The Fighting Pit (systems/pitFights.js; the ring on the street
// map world/pitRing.js): tonight's card and the book's odds, bets, watching
// the night, stepping in yourself (the duel panel: to first blood, to
// submission, to the death), the pit's fighters (sign one, train him, let him
// go), the bear, the dogs and the birds (buy and enter one of your own), the
// law (open, taxed, or a cellar behind a front where it is banned) and your
// record. Opened from the 'fight_pit' action and the ring's fence on the
// street map; buttons route through data-am-act → pitAct.
import { ActionMenu } from './_ref.js';
import { PitFights } from '../../systems/pitFights.js';
import { Townsfolk } from '../../systems/townsfolk.js';
import { Duels } from '../../systems/duels.js';
import { PitRing } from '../../world/pitRing.js';
import { Laws } from '../../systems/laws.js';
import { PlayerEffects } from '../../player/playerEffects.js';
import { DuelPanel } from './duel.js';
import { esc, lede, chips, card, rowList, price, purse, more, bullets } from './uiKit.js';
import { Utils } from '../../core/utils.js';
import { Soundscape } from '../soundscape.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';
const _cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const WHY = { market: 'the market night', feast: 'the feast', fair: 'the fair' };

function _town(game) {
    const t = game.world.getTile(game.player.q, game.player.r);
    return (t && t.settlement) || null;
}

function _when(n) {
    return n <= 0 ? 'tonight' : n === 1 ? 'tomorrow night' : `in ${n} days`;
}

/** "Brom Ironwood (7–2)" */
function _who(world, s, bout, side) {
    const name = PitFights.sideName(world, s, bout, side);
    if (bout.kind !== 'men') return esc(name);
    const rec = s.pit.fighters[side === 'a' ? bout.a : bout.b];
    return `${esc(name)}${rec ? ` <span style="color:#8f8a7e;">(${esc(PitFights.recordText(rec))})</span>` : ''}`;
}

function _boutName(world, s, bout) {
    if (bout.kind === 'bear') return `🐻 ${_who(world, s, bout, 'a')} against ${s.pit.dogs || 3} dogs`;
    if (bout.kind === 'cocks') return `🐓 ${_who(world, s, bout, 'a')} against ${_who(world, s, bout, 'b')}`;
    return `${bout.title ? '🏆 ' : '🥊 '}${_who(world, s, bout, 'a')} against ${_who(world, s, bout, 'b')}`;
}

function _boutDesc(bout) {
    if (bout.kind === 'bear') return 'Bear-baiting: does the bear shake off the dogs, or do they pull him down?';
    if (bout.kind === 'cocks') return 'A cockfight: steel spurs, and the loser seldom lives.';
    const M = PitFights.config().modes[bout.mode] || {};
    return `${bout.title ? 'For the champion\'s belt, ' : ''}${esc(M.label || '')}${bout.mode === 'death' ? '. One of them will not walk out.' : '.'}`;
}

/** Tonight's card, before it is fought: a row a bout (open it to bet), watch, fight. */
function cardHtml(game, s, cardObj) {
    const { world, player } = game;
    let html = '';
    const rows = cardObj.bouts.map((b, i) => {
        const book = PitFights.odds(world, s, b);
        const fixed = PitFights.fixKnown(player, world, s, b);
        return {
            icon: `${i + 1}`, name: _boutName(world, s, b), desc: _boutDesc(b),
            note: fixed ? 'A whisper in your ear: the fix is in on this one.' : '',
            side: book ? `${book.odds[0]} · ${book.odds[1]}` : '', tone: fixed ? 'warn' : '',
            act: 'pitAct', args: ['betPanel', i],
        };
    });
    html += rowList(rows, `🥊 Tonight's card, for ${WHY[cardObj.why] || 'the night'}`);
    const door = PitFights.door(player, world, s);
    html += rowList([{
        icon: '👁️', name: 'Watch the bouts', desc: `Take your place at the rail; the bouts are fought now and your bets settled.${door.paid ? '' : ` The doorman's fee: ${Utils.formatGold(door.fee)}g.`}`,
        side: door.paid ? '' : price(door.fee, player.gold >= door.fee), act: 'pitAct', args: ['watch'],
    }]);
    // Step in yourself
    const opp = PitFights.opponent(world, s);
    const st = PitFights.state(player);
    if (opp) {
        const fought = st.foughtDay === (world.day || 0);
        const rows2 = ['firstBlood', 'submission', 'death'].map(mode => {
            const M = PitFights.config().modes[mode];
            return {
                icon: mode === 'death' ? '💀' : mode === 'submission' ? '✊' : '🩸',
                name: `Fight ${esc(Townsfolk.name(opp.p))} ${esc(M.label)}`,
                desc: `${opp.champion ? 'The champion. ' : ''}${esc(PitFights.recordText(opp.rec))}.${mode === 'death' ? ' You can die. If you go down, the crowd decides.' : ''}`,
                side: price(PitFights.selfPrize(s, mode), true), tone: mode === 'death' ? 'bad' : 'gold',
                off: fought, why: 'You have fought once tonight.', act: 'pitAct', args: ['fight', mode],
            };
        });
        html += rowList(rows2, '⚔️ Into the pit yourself');
    }
    const mine = s.pit.cocks.filter(c => c.owner === 'player');
    const cockRows = [{ icon: '🐓', name: 'Buy a fighting bird and enter it', desc: 'From the town\'s yards. He fights in tonight\'s cockpit; a win pays a small purse.', side: price(PitFights.config().cocks.price * 2, player.gold >= PitFights.config().cocks.price * 2), act: 'pitAct', args: ['cock'] }];
    for (const c of mine) {
        if (c.entered !== cardObj.day) cockRows.push({ icon: '🐓', name: `Enter ${esc(c.name)}`, desc: `${c.wins} win${c.wins === 1 ? '' : 's'}; vigour ${c.vigour}.`, act: 'pitAct', args: ['enterCock', c.id] });
    }
    html += rowList(cockRows);
    return html;
}

/** The night fought: each bout's end, the crowd, the gate, the raid. */
function resultsHtml(game, s, cardObj) {
    if (cardObj.raid) return card(esc(cardObj.raid.text), { icon: '🚨', title: 'The watch came', tone: 'bad' });
    const rows = cardObj.results.map(r => ({
        icon: r.death || r.bearDied ? '💀' : r.kind === 'bear' ? '🐻' : r.kind === 'cocks' ? '🐓' : r.title ? '🏆' : '🥊',
        name: esc(r.line), desc: r.fixed ? 'Some in the crowd say the favourite went down too easily.' : r.champion != null ? 'A new champion.' : '',
        tone: r.death ? 'bad' : '',
    }));
    let html = rowList(rows, `🥊 Tonight's bouts are fought (${cardObj.crowd} in the crowd)`);
    if (cardObj.mood) html += `<div style="${NOTE} margin:4px 0;">${cardObj.mood > 0 ? 'The taverns are full and loud after it.' : 'The town is sullen after it; the priest will preach on it.'}</div>`;
    return html;
}

function fightersHtml(game, s) {
    const { player } = game;
    const list = PitFights.stable(game.world, s);
    if (!list.length) return '';
    const rows = list.map(f => ({
        icon: f.champion ? '🏆' : f.rec.owner === 'player' ? '⭐' : '🥊',
        name: `${esc(f.name)}, ${f.age}`,
        desc: `${esc(Townsfolk.roleTitle(f.p))}. ${esc(PitFights.recordText(f.rec))}${f.rec.train ? ` · trained ${f.rec.train}` : ''}${f.hurt ? ` · hurt (${f.hurt.hp}/${f.hurt.max})` : ''}${f.p.jailedUntil > (game.world.day || 0) ? ' · in the cells' : ''}`,
        side: f.rec.owner === 'player' ? 'yours' : price(PitFights.signFee(game.world, s, f.rec), player.gold >= PitFights.signFee(game.world, s, f.rec)),
        tone: f.rec.owner === 'player' ? 'good' : '',
        act: 'pitAct', args: ['fighter', f.rec.pid],
    }));
    return rowList(rows, '👊 The fighters');
}

function animalsHtml(s) {
    const pit = s.pit;
    const rows = [];
    if (pit.bearBaiting) {
        rows.push(pit.bear
            ? { icon: '🐻', name: esc(pit.bear.name), desc: `The pit's bear: ${pit.bear.wins || 0} baiting${pit.bear.wins === 1 ? '' : 's'} survived, ${Math.max(0, Math.round(pit.bear.hp))}/${pit.bear.max} strong.`, side: `${pit.dogs || 0} dogs` }
            : { icon: '🐻', name: 'No bear', desc: 'The master will buy one from the trappers when his book can stand it.', side: `${pit.dogs || 0} dogs` });
    }
    const birds = pit.cocks.filter(c => !c.owner).length;
    const mine = pit.cocks.filter(c => c.owner === 'player');
    rows.push({ icon: '🐓', name: `${birds} bird${birds === 1 ? '' : 's'} in the pen`, desc: mine.length ? `Yours: ${mine.map(c => `${esc(c.name)} (${c.wins} won)`).join(', ')}.` : 'Bought from the town\'s yards; the dead go to the cookshop.' });
    return rowList(rows, '🐾 The beasts');
}

Object.assign(ActionMenu, {
    /** The Fighting Pit. */
    showPit(game, message = null) {
        const { world, player } = game;
        const s = _town(game);
        const pit = s ? PitFights.ensure(world, s) : null;
        let html = '<div style="font-size:12px; max-height:580px; overflow-y:auto;">';
        if (message) html += card(esc(message.text), { tone: message.ok ? 'good' : 'bad' });
        if (!pit) {
            html += lede('There is no fighting pit here.') + '</div>';
            game.ui.showCustomPanel('🥊 The Pit', html);
            return;
        }
        const law = PitFights.status(world, s);
        const day = world.day || 0;
        const cardObj = PitFights.card(world, s);
        const next = PitRing.nextNight(s, day);
        const master = PitFights.masterOf(world, s);
        html += lede(pit.underground
            ? `${esc(law.why)} The pit fights on all the same, in a cellar behind ${esc(pit.front)}: a smaller crowd, more blood, and the watch may come down the stair.`
            : `${esc(_cap(pit.name))}: a fenced ring of trodden sand by the tavern, run by ${master ? esc(Townsfolk.name(master)) : 'nobody just now'}. ${cardObj ? (cardObj.ran ? 'Tonight\'s bouts are over.' : 'Bouts tonight.') : next ? `The next fight night is ${_when(next.day - day)}, for ${WHY[next.why] || 'the night'}.` : ''}`);
        const ch = pit.champion === 'player' ? 'you' : pit.champion != null ? Townsfolk.get(s.folk, pit.champion) : null;
        html += chips([
            ['🏆', 'Champion', ch === 'you' ? 'you' : ch ? esc(Townsfolk.name(ch)) : 'none'],
            ['⚖️', 'Law', pit.underground ? 'banned' : law.taxed ? 'taxed' : 'open'],
            ['💀', 'Killed', pit.stats.deaths || 0],
            ['📒', 'Book', `${Utils.formatGold(PitFights._masterPurse(world, s))}g`],
            purse(player.gold),
        ]);
        if (cardObj && !cardObj.ran) html += cardHtml(game, s, cardObj);
        else if (cardObj && cardObj.ran) html += resultsHtml(game, s, cardObj);
        // Your bets tonight
        const st = PitFights.state(player);
        const mine = st.bets.filter(b => b.q === s.q && b.r === s.r && b.day === day);
        if (mine.length && cardObj) {
            html += rowList(mine.map(b => ({ icon: '🎲', name: `${Utils.formatGold(b.stake)}g on ${esc(PitFights.sideName(world, s, cardObj.bouts[b.bout], b.side))}`, desc: `Bout ${b.bout + 1}, at ${b.odds} to 1: ${Utils.formatGold(b.stake * b.odds)}g back if it comes in.` })), '🎲 Your bets tonight');
        }
        html += fightersHtml(game, s);
        html += animalsHtml(s);
        const R = st.record;
        if (R.bouts || R.betsWon || R.betsLost) {
            html += chips([['🥊', 'Your bouts', `${R.wins}–${R.losses}${R.kills ? `, ${R.kills} killed` : ''}`], ['🎲', 'Bets', `${R.betsWon} won, ${R.betsLost} lost`], ['💰', 'Net', `${R.won >= 0 ? '+' : ''}${Utils.formatGold(R.won)}g`]]);
        }
        // The ruler of the realm may change its law on blood sports (ui/actionMenu/laws.js)
        const ruled = Laws.ruled(player, world);
        if (ruled && ruled.id === s.kingdom) {
            html += rowList([{ icon: '📜', name: 'The law on blood sports', desc: `Your realm's law: ${pit.underground && law.forbiddenBy === 'realm' ? 'banned' : law.taxed ? 'taxed' : 'open'}. Open the pits, tax them, or drive them underground.`, act: 'pitAct', args: ['law'] }]);
        }
        if (pit.log.length) html += more('What the pit has seen lately', bullets(pit.log.slice(-10).reverse().map(e => `${esc(e.x)} <span style="color:#8f8a7e;">(day ${e.d})</span>`)));
        html += `<div style="${NOTE} margin:6px 0;">The odds are the master's: what the fighters' strength and their records make of them, less his margin. Every coin of the gate, the purses, the bear and the birds goes from purse to purse in town. The clergy frown on all of it.${law.taxed ? ' The crown takes a fifth of the gate.' : ''}</div>`;
        html += '</div>';
        game.ui.showCustomPanel(pit.underground ? '🥊 The Cellar Pit' : '🥊 The Fighting Pit', html);
    },

    /** A bout's book: stake on either side. */
    showPitBet(game, i) {
        const { world, player } = game;
        const s = _town(game);
        const cardObj = s ? PitFights.card(world, s) : null;
        const bout = cardObj && cardObj.bouts[i];
        if (!bout || cardObj.ran) { ActionMenu.showPit(game); return; }
        const book = PitFights.odds(world, s, bout);
        let html = '<div style="font-size:12px;">';
        html += lede(`${_boutName(world, s, bout)}. ${_boutDesc(bout)}`);
        if (PitFights.fixKnown(player, world, s, bout)) html += card('Word is the favourite has been paid to go down.', { icon: '🤫', tone: 'warn' });
        for (const side of ['a', 'b']) {
            const odds = book.odds[side === 'a' ? 0 : 1];
            const max = PitFights.maxStake(world, s, bout, side);
            const rows = PitFights.config().odds.stakes.map(stake => ({
                icon: '🎲', name: `${Utils.formatGold(stake)}g on ${esc(PitFights.sideName(world, s, bout, side))}`,
                desc: `At ${odds} to 1: ${Utils.formatGold(stake * odds)}g back.`,
                side: price(stake, player.gold >= stake), off: player.gold < stake || stake > max,
                why: stake > max ? 'The master won\'t take so much on that side.' : 'You have not the coin.',
                act: 'pitAct', args: ['bet', i, side, stake],
            }));
            html += rowList(rows, `${esc(PitFights.sideName(world, s, bout, side))} · ${odds} to 1`);
        }
        html += rowList([{ icon: '⬅️', name: 'Back to the card', act: 'pitAct', args: ['back'] }]);
        html += '</div>';
        game.ui.showCustomPanel('🎲 The Book', html);
    },

    /** One fighter: sign, train, let go. */
    showPitFighter(game, pid) {
        const { world, player } = game;
        const s = _town(game);
        const f = s ? PitFights.stable(world, s).find(x => x.rec.pid === pid) : null;
        if (!f) { ActionMenu.showPit(game); return; }
        const mineF = f.rec.owner === 'player';
        let html = '<div style="font-size:12px;">';
        html += lede(`${esc(f.name)}, ${f.age}, ${esc(Townsfolk.roleTitle(f.p))} of ${esc(s.name)}: ${esc(PitFights.recordText(f.rec))}${f.champion ? ', the champion' : ''}.`);
        const rows = [];
        if (!mineF) {
            const fee = PitFights.signFee(world, s, f.rec);
            rows.push({ icon: '✍️', name: 'Sign him', desc: `His signing money to his own purse, then ${Utils.formatGold(PitFights.wage(s))}g a week. You take ${Math.round(PitFights.config().sponsor.ownerCut * 100)}% of his purses; if he dies, he is gone.`, side: price(fee, player.gold >= fee), off: player.gold < fee, why: 'You have not the coin.', act: 'pitAct', args: ['sign', pid] });
        } else {
            const T = PitFights.config().training;
            const fee = Math.round(T.fee * (1 + (f.rec.train || 0) * 0.5));
            rows.push({ icon: '🏋️', name: 'Pay for a week of training', desc: `At the posts and the sacks with the town's trainers: training ${f.rec.train || 0}/${T.max}.`, side: price(fee, player.gold >= fee), act: 'pitAct', args: ['train', pid] });
            rows.push({ icon: '👋', name: 'Let him go', desc: 'He fights for the house again.', act: 'pitAct', args: ['release', pid] });
        }
        rows.push({ icon: '⬅️', name: 'Back to the pit', act: 'pitAct', args: ['back'] });
        html += rowList(rows);
        html += '</div>';
        game.ui.showCustomPanel('👊 A Fighter', html);
    },

    /** The panels' buttons. */
    pitAct(game, op, a, b, c) {
        const { world, player } = game;
        const s = _town(game);
        if (!s) return;
        let res = null;
        switch (op) {
            case 'back': ActionMenu.showPit(game); return;
            case 'law': ActionMenu.showLaws(game, 'crown'); return;
            case 'betPanel': ActionMenu.showPitBet(game, a); return;
            case 'fighter': ActionMenu.showPitFighter(game, a); return;
            case 'bet': res = PitFights.bet(player, world, s, a, b, c); break;
            case 'watch': {
                res = PitFights.watch(player, world, s);
                // the pit's crowd roaring at the bouts (ui/soundscape.js)
                if (res.success && !res.already) Soundscape.crowd('pit', { ttl: 20, level: 0.8, cheer: true });
                if (res.success) {
                    const lines = (res.bets || []).map(x => x.text);
                    res.text = res.raid ? res.raid.text : `${res.already ? 'The bouts are over.' : 'You watched the bouts from the rail.'}${lines.length ? ` ${lines.join(' ')}` : ''}`;
                }
                break;
            }
            case 'sign': res = PitFights.sign(player, world, s, a); break;
            case 'train': res = PitFights.train(player, world, s, a); break;
            case 'release': res = PitFights.release(player, world, s, a); break;
            case 'cock': res = PitFights.buyCock(player, world, s); break;
            case 'enterCock': res = PitFights.enterCock(player, world, s, a); break;
            case 'fight': {
                const me = Duels.fromPlayer(player, { mods: PlayerEffects.duelModifiers(player) });
                const setup = PitFights.selfBout(player, world, s, a, me);
                if (!setup.success) { res = setup; break; }
                Soundscape.crowd('pit', { ttl: 90, level: 0.7, cheer: 0.8 });
                DuelPanel.open(game, {
                    ...setup.duel,
                    continueLabel: 'Out of the pit',
                    onFinish: (outcome) => {
                        const r = PitFights.selfSettle(player, world, s, outcome);
                        Soundscape.crowd('pit', { ttl: 12, level: 0.8, cheer: 1.1 });
                        if (game.ui.updateStats) game.ui.updateStats(player, world);
                        if (r.died) {
                            if (game.ui.hideCustomPanel) game.ui.hideCustomPanel();
                            if (typeof game._triggerDeath === 'function') game._triggerDeath(r.cause);
                            return;
                        }
                        ActionMenu.showPit(game, { ok: !!r.won, text: r.text || r.reason });
                    },
                });
                return;
            }
            default: return;
        }
        if (game.ui.updateStats) game.ui.updateStats(player, world);
        ActionMenu.showPit(game, { ok: !!(res && res.success), text: res && res.success ? res.text : (res && res.reason) || 'That cannot be done.' });
    },
});
