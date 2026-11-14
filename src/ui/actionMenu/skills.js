// ActionMenu — skills methods (split from the original monolith).
import { ActionMenu } from './_ref.js';
import { panelClosed, lede, chips, sectionHead, rowList, BTN_GOLD, BTN_PLAIN, BTN_DARK, BTN_OFF } from './uiKit.js';
import { Underworld } from '../../systems/underworld.js';
import { Ailments } from '../../systems/ailments.js';
import { Duels } from '../../systems/duels.js';
import { PlayerEffects } from '../../player/playerEffects.js';
import { DuelPanel } from './duel.js';
import { DevotionPanel } from './devotion.js';
import { WildTaskRunner } from '../mapTasks/wildTasks.js';
import { FoodSkills } from '../../systems/foodSkills.js';
import { PracticeSkills } from '../../systems/practiceSkills.js';
import { PerformTasks } from '../mapTasks/performTasks.js';
import { SocialSkills } from '../../systems/socialSkills.js';
import { Gangs } from '../../systems/gangs.js';
import { Ledger } from '../../systems/ledger.js';
import { StandingOrders } from '../../player/standingOrders.js';
import { PlayerActions, PlayerEconomy, Trading, PlayerMilitary, Hex, Utils, Banking, MarketDynamics, Taxation, Technology, Titles, Quests, Terrain, Kingdom, NPCLords, Peoples, LegendaryArtifacts, BountyHunting, Religion, Espionage, Infrastructure, Tavern, Ships, Housing, Cartography, Colonization, Relationships, Councils, SaveLoad, Economy, DataLoader, PlayerInventory } from './_imports.js';

/** A result panel's head: a big icon over a title in its colour (the action menu's result voice). */
function _resultHead(icon, color, title) {
    return `<div style="text-align: center;"><div style="font-size: 44px; margin: 10px 0 6px;">${icon}</div>`
        + `<div style="font-family: var(--font-display); font-size: 17px; color: ${color}; font-weight: bold; margin-bottom: 8px;">${title}</div></div>`;
}

/** The full-width Continue at the foot of a result panel; attrs route the click. */
function _continueBtn(attrs, label = 'Continue') {
    return `<button ${attrs} style="${BTN_GOLD} display: block; width: 100%; margin: 12px 0 0; padding: 9px; font-family: var(--font-display); font-size: 14px; letter-spacing: 1px;">${label}</button>`;
}

/** A quiet meter: a label (and its value) over a thin bar. */
function _meter(label, pct, color, value = '') {
    return `<div style="flex: 1;">
        <div style="display: flex; justify-content: space-between; font-size: 10px; color: #9d937c; margin-bottom: 2px;"><span>${label}</span>${value ? `<span style="color: ${color}; font-weight: 600;">${value}</span>` : ''}</div>
        <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(245,197,66,0.12); border-radius: 4px; height: 10px; overflow: hidden;">
            <div style="width: ${pct}%; height: 100%; background: ${color}; border-radius: 3px; transition: width 0.3s;"></div>
        </div>
    </div>`;
}

