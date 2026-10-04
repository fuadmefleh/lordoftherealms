// PlayerEconomy — auctions members.
import { PlayerEconomy } from './_ref.js';
import { Trading } from './trading.js';
import { Utils, Hex, WorldUnit, MarketDynamics, Quests, Technology, Infrastructure, PlayerInventory } from './_imports.js';

Object.assign(PlayerEconomy, {
    _generateAuctionLot(player, world) {
        const types = ['rare_item', 'artifact', 'land'];
        const type = Utils.randPick(types);
        const rarityRoll = Utils.random();
        const rarity = rarityRoll > 0.92 ? 'legendary' : rarityRoll > 0.68 ? 'epic' : 'rare';
        const rarityMult = rarity === 'legendary' ? 2.2 : rarity === 'epic' ? 1.55 : 1.0;

        let title = '';
        let description = '';
        let reward = {};
        let basePrice = Math.floor((160 + (world.day || 1) * 3 + Utils.random() * 120) * rarityMult);

        if (type === 'rare_item') {
            const goodsPool = ['gems', 'luxuries', 'weapons', 'tools', 'spices', 'liquor'];
            const goodId = Utils.randPick(goodsPool);
            const good = Object.values(PlayerEconomy.GOODS).find(g => g.id === goodId);
            const amount = rarity === 'legendary' ? 6 : rarity === 'epic' ? 4 : 3;
            title = `${good ? good.icon : '📦'} Crate of ${good ? good.name : goodId}`;
            description = `Contraband and import stock sold by anonymous brokers.`;
            reward = { kind: 'item', goodId, amount, label: `${amount} ${good ? good.name : goodId}` };
        } else if (type === 'artifact') {
            const artifacts = ['Sun Idol', 'Royal Signet', 'Sage Astrolabe', 'Banner of Conquest', 'Sainted Reliquary'];
            const skillPool = ['commerce', 'diplomacy', 'leadership', 'stealth'];
            const skill = Utils.randPick(skillPool);
            const renown = rarity === 'legendary' ? 30 : rarity === 'epic' ? 20 : 12;
            const skillBonus = rarity === 'legendary' ? 2 : 1;
            title = `🗿 ${Utils.randPick(artifacts)}`;
            description = `A priceless relic sought by nobles, guilds, and collectors.`;
            reward = { kind: 'artifact', skill, skillBonus, renown, label: `+${renown} renown, +${skillBonus} ${skill}` };
            basePrice = Math.floor(basePrice * 1.3);
        } else {
            const estates = ['Riverside Estate', 'Border Ranch', 'Oakfield Holdings', 'Old Port Warehouse', 'Vineyard Rights'];
            title = `🏞️ ${Utils.randPick(estates)}`;
            description = `Land rights with tax and rent privileges.`;
            const taxBonus = rarity === 'legendary' ? 0.15 : rarity === 'epic' ? 0.1 : 0.06;
            reward = { kind: 'land', taxBonus, renown: 8, label: `+${Math.round(taxBonus * 100)}% tax output` };
            basePrice = Math.floor(basePrice * 1.15);
        }

        return {
            id: `AUC-${player.auctions.nextId++}`,
            type,
            rarity,
            title,
            description,
            reward,
            basePrice,
            currentBid: Math.floor(basePrice * 0.9),
            minIncrement: Math.max(20, Math.floor(basePrice * 0.07)),
            topBidder: 'ai',
            endsOnDay: (world.day || 1) + Utils.randInt(4, 7),
        };
    },

    _applyAuctionReward(player, world, lot) {
        if (!lot || !lot.reward) return;
        const reward = lot.reward;

        if (reward.kind === 'item') {
            // No room for a new kind of good: the auction house refunds the winning bid
            const res = PlayerInventory.addItem(player, reward.goodId, reward.amount);
            if (!res.success) {
                player.gold = (player.gold || 0) + (lot.currentBid || 0);
                lot.refunded = true;
                lot.refundReason = res.reason;
                return;
            }
        } else if (reward.kind === 'artifact') {
            player.renown = (player.renown || 0) + (reward.renown || 0);
            if (!player.skills) player.skills = {};
            const current = player.skills[reward.skill] || 1;
            player.skills[reward.skill] = Math.min(10, current + (reward.skillBonus || 1));
        } else if (reward.kind === 'land') {
            player.renown = (player.renown || 0) + (reward.renown || 0);
            player.landTaxBonus = (player.landTaxBonus || 0) + (reward.taxBonus || 0);
        }

        player.auctions.won.push({
            day: world ? world.day : null,
            title: lot.title,
            rarity: lot.rarity,
            reward: reward.label,
            price: lot.currentBid,
        });
    },

    ensureAuctionListings(player, world) {
        PlayerEconomy.ensureEconomyState(player);
        if ((player.auctions.active || []).length > 0) return;
        if ((world.day || 1) < (player.auctions.nextRefreshDay || 1)) return;

        player.auctions.active = [];
        for (let i = 0; i < 3; i++) {
            player.auctions.active.push(PlayerEconomy._generateAuctionLot(player, world));
        }
        player.auctions.nextRefreshDay = (world.day || 1) + 8;
    },

    placeAuctionBid(player, auctionId, world) {
        PlayerEconomy.ensureEconomyState(player);
        const lot = (player.auctions.active || []).find(a => a.id === auctionId);
        if (!lot) return { success: false, reason: 'Auction lot not found' };

        const nextBid = lot.currentBid + lot.minIncrement;
        if (player.gold < nextBid) return { success: false, reason: `Need ${nextBid} gold` };

        player.gold -= nextBid;

        if (lot.topBidder === 'player' && lot.playerStake) {
            player.gold += lot.playerStake;
        }

        lot.playerStake = nextBid;
        lot.currentBid = nextBid;
        lot.topBidder = 'player';
        lot.lastBidDay = world.day || 1;

        return { success: true, lot, bid: nextBid };
    },

    _processAuctions(player, world) {
        PlayerEconomy.ensureEconomyState(player);
        const events = [];

        if ((player.auctions.lastProcessedDay || 0) === (world.day || 1)) {
            return events;
        }

        PlayerEconomy.ensureAuctionListings(player, world);

        for (const lot of player.auctions.active) {
            if (lot.topBidder === 'player') {
                const pressureChance = 0.28 + (lot.rarity === 'legendary' ? 0.18 : lot.rarity === 'epic' ? 0.1 : 0.04);
                if (Utils.random() < pressureChance) {
                    const increment = lot.minIncrement + Utils.randInt(0, Math.floor(lot.minIncrement * 0.5));
                    lot.currentBid += increment;
                    lot.topBidder = 'ai';
                    if (lot.playerStake) {
                        player.gold += lot.playerStake;
                        lot.playerStake = 0;
                    }
                }
            } else if (Utils.random() < 0.2) {
                lot.currentBid += Utils.randInt(Math.floor(lot.minIncrement * 0.4), lot.minIncrement);
            }
        }

        for (let i = player.auctions.active.length - 1; i >= 0; i--) {
            const lot = player.auctions.active[i];
            if ((world.day || 1) < lot.endsOnDay) continue;

            if (lot.topBidder === 'player') {
                PlayerEconomy._applyAuctionReward(player, world, lot);
                events.push(lot.refunded ? {
                    eventType: 'auction',
                    title: 'Auction Refunded',
                    message: `You won ${lot.title}, but had no room to carry it — your ${lot.currentBid}g was refunded. ${lot.refundReason}`,
                    severity: 'warning',
                } : {
                    eventType: 'auction',
                    title: 'Auction Won!',
                    message: `${lot.title} secured for ${lot.currentBid}g. Reward: ${lot.reward.label}`,
                    severity: 'success',
                });
            } else {
                events.push({
                    eventType: 'auction',
                    title: 'Auction Lost',
                    message: `${lot.title} sold to another bidder.`,
                    severity: 'default',
                });
            }

            player.auctions.active.splice(i, 1);
        }

        player.auctions.lastProcessedDay = world.day || 1;

        return events;
    },
});
