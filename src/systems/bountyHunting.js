// ============================================
// BOUNTY HUNTING — Criminal tracking and capture system
// ============================================

import { Utils } from '../core/utils.js';


export const BountyHunting = {
    TARGET_POOL: [
        { baseName: 'Ragpicker Venn', icon: '🗡️', crime: 'serial robberies', profile: 'A nimble cutpurse who vanished into border hamlets.' },
        { baseName: 'Mara Ashveil', icon: '🎭', crime: 'forgery and blackmail', profile: 'A former court scribe selling noble secrets to rivals.' },
        { baseName: 'Tarn Coaleye', icon: '🪓', crime: 'caravan raids', profile: 'An ex-mercenary leader who now hunts isolated trade routes.' },
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
        if (typeof state.nextTargetId !== 'number') state.nextTargetId = 1;
        if (typeof state.boardRefreshDay !== 'number') state.boardRefreshDay = 0;
        if (typeof state.boardSettlementKey !== 'string') state.boardSettlementKey = '';
        if (!Array.isArray(state.boardOffers)) state.boardOffers = [];
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

        const mustRefresh = state.boardSettlementKey !== settlementKey || day >= state.boardRefreshDay;
        if (!mustRefresh && state.boardOffers.length > 0) {
            return [...state.boardOffers, ...existingOffers];
        }

        const targetCount = 1 + (Math.random() < 0.4 ? 1 : 0);
        const generated = [];
        for (let i = 0; i < targetCount; i++) {
            generated.push(this._generateCriminalTarget(player, world, tile));
        }

        state.boardSettlementKey = settlementKey;
        state.boardRefreshDay = day + 2;
        state.boardOffers = generated;

        return [...generated, ...existingOffers];
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

        const playerPower = combat + Math.floor(stealth * 0.6) + Math.floor(leadership * 0.4) + armyPower + Utils.randInt(1, 6);
        const targetPower = bounty.difficulty + Utils.randInt(2, 8);

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
        return {
            success: false,
            escaped: true,
            reason: `${bounty.targetName} slipped away during the arrest attempt and fled toward (${bounty.targetQ}, ${bounty.targetR}).`,
            bounty,
        };
    },

    resolveCapturedTarget(player, bounty, choice) {
        this.initialize(player);
        if (!bounty || bounty.type !== 'criminal_hunt') return { success: false, reason: 'Invalid bounty.' };
        if (bounty.status !== 'captured_pending_decision') return { success: false, reason: 'Target is not awaiting judgment.' };

        const state = player.bountyHunter;

        if (choice === 'turn_in') {
            player.gold += bounty.actualPay;
            player.renown = (player.renown || 0) + Math.max(3, Math.floor(bounty.difficulty / 2));
            state.capturesTurnedIn += 1;
            player.bountiesCompleted = (player.bountiesCompleted || 0) + 1;
            bounty.status = 'completed';
            this._removeBounty(player, bounty.id);
            this._recalculateRank(player);
            return { success: true, turnedIn: true, pay: bounty.actualPay, bounty };
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
            player.bountiesCompleted = (player.bountiesCompleted || 0) + 1;
            bounty.status = 'completed';
            this._removeBounty(player, bounty.id);
            this._recalculateRank(player);
            return { success: true, recruited: true, bounty };
        }

        return { success: false, reason: 'Invalid resolution choice.' };
    },

    _removeBounty(player, bountyId) {
        player.activeBounties = (player.activeBounties || []).filter(entry => entry.id !== bountyId);
    },

    _recalculateRank(player) {
        const state = player.bountyHunter;
        const total = state.capturesTurnedIn + state.capturesRecruited;
        state.rank = 1 + Math.floor(total / 3);
    },

    processDaily(player, world) {
        this.initialize(player);
        const updates = { escaped: [], moved: [], escalated: [] };

        for (const bounty of player.activeBounties || []) {
            if (bounty.type !== 'criminal_hunt' || bounty.status !== 'active') continue;

            if (Math.random() < 0.55) {
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