Object.assign(ActionMenu, {
    /**
     * Pickpocket — choose a mark from the crowd, then lift the purse in
     * person on the street (ui/mapTasks/wildTasks.js): get beside them and
     * hold still while they aren't looking; when they turn round, be out of
     * their notice. The quick path is the old plain stealth roll.
     */
    doPickpocket(game, tile) {
        const player = game.player;
        const settlement = tile.settlement;
        if (!settlement) return;

        // Stealth's level and its purse-lifting edge (systems/socialSkills.js; 6% a level)
        const stealthSkill = SocialSkills.has('stealth') ? SocialSkills.level(player, 'stealth') : (player.skills?.stealth || 1);
        const liftEdge = SocialSkills.has('stealth') ? SocialSkills.frac(player, 'stealth', 'lift') : stealthSkill * 0.06;
        const luckStat = player.luck || 5;
        const tier = settlement.type === 'capital' ? 'capital' : (settlement.type === 'town' || settlement.type === 'city' ? 'town' : 'village');

        // ── Target generation ──
        const targetPool = [
            { type: 'peasant',    icon: '👨‍🌾', name: 'Farmer',         gold: [3, 12],   awareness: 0.2, tier: ['village','town','capital'] },
            { type: 'merchant',   icon: '👨‍💼', name: 'Merchant',       gold: [10, 35],  awareness: 0.45, tier: ['town','capital'] },
            { type: 'noble',      icon: '🤴',  name: 'Minor Noble',    gold: [25, 60],  awareness: 0.6,  tier: ['town','capital'] },
            { type: 'drunk',      icon: '🍺',  name: 'Drunkard',       gold: [2, 10],   awareness: 0.1,  tier: ['village','town','capital'] },
            { type: 'traveler',   icon: '🧳',  name: 'Traveler',       gold: [8, 25],   awareness: 0.35, tier: ['village','town','capital'] },
            { type: 'guard',      icon: '💂',  name: 'Off-Duty Guard', gold: [15, 30],  awareness: 0.7,  tier: ['town','capital'] },
            { type: 'priest',     icon: '⛪',  name: 'Priest',         gold: [5, 20],   awareness: 0.25, tier: ['village','town','capital'] },
            { type: 'aristocrat', icon: '👸',  name: 'Aristocrat',     gold: [40, 80],  awareness: 0.75, tier: ['capital'] },
        ];

        const available = targetPool.filter(t => t.tier.includes(tier));
        const targets = [];
        const copy = [...available];
        for (let i = 0; i < Math.min(3, copy.length); i++) {
            const idx = Math.floor(Math.random() * copy.length);
            const t = copy.splice(idx, 1)[0];
            const goldAmount = t.gold[0] + Math.floor(Math.random() * (t.gold[1] - t.gold[0] + 1));
            const diff = t.awareness < 0.3 ? 'Easy' : t.awareness < 0.5 ? 'Medium' : t.awareness < 0.7 ? 'Hard' : 'Risky';
            const diffColor = t.awareness < 0.3 ? '#8fd18a' : t.awareness < 0.5 ? '#f0b35a' : t.awareness < 0.7 ? '#e8a060' : '#e0846a';
            targets.push({ ...t, goldAmount, diff, diffColor });
        }

        // The action menu's voice (ui/actionMenu/uiKit.js): chips for the thief, one row a mark
        let html = '<div style="max-width: 520px;">';
        html += lede(`Work the crowd in ${settlement.name} (${tier}). The richer the mark, the sharper their eyes.`);
        html += chips([['🕵️', 'Stealth', stealthSkill], ['🍀', 'Luck', luckStat]]);
        html += rowList(targets.map((t, i) => ({
            icon: t.icon,
            name: t.name,
            desc: t.awareness < 0.3 ? 'Dozy — rarely looks round' : t.awareness < 0.5 ? 'Glances about now and then' : t.awareness < 0.7 ? 'Watchful' : 'Sharp-eyed and quick to turn',
            attrs: `onclick="window._ppSelectTarget(${i})"`,
            side: `<div style="color: ${t.diffColor}; font-weight: 700;">${t.diff}</div><div style="font-size: 10px; color: #9d937c;">~${t.goldAmount}g</div>`,
        })), 'Choose your mark from the crowd');
        html += `<button data-am-act="closePanel" style="${BTN_PLAIN}">Nevermind</button>`;
        html += '</div>';
        game.ui.showCustomPanel('👛 Pickpocket', html);

        window._ppSelectTarget = (idx) => {
            const target = targets[idx];
            const quick = () => {
                // Simple stealth roll
                const successChance = Math.max(0.1, 0.5 + liftEdge - target.awareness * 0.3);
                if (Math.random() < successChance) {
                    const res = _ppLift(game, player, settlement, target);
                    game.ui.showNotification('👛 Pickpocket', `Swiped ${res.gold}g from the ${target.name}. -1 karma.`, 'success');
                } else {
                    ActionMenu._ppDoCaught(game, tile, player, settlement, target);
                }
                game.ui.updateStats(player, game.world);
                game.ui.hideCustomPanel();
                game.endDay();
            };
            if (!WildTaskRunner.inWorld(game)) { quick(); return; }
            WildTaskRunner.choose(game, {
                title: '👛 Pickpocket ' + target.name,
                icon: target.icon,
                description: `Attempt to steal from the ${target.name}. ${target.diff} difficulty.`,
                baseText: `Simple roll (~${Math.floor(Math.max(0.1, 0.5 + liftEdge - target.awareness * 0.3) * 100)}% success, ~${target.goldAmount}g)`,
                onQuick: quick,
                onGo: () => _ppInPerson(game, tile, player, settlement, target, quick),
            });
        };
    },

    /**
     * Handle getting caught pickpocketing — fines, jail, reputation
     */
    _ppDoCaught(game, tile, player, settlement, target) {
        SocialSkills.trainBy(player, 'stealth', 'liftCaught');
        const fine = Math.floor(Math.random() * 30) + 10;
        const actualFine = Math.min(fine, player.gold);
        player.gold -= actualFine;
        player.karma = (player.karma || 0) - 3;
        // The fine goes to the town's court
        Ledger.record(player, 'fines', -actualFine);
        Economy.payTown(tile.settlement || settlement, actualFine);

        const kingdomId = settlement.kingdom;
        if (kingdomId && player.reputation) {
            player.reputation[kingdomId] = (player.reputation[kingdomId] || 0) - 5;
        }

        if (!player.criminalRecord) player.criminalRecord = { pickpocket: 0, smuggling: 0 };
        player.criminalRecord.pickpocket = (player.criminalRecord.pickpocket || 0) + 1;
        Underworld.recordCrime(player, game.world, 'theft', { kingdom: settlement.kingdom, caught: true, q: tile.q, r: tile.r });
        const offenses = player.criminalRecord.pickpocket;
        const jailDays = offenses === 1 ? 2 : offenses === 2 ? 4 : offenses === 3 ? 7 : 10 + (offenses - 4) * 3;
        const bailCost = jailDays * 25;
        player.jailState = {
            daysRemaining: jailDays,
            totalDays: jailDays,
            offense: 'pickpocketing',
            offenseNumber: offenses,
            settlement: settlement.name,
            bailCost: bailCost,
            escapeChance: 0.08 + ((player.skills?.stealth || 0) * 0.03),
        };
        player.stamina = 0;
        player.movementRemaining = 0;

        game.ui.showNotification('🚔 Arrested!',
            `Caught pickpocketing the ${target.name}! Fined ${actualFine}g, sentenced to ${jailDays} days in jail (offense #${offenses}). -3 karma, -5 reputation.`, 'error');
        game.ui.updateStats(player, game.world);
    },

    /**
     * Smuggle goods — sell inventory items at premium but risk getting caught
     */
    showSmuggleMenu(game, tile) {
        const player = game.player;
        const settlement = tile.settlement;
        if (!settlement) return;

        // Find sellable goods in inventory
        const goods = [];
        const excludeItems = ['bread'];
        for (const [item, qty] of Object.entries(player.inventory || {})) {
            if (qty > 0 && !excludeItems.includes(item)) {
                goods.push({ item, qty });
            }
        }

        if (goods.length === 0) {
            game.ui.showNotification('No Goods', 'You have nothing worth smuggling!', 'default');
            return;
        }

        // A smuggler gets a premium over the black market, but never more than
        // what the goods cost on open sale here or next door (Underworld.openSaleCap):
        // buying in the square and smuggling it straight back is no money loop
        const smugglePriceOf = (item) => Math.min(
            Math.floor(Underworld.blackMarketPrice(game.world, tile, item) * 1.3),
            Underworld.openSaleCap(game.world, tile, item));

        // Step 1: Choose item to smuggle
        let html = '<div style="max-width: 420px;">';
        html += sectionHead('🏴‍☠️ Black Market Smuggling');
        html += lede(`Sell goods at a premium through shady channels in ${settlement.name}. Carry them to the fence past the watch.`);
        html += chips([['🕵️', 'Stealth', player.skills?.stealth || 1], { icon: '⚡', label: 'AP', value: `${player.actionPoints || 0} (costs 2 per deal)` }]);

        const goodsRows = [];
        for (const g of goods) {
            const smugglePrice = smugglePriceOf(g.item);
            if (!(smugglePrice > 1)) continue;
            goodsRows.push({
                icon: '📦',
                name: `${g.item} (x${g.qty})`,
                desc: 'Smuggle 1',
                attrs: `onclick="window._startSmuggleRun('${g.item}', ${smugglePrice})"`,
                side: `<span class="pk-price">${smugglePrice}<small>g</small></span> <span style="font-size: 10px; color: #9d937c;">each</span>`,
            });
        }
        html += rowList(goodsRows);

        html += '</div>';
        game.ui.showCustomPanel('Smuggling', html);

        window._startSmuggleRun = (itemName, price) => {
            if (!player.inventory[itemName] || player.inventory[itemName] <= 0) {
                game.ui.showNotification('No Stock', 'You don\'t have any more of that!', 'error');
                return;
            }
            const apCost = 2;
            if ((player.actionPoints || 0) < apCost) {
                game.ui.showNotification('⚡ No Action Points', `Each smuggling deal costs ${apCost} AP.`, 'error');
                return;
            }
            player.actionPoints -= apCost;

            const stealthSkill = player.skills?.stealth || 1;
            const quick = () => {
                // The plain roll
                const ok = Math.random() < Math.min(0.9, 0.5 + stealthSkill * 0.06);
                const res = _smuggleSettle(game, tile, player, settlement, itemName, price, ok);
                game.ui.showNotification(ok ? '🏴‍☠️ Deal Done' : '🚔 Arrested!', res.text, ok ? 'success' : 'error');
                game.ui.updateStats(player, game.world);
                game.ui.hideCustomPanel();
                const remaining = Object.entries(player.inventory || {}).filter(([k, v]) => v > 0 && k !== 'bread');
                if (remaining.length > 0) ActionMenu.showSmuggleMenu(game, tile);
            };
            if (!WildTaskRunner.inWorld(game)) { quick(); return; }

            WildTaskRunner.choose(game, {
                title: '🏴‍☠️ Smuggle ' + itemName,
                icon: '🏴‍☠️',
                description: `Carry the ${itemName} past the watch to the fence, for ${price}g.`,
                baseText: `~${Math.min(90, Math.floor(50 + stealthSkill * 6))}% success chance (simple roll)`,
                onQuick: quick,
                onGo: () => { ActionMenu._doSmuggleMinigame(game, tile, player, settlement, itemName, price, stealthSkill, quick); }
            });
        };
    },

    /**
     * Smuggle in person on the street map (ui/mapTasks/wildTasks.js): carry
     * the goods to the fence's door while the watch walks its rounds.
     * Handing them over is a sale, being caught is the old arrest.
     */
    _doSmuggleMinigame(game, tile, player, settlement, itemName, price, stealthSkill, quick) {
        WildTaskRunner.smuggle(game, { player, settlement, item: itemName }, (ok) => {
            if (ok === null) { if (quick) quick(); return; }
            const res = _smuggleSettle(game, tile, player, settlement, itemName, price, ok);
            let h = '<div style="max-width: 440px;">';
            if (ok) {
                h += _resultHead('🏴‍☠️', '#8fd18a', 'Deal Complete!');
                h += `<div style="display: flex; justify-content: center;">${chips([{ icon: '💰', label: '', value: `+${price}g`, cls: 'gold' }, `for ${itemName}`])}</div>`;
                h += lede('The fence counts out the coin. Nobody saw a thing.');
            } else {
                h += _resultHead('🚔', '#e0846a', 'Caught!');
                h += lede(res.text);
            }
            h += _continueBtn('onclick="window._smuggleDone()"');
            h += '</div>';
            game.ui.showCustomPanel('🏴‍☠️ Smuggling', h);
            game.ui.updateStats(player, game.world);
            window._smuggleDone = () => {
                game.ui.hideCustomPanel();
                const remaining = Object.entries(player.inventory || {}).filter(([k, v]) => v > 0 && k !== 'bread');
                if (remaining.length > 0 && ok) ActionMenu.showSmuggleMenu(game, tile);
            };
        }, () => {
            // Turned back with the goods: the 2 AP the run cost come back
            player.actionPoints += 2;
            game.ui.showNotification('🏴‍☠️ Smuggling', `You turn back with the ${itemName} still on you.`, 'default');
            game.ui.updateStats(player, game.world);
        });
    },

    /**
     * Train combat at a settlement — costs gold, improves combat skill
     */
    doTrainCombat(game, tile) {
        const player = game.player;
        const settlement = tile.settlement;
        if (!settlement) return;

        // The trainer's fee goes into the town's purse (player/standingOrders.js payTrainer,
        // shared with the "Train at arms" standing order)
        const paid = StandingOrders.payTrainer(player, settlement);
        const cost = paid.fee;
        if (!paid.ok) {
            game.ui.showNotification('Not Enough Gold', `Training costs ${cost} gold.`, 'error');
            return;
        }

        ActionMenu._showMinigamePrompt(game, {
            title: '⚔️ Combat Training',
            icon: '⚔️',
            description: `Spar with a trainer in ${settlement.name}. (Paid ${cost}g)`,
            baseRewardText: '15% chance combat skill +1',
            onSkip: () => {
                // Base reward: small chance of stat growth
                let msg = `Trained with the ${settlement.type === 'capital' ? 'Royal Swordmaster' : 'Militia Sergeant'}.`;
                if (Utils.random() < StandingOrders.config().train.skillChance) {
                    player.skills = player.skills || {};
                    player.skills.combat = Math.min(10, (player.skills.combat || 1) + 1);
                    msg += ' ⚔️ Combat skill improved!';
                }
                if (player.army && player.army.length > 0) {
                    const xp = 8;
                    for (const unit of player.army) unit.experience = (unit.experience || 0) + xp;
                    msg += ` Army gained ${xp} XP.`;
                }
                game.ui.showNotification('⚔️ Training', msg, 'success');
                game.ui.updateStats(player, game.world);
                game.endDay();
            },
            onPlay: () => { ActionMenu._doTrainCombatMinigame(game, tile, player, settlement, cost); }
        });
    },

    _doTrainCombatMinigame(game, tile, player, settlement, cost) {
        // ── Combat Training: a sparring bout on the duel engine (systems/duels.js) ──
        const isCapital = settlement.type === 'capital';
        const trainer = Duels.trainer(settlement);
        const me = Duels.fromPlayer(player, { mods: PlayerEffects.duelModifiers(player), fresh: true });

        DuelPanel.open(game, {
            a: me,
            b: trainer,
            mode: 'spar',
            title: '⚔️ Combat Training',
            intro: `${settlement.name} — sparring with ${trainer.icon} ${trainer.name} (paid ${cost}g). Blunted steel: five exchanges, the one with more left standing wins.`,
            continueLabel: 'See what you learned',
            onFinish: (r) => {
                const won = r.playerWon;
                const tied = r.draw;
                const msgs = [];

                // Combat skill — high chance if won, lower if lost
                const combatChance = won ? (isCapital ? 0.65 : 0.45) :
                                     tied ? (isCapital ? 0.35 : 0.20) :
                                            (isCapital ? 0.20 : 0.10);
                if (Utils.random() < combatChance && player.skills) {
                    player.skills.combat = Math.min((player.skills.combat || 1) + 1, 10);
                    msgs.push('⚔️ Combat skill improved!');
                } else {
                    msgs.push(won ? 'Good fight, but no skill breakthrough.' : 'A humbling lesson.');
                }

                // Strength improvement
                if (Utils.random() < (won ? 0.20 : 0.10)) {
                    player.strength = (player.strength || 5) + 1;
                    msgs.push('💪 Strength increased!');
                }

                // Army XP if player has troops
                if (player.army && player.army.length > 0) {
                    const xpGain = isCapital ? 15 : 10;
                    const bonus = won ? 5 : 0;
                    for (const unit of player.army) {
                        unit.experience = (unit.experience || 0) + xpGain + bonus;
                    }
                    msgs.push(`🎖️ Army gained ${xpGain + bonus} XP from drills.`);
                }

                const verdict = won ? '🏆 You won the bout' : tied ? '🤝 An even bout' : '😤 The trainer had the better of you';
                let html = '<div style="max-width: 440px; text-align: center;">';
                html += `<div style="font-family: var(--font-display); font-size: 17px; font-weight: bold; color: ${won ? '#8fd18a' : tied ? '#ffcf6a' : '#e0846a'}; margin: 6px 0;">${verdict}</div>`;
                html += `<div style="font-size: 11px; color: #9d937c; margin-bottom: 8px;">You landed ${r.dealt}, took ${r.taken} with ${me.weapon}.</div>`;
                html += `<div style="font-size: 12px; color: #ece2c8; white-space: pre-line; margin-bottom: 8px;">${msgs.join('\n')}</div>`;
                html += _continueBtn('data-am-act="closePanelAndEndDay"');
                html += '</div>';
                game.ui.showCustomPanel('⚔️ Combat Training', html);
                game.ui.updateStats(player, game.world);
            },
        });
    },

    /**
     * Meditate — rest and devotion by the devotion model (systems/devotion.js):
     * worth less each time today and at the same place, karma capped per day,
     * faith-bound at holy sites; an omen or a vow may come of it.
     */
    doMeditate(game, tile) {
        const player = game.player;
        const isHolySite = !!tile.holySite;
        const faithStat = player.faith || 5;
        const intStat = player.intelligence || 5;
        ActionMenu._doMeditateMinigame(game, tile, player, isHolySite, faithStat, intStat);
    },

    /**
     * Meditation in person (ui/mapTasks/performTasks.js): find a quiet spot
     * on the street map and sit still; passers-by and getting up cost focus.
     * Its quality goes to the devotion model. (The old breathing-focus
     * minigame is gone; this keeps its name as the entry point.)
     */
    _doMeditateMinigame(game, tile, player, isHolySite, faithStat, intStat) {
        const place = isHolySite ? 'holy' : (tile.religiousBuilding ? 'temple' : 'field');
        PerformTasks.meditate(game, {
            holy: isHolySite,
            stat: Math.round((faithStat + intStat) / 2),
            onQuality: (quality) => DevotionPanel.devote(game, tile, 'meditate', { place, quality, endDay: true }),
            onAbandon: () => game.ui.showNotification('🧘 Meditation', 'You get up before your mind is still. No benefit.', 'warning'),
        });
    },

    /**
     * Fish at a water-adjacent tile — yields food items
     */
    doFish(game, tile, opts = {}) {
        const player = game.player;
        const luckStat = player.luck || 5;
        // The fishing level (systems/foodSkills.js, data/skillPacks/food.json): more
        // bites, bigger fish, less junk, more casts, deep-water fish and deep water
        const angler = FoodSkills.fishing(player);

        // Determine fishing spot quality
        const nearbyTiles = Hex.neighbors(tile.q, tile.r).map(n => game.world.getTile(n.q, n.r)).filter(Boolean);
        // Deep-Sea Nets on one of your ships moored alongside: extra casts and
        // the nets reach deep water from any shore
        const netBonus = Ships.getFishingBonus(player, tile.q, tile.r, game.world);
        const deepSea = netBonus > 0 || nearbyTiles.some(t => ['ocean', 'deep_ocean', 'sea'].includes(t.terrain.id));
        const isCoast = ['coast', 'beach'].includes(tile.terrain.id);
        const seaShore = isCoast || nearbyTiles.some(t => t.terrain.id === 'coast');
        const deepWater = FoodSkills.canFishDeep(player, deepSea, seaShore);

        const depths = [];
        const more = (id) => (FoodSkills.lockedFish(id, angler.level).length ? ' · more to find for a practised angler' : '');
        depths.push({ id: 'shallow', label: '🏖️ Shallows', desc: `Easy catches, smaller fish${more('shallow')}`, color: '#1abc9c' });
        if (isCoast || deepWater) depths.push({ id: 'mid', label: '🌊 Mid Waters', desc: `Moderate fish, decent value${more('mid')}`, color: '#3498db' });
        if (deepWater) depths.push({ id: 'deep', label: '🌀 Deep Waters', desc: `Rare fish, bigger fight${!deepSea ? ' · your long casts reach it' : ''}${more('deep')}`, color: '#2c3e50' });

        // The fish by depth and rarity: data/skillPacks/food.json (skills.fishing.catches)
        const rollFish = (depth) => FoodSkills.rollFish(player, depth, Math.random, luckStat)
            || { name: 'seaweed', label: 'Seaweed', icon: '🌿', value: 1, rarity: 'junk', color: '#666', fight: 0 };

        // A level-up, announced
        const announce = (up) => { if (up) game.ui.showNotification(`${up.icon} ${up.name} Improved`, up.text, 'success'); };

        // Casts for the day; Deep-Sea Nets and a practised hand add more
        const maxCasts = 3 + Math.floor(Math.random() * 2) + netBonus + angler.casts;

        // From the town map: "Fish Here" on the water you see — straight to the cast,
        // from the bank by that water, with the catch of its depth (ui/innerMapUI.js)
        if (opts.spots && opts.depth && WildTaskRunner.inWorld(game)) {
            WildTaskRunner.fish(game, { player, casts: maxCasts, rollFish: () => rollFish(opts.depth), spots: opts.spots, target: opts.target, biteBonus: opts.biteBonus || 0 }, (catches, tally) => {
                if (catches === null) { game.ui.showNotification('🎣 Fishing', 'You can\'t get a line in the water from here.', 'warning'); return; }
                const up = FoodSkills.fishXp(player, { ...(tally || {}), catches });
                game.ui.showCustomPanel('🎣 Fishing', `<div style="max-width: 500px;">${ActionMenu._renderFishingResults(catches, player, up)}</div>`);
                announce(up);
                game.ui.updateStats(player, game.world);
            });
            return;
        }

        let html = '<div style="max-width: 500px;">';
        html += lede('Choose where to cast your line.');
        html += rowList(depths.map(d => ({
            icon: d.label.split(' ')[0],
            name: d.label.split(' ').slice(1).join(' '),
            desc: d.desc,
            attrs: `onclick="window._fishPickDepth('${d.id}')"`,
            side: '▶ Cast',
            tone: 'gold',
        })), '🎣 Fishing');
        html += `<button data-am-act="closePanel" style="${BTN_PLAIN}">Cancel</button>`;
        html += '</div>';
        game.ui.showCustomPanel('🎣 Fishing', html);

        // Which way the water lies, for a map that shows none
        const waterTile = nearbyTiles.find(t => !t.terrain.passable || /ocean|sea|lake|river/.test(t.terrain.id));
        const waterDir = waterTile ? { x: (waterTile.q - tile.q) + (waterTile.r - tile.r) / 2, y: (waterTile.r - tile.r) * 0.866 } : null;

        // ── Depth chosen: fish in person at the water's edge, or the quick catch ──
        window._fishPickDepth = (depthId) => {
            const quick = () => {
                // Base reward: 1-2 simple fish rolls
                const catches = 1 + (Math.random() < 0.4 + angler.bites ? 1 : 0);
                let totalVal = 0;
                let msg = 'Quick fishing trip — ';
                const items = [];
                const landed = [];
                for (let i = 0; i < catches; i++) {
                    const fish = rollFish(depthId);
                    if (fish && fish.name && fish.value > 0) {
                        if (!PlayerInventory.addItem(player, fish.name, 1).success) continue;
                        totalVal += fish.value;
                        landed.push(fish);
                        items.push(`${fish.icon} ${fish.label}${fish.bigger ? ' (a big one)' : ''}`);
                    }
                }
                if (items.length > 0) {
                    msg += `caught ${items.join(', ')} (~${totalVal}g).`;
                } else {
                    msg += 'nothing biting today.';
                }
                if (Math.random() < 0.08) {
                    player.luck = (player.luck || 5) + 1;
                    msg += ' 🍀 Luck increased!';
                }
                game.ui.showNotification('🎣 Fishing', msg, items.length > 0 ? 'success' : 'default');
                announce(FoodSkills.fishXp(player, { casts: catches, catches: landed, quick: true }));
                game.ui.hideCustomPanel();
                game.ui.updateStats(player, game.world);
                game.endDay();
            };
            if (!WildTaskRunner.inWorld(game)) { quick(); return; }

            WildTaskRunner.choose(game, {
                title: '🎣 Fishing',
                icon: '🎣',
                description: `Cast your line into the ${depthId === 'deep' ? 'deep waters' : depthId === 'mid' ? 'mid waters' : 'shallows'}.`,
                baseText: '1-2 basic catches',
                onQuick: quick,
                onGo: () => {
                    WildTaskRunner.fish(game, { player, casts: maxCasts, rollFish: () => rollFish(depthId), waterDir }, (catches, tally) => {
                        if (catches === null) { quick(); return; }
                        // The day's catch into the packs (as the old reel game did); the casts and catch teach fishing
                        const up = FoodSkills.fishXp(player, { ...(tally || {}), catches });
                        game.ui.showCustomPanel('🎣 Fishing', `<div style="max-width: 500px;">${ActionMenu._renderFishingResults(catches, player, up)}</div>`);
                        announce(up);
                        game.ui.updateStats(player, game.world);
                    });
                },
            });
        };
    },

    /**
     * Render final fishing results and add to inventory
     */
    _renderFishingResults(catches, player, levelUp = null) {
        let html = '<div style="text-align: left; padding: 4px 2px;">';
        html += sectionHead('🎣 Day\'s Catch');

        if (catches.length === 0) {
            html += lede('Nothing caught today. The fish outsmarted you!');
        } else {
            // Consolidate
            const totals = {};
            for (const c of catches) {
                if (!totals[c.name]) totals[c.name] = { ...c, qty: 0 };
                totals[c.name].qty++;
            }

            let totalValue = 0;
            const rows = [];
            for (const [key, item] of Object.entries(totals)) {
                if (!PlayerInventory.addItem(player, key, item.qty).success) {
                    rows.push({ icon: '🎒', name: `<span style="color: #f0b35a;">Packs full — released ${item.icon} ${item.label} ×${item.qty}</span>` });
                    continue;
                }
                totalValue += item.value * item.qty;
                const rarityLabel = item.rarity === 'legendary' ? ' ★' : item.rarity === 'rare' ? ' ◆' : '';
                const fancy = item.rarity === 'legendary' || item.rarity === 'rare';
                rows.push({
                    icon: item.icon,
                    name: `${fancy ? `<span style="color: ${item.color};">${item.label}${rarityLabel}</span>` : item.label} <span style="color: #9d937c; font-weight: 400;">×${item.qty}</span>`,
                    side: item.value > 0 ? `<span class="pk-price">${item.value * item.qty}<small>g</small></span>` : '—',
                });
            }
            html += rowList(rows);

            html += chips([{ icon: '💰', label: 'Total value:', value: `${totalValue} gold`, cls: 'gold' }]);
        }

        // Luck chance
        if (Math.random() < 0.08) {
            player.luck = (player.luck || 5) + 1;
            html += '<div style="color: #8fd18a; margin-top: 8px; text-align: center; font-size: 12px;">🍀 Your patience improved your luck!</div>';
        }
        // The fishing level (systems/foodSkills.js)
        const fp = PracticeSkills.progress(player, 'fishing');
        html += `<div style="color: #7db4ff; margin-top: 8px; text-align: center; font-size: 12px;">${fp.icon} ${fp.name} ${fp.level} (${fp.levelName})${fp.max ? '' : ` · ${Math.floor(fp.into)}/${fp.need} xp`}</div>`;
        if (levelUp) html += `<div style="color: #8fd18a; margin-top: 4px; text-align: center; font-size: 12px;">${levelUp.icon} ${levelUp.text}</div>`;

        html += _continueBtn('data-am-act="closePanelAndEndDay"', 'Done Fishing');
        html += '</div>';
        return html;
    },

    /**
     * Prospect for minerals on hills/highlands/mountain tiles
     */
    doProspect(game, tile) {
        const player = game.player;
        const terrainId = tile.terrain?.id || '';
        const strengthStat = player.strength || 5;
        const luckStat = player.luck || 5;

        const difficultyMod = {
            hills: 1.0, highlands: 1.2, mountain: 1.5, volcanic_mountain: 1.8
        }[terrainId] || 1.0;

        ActionMenu._showMinigamePrompt(game, {
            title: '⛏️ Prospecting',
            icon: '⛏️',
            description: 'Drill into the earth to find valuable minerals.',
            baseRewardText: '1 basic mineral (stone or ore)',
            onSkip: () => {
                // Base reward: 1 basic mineral
                const roll = Math.random();
                let type, label, icon, value;
                // Deep Mining: a trained eye spots gem seams
                const gemChance = Technology.getEffectTotal(player, 'gemDiscoveryChance');
                if (gemChance > 0 && Utils.random() < gemChance) { type = 'gems'; label = 'Gemstones'; icon = '💎'; value = 80; }
                else if (roll < 0.55) { type = 'stone'; label = 'Stone'; icon = '⛰️'; value = 8; }
                else if (roll < 0.85) { type = 'ore'; label = 'Iron Ore'; icon = '⛏️'; value = 25; }
                else if (roll < 0.95) { type = 'fossil'; label = 'Fossil'; icon = '🦴'; value = 35; }
                else { type = 'crystal'; label = 'Crystal'; icon = '🔮'; value = 50; }
                if (!PlayerInventory.addItem(player, type, 1).success) {
                    game.ui.showNotification('🎒 Inventory Full', PlayerInventory.fullMessage(player), 'warning');
                    return;
                }
                const hpCost = 2;
                player.health = Math.max(1, player.health - hpCost);
                if (Math.random() < 0.12) { player.strength = (player.strength || 5) + 1; }
                game.ui.showNotification('⛏️ Prospecting', `Quick dig — found ${icon} ${label} (~${value}g). -${hpCost} HP.`, 'success');
                game.ui.updateStats(player, game.world);
                game.endDay();
            },
            onPlay: () => { ActionMenu._doProspectMinigame(game, tile, player, terrainId, strengthStat, luckStat, difficultyMod); }
        });
    },

    _doProspectMinigame(game, tile, player, terrainId, strengthStat, luckStat, difficultyMod) {
        // ── Prospecting Minigame: Depth Drilling with vein scanner ──
        const maxDepth = 8;
        let currentDepth = 0;
        let drillHP = 100; // drill durability
        let stamina = 100; // player stamina for drilling
        let finds = [];
        let totalValue = 0;
        let phase = 'drilling'; // drilling → result
        let statusMsg = '';
        let healthCost = 0;
        let scanResult = '';
        let scansLeft = 2 + Math.floor(luckStat / 3);

        const itemData = {
            gems:    { label: 'Gemstones', icon: '💎', value: 80 },
            ore:     { label: 'Iron Ore',  icon: '⛏️', value: 25 },
            stone:   { label: 'Stone',     icon: '⛰️', value: 8 },
            fossil:  { label: 'Fossil',    icon: '🦴', value: 35 },
            crystal: { label: 'Crystal',   icon: '🔮', value: 50 },
        };

        // Generate what's at each depth
        const gemChance = Technology.getEffectTotal(player, 'gemDiscoveryChance');
        const layers = [];
        for (let d = 0; d < maxDepth; d++) {
            const depthBonus = d * 0.06 * (luckStat / 5);
            const roll = Math.random();
            let type = 'rock';
            if (roll < 0.03 + depthBonus * 0.5) type = 'gems';
            else if (roll < 0.10 + depthBonus * 1.5) type = 'crystal';
            else if (roll < 0.22 + depthBonus * 2) type = 'ore';
            else if (roll < 0.35 + depthBonus) type = 'fossil';
            else if (roll < 0.55 + depthBonus) type = 'stone';
            // Deep Mining: a trained eye spots gem seams in otherwise barren rock
            if (type === 'rock' && gemChance > 0 && Utils.random() < gemChance) type = 'gems';
            // Add hazards at deeper levels
            const hasHazard = d >= 3 && Math.random() < 0.2 + d * 0.05;
            layers.push({ type, hasHazard, extracted: false });
        }

        const getLayerColor = (type) => {
            switch(type) {
                case 'gems': return '#9b59b6';
                case 'crystal': return '#8e44ad';
                case 'ore': return '#3498db';
                case 'fossil': return '#f39c12';
                case 'stone': return '#95a5a6';
                default: return '#8b6914';
            }
        };

        const render = () => {
            let html = '<div style="max-width: 440px; text-align: center;">';
            html += sectionHead('⛏️ Prospecting');
            html += `<p style="font-size: 11px; color: #9d937c; margin: 0 0 8px;">Terrain: ${terrainId} (x${difficultyMod}) | Str: ${strengthStat} | Luck: ${luckStat}</p>`;

            if (phase === 'drilling') {
                // Status bars
                html += `<div style="display: flex; gap: 12px; margin-bottom: 10px;">
                    ${_meter('⛏️ Drill HP', drillHP, drillHP > 30 ? '#7db4ff' : '#e0846a')}
                    ${_meter('💪 Stamina', stamina, stamina > 30 ? '#8fd18a' : '#e0846a')}
                </div>`;

                html += `<div style="display: flex; justify-content: center;">${chips([
                    { icon: '💰', label: 'Found:', value: `${totalValue}g`, cls: 'gold' },
                    ['🔍', 'Scans:', scansLeft],
                ])}</div>`;

                // Depth column — vertical drill shaft
                html += '<div style="display: flex; gap: 6px; align-items: stretch;">';

                // Depth labels
                html += '<div style="display: flex; flex-direction: column; gap: 2px; margin-right: 2px;">';
                for (let d = 0; d < maxDepth; d++) {
                    html += `<div style="height: 42px; display: flex; align-items: center; font-size: 9px; color: #9d937c;">
                        ${d + 1}m
                    </div>`;
                }
                html += '</div>';

                // Shaft
                html += '<div style="flex: 1; display: flex; flex-direction: column; gap: 2px;">';
                for (let d = 0; d < maxDepth; d++) {
                    const layer = layers[d];
                    const isCurrent = d === currentDepth;
                    const isPast = d < currentDepth;
                    const darkness = 0.06 + d * 0.03;

                    if (isPast) {
                        // Already drilled through
                        const col = layer.extracted ? 'rgba(143,209,138,0.1)' : 'rgba(255,255,255,0.02)';
                        html += `<div style="height: 42px; border-radius: 6px; display: flex; align-items: center; justify-content: center;
                            background: ${col}; border: 1px solid rgba(245,197,66,0.06); font-size: 12px; color: #9d937c;">
                            ${layer.extracted ? (itemData[layer.type]?.icon || '✓') : '▪️'} ${layer.extracted ? itemData[layer.type]?.label || '' : 'empty'}
                        </div>`;
                    } else if (isCurrent) {
                        // Current depth — drill head
                        html += `<div style="height: 42px; border-radius: 6px; display: flex; align-items: center; justify-content: center;
                            background: rgba(245,197,66,0.12); border: 1px solid rgba(245,197,66,0.7); font-size: 18px;
                            box-shadow: 0 0 12px rgba(245,197,66,0.18);">
                            ⛏️ <span style="font-size: 11px; margin-left: 6px; color: #ffcf6a; letter-spacing: 1px; font-weight: 600;">DRILL HERE</span>
                        </div>`;
                    } else {
                        // Future depth — hidden
                        html += `<div style="height: 42px; border-radius: 6px; display: flex; align-items: center; justify-content: center;
                            background: rgba(139,90,43,${darkness}); border: 1px solid rgba(255,255,255,0.04); font-size: 14px; color: rgba(255,255,255,0.15);">
                            ???
                        </div>`;
                    }
                }
                html += '</div>';

                // Scan results sidebar
                html += '<div style="width: 80px; display: flex; flex-direction: column; gap: 2px;">';
                for (let d = 0; d < maxDepth; d++) {
                    const layer = layers[d];
                    if (layer.scanned) {
                        const col = getLayerColor(layer.type);
                        html += `<div style="height: 42px; border-radius: 4px; display: flex; align-items: center; justify-content: center;
                            background: rgba(${col === '#9b59b6' ? '155,89,182' : col === '#3498db' ? '52,152,219' : col === '#f39c12' ? '243,156,18' : col === '#95a5a6' ? '149,165,166' : '142,68,173'},0.15);
                            border: 1px solid ${col}40; font-size: 9px; color: ${col};">
                            ${layer.hasHazard ? '⚠️' : ''} ${itemData[layer.type]?.icon || '⛰️'}
                        </div>`;
                    } else {
                        html += `<div style="height: 42px; border-radius: 4px; display: flex; align-items: center; justify-content: center;
                            background: rgba(255,255,255,0.02); border: 1px solid rgba(245,197,66,0.06); font-size: 9px; color: #9d937c;">
                            ?
                        </div>`;
                    }
                }
                html += '</div>';

                html += '</div>';

                if (statusMsg) html += `<div style="margin-top: 8px; font-size: 12px;">${statusMsg}</div>`;
                if (scanResult) html += `<div style="margin-top: 4px; font-size: 11px; color: #9d937c;">${scanResult}</div>`;

                // Action buttons
                html += `<div style="display: flex; gap: 8px; justify-content: center; margin-top: 10px;">
                    <button onclick="window._prospectDrill()" style="${BTN_GOLD} margin: 0; padding: 9px 22px; font-size: 13px;">
                        ⛏️ Drill Down
                    </button>
                    <button onclick="window._prospectScan()" ${scansLeft <= 0 ? 'disabled' : ''}
                        style="${scansLeft <= 0 ? BTN_OFF : BTN_PLAIN} margin: 0; padding: 9px 18px; font-size: 13px;">
                        🔍 Scan (${scansLeft})
                    </button>
                    <button onclick="window._prospectStop()" style="${BTN_DARK} margin: 0; padding: 9px 14px;">
                        Stop
                    </button>
                </div>`;
                html += `<div style="font-size: 10px; color: #9d937c; margin-top: 6px;">Drill deeper for rare minerals! Scan to see what's ahead.</div>`;

            } else {
                // Results
                if (finds.length > 0) {
                    html += _resultHead('⛏️', '#8fd18a', 'Prospecting Haul');
                    const totals = {};
                    for (const f of finds) {
                        if (!totals[f.type]) totals[f.type] = { ...itemData[f.type], qty: 0 };
                        totals[f.type].qty++;
                    }
                    const rows = [];
                    for (const [key, item] of Object.entries(totals)) {
                        if (!PlayerInventory.addItem(player, key, item.qty).success) {
                            rows.push({ icon: '🎒', name: `<span style="color: #f0b35a;">Packs full — left behind ${item.icon} ${item.label} x${item.qty}</span>` });
                            continue;
                        }
                        rows.push({ icon: item.icon, name: `${item.label} x${item.qty}`, side: `<span class="pk-price">${item.value * item.qty}<small>g</small></span>` });
                    }
                    html += '<div style="text-align: left;">' + rowList(rows) + '</div>';
                    html += `<div style="display: flex; justify-content: center;">${chips([{ icon: '💰', label: 'Total Value:', value: `~${totalValue} gold`, cls: 'gold' }])}</div>`;
                } else {
                    html += _resultHead('⛏️', '#f0b35a', 'Slim Pickings');
                    html += `<div style="color: #cbbf9f;">Nothing valuable found.</div>`;
                }
                html += `<div style="font-size: 12px; color: #9d937c; margin-top: 4px;">Reached depth: ${currentDepth}m</div>`;
                if (healthCost > 0) html += `<div style="color: #e0846a; margin-top: 4px;">Hard work cost ${healthCost} HP.</div>`;
                if (statusMsg) html += `<div style="font-size: 12px; color: #cbbf9f; margin-top: 4px;">${statusMsg}</div>`;
                html += _continueBtn('data-am-act="closePanelAndEndDay"');
            }

            html += '</div>';
            game.ui.showCustomPanel('⛏️ Prospecting', html);
        };

        render();

        window._prospectDrill = () => {
            if (phase !== 'drilling' || currentDepth >= maxDepth) return;

            const layer = layers[currentDepth];
            const staminaCost = 8 + currentDepth * 2 + Math.floor(difficultyMod * 3);
            const drillDmg = 5 + currentDepth * 3 + (layer.hasHazard ? 15 : 0);

            stamina = Math.max(0, stamina - staminaCost + strengthStat * 0.8);
            drillHP = Math.max(0, drillHP - drillDmg);

            // Health cost
            const hpCost = currentDepth >= 4 ? 2 : 1;
            healthCost += hpCost;
            player.health = Math.max(1, player.health - hpCost);

            // Extract any mineral
            if (layer.type !== 'rock') {
                layer.extracted = true;
                const data = itemData[layer.type];
                finds.push({ type: layer.type });
                totalValue += data.value;
                statusMsg = `<span style="color: #8fd18a;">Found ${data.icon} ${data.label}!</span>`;
            } else {
                statusMsg = `<span style="color: #9d937c;">Just rock...</span>`;
            }

            if (layer.hasHazard) {
                const extraDmg = Math.floor(Math.random() * 6) + 3;
                healthCost += extraDmg;
                player.health = Math.max(1, player.health - extraDmg);
                statusMsg += ` <span style="color: #e0846a;">⚠️ Cave-in! -${extraDmg} HP</span>`;
            }

            currentDepth++;

            // Check end conditions
            if (stamina <= 0 || drillHP <= 0 || currentDepth >= maxDepth) {
                phase = 'result';
                if (stamina <= 0) statusMsg = 'Too exhausted to continue.';
                else if (drillHP <= 0) statusMsg = 'Your pick broke!';
                else statusMsg = 'You reached the bottom of the shaft!';

                if (Math.random() < 0.12) {
                    player.strength = (player.strength || 5) + 1;
                    statusMsg += ' 💪 The hard labor strengthened you!';
                }
            }

            render();
            game.ui.updateStats(player, game.world);
        };

        window._prospectScan = () => {
            if (phase !== 'drilling' || scansLeft <= 0) return;
            scansLeft--;

            // Reveal 2-3 upcoming layers
            const scanRange = 2 + (luckStat >= 7 ? 1 : 0);
            let scannedInfo = [];
            for (let d = currentDepth; d < Math.min(maxDepth, currentDepth + scanRange); d++) {
                layers[d].scanned = true;
                const data = itemData[layers[d].type];
                if (data) scannedInfo.push(`${data.icon} ${data.label} at ${d + 1}m`);
                else scannedInfo.push(`⛰️ Rock at ${d + 1}m`);
                if (layers[d].hasHazard) scannedInfo[scannedInfo.length - 1] += ' ⚠️';
            }
            scanResult = `🔍 Scan: ${scannedInfo.join(', ')}`;
            render();
        };

        window._prospectStop = () => {
            phase = 'result';
            if (Math.random() < 0.12) {
                player.strength = (player.strength || 5) + 1;
                statusMsg = '💪 The hard labor strengthened you!';
            }
            render();
            game.ui.updateStats(player, game.world);
        };
    },

    /**
     * Tame a wild horse — requires horse resource on tile
     */
    doTameHorse(game, tile) {
        const player = game.player;
        const strengthStat = player.strength || 5;
        const luckStat = player.luck || 5;

        if (!PlayerInventory.canAdd(player, 'horse')) {
            game.ui.showNotification('🐴 No Room', `You have nowhere to keep a horse. ${PlayerInventory.fullMessage(player)}`, 'warning');
            return;
        }

        ActionMenu._showMinigamePrompt(game, {
            title: '🐴 Tame Horse',
            icon: '🐴',
            description: 'Approach and calm a wild horse to tame it.',
            baseRewardText: '~40% chance of success',
            onSkip: () => {
                // Base reward: simple chance roll
                const chance = 0.35 + luckStat * 0.02 + strengthStat * 0.01;
                if (Math.random() < chance && PlayerInventory.addItem(player, 'horse', 1).success) {
                    player.maxStamina = (player.maxStamina || 10) + 2;
                    if (Math.random() < 0.2) player.strength = (player.strength || 5) + 1;
                    game.ui.showNotification('🐴 Horse Tamed!', 'You patiently calmed the horse. +1 Horse, +2 Max Stamina.', 'success');
                } else {
                    game.ui.showNotification('🐴 Horse Fled', 'The horse bolted before you could approach.', 'default');
                }
                game.ui.updateStats(player, game.world);
                game.endDay();
            },
            onPlay: () => { ActionMenu._doTameHorseMinigame(game, tile, player, strengthStat, luckStat); }
        });
    },

    _doTameHorseMinigame(game, tile, player, strengthStat, luckStat) {
        // ── Horse Taming Minigame: Calm & Hold ──
        let calmness = 50;   // 0-100, need to keep in sweet spot (40-70) and hold
        let holdTimer = 0;   // seconds held in calm zone — need 3 to succeed
        const holdTarget = 3.0;
        let phase = 'taming'; // taming → result
        let tameResult = null; // 'success' | 'bolted' | 'kicked'
        let statusMsg = '';
        let gameInterval = null;
        let horseMood = 'nervous'; // nervous | calm | panicked
        let horseAction = '';
        let actionCooldown = 0;

        const cleanup = () => {
            if (gameInterval) { clearInterval(gameInterval); gameInterval = null; }
        };

        const render = () => {
            let html = '<div style="max-width: 440px; text-align: center;">';
            html += sectionHead('🐴 Taming a Wild Horse');
            html += `<p style="font-size: 11px; color: #9d937c; margin: 0 0 10px;">Strength: ${strengthStat} | Luck: ${luckStat}</p>`;

            if (phase === 'taming') {
                // Horse visual
                const horseAnim = horseMood === 'panicked' ? '🐎💨' : horseMood === 'calm' ? '🐴✨' : '🐴';
                html += `<div style="font-size: 48px; margin: 8px 0; transition: all 0.3s;">${horseAnim}</div>`;
                if (horseAction) html += `<div style="font-size: 11px; color: #9d937c; margin-bottom: 8px;">${horseAction}</div>`;

                // Calmness meter with sweet-spot zone
                const calmnessColor = (calmness >= 40 && calmness <= 70) ? '#8fd18a' : calmness > 85 ? '#7db4ff' : '#e0846a';
                const moodLabel = horseMood === 'panicked' ? '😱 Panicking!' : horseMood === 'calm' ? '😌 Calm' : '😰 Nervous';
                html += `<div style="margin-bottom: 10px;">
                    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
                        <span style="color: #9d937c;">Horse Calmness</span>
                        <span style="color: ${calmnessColor}; font-weight: 600;">${moodLabel}</span>
                    </div>
                    <div style="position: relative; height: 22px; background: rgba(0,0,0,0.3); border-radius: 10px; overflow: hidden; border: 1px solid rgba(245,197,66,0.14);">
                        <!-- Sweet zone -->
                        <div style="position: absolute; left: 40%; width: 30%; height: 100%; background: rgba(46,204,113,0.12); border-left: 2px dashed rgba(46,204,113,0.4); border-right: 2px dashed rgba(46,204,113,0.4);"></div>
                        <!-- Calmness marker -->
                        <div style="position: absolute; left: ${calmness}%; top: 2px; bottom: 2px; width: 8px; background: ${calmnessColor}; border-radius: 4px; transform: translateX(-50%); box-shadow: 0 0 8px ${calmnessColor}; transition: left 0.15s;"></div>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 9px; color: #9d937c; margin-top: 2px;">
                        <span>Wild</span>
                        <span style="color: rgba(46,204,113,0.6);">Sweet spot</span>
                        <span>Sleepy</span>
                    </div>
                </div>`;

                // Hold progress
                const holdPct = Math.min(100, (holdTimer / holdTarget) * 100);
                html += `<div style="margin-bottom: 12px;">
                    <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 3px;">
                        <span style="color: #9d937c;">Trust (hold in sweet spot)</span>
                        <span style="color: #ffcf6a; font-weight: 600;">${holdPct.toFixed(0)}%</span>
                    </div>
                    <div style="background: rgba(0,0,0,0.3); border-radius: 6px; height: 14px; overflow: hidden; border: 1px solid rgba(245,197,66,0.14);">
                        <div style="width: ${holdPct}%; height: 100%; background: #ffcf6a; transition: width 0.2s; border-radius: 5px;"></div>
                    </div>
                </div>`;

                // Control buttons
                html += `<div style="display: flex; gap: 10px; justify-content: center;">
                    <button onmousedown="window._tameCalm()" ontouchstart="window._tameCalm()"
                        style="${BTN_GOLD} margin: 0; padding: 12px 20px; font-size: 14px; user-select: none;">
                        🤲 Soothe
                    </button>
                    <button onmousedown="window._tameFeed()" ontouchstart="window._tameFeed()"
                        style="${BTN_PLAIN} margin: 0; padding: 12px 20px; font-size: 14px; user-select: none;">
                        🥕 Offer Food
                    </button>
                    <button onmousedown="window._tameGrip()" ontouchstart="window._tameGrip()"
                        style="${BTN_DARK} margin: 0; padding: 12px 20px; font-size: 14px; user-select: none;">
                        ✊ Firm Grip
                    </button>
                </div>`;
                html += `<div style="font-size: 10px; color: #9d937c; margin-top: 8px;">Keep the horse in the green sweet spot and build trust!</div>`;

            } else {
                // Results
                if (tameResult === 'success') {
                    html += _resultHead('🐴✨', '#8fd18a', 'Horse Tamed!');
                    html += '<div style="text-align: left;">' + rowList([
                        { icon: '🐴', name: '+1 Horse added to inventory' },
                        { icon: '⚡', name: '+2 Max Stamina (mount bonus)' },
                    ]) + '</div>';
                    if (statusMsg) html += `<div style="font-size: 12px; color: #8fd18a; margin-top: 6px;">${statusMsg}</div>`;
                } else if (tameResult === 'bolted') {
                    html += _resultHead('🐎💨', '#f0b35a', 'The Horse Bolted!');
                    html += `<div style="font-size: 13px; color: #cbbf9f;">${statusMsg || 'It broke free and disappeared into the wild.'}</div>`;
                } else if (tameResult === 'kicked') {
                    html += _resultHead('🦵💥', '#e0846a', 'Kicked!');
                    html += `<div style="font-size: 13px; color: #cbbf9f;">${statusMsg}</div>`;
                }
                html += _continueBtn('data-am-act="closePanelAndEndDay"');
            }

            html += '</div>';
            game.ui.showCustomPanel('🐴 Horse Taming', html);
        };

        render();

        // Game loop — horse naturally gets restless
        gameInterval = setInterval(() => {
            if (phase === 'taming' && panelClosed()) { phase = 'abandoned'; cleanup(); return; }
            if (phase !== 'taming') return;

            // Horse naturally drifts (gets nervous)
            const drift = (Math.random() - 0.45) * (8 - strengthStat * 0.3);
            calmness = Math.max(0, Math.min(100, calmness + drift));

            // Random horse actions
            actionCooldown--;
            if (actionCooldown <= 0 && Math.random() < 0.25) {
                const actions = [
                    { text: 'The horse snorts nervously...', effect: -8 },
                    { text: 'The horse stamps its hooves!', effect: -12 },
                    { text: 'The horse nickers softly...', effect: 5 },
                    { text: 'The horse tosses its mane!', effect: -6 },
                    { text: 'The horse whinnies!', effect: -10 },
                ];
                const action = actions[Math.floor(Math.random() * actions.length)];
                horseAction = action.text;
                calmness = Math.max(0, Math.min(100, calmness + action.effect));
                actionCooldown = 3;
            }

            // Update mood
            horseMood = calmness < 20 ? 'panicked' : calmness >= 40 && calmness <= 70 ? 'calm' : 'nervous';

            // In sweet spot? Build hold timer
            if (calmness >= 40 && calmness <= 70) {
                holdTimer += 0.3;
            } else {
                holdTimer = Math.max(0, holdTimer - 0.1);
            }

            // Win condition
            if (holdTimer >= holdTarget) {
                cleanup();
                phase = 'result';
                if (!PlayerInventory.addItem(player, 'horse', 1).success) {
                    tameResult = 'bolted';
                    statusMsg = 'Your packs are full — with nowhere to keep it, the horse wanders off.';
                } else {
                    tameResult = 'success';
                    player.maxStamina = (player.maxStamina || 10) + 2;
                    if (Math.random() < 0.2) {
                        player.strength = (player.strength || 5) + 1;
                        statusMsg = '💪 The struggle strengthened you!';
                    }
                }
            }

            // Lose condition — too wild
            if (calmness <= 0) {
                cleanup();
                phase = 'result';
                if (Math.random() < 0.4) {
                    const dmg = Math.floor(Math.random() * 12) + 5;
                    player.health = Math.max(1, player.health - dmg);
                    tameResult = 'kicked';
                    statusMsg = `The panicked horse kicked you! -${dmg} HP`;
                    // A hoof can crack ribs or break an arm (systems/ailments.js)
                    const wound = Ailments.maybeWound(player, game.world, 'kick');
                    if (wound) statusMsg += ` ${wound.icon} ${wound.name}.`;
                } else {
                    tameResult = 'bolted';
                }
            }

            render();
        }, 300);

        // ── Player actions ──
        window._tameCalm = () => {
            if (phase !== 'taming') return;
            // Soothe — gently increase calmness
            calmness = Math.min(100, calmness + (3 + strengthStat * 0.3));
            horseAction = 'You speak softly and stroke its neck...';
            render();
        };

        window._tameFeed = () => {
            if (phase !== 'taming') return;
            // Feed — bigger calm boost but with cooldown risk
            const feedBonus = 8 + luckStat * 0.5;
            if (Math.random() < 0.7) {
                calmness = Math.min(100, calmness + feedBonus);
                horseAction = '🥕 The horse cautiously takes the food...';
            } else {
                calmness = Math.max(0, calmness - 5);
                horseAction = 'The horse snaps at your hand! Just missed!';
            }
            render();
        };

        window._tameGrip = () => {
            if (phase !== 'taming') return;
            // Firm grip — stops drift temporarily but may spook
            if (calmness < 30) {
                // Risky when panicked
                calmness = Math.max(0, calmness - 10);
                horseAction = 'The horse rears up! Too forceful!';
            } else {
                calmness = Math.max(0, Math.min(100, calmness + (Math.random() < 0.5 ? 2 : -3)));
                holdTimer += 0.4;
                horseAction = '✊ You hold firm... the horse settles slightly.';
            }
            render();
        };
    },

    /**
     * Craft a campfire — uses 2 wood, gives health bonus on rest, can cook fish
     */
    doCraftCampfire(game, tile) {
        const player = game.player;

        if (!player.inventory?.wood || player.inventory.wood < 2) {
            game.ui.showNotification('No Wood', 'You need at least 2 wood to build a campfire.', 'error');
            return;
        }

        player.inventory.wood -= 2;
        if (player.inventory.wood <= 0) delete player.inventory.wood;

        // Immediate health bonus
        const healAmount = 15;
        player.health = Math.min(player.maxHealth || 100, player.health + healAmount);

        let resultMsg = `You built a warm campfire. +${healAmount} HP from the warmth.`;

        // Cook fish if available
        if (player.inventory.fish && player.inventory.fish > 0) {
            const fishCount = Math.min(player.inventory.fish, 3); // Cook up to 3
            player.inventory.fish -= fishCount;
            if (player.inventory.fish <= 0) delete player.inventory.fish;
            const extraHeal = fishCount * 5;
            player.health = Math.min(player.maxHealth || 100, player.health + extraHeal);
            if (PlayerInventory.addItem(player, 'cooked_fish', fishCount).success) {
                resultMsg += ` Cooked ${fishCount} fish (+${extraHeal} HP).`;
            } else {
                resultMsg += ` Your packs are full, so you ate the ${fishCount} fish on the spot (+${extraHeal} HP).`;
            }
        }

        // Cook raw meat if available
        if (player.inventory.meat && player.inventory.meat > 0) {
            const meatCount = Math.min(player.inventory.meat, 3);
            player.inventory.meat -= meatCount;
            if (player.inventory.meat <= 0) delete player.inventory.meat;
            const extraHeal = meatCount * 7;
            player.health = Math.min(player.maxHealth || 100, player.health + extraHeal);
            if (PlayerInventory.addItem(player, 'cooked_meat', meatCount).success) {
                resultMsg += ` Cooked ${meatCount} meat (+${extraHeal} HP).`;
            } else {
                resultMsg += ` Your packs are full, so you ate the ${meatCount} meat on the spot (+${extraHeal} HP).`;
            }
        }

        // Small intelligence gain from the craft
        if (Math.random() < 0.08) {
            player.intelligence = (player.intelligence || 5) + 1;
            resultMsg += ' Your practical skills sharpened your mind.';
        }

        game.ui.showNotification('🔥 Campfire', resultMsg, 'success');
        game.ui.updateStats(player, game.world);
    },
});

