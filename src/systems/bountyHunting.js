// ============================================
// BOUNTY HUNTING — Criminal tracking and capture system
// ============================================

import { Utils } from '../core/utils.js';
import { Traits } from './traits.js';
import { Sagas } from './sagas.js';
import { OutlawLairs } from './outlawLairs.js';
import { Ledger } from './ledger.js';
import { Economy } from '../world/economy.js';

/** A hunter who took the notice on a saga beast earns this much over the realm's bounty. */
const SAGA_NOTICE_BONUS = 0.25;

function _num(v) {
    return typeof v === 'number' && isFinite(v) ? v : 0;
}


export const BountyHunting = {
    TARGET_POOL: [
        { baseName: 'Ragpicker Venn', icon: '🗡️', crime: 'serial robberies', profile: 'A nimble cutpurse who vanished into border hamlets.' },
        { baseName: 'Mara Ashveil', icon: '🎭', crime: 'forgery and blackmail', profile: 'A former court scribe selling noble secrets to rivals.' },
        { baseName: 'Tarn Coaleye', icon: '🗡️', crime: 'caravan raids', profile: 'An ex-mercenary leader who now hunts isolated trade routes.' },
        { baseName: 'Jorek Saltfang', icon: '☠️', crime: 'river piracy', profile: 'Known for boarding ferries and vanishing before dawn.' },
        { baseName: 'Sister Hollow', icon: '🕯️', crime: 'grave theft', profile: 'Steals relics from shrines and sells them to collectors.' },
        { baseName: 'Ilya Black Reed', icon: '🏹', crime: 'royal poaching', profile: 'A ghost archer wanted by three hunting lodges.' },
        { baseName: 'Copper Jack', icon: '💰', crime: 'counterfeiting', profile: 'Floods markets with false coin and fake tax seals.' },
        { baseName: 'Dame Briar Voss', icon: '🕶️', crime: 'espionage', profile: 'Runs coded letters between hostile courts and rebels.' },
        { baseName: 'Old Kestrel', icon: '🛶', crime: 'smuggling arms', profile: 'Moves contraband through marsh channels and dry ravines.' },
        { baseName: 'The Hound of Velm', icon: '🐺', crime: 'contract killings', profile: 'A relentless tracker feared by debtors and deserters.' },
    ],

    initialize(player) {
        if (!Array.isArray(player.activeBounties)) player.activeBounties = [];
        if (typeof player.bountiesCompleted !== 'number') player.bountiesCompleted = 0;

        if (!player.bountyHunter) {
            player.bountyHunter = {
                rank: 1,
                capturesTurnedIn: 0,
                capturesRecruited: 0,
                failedCaptures: 0,
                beastsSlain: 0,
                outlawChiefs: 0,
                nextTargetId: 1,
                boardRefreshDay: 0,
                boardSettlementKey: '',
                boardOffers: [],
            };
        }

        const state = player.bountyHunter;
        if (typeof state.rank !== 'number') state.rank = 1;
        if (typeof state.capturesTurnedIn !== 'number') state.capturesTurnedIn = 0;
        if (typeof state.capturesRecruited !== 'number') state.capturesRecruited = 0;
        if (typeof state.failedCaptures !== 'number') state.failedCaptures = 0;
        if (typeof state.beastsSlain !== 'number') state.beastsSlain = 0;
        if (typeof state.outlawChiefs !== 'number') state.outlawChiefs = 0;
        if (typeof state.nextTargetId !== 'number') state.nextTargetId = 1;
        if (typeof state.boardRefreshDay !== 'number') state.boardRefreshDay = 0;
        if (typeof state.boardSettlementKey !== 'string') state.boardSettlementKey = '';
        if (!Array.isArray(state.boardOffers)) state.boardOffers = [];
        // Writs for bounties a broke crown and town could not pay in full (_payLairBounty)
        if (!Array.isArray(state.owed)) state.owed = [];
    },

    /** Hunter ranks: each adds capture skill and a cut of extra pay. */
    RANKS: [
        { rank: 1, title: 'Novice Tracker', icon: '🔰' },
        { rank: 2, title: 'Bounty Hunter', icon: '🎯' },
        { rank: 3, title: 'Seasoned Hunter', icon: '🏹' },
        { rank: 4, title: 'Manhunter', icon: '🐺' },
        { rank: 5, title: 'Legendary Hunter', icon: '⭐' },
    ],

    /** Rank title plus its effects: +1 capture power and +10% pay per rank above the first (max +4 / +40%). */
    getRankInfo(player) {
        this.initialize(player);
        const rank = Math.max(1, player.bountyHunter.rank);
        const def = this.RANKS[Math.min(rank, this.RANKS.length) - 1];
        const steps = Math.min(4, rank - 1);
        const botchPenalty = this.getBotchPenalty(player);
        return { ...def, rank, captureBonus: steps, payBonus: steps * 0.1 - botchPenalty, botchPenalty };
    },

    /**
     * Magistrates hear about botched arrests: every failed capture beyond your
     * successful ones knocks 5% off the pay you can ask (max −25%).
     */
    getBotchPenalty(player) {
        this.initialize(player);
        const s = player.bountyHunter;
        const net = s.failedCaptures - (s.capturesTurnedIn + s.capturesRecruited + s.beastsSlain);
        return Math.min(0.25, Math.max(0, net) * 0.05);
    },

    _key(q, r) {
        return `${q},${r}`;
    },

    _pickPassableTile(world, anchorQ, anchorR, maxRange = 18) {
        let attempts = 0;
        while (attempts < 240) {
            const q = Utils.randInt(Math.max(0, anchorQ - maxRange), Math.min(world.width - 1, anchorQ + maxRange));
            const r = Utils.randInt(Math.max(0, anchorR - maxRange), Math.min(world.height - 1, anchorR + maxRange));
            const tile = world.getTile(q, r);
            attempts++;
            if (!tile || !tile.terrain.passable || tile.settlement) continue;
            return { q, r };
        }
        return { q: anchorQ, r: anchorR };
    },

    _difficultyForPlayer(player) {
        this.initialize(player);
        const state = player.bountyHunter;
        const progress = state.capturesTurnedIn + state.capturesRecruited;
        const tier = Math.floor(progress / 2);
        return Math.min(10, 3 + tier);
    },

    _payForDifficulty(difficulty) {
        const min = 70 + difficulty * 35;
        const max = 140 + difficulty * 55;
        return Utils.randInt(min, max);
    },

    _generateCriminalTarget(player, world, settlementTile) {
        this.initialize(player);
        const state = player.bountyHunter;

        const profile = Utils.randPick(this.TARGET_POOL);
        const difficulty = this._difficultyForPlayer(player) + Utils.randInt(0, 2);
        const location = this._pickPassableTile(world, settlementTile.q, settlementTile.r, 12 + difficulty);
        const pay = this._payForDifficulty(difficulty);

        const id = `bounty_target_${state.nextTargetId++}`;
        const notoriety = difficulty >= 9 ? 'infamous' : difficulty >= 7 ? 'dangerous' : difficulty >= 5 ? 'notorious' : 'wanted';

        return {
            id,
            type: 'criminal_hunt',
            icon: profile.icon,
            name: `Wanted: ${profile.baseName}`,
            targetName: profile.baseName,
            targetBackstory: profile.profile,
            crime: profile.crime,
            notoriety,
            difficulty,
            actualPay: pay,
            daysLimit: Math.max(6, 16 - Math.floor(difficulty * 0.8)),
            daysElapsed: 0,
            fromSettlement: settlementTile.settlement?.name || 'Unknown Settlement',
            fromQ: settlementTile.q,
            fromR: settlementTile.r,
            targetQ: location.q,
            targetR: location.r,
            lastKnownQ: location.q,
            lastKnownR: location.r,
            status: 'active',
            canRecruit: true,
            recruitedUnit: {
                name: profile.baseName,
                icon: profile.icon,
                strength: 8 + difficulty * 2,
                upkeep: 6 + Math.floor(difficulty / 2),
            },
            description: `${profile.baseName} is wanted for ${profile.crime}. Last seen near (${location.q}, ${location.r}).`,
        };
    },

    generateBoardOffers(player, world, tile, existingOffers = []) {
        this.initialize(player);
        const state = player.bountyHunter;
        const day = world.day || 1;
        const settlementKey = this._key(tile.q, tile.r);

        // Saga beasts roaming nearby are cried on every board (systems/sagas.js);
        // they are never cached, so a slain or departed beast drops off at once
        const beasts = this.sagaOffers(player, world, tile);
        // Outlaw chiefs of the lairs near this town (systems/outlawLairs.js), never cached either
        beasts.push(...this.lairOffers(player, world, tile));

        const mustRefresh = state.boardSettlementKey !== settlementKey || day >= state.boardRefreshDay;
        if (!mustRefresh && state.boardOffers.length > 0) {
            return [...beasts, ...state.boardOffers, ...existingOffers];
        }

        const targetCount = 1 + (Utils.random() < 0.4 ? 1 : 0);
        const generated = [];
        for (let i = 0; i < targetCount; i++) {
            generated.push(this._generateCriminalTarget(player, world, tile));
        }

        state.boardSettlementKey = settlementKey;
        state.boardRefreshDay = day + 2;
        state.boardOffers = generated;

        return [...beasts, ...generated, ...existingOffers];
    },

    /** Posted saga beasts near this board that the player has not already taken. */
    sagaOffers(player, world, tile) {
        const taken = new Set((player.activeBounties || []).map(b => b && b.id));
        return Sagas.bountyOffers(player, world, tile).filter(o => !taken.has(o.id));
    },

    /** Posted outlaw chiefs near this board that the player has not already taken. */
    lairOffers(player, world, tile) {
        const taken = new Set((player.activeBounties || []).map(b => b && b.id));
        return OutlawLairs.bountyOffers(player, world, tile).filter(o => !taken.has(o.id));
    },

    getBountyTargetAtPlayer(player) {
        this.initialize(player);
        return (player.activeBounties || []).find(b =>
            b.type === 'criminal_hunt' &&
            b.status === 'active' &&
            b.targetQ === player.q &&
            b.targetR === player.r
        ) || null;
    },

    attemptCapture(player, bounty, world = null) {
        this.initialize(player);
        if (!bounty || bounty.type !== 'criminal_hunt') return { success: false, reason: 'Invalid bounty target.' };
        if (bounty.status !== 'active') return { success: false, reason: 'This target is no longer active.' };

        const combat = player.skills?.combat || 1;
        const stealth = player.skills?.stealth || 1;
        const leadership = player.skills?.leadership || 1;
        const armyPower = Math.min(4, Math.floor(((player.army || []).length || 0) / 4));

        const rankBonus = this.getRankInfo(player).captureBonus;
        const playerPower = combat + Math.floor(stealth * 0.6) + Math.floor(leadership * 0.4) + armyPower + rankBonus + Utils.randInt(1, 6);
        // A quarry that has slipped you before is warier (+1 per escape, max +3)
        const wariness = Math.min(3, bounty.escapes || 0);
        const targetPower = bounty.difficulty + wariness + Utils.randInt(2, 8);

        if (playerPower >= targetPower) {
            bounty.status = 'captured_pending_decision';
            return { success: true, bounty };
        }

        bounty.lastKnownQ = bounty.targetQ;
        bounty.lastKnownR = bounty.targetR;
        const stepQ = Utils.randInt(-2, 2);
        const stepR = Utils.randInt(-2, 2);
        const maxQ = world ? Math.max(0, world.width - 1) : Math.max(0, bounty.targetQ + 2);
        const maxR = world ? Math.max(0, world.height - 1) : Math.max(0, bounty.targetR + 2);
        bounty.targetQ = Math.max(0, Math.min(maxQ, bounty.targetQ + stepQ));
        bounty.targetR = Math.max(0, Math.min(maxR, bounty.targetR + stepR));

        player.bountyHunter.failedCaptures += 1;
        bounty.escapes = (bounty.escapes || 0) + 1;
        const penalty = this.getBotchPenalty(player);
        const repNote = penalty > 0 ? ` Word of the botched arrest spreads — magistrates now pay you ${Math.round(penalty * 100)}% less.` : '';
        return {
            success: false,
            escaped: true,
            botchPenalty: penalty,
            reason: `${bounty.targetName} slipped away during the arrest attempt and fled toward (${bounty.targetQ}, ${bounty.targetR}).${repNote}`,
            bounty,
        };
    },

    resolveCapturedTarget(player, bounty, choice, world = null) {
        this.initialize(player);
        if (!bounty || bounty.type !== 'criminal_hunt') return { success: false, reason: 'Invalid bounty.' };
        if (bounty.status !== 'captured_pending_decision') return { success: false, reason: 'Target is not awaiting judgment.' };

        const state = player.bountyHunter;

        if (choice === 'turn_in') {
            // Magistrates pay a renowned hunter's asking price
            const due = Math.round(bounty.actualPay * (1 + this.getRankInfo(player).payBonus));
            // Real coin: the realm of the town that posted the notice pays, then the town's
            // purse; what neither has is a writ on the crown (owe), as for an outlaw chief
            let pay = due;
            let writ = null;
            if (world) {
                const tile = bounty.fromQ != null && typeof world.getTile === 'function' ? world.getTile(bounty.fromQ, bounty.fromR) : null;
                const kid = bounty.kingdomId != null ? bounty.kingdomId : tile && tile.settlement ? tile.settlement.kingdom : null;
                const payer = { ...bounty, kingdomId: kid != null ? kid : null };
                pay = Math.floor(this._payLairBounty(world, payer, due));
                if (due > pay) writ = this.owe(player, world, payer, due - pay);
            }
            player.gold = (player.gold || 0) + pay;
            if (pay > 0) Ledger.record(player, 'bounties', pay);
            player.renown = (player.renown || 0) + Math.max(3, Math.floor(bounty.difficulty / 2));
            state.capturesTurnedIn += 1;
            Traits.recordDeeds(player, { mercy: 2, honesty: 1 }); // taken alive to face justice
            // A jailer's warrant (systems/titles.js): the duty is done, and the office's perks
            const warrant = bounty.jailerWarrant;
            if (warrant) {
                if (player.currentTitle === 'jailer') {
                    if (!player.titleProgress) player.titleProgress = {};
                    player.titleProgress.capturesMade = (player.titleProgress.capturesMade || 0) + 1;
                }
                player.karma = (player.karma || 0) + (warrant.karma || 0);
                player.renown = (player.renown || 0) + (warrant.renown || 0);
            }
            player.bountiesCompleted = (player.bountiesCompleted || 0) + 1;
            bounty.status = 'completed';
            this._removeBounty(player, bounty.id);
            const promoted = this._recalculateRank(player);
            return { success: true, turnedIn: true, pay, owed: writ ? writ.amount : 0, bounty, promoted };
        }

        if (choice === 'recruit') {
            if (!Array.isArray(player.army)) player.army = [];

            player.army.push({
                type: `bounty_${bounty.id}`,
                name: bounty.recruitedUnit.name,
                icon: bounty.recruitedUnit.icon,
                strength: bounty.recruitedUnit.strength,
                upkeep: bounty.recruitedUnit.upkeep,
                experience: 18 + bounty.difficulty * 3,
                level: 1,
                bountyRecruit: true,
                backstory: bounty.targetBackstory,
            });

            player.karma = (player.karma || 0) - Math.max(1, Math.floor(bounty.difficulty / 4));
            player.renown = (player.renown || 0) + 2;
            state.capturesRecruited += 1;
            Traits.recordDeeds(player, { cunning: 2, deceit: 1 }); // the bounty never reaches the magistrate
            // A jailer who enlists the crown's own fugitive betrays the office: no duty credit
            if (bounty.jailerWarrant) {
                player.karma -= bounty.jailerWarrant.recruitKarma || 3;
                Traits.recordDeeds(player, { deceit: 1 });
            }
            player.bountiesCompleted = (player.bountiesCompleted || 0) + 1;
            bounty.status = 'completed';
            this._removeBounty(player, bounty.id);
            const promoted = this._recalculateRank(player);
            return { success: true, recruited: true, bounty, promoted };
        }

        return { success: false, reason: 'Invalid resolution choice.' };
    },

    _removeBounty(player, bountyId) {
        player.activeBounties = (player.activeBounties || []).filter(entry => entry.id !== bountyId);
    },

    _recalculateRank(player) {
        const state = player.bountyHunter;
        const total = state.capturesTurnedIn + state.capturesRecruited + (state.beastsSlain || 0) + (state.outlawChiefs || 0);
        const before = state.rank;
        state.rank = 1 + Math.floor(total / 3);
        return state.rank > before ? this.getRankInfo(player) : null;
    },

    /**
     * The coin for an outlaw chief's head comes from the realm that posted it
     * (its treasury), then the town whose board carried the notice — the
     * notice says "{realm} pay". → coin drawn; what neither has is not made
     * from nothing: the caller writes the rest as a writ on the crown (owe()).
     */
    _payLairBounty(world, bounty, pay) {
        if (!world || !(pay > 0)) return 0;
        let got = 0;
        const k = bounty.kingdomId != null ? (world.kingdoms || []).find(x => x && x.id === bounty.kingdomId && x.isAlive !== false) : null;
        if (k && _num(k.treasury) > 0) {
            const t = Math.min(Math.floor(_num(k.treasury)), pay);
            k.treasury = _num(k.treasury) - t;
            got += t;
        }
        if (got < pay && bounty.fromQ != null && typeof world.getTile === 'function') {
            const tile = world.getTile(bounty.fromQ, bounty.fromR);
            const s = tile && tile.settlement;
            const have = s && s.economy && Number.isFinite(s.economy.gold) ? Math.floor(Math.max(0, s.economy.gold)) : pay - got;
            if (s) got += _num(Economy.drawTown(s, Math.min(pay - got, have)));
        }
        return got;
    },

    /** Days a writ for an unpaid bounty stands before the crown forgets it. */
    WRIT_DAYS: 360,

    /** The crown's writ for the part of a bounty it could not pay: collected as its chests fill. */
    owe(player, world, bounty, amount) {
        const n = Math.round(_num(amount));
        if (!player || !(n > 0)) return null;
        this.initialize(player);
        const day = _num(world && world.day);
        const k = bounty.kingdomId != null && world ? (world.kingdoms || []).find(x => x && x.id === bounty.kingdomId) : null;
        const writ = {
            id: `writ_${bounty.id || day}_${player.bountyHunter.owed.length}`, kingdomId: bounty.kingdomId != null ? bounty.kingdomId : null,
            realm: k ? k.name : null, fromQ: bounty.fromQ != null ? bounty.fromQ : null, fromR: bounty.fromR != null ? bounty.fromR : null,
            target: bounty.targetName || 'an outlaw chief', amount: n, paid: 0, day, until: day + this.WRIT_DAYS,
        };
        player.bountyHunter.owed.push(writ);
        return writ;
    },

    /** What the crowns still owe you on bounty writs (for the board). */
    owedTotal(player) {
        const st = player && player.bountyHunter;
        return st && Array.isArray(st.owed) ? st.owed.reduce((t, w) => t + Math.max(0, _num(w.amount) - _num(w.paid)), 0) : 0;
    },

    /** Daily: each writ draws what it can from its crown and town; paid off, or lapsed with its realm or its year. */
    _settleWrits(player, world, updates) {
        const st = player.bountyHunter;
        if (!st || !Array.isArray(st.owed) || !st.owed.length || !world) return;
        const day = _num(world.day);
        for (const w of st.owed.slice()) {
            const due = Math.max(0, _num(w.amount) - _num(w.paid));
            const k = w.kingdomId != null ? (world.kingdoms || []).find(x => x && x.id === w.kingdomId) : null;
            const got = due > 0 ? Math.floor(this._payLairBounty(world, w, due)) : 0;
            if (got > 0) {
                w.paid = _num(w.paid) + got;
                player.gold = (player.gold || 0) + got;
                Ledger.record(player, 'bounties', got);
            }
            const left = Math.max(0, _num(w.amount) - _num(w.paid));
            if (left <= 0) {
                st.owed = st.owed.filter(x => x !== w);
                updates.chiefs.push({ outcome: 'writPaid', targetName: w.target, pay: got, realm: w.realm });
            } else if (day > _num(w.until) || (w.kingdomId != null && (!k || k.isAlive === false))) {
                st.owed = st.owed.filter(x => x !== w);
                updates.chiefs.push({ outcome: 'writLapsed', targetName: w.target, pay: got, left, realm: w.realm });
            } else if (got > 0) {
                updates.chiefs.push({ outcome: 'writPart', targetName: w.target, pay: got, left, realm: w.realm });
            }
        }
    },

    processDaily(player, world) {
        this.initialize(player);
        const updates = { escaped: [], moved: [], escalated: [], beasts: [], chiefs: [] };

        // Outlaw chiefs on the hunter's list (systems/outlawLairs.js): the notice
        // shows the lair; the realm pays when the player killed the chief —
        // storming the lair or striking alone — and lapses otherwise
        for (const bounty of (player.activeBounties || []).slice()) {
            if (bounty.type !== 'lair_leader' || bounty.status !== 'active') continue;
            OutlawLairs.reveal(player, bounty.lairId);
            const fate = OutlawLairs.bountyStatus(player, bounty);
            if (fate === 'slain') {
                const due = Math.round(_num(bounty.actualPay) * (1 + Math.max(0, this.getRankInfo(player).payBonus)));
                // Paid from the crown's chests and the town's purse; what they lack, a writ on the crown
                const pay = Math.floor(this._payLairBounty(world, bounty, due));
                if (pay > 0) {
                    player.gold = (player.gold || 0) + pay;
                    Ledger.record(player, 'bounties', pay);
                }
                const writ = due > pay ? this.owe(player, world, bounty, due - pay) : null;
                player.renown = (player.renown || 0) + 3;
                player.bountyHunter.outlawChiefs += 1;
                player.bountiesCompleted = (player.bountiesCompleted || 0) + 1;
                bounty.status = 'completed';
                this._removeBounty(player, bounty.id);
                const promoted = this._recalculateRank(player);
                updates.chiefs.push({ bountyId: bounty.id, targetName: bounty.targetName, outcome: 'slain', pay, owed: writ ? writ.amount : 0, realm: writ ? writ.realm : null, promoted });
            } else if (fate === 'gone') {
                bounty.status = 'lapsed';
                this._removeBounty(player, bounty.id);
                updates.chiefs.push({ bountyId: bounty.id, targetName: bounty.targetName, outcome: 'gone' });
            }
        }

        this._settleWrits(player, world, updates);

        // Saga beasts on the hunter's list: follow the beast's trail; when it
        // falls to the player, the notice pays its bonus (the realm's own
        // bounty is paid by Sagas); if it escapes the story, the notice lapses
        for (const bounty of (player.activeBounties || []).slice()) {
            if (bounty.type !== 'saga_beast' || bounty.status !== 'active') continue;
            const found = Sagas.unitRecord(player, bounty.sagaKey);
            const rec = found && found.rec;
            if (rec && rec.slain) {
                const want = Math.round(_num(bounty.actualPay) * (SAGA_NOTICE_BONUS + Math.max(0, this.getRankInfo(player).payBonus)));
                // (the notice's bonus is the posting town's and its realm's coin, as far as they have it)
                const bonus = Math.floor(this._payLairBounty(world, bounty, want));
                player.gold = (player.gold || 0) + bonus;
                if (bonus > 0) Ledger.record(player, 'bounties', bonus);
                player.bountyHunter.beastsSlain += 1;
                player.bountiesCompleted = (player.bountiesCompleted || 0) + 1;
                bounty.status = 'completed';
                this._removeBounty(player, bounty.id);
                const promoted = this._recalculateRank(player);
                updates.beasts.push({ bountyId: bounty.id, targetName: bounty.targetName, outcome: 'slain', bonus, promoted });
            } else if (!rec || rec.gone) {
                bounty.status = 'lapsed';
                this._removeBounty(player, bounty.id);
                updates.beasts.push({ bountyId: bounty.id, targetName: bounty.targetName, outcome: 'gone' });
            } else if (rec.q !== bounty.targetQ || rec.r !== bounty.targetR) {
                bounty.lastKnownQ = bounty.targetQ;
                bounty.lastKnownR = bounty.targetR;
                bounty.targetQ = rec.q;
                bounty.targetR = rec.r;
            }
        }

        for (const bounty of player.activeBounties || []) {
            if (bounty.type !== 'criminal_hunt' || bounty.status !== 'active') continue;

            if (Utils.random() < 0.55) {
                const oldQ = bounty.targetQ;
                const oldR = bounty.targetR;
                const deltaQ = Utils.randInt(-1, 1);
                const deltaR = Utils.randInt(-1, 1);
                const newQ = Math.max(0, Math.min(world.width - 1, oldQ + deltaQ));
                const newR = Math.max(0, Math.min(world.height - 1, oldR + deltaR));
                const targetTile = world.getTile(newQ, newR);

                if (targetTile && targetTile.terrain.passable) {
                    bounty.lastKnownQ = oldQ;
                    bounty.lastKnownR = oldR;
                    bounty.targetQ = newQ;
                    bounty.targetR = newR;
                    updates.moved.push({ bountyId: bounty.id, targetName: bounty.targetName, q: newQ, r: newR });
                }
            }

            if ((bounty.daysElapsed || 0) > Math.floor((bounty.daysLimit || 10) * 0.6) && !bounty.escalated) {
                bounty.escalated = true;
                bounty.difficulty = Math.min(10, (bounty.difficulty || 5) + 1);
                bounty.actualPay += Utils.randInt(30, 90);
                bounty.notoriety = bounty.difficulty >= 8 ? 'infamous' : 'dangerous';
                updates.escalated.push({ bountyId: bounty.id, targetName: bounty.targetName, difficulty: bounty.difficulty });
            }
        }

        return updates;
    },
};
