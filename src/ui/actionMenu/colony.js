// ActionMenu — colony methods (split from the original monolith).
import { ActionMenu } from './_ref.js';
import { DevotionPanel } from './devotion.js';
import { esc, BTN_GOLD, BTN_DARK, BTN_PLAIN, lede, chips, purse, sectionHead, kv, card, actRow, rowList, price } from './uiKit.js';
import { PlayerActions, PlayerEconomy, Trading, PlayerMilitary, Hex, Utils, Banking, MarketDynamics, Taxation, Technology, Titles, Quests, Terrain, Kingdom, NPCLords, Peoples, LegendaryArtifacts, BountyHunting, Religion, Espionage, Infrastructure, Tavern, Ships, Housing, Cartography, Colonization, Relationships, Councils, SaveLoad, Economy, DataLoader, Culture, KingdomAtlas } from './_imports.js';

Object.assign(ActionMenu, {
    // ─────────────────────────────────────────────
    // CULTURAL BUILDINGS
    // ─────────────────────────────────────────────
    /**
     * Show build cultural building menu
     */
    showBuildCulturalMenu(game, tile) {
        if (typeof Culture === 'undefined') return;

        const rows = [];
        for (const [key, building] of Object.entries(Culture.BUILDING_TYPES)) {
            const canBuild = (() => {
                if (game.player.gold < building.cost) return 'Not enough gold';
                if (building.requiredSettlement && !tile.settlement) return 'Requires a settlement';
                if (building.requiredPopulation && tile.settlement && tile.settlement.population < building.requiredPopulation)
                    return `Needs ${building.requiredPopulation}+ population`;
                if (tile.culturalBuilding || tile.playerProperty || tile.religiousBuilding) return 'Tile occupied';
                return null;
            })();
            const stats = [
                `Influence: +${building.influencePerDay}/day`, `Radius: ${building.influenceRadius}`,
                building.researchBonus ? `Research: +${Math.round(building.researchBonus * 100)}%` : '',
                building.moraleBonus ? `Morale: +${building.moraleBonus}` : '',
                building.renownPerDay ? `Renown: +${building.renownPerDay}/day` : '',
                building.incomeBonus ? `Income: +${Math.round(Culture.dailyIncome(building) * 10) / 10} gold/day` : '',
            ].filter(Boolean).join(' · ');
            rows.push({
                icon: building.icon, name: building.name, desc: building.description,
                note: `${stats} · 🏗️ ${building.constructionDays || 0} days`,
                attrs: `onclick="window._buildCultural('${key}')"`, off: !!canBuild, why: `${canBuild} · ${building.description}`,
                side: price(building.cost, game.player.gold >= building.cost),
            });
        }
        let html = '<div>';
        html += lede('Raise a house of learning, art or worship: it spreads your influence over the land around it.');
        html += chips([purse(game.player.gold)]);
        html += rowList(rows, 'Build Cultural Building');
        html += '</div>';
        game.ui.showCustomPanel('📚 Cultural Buildings', html);

        window._buildCultural = (buildingType) => {
            if (!ActionMenu.commitPendingAP(game)) return;
            const result = Culture.buildCulturalBuilding(game.player, buildingType, tile, game.world);
            if (result.success) {
                if (result.underConstruction) {
                    game.ui.showNotification('🏗️ Construction Started!', `${result.building.icon} ${result.building.name} is under construction — ${result.constructionDays} days to completion.`, 'info');
                } else {
                    game.ui.showNotification('Building Constructed!', `${result.building.icon} ${result.building.name} will spread knowledge and influence`, 'success');
                }
                game.ui.updateStats(game.player, game.world);
                game.ui.hideCustomPanel();
            } else {
                game.ui.showNotification('Cannot Build', result.reason, 'error');
            }
        };
    },

    /**
     * Upgrade the player's cultural building on this tile (confirm panel).
     */
    showUpgradeCulturalMenu(game, tile) {
        if (typeof Culture === 'undefined' || !tile.culturalBuilding) return;
        const b = tile.culturalBuilding;
        const level = b.level || 1;
        const check = Culture.canUpgrade(game.player, tile);
        const next = { ...b, level: level + 1 };
        const row = (label, now, then) => kv(label, `${now} → <strong style="color:#8fd18a;">${then}</strong>`);

        let html = '<div>';
        html += lede(`${b.icon} <b>${b.name}</b> — Level ${level}/${Culture.LEVELS.max}`);
        if (level < Culture.LEVELS.max) {
            html += sectionHead(`At level ${level + 1}`);
            if (b.incomeBonus) html += row('Income', `${Math.round(Culture.dailyIncome(b) * 10) / 10} gold/day`, `${Math.round(Culture.dailyIncome(next) * 10) / 10} gold/day`);
            html += row('Influence', `+${b.influencePerDay * level}/day`, `+${b.influencePerDay * (level + 1)}/day`);
            if (b.researchBonus) html += row('Research', `+${Math.round(b.researchBonus * Culture.levelMultiplier(b) * 100)}%`, `+${Math.round(b.researchBonus * Culture.levelMultiplier(next) * 100)}%`);
            if (b.moraleBonus) html += row('Army morale', `+${Math.round(b.moraleBonus / 5 * Culture.levelMultiplier(b))}%`, `+${Math.round(b.moraleBonus / 5 * Culture.levelMultiplier(next))}%`);
            if (b.renownPerDay) html += row('Renown', `+${b.renownPerDay * level}/day`, `+${b.renownPerDay * (level + 1)}/day`);
        }
        html += `<div style="margin-top: 10px;">${rowList([{
            icon: '⬆️', name: 'Upgrade', desc: `${b.name} to level ${level + 1}`,
            attrs: 'onclick="window._upgradeCultural()"', off: !check.can, why: check.reason,
            side: check.cost !== undefined ? price(check.cost, game.player.gold >= check.cost) : '',
        }])}</div>`;
        html += '</div>';
        game.ui.showCustomPanel('📚 Upgrade Cultural Building', html);

        window._upgradeCultural = () => {
            if (!ActionMenu.commitPendingAP(game)) return;
            const result = Culture.upgradeCulturalBuilding(game.player, tile);
            if (result.success) {
                game.ui.showNotification('📚 Building Upgraded', `${result.building.icon} ${result.building.name} is now level ${result.level}.`, 'success');
                game.ui.updateStats(game.player, game.world);
                game.ui.hideCustomPanel();
            } else {
                game.ui.showNotification('Cannot Upgrade', result.reason, 'error');
            }
        };
    },

    // ─────────────────────────────────────────────
    // PILGRIMAGE / HOLY SITES
    // ─────────────────────────────────────────────
    /**
     * Visit a holy site: kneel with an offering (the pilgrim pays), keep a
     * sworn pilgrimage, pray, swear a new one (systems/devotion.js)
     */
    visitHolySite(game, tile) {
        if (!tile || !tile.holySite) return;
        DevotionPanel.showPilgrimage(game, tile);
    },

    // postBail, attemptJailbreak and attemptServitudeEscape: ./prisonScenes.js (player/prison.js)

    /**
     * Buy freedom from indentured servitude
     */
    buyFreedom(game) {
        const result = PlayerMilitary.buyFreedom(game.player);
        if (result.success) {
            game.ui.showNotification('Freedom Bought!', result.message, 'success');
        } else {
            game.ui.showNotification('Cannot Buy Freedom', result.reason, 'error');
        }
        game.ui.updateStats(game.player, game.world);
    },

    // ── RECRUIT SETTLERS MENU ──────────────────────────
    /**
     * Show the recruit settlers menu at a foreign settlement
     */
    showRecruitSettlersMenu(game, tile) {
        const player = game.player;
        const world = game.world;
        const sourcePop = tile.settlement.population;
        const maxRecruit = Math.max(1, Math.floor(sourcePop * 0.02));

        // Get player colonies that need settlers
        const colonies = (player.colonies || []).map(c => {
            const ct = world.getTile(c.q, c.r);
            if (!ct || !ct.settlement) return null;
            const pop = ct.settlement.population;
            const enRoute = ct.settlement.colony?.recruitment?.enRoute || 0;
            return { ...c, pop, enRoute, tile: ct };
        }).filter(c => c && c.pop < 50);

        if (colonies.length === 0) {
            game.ui.showNotification('No Colonies', 'You have no colonies that need settlers.', 'info');
            return;
        }

        const SEL = `${BTN_GOLD} font-size: 12px;`;
        const UNSEL = `${BTN_DARK} font-size: 12px;`;
        let html = '<div style="max-width: 520px;">';
        html += lede(`📢 Convince people from <strong>${tile.settlement.name}</strong> (pop. ${sourcePop}) to move to your settlement.`);
        html += chips([
            ['👥', 'Max recruitable', `${maxRecruit} people`],
            ['⏳', 'Cost', '2 AP per attempt'],
            purse(player.gold),
        ]);
        html += `<div style="font-size: 11px; color: #9d937c; margin: -4px 0 8px;">Max recruitable: ${maxRecruit} people (2% of population) | Cost: 2 AP per attempt</div>`;

        // Colony selection
        if (colonies.length > 1) {
            html += sectionHead('Send settlers to:');
            html += '<div style="display: flex; gap: 2px; margin-bottom: 12px; flex-wrap: wrap;">';
            colonies.forEach((c, i) => {
                html += `<button onclick="window._selectTargetColony(${i})" id="colSel_${i}" style="${i === 0 ? SEL : UNSEL}">${c.name} (${c.pop} settlers${c.enRoute > 0 ? `, ${c.enRoute} en route` : ''})</button>`;
            });
            html += '</div>';
        } else {
            html += kv('Destination', `<strong style="color: #ffcf6a;">${colonies[0].name}</strong> (${colonies[0].pop} settlers${colonies[0].enRoute > 0 ? `, ${colonies[0].enRoute} en route` : ''})`);
        }

        // Recruitment methods
        const methods = [
            { id: 'persuade', name: 'Spread the Word', icon: '🗣️', desc: 'Persuade people with tales of opportunity. Free but limited by charisma.', costLabel: 'Free', tone: 'good' },
            { id: 'hire', name: 'Hire Settlers', icon: '💰', desc: `Pay workers to relocate. ${maxRecruit * 15}g for ${maxRecruit} settlers.`, costLabel: price(maxRecruit * 15, player.gold >= maxRecruit * 15), tone: '' },
            { id: 'promise', name: 'Promise Prosperity', icon: '✨', desc: 'Make grand promises of wealth and land. Effective but slightly dubious.', costLabel: 'Free (−1 karma)', tone: 'warn' },
        ];
        html += rowList(methods.map(m => {
            const disabled = m.id === 'hire' && player.gold < maxRecruit * 15;
            return {
                icon: m.icon, name: m.name, desc: m.desc, side: m.costLabel, tone: m.tone,
                attrs: `onclick="window._recruitSettlers('${m.id}')"`, off: disabled, why: `${m.desc} Not enough gold.`,
            };
        }), 'How will you recruit?');

        html += '</div>';
        game.ui.showCustomPanel('📢 Recruit Settlers', html);

        let selectedColonyIdx = 0;

        window._selectTargetColony = (idx) => {
            selectedColonyIdx = idx;
            colonies.forEach((_, i) => {
                const btn = document.getElementById('colSel_' + i);
                if (btn) btn.setAttribute('style', i === idx ? SEL : UNSEL);
            });
        };

        window._recruitSettlers = (method) => {
            if (!ActionMenu.commitPendingAP(game)) return;
            const target = colonies[selectedColonyIdx];
            if (!target) return;

            const result = Colonization.recruitSettlers(player, tile, target.tile, world, maxRecruit, method);
            if (result.success) {
                game.ui.showNotification('📢 Settlers Recruited!',
                    `${result.recruited} people will head to ${result.colonyName}! (${result.enRoute} en route, ${result.goldSpent}g spent)`, 'success');
                game.ui.updateStats(game.player, game.world);
                // Refresh
                game.ui.hideCustomPanel();
            } else {
                game.ui.showNotification('Cannot Recruit', result.reason, 'error');
            }
        };
    },

    /**
     * Post a signboard at player colony
     */
    doPostSignboard(game, tile) {
        const result = Colonization.postSignboard(game.player, tile);
        if (result.success) {
            game.ui.showNotification('📋 Signboard Posted', `A signboard now advertises ${tile.settlement.name} to passing travelers.`, 'success');
        } else {
            game.ui.showNotification('Cannot Post', result.reason, 'error');
        }
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Show colony founding menu
     */
    showFoundColonyMenu(game, tile) {
        const player = game.player;
        const world = game.world;
        const q = player.q;
        const r = player.r;

        // Check for nearby indigenous
        const nearbyIndigenous = Colonization.getNearbyIndigenous(world, q, r, 3);
        let indigenousWarning = '';
        if (nearbyIndigenous.length > 0) {
            const names = nearbyIndigenous.map(i => i.name).join(', ');
            indigenousWarning = `<p style="color:#f0b35a; font-size:12px; margin:4px 0 8px;">⚠️ Nearby indigenous: ${names}</p>`;
        }

        // Distance from capital
        const capitalTile = world.getAllSettlements().find(s => s.kingdom === player.allegiance && s.type === 'capital');
        let distInfo = '';
        if (capitalTile) {
            const dist = Hex.wrappingDistance(q, r, capitalTile.q, capitalTile.r, world.width);
            const penalty = Colonization.getDistancePenalty(world, world.kingdoms.find(k => k.id === player.allegiance), q, r);
            distInfo = kv('Distance from capital', `<b>${dist}</b> hexes (loyalty penalty: <span style="color:${penalty > 15 ? '#e0846a' : '#8fd18a'}">-${penalty.toFixed(1)}</span>)`);
        }

        // Policy options: picking one sets the hidden #selectedPolicy and marks its row
        const pickJs = (id) => `document.querySelectorAll('.colony-policy-opt .pk-row-side').forEach(function(e){e.textContent=''});this.querySelector('.pk-row-side').textContent='✓ chosen';document.getElementById('selectedPolicy').value='${id}'`;
        const policyRows = Object.entries(Colonization.POLICIES).map(([id, policy]) => ({
            icon: '📜', name: policy.name,
            desc: policy.description || policy.desc || '',
            note: `Expansion: +${(policy.expansionBonus * 100).toFixed(0)}% | Loyalty: +${policy.loyaltyBonus} | Production: +${(policy.productionBonus * 100).toFixed(0)}%`,
            attrs: `onclick="${pickJs(id)}"`, side: id === 'manifest_destiny' ? '✓ chosen' : '', tone: 'gold',
        }));

        let html = '<div style="max-height:450px; overflow-y:auto;">';
        html += lede(`Establish a frontier colony here for <b>${Colonization.COLONY_COST} gold</b>.`);
        html += chips([{ icon: '💰', label: 'Your gold', value: player.gold.toFixed(0), cls: 'gold' }]);
        html += distInfo;
        html += indigenousWarning;
        html += sectionHead('Colony Name:');
        html += `<input type="text" id="colonyNameInput" value="${Kingdom.generateCityName('Imperial')}"
                       style="width:100%; box-sizing:border-box; padding:7px 10px; background:rgba(0,0,0,0.3); color:#ece2c8; border:1px solid rgba(245,197,66,0.22); border-radius:6px; font-size:13px;">`;
        html += sectionHead('Colonization Policy:');
        html += '<input type="hidden" id="selectedPolicy" value="manifest_destiny">';
        html += `<div class="colony-policy-opt">${rowList(policyRows)}</div>`;
        html += rowList([{
            icon: '🏴', name: 'Found Colony', desc: 'Raise the banner and settle here',
            act: 'executeFoundColony', args: [q, r], tone: 'gold',
            side: price(Colonization.COLONY_COST, player.gold >= Colonization.COLONY_COST),
        }]);
        html += '</div>';

        game.ui.showCustomPanel('Found Colony', html);
    },

    /**
     * Execute colony founding
     */
    executeFoundColony(game, q, r) {
        const player = game.player;
        const world = game.world;
        const tile = world.getTile(q, r);
        const name = document.getElementById('colonyNameInput')?.value || 'New Colony';
        const policyId = document.getElementById('selectedPolicy')?.value || 'manifest_destiny';

        const result = Colonization.foundPlayerColony(player, tile, world, q, r, name, policyId);
        if (result.success) {
            // The colony stands: the founding panel is done with
            game.ui.hideCustomPanel();
            game.ui.showNotification('Colony Founded!', `${name} has been established as your frontier colony!`, 'success');
            game.endDay();
        } else {
            game.ui.showNotification('Cannot Found Colony', result.reason || 'Requirements not met', 'error');
        }
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Show send pioneers menu — pick a target from map
     */
    showSendPioneersMenu(game, tile) {
        const player = game.player;
        const world = game.world;

        // Find suitable wilderness targets
        const targets = [];
        for (let attempt = 0; attempt < 100; attempt++) {
            const tq = Utils.randInt(0, world.width - 1);
            const tr = Utils.randInt(5, world.height - 6);
            const t = world.getTile(tq, tr);
            if (t && t.terrain.passable && !t.settlement) {
                const dist = Hex.wrappingDistance(player.q, player.r, tq, tr, world.width);
                if (dist > 8 && dist < 30) {
                    const score = Colonization.getWildernessScore(t, world, tq, tr);
                    if (score > 0) {
                        targets.push({ q: tq, r: tr, dist, score, terrain: t.terrain.name });
                    }
                }
            }
        }

        // Sort by score descending and take top 5
        targets.sort((a, b) => b.score - a.score);
        const best = targets.slice(0, 5);

        if (best.length === 0) {
            game.ui.showNotification('No Targets', 'No suitable wilderness for pioneers found nearby.', 'default');
            return;
        }

        let html = '<div style="max-height:400px; overflow-y:auto;">';
        html += lede('Send a pioneering party to settle a distant region. Cost: <b>200 gold</b>');
        html += chips([purse(player.gold)]);
        html += rowList(best.map(target => {
            const hasIndigenous = Colonization.getNearbyIndigenous(world, target.q, target.r, 2).length > 0;
            return {
                icon: '🗺️', name: target.terrain,
                desc: `Distance: ${target.dist} hexes${hasIndigenous ? ' · <span style="color:#f0b35a;">⚠️ Indigenous nearby</span>' : ''}`,
                note: `Suitability: ${'⭐'.repeat(Math.min(5, Math.ceil(target.score / 2)))}`,
                act: 'executeSendPioneers', args: [target.q, target.r], side: price(200, player.gold >= 200),
            };
        }), 'Choose a target region:');
        html += '</div>';

        game.ui.showCustomPanel('Send Pioneers', html);
    },

    /**
     * Execute sending pioneers
     */
    executeSendPioneers(game, targetQ, targetR) {
        const player = game.player;
        const world = game.world;
        if (!ActionMenu.commitPendingAP(game)) return;

        if (player.gold < 200) {
            game.ui.showNotification('Not Enough Gold', 'You need 200 gold to send pioneers.', 'error');
            return;
        }

        const result = Colonization.sendPioneerParty(player, world, targetQ, targetR);
        if (result.success) {
            game.ui.showNotification('Pioneers Dispatched!', result.message || 'A pioneering party has set out to settle new lands!', 'success');
            game.ui.hideCustomPanel();
        } else {
            game.ui.showNotification('Cannot Send Pioneers', result.reason || 'Failed to dispatch pioneers.', 'error');
        }
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Show colony management menu
     */
    showManageColonyMenu(game, tile) {
        const colony = tile.settlement.colony;
        if (!colony) return;

        const world = game.world;
        const player = game.player;
        const capitalTile = world.getAllSettlements().find(s => s.kingdom === player.allegiance && s.type === 'capital');
        let dist = 0;
        if (capitalTile) {
            dist = Hex.wrappingDistance(tile.q, tile.r, capitalTile.q, capitalTile.r, world.width);
        }

        const policy = Colonization.POLICIES[colony.policy] || Colonization.POLICIES.manifest_destiny;
        const loyaltyColor = colony.loyalty > 60 ? '#4CAF50' : colony.loyalty > 30 ? '#e8a040' : '#ff4444';
        const nearbyIndigenous = Colonization.getNearbyIndigenous(world, tile.q, tile.r, 3);
        const rec = colony.recruitment || {};
        const isEmptyColony = tile.settlement.population < 10;
        const currentIncentive = Colonization.INCENTIVES[rec.incentive] || Colonization.INCENTIVES.none;

        let html = '<div style="max-height:550px; overflow-y:auto;">';
        html += lede(`Colony: <b>${tile.settlement.name}</b>`);
        html += chips([
            ['👥', 'Population', `${tile.settlement.population}${rec.enRoute ? ` <small style="color:#ffcf6a;">(+${rec.enRoute} en route)</small>` : ''}`],
            ['🤝', 'Loyalty', `<span style="color:${loyaltyColor}">${colony.loyalty.toFixed(1)}%</span>`],
            ['📏', 'Distance', `${dist} hexes`],
            ['🛡️', 'Garrison', colony.garrisonStrength],
        ]);

        // ── Missionary work (Missionary policy) ──
        if (policy.missionaryWork) {
            const m = colony.missionary || {};
            const mw = policy.missionaryWork;
            const faith = m.faith || (player.religion ? player.religion.name : null);
            html += card(`<div style="font-size:12px;">${faith
                ? `Spreading <b>${faith}</b> within ${mw.radius} hexes: ${m.settlements || 0} settlement${m.settlements === 1 ? '' : 's'}, ${m.tribes || 0} tribe${m.tribes === 1 ? '' : 's'} reached · ${m.converts || 0} tribal converts so far.`
                : 'Found a religion to have this colony\'s missionaries spread it. Until then they still befriend nearby tribes.'}
                <div style="color:#9d937c; margin-top:3px;">Nearby tribes warm to the colony each day; the mother kingdom gains cultural influence and piety.</div></div>`, { icon: '⛪', title: 'Missionary Work' });
        }

        // ── Recruitment Status (shown when colony is young / small) ──
        if (isEmptyColony || rec.recruited > 0) {
            let body = chips([
                ['', 'Recruited', rec.recruited || 0],
                { icon: '', label: 'En Route', value: rec.enRoute || 0, cls: 'gold' },
                ['', 'Reputation', (rec.reputation || 0).toFixed(0)],
            ]);
            const rows = [];
            rows.push(rec.signboard
                ? { icon: '📋', name: 'Signboard', desc: 'Advertising the colony to passing travellers', side: '✓ Posted', tone: 'good' }
                : { icon: '📋', name: 'Signboard', desc: 'Post one to advertise the colony to passing travellers', act: 'postSignboardAndManageColony', args: [tile.q, tile.r], side: 'Post (20g)', tone: 'gold' });
            body += rowList(rows);
            body += `<div style="font-size:12px; margin:2px 0 4px;">Current Incentive: <b>${currentIncentive.icon} ${currentIncentive.name}</b>${currentIncentive.dailyCost > 0 ? ` <small style="color:#f0b35a;">(${currentIncentive.dailyCost}g/day)</small>` : ''}</div>`;
            const incRows = [];
            for (const [id, inc] of Object.entries(Colonization.INCENTIVES)) {
                if (id === 'none') continue;
                const active = rec.incentive === id;
                const setupCost = Number(inc.setupCost || 0);
                const dailyCost = Number(inc.dailyCost || 0);
                const attractionBonusPct = Number((inc.attractionBonus || 0) * 100).toFixed(0);
                incRows.push({
                    icon: inc.icon, name: inc.name, desc: `${inc.desc || ''} (Setup: ${setupCost}g, Daily: ${dailyCost}g, +${attractionBonusPct}% attraction)`,
                    act: '_setIncentiveFromManage', args: [tile.q, tile.r, id],
                    side: active ? '✓ current' : `${setupCost}g + ${dailyCost}g/day`, tone: active ? 'gold' : '',
                });
            }
            const none = rec.incentive === 'none' || !rec.incentive;
            incRows.push({ icon: '—', name: 'None', desc: 'Remove incentives', act: '_setIncentiveFromManage', args: [tile.q, tile.r, 'none'], side: none ? '✓ current' : '', tone: none ? 'gold' : '' });
            body += rowList(incRows);
            html += card(body, { icon: '📢', title: 'Recruitment Status' });

            if (isEmptyColony) {
                html += '<div style="font-size:12px; color:#9d937c; margin:0 0 10px;">💡 <b style="color:#ece2c8;">Tip:</b> Visit other settlements and use <em>Recruit Settlers</em> to attract people. Post a signboard and set incentives to draw settlers passively each day. Once you reach 10 settlers, the settlement will begin to grow on its own.</div>';
            }
        }

        const relColor = colony.indigenousRelation > 50 ? '#8fd18a' : colony.indigenousRelation > 0 ? '#f0b35a' : '#e0846a';
        html += sectionHead('The colony');
        html += kv('Policy', `${policy.name} — <small style="font-weight:400; color:#9d937c;">${policy.description || policy.desc || ''}</small>`);
        html += kv('Indigenous Relations', `<b style="color:${relColor}">${colony.indigenousRelation.toFixed(0)}</b> / 100`);
        html += `<div style="font-size:11px; color:#9d937c; padding:2px 0 4px;">${nearbyIndigenous.length > 0 ? `Nearby: ${nearbyIndigenous.map(i => `${i.name} (${i.population})`).join(', ')}` : 'No indigenous nearby'}</div>`;
        html += kv('Founded', `Day ${colony.foundedDay} (${Math.floor((world.day - colony.foundedDay) / 30)} months ago)`);

        html += rowList([
            { icon: '🛡️', name: 'Reinforce Garrison', desc: '+10 garrison', act: 'reinforceColony', args: [tile.q, tile.r], side: price(100, player.gold >= 100) },
            { icon: '💰', name: 'Send Gold Aid', desc: '+15 loyalty', act: 'sendGoldToColony', args: [tile.q, tile.r], side: price(150, player.gold >= 150) },
            { icon: '🏰', name: 'Manage Holding', desc: 'projects, governor, garrison', act: 'openTileMenu', args: ['showHoldingPanel', tile.q, tile.r], side: '›' },
            { icon: '📜', name: 'Change Policy', desc: `Now: ${policy.name}`, act: 'changeColonyPolicy', args: [tile.q, tile.r], side: '›' },
        ], 'Colony Actions:');

        if (colony.loyalty < Colonization.REVOLT_LOYALTY + 10) {
            html += card(`<div style="color:#e0846a;">⚠️ <b>Warning:</b> This colony is at risk of independence revolt!${colony.loyalty < Colonization.REVOLT_LOYALTY ? '<br>🔥 <b>REVOLT IMMINENT!</b>' : ''}</div>`, { tone: 'bad' });
        }
        html += '</div>';

        game.ui.showCustomPanel('Colony Management', html);
    },

    /**
     * Set incentive from manage colony panel and refresh
     */
    _setIncentiveFromManage(game, q, r, incentiveId) {
        const tile = game.world.getTile(q, r);
        if (!tile) return;
        const result = Colonization.setColonyIncentive(game.player, tile, incentiveId);
        if (result.success) {
            game.ui.showNotification('Incentive Updated', result.message || `Incentive set to ${incentiveId}.`, 'success');
        } else {
            game.ui.showNotification('Cannot Set Incentive', result.reason, 'error');
        }
        game.ui.updateStats(game.player, game.world);
        ActionMenu.showManageColonyMenu(game, tile);
    },

    /**
     * Reinforce colony garrison
     */
    reinforceColony(game, q, r) {
        const player = game.player;
        const tile = game.world.getTile(q, r);
        if (!tile || !tile.settlement || !tile.settlement.colony) return;

        if (player.gold < 100) {
            game.ui.showNotification('Not Enough Gold', 'Need 100 gold to reinforce.', 'error');
            return;
        }

        player.gold -= 100;
        tile.settlement.colony.garrisonStrength += 10;
        tile.settlement.colony.loyalty = Math.min(100, tile.settlement.colony.loyalty + 5);
        game.ui.showNotification('Garrison Reinforced', `${tile.settlement.name} garrison strengthened to ${tile.settlement.colony.garrisonStrength}.`, 'success');
        ActionMenu.showManageColonyMenu(game, tile);
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Send gold to boost colony loyalty
     */
    sendGoldToColony(game, q, r) {
        const player = game.player;
        const tile = game.world.getTile(q, r);
        if (!tile || !tile.settlement || !tile.settlement.colony) return;

        if (player.gold < 150) {
            game.ui.showNotification('Not Enough Gold', 'Need 150 gold to send aid.', 'error');
            return;
        }

        player.gold -= 150;
        tile.settlement.colony.loyalty = Math.min(100, tile.settlement.colony.loyalty + 15);
        game.ui.showNotification('Aid Sent', `${tile.settlement.name} loyalty boosted to ${tile.settlement.colony.loyalty.toFixed(1)}%.`, 'success');
        ActionMenu.showManageColonyMenu(game, tile);
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Change colony policy
     */
    changeColonyPolicy(game, q, r) {
        const tile = game.world.getTile(q, r);
        if (!tile || !tile.settlement || !tile.settlement.colony) return;

        let html = lede('Select a new colonization policy for this colony:');
        html += rowList(Object.entries(Colonization.POLICIES).map(([id, policy]) => {
            const isCurrent = tile.settlement.colony.policy === id;
            return {
                icon: isCurrent ? '✅' : '📜', name: policy.name,
                desc: policy.description || policy.desc || '',
                note: `Expansion: +${(policy.expansionBonus * 100).toFixed(0)}% | Indigenous: ${policy.indigenousRelation > 0 ? '+' : ''}${policy.indigenousRelation} | Loyalty: +${policy.loyaltyBonus} | Production: +${((policy.productionBonus || 0) * 100).toFixed(0)}%`,
                act: 'executeChangePolicy', args: [q, r, id], side: isCurrent ? '(current)' : '', tone: isCurrent ? 'gold' : '',
            };
        }));

        game.ui.showCustomPanel('Change Colony Policy', html);
    },

    /**
     * Execute policy change
     */
    executeChangePolicy(game, q, r, policyId) {
        const tile = game.world.getTile(q, r);
        if (!tile || !tile.settlement || !tile.settlement.colony) return;

        tile.settlement.colony.policy = policyId;
        const policy = Colonization.POLICIES[policyId];
        game.ui.showNotification('Policy Changed', `${tile.settlement.name} now follows ${policy.name} policy.`, 'success');
        ActionMenu.showManageColonyMenu(game, tile);
    },

    /**
     * Show indigenous negotiation menu
     */
    showNegotiateIndigenousMenu(game, tile) {
        const indigenous = tile.indigenous;
        if (!indigenous) return;

        const hostility = Colonization.getTribeHostility(indigenous);
        const hostilityColor = hostility > 60 ? '#ff4444' : hostility > 30 ? '#e8a040' : '#4CAF50';
        const dispositionText = Colonization.getTribeDisposition(indigenous);
        const canLearn = Colonization.canLearnFromTribe(indigenous);
        const trade = typeof indigenous.tradeability === 'number' ? indigenous.tradeability : 0.5;
        const tradeWord = trade >= 0.6 ? 'Keen traders' : trade >= 0.4 ? 'Willing traders' : 'Reluctant traders';

        let html = '<div style="max-height:450px; overflow-y:auto;">';
        html += lede(`The <b>${indigenous.name}</b> · ${tile.terrain.name} · ${tradeWord}`);
        html += chips([
            ['👥', 'Population', indigenous.population],
            ['🙂', 'Disposition', `<span style="color:${hostilityColor}">${dispositionText}</span>`],
            ['⚔️', 'Hostility', `<span style="color:${hostilityColor}">${hostility}</span> / 100`],
            purse(game.player.gold),
        ]);
        html += kv('Territory', `${tile.terrain.name} <small style="color:#9d937c; font-weight:400;">${tradeWord}</small>`);
        html += rowList([
            { icon: '🤝', name: 'Trade Goods', desc: 'reduces hostility — more with keen traders', act: 'tradeWithIndigenous', args: [tile.q, tile.r], side: price(Colonization.TRIBE_TRADE_COST, game.player.gold >= Colonization.TRIBE_TRADE_COST) },
            { icon: '🎁', name: 'Offer Tribute', desc: 'greatly reduces hostility', act: 'giftToIndigenous', args: [tile.q, tile.r], side: price(Colonization.TRIBE_TRIBUTE_COST, game.player.gold >= Colonization.TRIBE_TRIBUTE_COST) },
            { icon: '📖', name: 'Learn Local Knowledge', desc: canLearn ? 'Available' : 'Need friendly relations', act: 'learnFromIndigenous', args: [tile.q, tile.r], side: canLearn ? 'Available' : '', tone: canLearn ? 'good' : 'warn' },
        ], 'Diplomatic Options:');
        html += hostility > 50
            ? `<div style="color:#e0846a; font-size:12px; margin-top:4px;">⚠️ The ${indigenous.name} are ${dispositionText.toLowerCase()} towards outsiders. Trade or tribute may improve relations.</div>`
            : `<div style="color:#8fd18a; font-size:12px; margin-top:4px;">The ${indigenous.name} are ${dispositionText.toLowerCase()} and open to interaction.</div>`;
        html += '</div>';

        game.ui.showCustomPanel('Negotiate with Natives', html);
    },

    /**
     * Trade with indigenous
     */
    tradeWithIndigenous(game, q, r) {
        const tile = game.world.getTile(q, r);
        const player = game.player;
        if (!tile || !tile.indigenous) return;
        if (!ActionMenu.commitPendingAP(game)) return;

        const res = Colonization.tradeWithTribe(player, tile.indigenous);
        if (!res.success) {
            game.ui.showNotification('Not Enough Gold', res.reason, 'error');
            return;
        }

        game.ui.showNotification('Trade Successful',
            `Traded with the ${tile.indigenous.name}: their goods resold for ${res.profit} gold. Relations +${res.relationGain} (hostility now ${res.hostility}). +${res.karma} karma from cultural exchange.`, 'success');
        ActionMenu.showNegotiateIndigenousMenu(game, tile);
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Offer tribute to indigenous
     */
    giftToIndigenous(game, q, r) {
        const tile = game.world.getTile(q, r);
        const player = game.player;
        if (!tile || !tile.indigenous) return;
        if (!ActionMenu.commitPendingAP(game)) return;

        const res = Colonization.tributeToTribe(player, tile.indigenous);
        if (!res.success) {
            game.ui.showNotification('Not Enough Gold', res.reason, 'error');
            return;
        }

        game.ui.showNotification('Tribute Accepted',
            `The ${tile.indigenous.name} graciously accept your tribute. Relations +${res.relationGain} (hostility now ${res.hostility}). +${res.renown} renown.`, 'success');
        ActionMenu.showNegotiateIndigenousMenu(game, tile);
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Learn local knowledge from friendly indigenous
     */
    learnFromIndigenous(game, q, r) {
        const tile = game.world.getTile(q, r);
        const player = game.player;
        if (!tile || !tile.indigenous) return;
        if (!ActionMenu.commitPendingAP(game)) return;

        if (!Colonization.canLearnFromTribe(tile.indigenous)) {
            game.ui.showNotification('Too Hostile', 'The natives don\'t trust you enough to share their knowledge. Improve relations first.', 'error');
            return;
        }

        // Random benefit
        const benefits = [
            { text: 'terrain navigation', stat: 'speed', value: 0 },
            { text: 'local herbs and medicine', stat: 'karma', value: Utils.randInt(2, 5) },
            { text: 'ancient trade routes', stat: 'gold', value: Utils.randInt(20, 80) },
            { text: 'survival techniques', stat: 'renown', value: Utils.randInt(3, 8) },
        ];
        const benefit = Utils.randPick(benefits);
        
        if (benefit.stat === 'gold') player.gold += benefit.value;
        else if (benefit.stat === 'karma') player.karma = (player.karma || 0) + benefit.value;
        else if (benefit.stat === 'renown') player.renown = (player.renown || 0) + benefit.value;

        // Slight hostility increase from knowledge exchange
        Colonization.noteTribeTaught(tile.indigenous);

        game.ui.showNotification('Knowledge Gained', 
            `The ${tile.indigenous.name} teach you about ${benefit.text}. ${benefit.value > 0 ? `+${benefit.value} ${benefit.stat}` : ''}`, 'success');
        game.ui.updateStats(game.player, game.world);
    },

    // ────────────────────────────────────────────
    //  CARTOGRAPHY
    // ────────────────────────────────────────────
    /**
     * Show main cartography menu
     */
    showCartographyMenu(game, tile) {
        const player = game.player;
        const skill = player.skills.cartography || 0;
        const skillDesc = Cartography.getSkillDescription(skill);
        const quality = Cartography.getQualityForSkill(skill);
        const qualityData = Cartography.QUALITY[quality];
        const mapCount = (player.maps || []).length;
        const exploredCount = Cartography.countExploredTiles(game.world);
        const totalTiles = game.world.width * game.world.height;

        let html = '<div style="max-height:500px; overflow-y:auto;">';
        html += lede(`<span style="color:#ffcf6a;">${skillDesc}</span>`);
        html += chips([
            { icon: '🗺️', label: 'Cartography Skill', value: `${skill.toFixed(1)} / 10`, cls: 'gold' },
            ['', 'Map Quality', `${qualityData.icon} ${qualityData.label} · Accuracy: ${(qualityData.accuracy * 100).toFixed(0)}%`],
            ['📚', 'Maps Owned', mapCount],
            ['🗺️', 'Explored', `${exploredCount} / ${totalTiles} tiles`],
        ]);
        html += ActionMenu._chartingSection(game);
        if (mapCount > 0) {
            html += rowList([{ icon: '📚', name: 'View Map Collection', desc: `${mapCount} maps`, act: 'showMapCollection', side: '›' }], 'Your Maps:');
        }
        if (skill >= 3) {
            html += rowList([{ icon: '✏️', name: 'Add Deliberate Errors', desc: 'Alter a map for deception/security', note: 'Requires cartography skill 3+', act: 'showAddErrorsMenu', side: '›', tone: 'warn' }], 'Advanced:');
        }
        html += '</div>';

        game.ui.showCustomPanel('🗺️ Cartography', html);
    },

    /** The draft and the maps it can be drawn into (systems/cartography/charting.js). */
    _chartingSection(game) {
        const { player, world } = game;
        const count = Cartography.draftCount(player);
        const here = Cartography.isCharted(player, player.q, player.r);
        let html = sectionHead('Charting');
        html += `<p style="margin:0 0 4px;"><b>Charting:</b> ${count} tile${count === 1 ? '' : 's'} charted toward your next map.</p>
                <p style="font-size:12px; color:#9d937c; margin:2px 0 6px;">Walk the land and use <b>📏 Chart This Tile</b> on each tile (1 AP). Once enough tiles are charted, draw them up into a map here.${here ? ' This tile is already charted.' : ''}</p>`;
        const rows = [];
        for (const o of Cartography.drawOptions(player, world)) {
            const can = o.ready && player.gold >= o.cost;
            const why = !o.ready ? o.reason : player.gold < o.cost ? `Ink and vellum cost ${o.cost}g.` : `Ink and vellum: ${o.cost}g`;
            const progress = `${Math.min(o.have, o.need)} / ${o.need} tiles charted${o.type === 'survey' ? ', resources marked' : ''}`;
            rows.push({
                icon: o.icon, name: `Draw ${esc(o.name)}`, desc: progress, note: can ? esc(why) : '',
                act: 'createMap', args: [o.type], off: !can, why: `${esc(why)} · ${progress}`,
                side: price(o.cost, player.gold >= o.cost),
            });
        }
        // A standing order: walk the area and chart it all (ui/game/autoChart.js)
        const order = Cartography.autoChartView(player, world);
        if (order) {
            rows.push({ icon: '🗺️', name: 'Stop auto-charting', desc: `${order.charted} charted, ${order.left} left within ${order.radius} tiles`, act: 'stopAutoChartArea', side: '■', tone: 'bad' });
        }
        if (count > 0) {
            rows.push({ icon: '🗑️', name: 'Throw away the charted sheets', desc: `${count} tile${count === 1 ? '' : 's'} lost`, act: 'discardChartDraft', tone: 'bad' });
        }
        html += rowList(rows);
        if (!order) {
            html += sectionHead('🧭 Auto-chart the area');
            html += '<div style="font-size:11px; color:#9d937c; margin:-2px 0 4px;">walks and charts every tile nearby, resting each night (1 AP a step, 1 AP a tile; Escape stops)</div>';
            const auto = [];
            for (const radius of Cartography.CHARTING.autoRadii || [2, 3, 4]) {
                const left = Cartography._autoTargets(player, world, player.q, player.r, radius).length;
                auto.push({
                    icon: '🗺️', name: `${radius} tiles around`, desc: `${left} to chart`,
                    act: 'autoChartArea', args: [radius], off: !left, why: `${left} to chart`,
                    side: `${left} to chart`,
                });
            }
            html += rowList(auto);
        }
        return html;
    },

    /** Chart the tile underfoot (the 📏 action; its 1 AP is already spent). */
    doChartTile(game) {
        const { player, world } = game;
        const res = Cartography.chartTile(player, world);
        if (!res.success) {
            game.ui.showNotification('Cannot Chart', res.reason, 'error');
            return;
        }
        const ready = Cartography.drawOptions(player, world).filter(o => o.ready).map(o => o.name);
        const seen = [res.settlement, res.resource ? `${res.resource} noted` : null].filter(Boolean).join(', ');
        game.ui.showNotification('📏 Tile Charted',
            `You sketch the ${res.terrain}${seen ? ` (${seen})` : ''}. ${res.count} tile${res.count === 1 ? '' : 's'} charted.`
            + (ready.length ? ` Enough to draw: ${ready.join(', ')} (Cartography).` : ''), 'success');
        game.ui.updateStats(player, world);
    },

    /** Scrub the clothes by hand (the 🧺 action; its AP is already spent). */
    doWashClothes(game) {
        const { player, world } = game;
        const res = player.washClothesByHand(world);
        if (!res.success) {
            game.ui.showNotification('Cannot Wash', res.reason, 'error');
            return;
        }
        const cs = player.clothesState();
        game.ui.showNotification('🧺 Clothes Washed', `You scrub your clothes at ${res.where} and wring them out. They are ${cs.label.toLowerCase()} again (${cs.freshness}%), if a little damp. A bath will get you properly clean now.`, 'success');
        game.ui.updateStats(player, world);
    },

    /** Bathe in the water here, or at the well or bathhouse (player/core/needs.js bathe). */
    doBathe(game) {
        const { player, world } = game;
        const res = player.bathe(world);
        if (!res.success) {
            game.ui.showNotification('Cannot Bathe', res.reason, 'error');
            return;
        }
        const bits = [];
        if (res.clothes > 0) bits.push('scrub your clothes');
        const cold = res.kind === 'wild' && res.cold < 0 ? (res.cold <= -10 ? ' The water is bitterly cold.' : ' The water is cold.') : '';
        const paid = res.cost > 0 ? ` (${res.cost} gold)` : '';
        const title = res.kind === 'bathhouse' ? '🛁 A Hot Bath' : '🧼 Washed';
        game.ui.showNotification(title, `You ${bits.length ? bits.join(', ') + ' and ' : ''}wash at ${res.where}${paid}: hygiene +${res.gained}.${cold}`, 'success');
        game.ui.updateStats(player, world);
    },

    /** Give the order to chart the area (the walking is the game loop's, ui/game/autoChart.js). */
    autoChartArea(game, radius) {
        // Opening Cartography left its AP pending; the survey pays its own way, a step and a tile at a time
        ActionMenu._pendingAP = null;
        if (typeof game.startAutoChart === 'function') game.startAutoChart(Number(radius));
    },

    /** Call the survey off. */
    stopAutoChartArea(game) {
        if (typeof game.stopAutoChart === 'function') game.stopAutoChart();
        ActionMenu.showCartographyMenu(game, game.world.getTile(game.player.q, game.player.r));
    },

    /** Throw the draft away. */
    discardChartDraft(game) {
        Cartography.discardDraft(game.player);
        game.ui.showNotification('Sheets Discarded', 'You throw away your charted sheets.', 'info');
        ActionMenu.showCartographyMenu(game, game.world.getTile(game.player.q, game.player.r));
    },

    /** Draw the charted tiles up into a map. */
    createMap(game, type) {
        const { player, world } = game;
        const opt = Cartography.drawOptions(player, world).find(o => o.type === type);
        if (!opt) return;
        if (!opt.ready) {
            game.ui.showNotification('Not Enough Charted', opt.reason, 'error');
            return;
        }
        if (player.gold < opt.cost) {
            game.ui.showNotification('Not Enough Gold', `You need ${opt.cost} gold for ink and vellum.`, 'error');
            return;
        }
        if (!ActionMenu.commitPendingAP(game)) return;
        const res = Cartography.drawMap(player, world, type);
        if (!res.success) {
            game.ui.showNotification('Failed', res.reason, 'error');
            return;
        }
        player.gold -= opt.cost;
        const map = res.map;
        // A Royal Cartographer is paid a commission for every survey
        const commission = type === 'survey' ? Titles.recordSurvey(player) : 0;

        game.ui.showNotification('Map Drawn!',
            `${map.name} (${Cartography.QUALITY[map.quality].label} quality), ${map.tiles.length} tiles charted, worth ${map.value}g.${commission ? ` The crown pays ${commission}g for the survey.` : ''}`, 'success');
        game.ui.updateStats(player, world);
        ActionMenu.showCartographyMenu(game, world.getTile(player.q, player.r));
    },

    /**
     * Show map collection
     */
    showMapCollection(game) {
        const player = game.player;
        const maps = player.maps || [];

        if (maps.length === 0) {
            game.ui.showNotification('No Maps', 'You don\'t have any maps yet.', 'default');
            return;
        }

        const SMALL = 'padding:2px 8px; margin:0 0 0 4px; font-size:11px;';
        let html = '<div style="max-height:500px; overflow-y:auto;">';
        html += chips([['📚', 'Maps', maps.length], purse(player.gold)]);
        const rows = [];
        for (let i = 0; i < maps.length; i++) {
            const map = maps[i];
            const qualityData = Cartography.QUALITY[map.quality] || Cartography.QUALITY.crude;
            const ageText = map.createdDay > 0 ? `Day ${map.createdDay}` : 'Ancient';

            let tags = '';
            if (map.isPropaganda) tags += '<span style="color:#e0846a; margin-left:4px;">[PROPAGANDA]</span>';
            if (map.isStolen) tags += '<span style="color:#f0b35a; margin-left:4px;">[STOLEN]</span>';
            if (map.isAncient) tags += '<span style="color:#a0a0ff; margin-left:4px;">[ANCIENT]</span>';
            if (map.deliberateErrors.length > 0) tags += '<span style="color:#ff9999; margin-left:4px;">[ALTERED]</span>';

            rows.push(actRow({
                icon: map.icon || '📜', name: `${map.name}${tags}`,
                desc: `${qualityData.label} | Accuracy: ${(map.accuracy * 100).toFixed(0)}% | By: ${map.createdBy} | ${ageText} · worth <span style="color:#ffcf6a;">${map.value}g</span>`,
                note: map.notes ? `<i style="color:#9d937c;">${map.notes}</i>` : '',
                side: `<button data-am-act="readMap" data-am-args='[${i}]' style="${BTN_PLAIN} ${SMALL}">📖 Read</button>`
                    + `<button data-am-act="sellPlayerMap" data-am-args='[${i}]' style="${BTN_GOLD} ${SMALL}">💰 Sell (${Math.floor(map.value * 0.7)}g)</button>`,
            }));
        }
        html += rowList(rows, 'Your Maps');
        html += '</div>';
        game.ui.showCustomPanel('📚 Map Collection', html);
    },

    /**
     * Read/apply a map from collection
     */
    readMap(game, mapIndex) {
        const player = game.player;
        const maps = player.maps || [];
        if (mapIndex < 0 || mapIndex >= maps.length) return;

        const map = maps[mapIndex];
        const world = game.world;

        // Check for propaganda/errors detection
        let warningText = '';
        if ((map.isPropaganda || map.deliberateErrors.length > 0) && Cartography.canDetectErrors(player, map)) {
            warningText = map.isPropaganda
                ? ' ⚠️ You detect propaganda — some borders shown are false!'
                : ` ⚠️ You notice ${map.deliberateErrors.length} deliberate alteration(s) in this map!`;
        }

        const result = Cartography.applyMap(player, map, world, { detected: !!warningText });

        let msg = `Studied ${map.name}. Revealed ${result.tilesRevealed} tiles.`;
        if (result.deceptionsSpotted > 0) msg += ` 🔍 You spot ${result.deceptionsSpotted} thing(s) on it that don't look right.`;
        if (warningText) msg += warningText;
        if (map.type === 'treasure' && map.treasureQ !== undefined) {
            msg += ` 💎 Treasure location marked on your map!`;
        }
        if (map.isAncient && map.sites && map.sites.length > 0) {
            msg += ` 📍 ${map.sites.length} ancient site(s) revealed!`;
        }
        // An old map may mark a place on no other chart (systems/discovery.js)
        if (result.discovery) msg += ` 🧭 ${result.discovery.text}`;

        game.ui.showNotification('Map Read', msg, 'success');
        game.ui.updateStats(game.player, game.world);
        ActionMenu.showMapCollection(game);
    },

    /**
     * Sell a map from collection
     */
    sellPlayerMap(game, mapIndex) {
        const result = Cartography.sellMap(game.player, mapIndex);
        if (result.success) {
            game.ui.showNotification('Map Sold', `Sold ${result.mapName} for ${result.gold} gold.`, 'success');
            game.ui.updateStats(game.player, game.world);
            if ((game.player.maps || []).length > 0) {
                ActionMenu.showMapCollection(game);
            } else {
                game.ui.hideCustomPanel();
            }
        } else {
            game.ui.showNotification('Cannot Sell', result.reason, 'error');
        }
    },

    /**
     * Show add deliberate errors menu
     */
    showAddErrorsMenu(game) {
        const player = game.player;
        const maps = player.maps || [];
        const editableMaps = maps.filter(m => !m.isPropaganda && !m.isAncient && m.deliberateErrors.length < Cartography.MAX_DELIBERATE_ERRORS);

        if (editableMaps.length === 0) {
            game.ui.showNotification('No Maps', 'No maps available to alter.', 'default');
            return;
        }

        let html = '<div style="max-height:400px; overflow-y:auto;">';
        html += lede('Add deliberate errors to a map for deception or security. Altered maps appear authentic but contain false information.');
        const rows = [];
        for (let i = 0; i < maps.length; i++) {
            const map = maps[i];
            if (map.isPropaganda || map.isAncient || map.deliberateErrors.length >= Cartography.MAX_DELIBERATE_ERRORS) continue;
            rows.push({
                icon: map.icon || '📜', name: map.name,
                desc: `Current errors: ${map.deliberateErrors.length} / ${Cartography.MAX_DELIBERATE_ERRORS}`,
                act: 'executeAddErrors', args: [i], side: '✏️', tone: 'warn',
            });
        }
        html += rowList(rows);
        html += '</div>';
        game.ui.showCustomPanel('✏️ Alter Map', html);
    },

    /**
     * Execute adding errors to a map
     */
    executeAddErrors(game, mapIndex) {
        const player = game.player;
        const maps = player.maps || [];
        if (mapIndex < 0 || mapIndex >= maps.length) return;

        const map = maps[mapIndex];
        const errorsToAdd = Utils.randInt(1, 3);
        Cartography.addDeliberateErrors(map, errorsToAdd, game.world);

        game.ui.showNotification('Map Altered', 
            `Added ${errorsToAdd} deliberate error(s) to ${map.name}. Accuracy reduced to ${(map.accuracy * 100).toFixed(0)}%.`, 'info');
        ActionMenu.showCartographyMenu(game, game.world.getTile(player.q, player.r));
    },

    /**
     * Show map trade menu at a settlement
     */
    showMapTradeMenu(game, tile) {
        const player = game.player;
        const world = game.world;

        // Get settlement coordinates
        let tileQ = player.q;
        let tileR = player.r;

        // Create a tile-like object with q,r for the sales function
        const tileWithCoords = { ...tile, q: tileQ, r: tileR };
        const availableMaps = Cartography.getAvailableMapsForSale(tileWithCoords, world);

        let html = '<div style="max-height:500px; overflow-y:auto;">';
        html += chips([{ icon: '💰', label: 'Your gold', value: player.gold.toFixed(0), cls: 'gold' }]);

        // Buy section
        html += sectionHead('📥 Maps for Sale');
        if (availableMaps.length === 0) {
            html += '<p style="color:#9d937c;">No maps available at this location.</p>';
        } else {
            const rows = [];
            for (let i = 0; i < availableMaps.length; i++) {
                const item = availableMaps[i];
                const map = item.map;
                const cost = item.price;
                const qualityData = Cartography.QUALITY[map.quality] || Cartography.QUALITY.crude;
                const canAfford = player.gold >= cost;

                let tags = '';
                if (map.isPropaganda) tags += '<span style="color:#e0846a; margin-left:4px;">[PROPAGANDA]</span>';
                if (map.isAncient) tags += '<span style="color:#a0a0ff; margin-left:4px;">[ANCIENT]</span>';

                // Store map data for purchase
                if (!window._mapTradeData) window._mapTradeData = [];
                window._mapTradeData[i] = item;

                const desc = `${qualityData.label} | Accuracy: ${(map.accuracy * 100).toFixed(0)}% | Radius: ${map.radius}`;
                rows.push({
                    icon: map.icon || '📜', name: `${map.name}${tags}`, desc,
                    note: map.notes ? `<i style="color:#9d937c;">${map.notes}</i>` : '',
                    act: 'buyMapFromTrade', args: [i, tileQ, tileR], off: !canAfford, why: `${desc} · not enough gold`,
                    title: `Buy (${cost}g)`, side: price(cost, canAfford),
                });
            }
            html += rowList(rows);
        }

        // Sell section
        const playerMaps = player.maps || [];
        if (playerMaps.length > 0) {
            html += rowList(playerMaps.map((map, i) => ({
                icon: map.icon || '📜', name: map.name, desc: 'Sell to the map trader',
                act: 'sellMapFromTrade', args: [i, tileQ, tileR], side: `Sell (${Math.floor(map.value * 0.7)}g)`, tone: 'good',
            })), '📤 Sell Your Maps');
        }

        // Royal archive of the realm that holds this town: buys maps of other realms
        const realm = tile.kingdom ? world.getKingdom(tile.kingdom) : null;
        const sType = tile.settlement && tile.settlement.type;
        if (realm && realm.isAlive && ['capital', 'city', 'town'].includes(sType)) {
            const atlas = KingdomAtlas.summary(realm, world);
            html += sectionHead(`🏛️ Royal Archive of ${realm.name}`);
            html += `<div style="font-size:11px; color:#9d937c;">${atlas.hired ? '🧭 Court cartographer employed' : 'No court cartographer'}`
                + ` · ${atlas.mapsMade} maps drawn · Charts ${(atlas.accuracy * 100).toFixed(0)}% accurate`
                + ` · Holds charts of: ${atlas.charts.length ? atlas.charts.map(c => c.name).join(', ') : 'none'}</div>`;
            if (atlas.distrust > 0) {
                html += `<div style="font-size:11px; color:#e0846a;">The archivists have caught you selling ${atlas.distrust} doctored map(s).</div>`;
            }
            const rows = [];
            for (let i = 0; i < playerMaps.length; i++) {
                const map = playerMaps[i];
                const offer = Cartography.archiveOffer(map, realm, world);
                if (!offer.price) continue;
                const note = offer.improves ? 'better than their chart' : 'they have a better chart';
                rows.push({
                    icon: map.icon || '📜', name: map.name, desc: `(${note})`,
                    act: 'sellMapToArchive', args: [i, tileQ, tileR], side: `Offer (${offer.price}g)`, tone: offer.improves ? 'good' : '',
                });
            }
            if (rows.length) html += `<div style="margin-top:6px;">${rowList(rows)}</div>`;
            else html += '<p style="color:#9d937c; margin:4px 0;">You carry no maps of other realms they would buy.</p>';
        }

        html += '</div>';
        game.ui.showCustomPanel('📜 Map Trader', html);
    },

    /**
     * Buy a map from trade menu
     */
    buyMapFromTrade(game, index, tileQ, tileR) {
        const item = window._mapTradeData ? window._mapTradeData[index] : null;
        if (!item) {
            game.ui.showNotification('Error', 'Map no longer available.', 'error');
            return;
        }
        if (!ActionMenu.commitPendingAP(game)) return;

        const result = Cartography.buyMap(game.player, item.map, item.price);
        if (result.success) {
            // Auto-reveal the map area on the world
            Cartography.applyMap(game.player, item.map, game.world);
            game.ui.showNotification('Map Purchased!', `Acquired ${item.map.name}! The area has been revealed on your map.`, 'success');
            game.ui.updateStats(game.player, game.world);
            // Refresh the trade menu
            const tile = game.world.getTile(tileQ, tileR);
            if (tile) ActionMenu.showMapTradeMenu(game, tile);
        } else {
            game.ui.showNotification('Cannot Buy', result.reason, 'error');
        }
    },

    /**
     * Sell a map from trade menu
     */
    sellMapFromTrade(game, mapIndex, tileQ, tileR) {
        if (!ActionMenu.commitPendingAP(game)) return;
        const result = Cartography.sellMap(game.player, mapIndex);
        if (result.success) {
            game.ui.showNotification('Map Sold', `Sold ${result.mapName} for ${result.gold} gold.`, 'success');
            game.ui.updateStats(game.player, game.world);
            const tile = game.world.getTile(tileQ, tileR);
            if (tile) ActionMenu.showMapTradeMenu(game, tile);
        } else {
            game.ui.showNotification('Cannot Sell', result.reason, 'error');
        }
    },

    /**
     * Sell a map to the royal archive of the realm holding (tileQ, tileR)
     */
    sellMapToArchive(game, mapIndex, tileQ, tileR) {
        const tile = game.world.getTile(tileQ, tileR);
        const realm = tile && tile.kingdom ? game.world.getKingdom(tile.kingdom) : null;
        if (!realm) return;
        if (!ActionMenu.commitPendingAP(game)) return;
        const result = Cartography.sellMapToArchive(game.player, mapIndex, realm, game.world);
        if (result.success) {
            const extra = result.planted > 0 ? ` Its ${result.planted} alteration(s) now sit in ${realm.name}'s war maps.` : '';
            game.ui.showNotification('Map Sold', `${realm.name}'s archive bought ${result.mapName} for ${result.gold} gold.${extra}`, 'success');
        } else {
            game.ui.showNotification(result.caught ? 'Forgery Spotted!' : 'Not Interested', result.reason, 'error');
        }
        game.ui.updateStats(game.player, game.world);
        if (tile) ActionMenu.showMapTradeMenu(game, tile);
    },

    // attemptStealMap and digTreasure: ./treasureScenes.js (systems/mapTheft.js, systems/treasureDigs.js)
});