// ── Pickpocketing and smuggling outcomes (shared by the quick roll and the in-person task) ──

/** A purse lifted: the gold, the crime on the record, karma, maybe a stealth gain. */
function _ppLift(game, player, settlement, target, extra = 0) {
    // The mark's purse is the town's coin (world/economy.js): a poor town's folk carry less
    const gold = Math.floor(Economy.drawTown(settlement, target.goldAmount + extra));
    player.gold += gold;
    Underworld.recordCrime(player, game.world, 'theft', { kingdom: settlement.kingdom });
    Ledger.record(player, 'theft', gold);
    Gangs.addDirty(player, gold);
    player.karma = (player.karma || 0) - 1;
    // Stealth practice (systems/socialSkills.js; a level-up is announced from the queue)
    let skillUp = false;
    if (SocialSkills.has('stealth')) SocialSkills.trainBy(player, 'stealth', 'lift');
    else if (Math.random() < 0.2 && player.skills) {
        player.skills.stealth = Math.min((player.skills.stealth || 1) + 1, 10);
        skillUp = true;
    }
    return { gold, skillUp };
}

/** Lift the purse in person on the street (ui/mapTasks/wildTasks.js). */
function _ppInPerson(game, tile, player, settlement, target, quick) {
    WildTaskRunner.pickpocket(game, { player, target }, (res) => {
        if (res === null) { quick(); return; }
        let html = '<div style="max-width: 440px; text-align: center;">';
        if (res === 'lifted') {
            const got = _ppLift(game, player, settlement, target);
            html += _resultHead('💰', '#8fd18a', 'Success!');
            html += `<div style="font-size: 13px; color: #cbbf9f; margin-bottom: 4px;">Deftly lifted the purse from the ${target.name} and melted into the crowd. -1 karma.${got.skillUp ? ' Your stealth skill improved!' : ''}</div>`;
            html += `<div style="display: flex; justify-content: center;">${chips([{ icon: '💰', label: '', value: `+${got.gold} gold`, cls: 'gold' }])}</div>`;
        } else {
            ActionMenu._ppDoCaught(game, tile, player, settlement, target);
            html += _resultHead('🚔', '#e0846a', 'CAUGHT!');
            html += `<div style="font-size: 13px; color: #cbbf9f; margin-bottom: 8px;">The ${target.name} grabbed your wrist and shouted for the watch!</div>`;
        }
        html += _continueBtn('data-am-act="closePanel"');
        html += '</div>';
        game.ui.showCustomPanel('👛 Pickpocket', html);
        game.ui.updateStats(player, game.world);
    }, () => {
        game.ui.showNotification('👛 Pickpocket', 'You thought better of it and melted back into the crowd.', 'default');
    });
}

/**
 * A smuggling run settled: one of the goods leaves the packs either way.
 * Sold: the price, the crime, karma, maybe stealth. Caught: the fine, the
 * record, the jail term. Returns { text } for the notice or panel.
 */
function _smuggleSettle(game, tile, player, settlement, itemName, price, success) {
    if (success) {
        // The buyer is one of the town's gangs: its purse pays, its stash takes the goods (systems/gangs.js)
        const deal = Gangs.buyFromPlayer(player, game.world, tile, itemName, 1, price);
        if (!(deal.qty > 0)) return { text: `Nobody on the black market here can pay ${price}g for ${itemName} this week. You keep it.` };
        player.inventory[itemName]--;
        if (player.inventory[itemName] <= 0) delete player.inventory[itemName];
        player.gold += price;
        Underworld.recordCrime(player, game.world, 'smuggling', { kingdom: settlement.kingdom });
        Ledger.record(player, 'smuggling', price);
        Gangs.addDirty(player, price);
        player.karma = (player.karma || 0) - 1;
        if (SocialSkills.has('stealth')) SocialSkills.train(player, 'stealth', SocialSkills.xpFor('stealth', 'steal') + price * SocialSkills.xpFor('stealth', 'stealPerGold'));
        else if (Math.random() < 0.15 && player.skills) {
            player.skills.stealth = Math.min((player.skills.stealth || 1) + 1, 10);
        }
        return { text: `Sold ${itemName} for ${price}g on the black market.` };
    }
    // Caught: the goods are seized (burned as contraband) and the fine goes to the town's court
    player.inventory[itemName]--;
    if (player.inventory[itemName] <= 0) delete player.inventory[itemName];
    const fine = Math.floor(price * 0.5);
    const actualFine = Math.min(fine, player.gold);
    player.gold -= actualFine;
    player.karma = (player.karma || 0) - 3;
    Ledger.record(player, 'fines', -actualFine);
    Economy.payTown(tile.settlement || settlement, actualFine);
    const kingdomId = settlement.kingdom;
    if (kingdomId && player.reputation) {
        player.reputation[kingdomId] = (player.reputation[kingdomId] || 0) - 8;
    }
    if (!player.criminalRecord) player.criminalRecord = { pickpocket: 0, smuggling: 0 };
    player.criminalRecord.smuggling = (player.criminalRecord.smuggling || 0) + 1;
    Underworld.recordCrime(player, game.world, 'smuggling', { kingdom: settlement.kingdom, caught: true, q: tile.q, r: tile.r });
    const offenses = player.criminalRecord.smuggling;
    const jailDays = offenses === 1 ? 3 : offenses === 2 ? 6 : offenses === 3 ? 10 : 14 + (offenses - 4) * 4;
    const bailCost = jailDays * 30;
    player.jailState = {
        daysRemaining: jailDays, totalDays: jailDays, offense: 'smuggling',
        offenseNumber: offenses, settlement: settlement.name, bailCost: bailCost,
        escapeChance: 0.08 + ((player.skills?.stealth || 0) * 0.03),
    };
    player.stamina = 0;
    player.movementRemaining = 0;
    return { text: `Caught smuggling ${itemName}! Fined ${actualFine}g, sentenced to ${jailDays} days in jail (offense #${offenses}). -3 karma, -8 rep.` };
}
