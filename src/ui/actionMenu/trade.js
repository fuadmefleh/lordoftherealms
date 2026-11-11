// ActionMenu — trade methods (split from the original monolith).
import { ActionMenu } from './_ref.js';
import { peopleLine } from './labour.js';
import { Guilds } from '../../systems/guilds.js';
import { Hospitality } from '../../systems/hospitality.js';
import { TradePolicy } from '../../systems/tradePolicy.js';
import { policyLine } from './tradePolicy.js';
import { MercContracts } from '../../player/mercContracts.js';
import { Crafting } from '../../player/crafting.js';
import { Grades } from '../../core/grades.js';
import { MarketGrades } from '../../world/marketGrades.js';
import { Fame } from '../../systems/fame.js';
import { Causes } from '../../player/causes.js';
import { whyIcon, priceWhy, sellWhy } from '../whyPopover.js';
import { goodInfoIcon } from '../goodInfo.js';
import { PlayerActions, PlayerEconomy, Trading, PlayerMilitary, Hex, Utils, Banking, MarketDynamics, Taxation, Technology, Titles, Quests, Terrain, Kingdom, NPCLords, Peoples, LegendaryArtifacts, BountyHunting, Religion, Espionage, Infrastructure, Tavern, Ships, Housing, Cartography, Colonization, Relationships, Councils, SaveLoad, Economy, DataLoader, PlayerInventory, NpcDisposition, Seasons, SettlementMarket } from './_imports.js';
import { SocialSkills } from '../../systems/socialSkills.js';
import { Livestock } from '../../systems/livestock.js';
import { lede, chips, purse, bullets, actRow, rowList, price, sectionHead, card, kv, BTN_GOLD, BTN_PLAIN, BTN_RED, BTN_OFF } from './uiKit.js';
import { BackRooms } from '../../systems/backRooms.js';
import { ParentsGuard } from '../parentsGuard.js';
import { Barter } from '../../world/barter.js';

/**
 * The market's tab bar: Buy and Sell here, and the town's other trade views
 * (Invest, Warehouse, People, Harvest, Estates, Putting-out, Tariffs, Ledger, ...) as tabs of the same
 * window, so moving between them keeps the bar and the window in place.
 */
export function setMarketNav(game, tile, active) {
    if (!game || !game.ui || typeof game.ui.setPanelNav !== 'function' || !tile || !tile.settlement) return;
    const go = (fn) => () => fn();
    // Buy, Sell and the Ledger up front; the town's other views behind "More"
    const items = [
        { key: 'buy', label: '🛒 Buy', run: go(() => ActionMenu.showTradeMenu(game, tile, 'buy')) },
        { key: 'sell', label: '💰 Sell', run: go(() => ActionMenu.showTradeMenu(game, tile, 'sell')) },
        { key: 'ledger', label: '📒 Ledger', title: 'Known prices, best spreads, price history and your trading profit', run: go(() => ActionMenu.showMerchantLedger(game, 'book')) },
        { key: 'invest', more: true, label: '🏭 Invest', title: 'Fund works in this town', run: go(() => ActionMenu.showMerchantPrince(game, null, 'invest')) },
        { key: 'warehouse', more: true, label: '📦 Warehouse', title: 'Rent a store-room here', run: go(() => ActionMenu.showMerchantPrince(game, null, 'warehouse')) },
        { key: 'contracts', more: true, label: '📜 Contracts', title: 'Forward contracts with this town', run: go(() => ActionMenu.showMerchantPrince(game, null, 'contracts')) },
        { key: 'people', more: true, label: '👥 People', title: "The town's classes, work, wages and welfare", run: go(() => ActionMenu.showTownPeople(game, null)) },
        { key: 'hinterland', more: true, label: '⛏️ Hinterland', title: 'The mines, quarries and sheep runs around the town; mining leases and prospecting', run: go(() => ActionMenu.showHinterland(game, null)) },
        { key: 'harvest', more: true, label: '🌾 Harvest', title: "The coming harvest here, the crop reports, the town's fields", run: go(() => ActionMenu.showHarvests(game, null)) },
        { key: 'estates', more: true, label: '🏡 Estates', title: 'The estates about the town: tenants, rents, land values; buy, improve, enclose', run: go(() => ActionMenu.showEstates(game, null, 'here')) },
        { key: 'puttingOut', more: true, label: '🧶 Putting-out', title: 'Put out wool and flax to the cottagers to spin and weave', run: go(() => ActionMenu.showPuttingOut(game, null)) },
    ];
    if (tile.settlement.guilds) items.push({ key: 'guilds', more: true, label: '⚒️ Guilds', title: 'The town guilds: tolls, membership, contracts', run: go(() => ActionMenu.showGuildhall(game, null)) });
    items.push({ key: 'laws', more: true, label: '📜 Laws', title: 'The laws of the realm: private prisons, land for foreigners, punishment', run: go(() => ActionMenu.showLaws(game, 'here')) });
    items.push({ key: 'tariffs', more: true, label: '⚖️ Tariffs', title: "The crown's duties, export bans, embargoes and treaties", run: go(() => ActionMenu.showTradePolicy(game, 'here')) });
    // Views with tabs of their own keep this bar and show theirs as sub-tabs
    // (uiKit.panelTabs): the Merchant Prince's Invest/Warehouse/Contracts are
    // this bar's tabs, the Ledger's and the Tariffs' sit under theirs
    const hosts = {
        merchantPrince: { invest: 'invest', warehouse: 'warehouse', contracts: 'contracts' },
        ledger: { '*': 'ledger' },
        tradePolicy: { '*': 'tariffs' },
        estates: { '*': 'estates' },
    };
    game.ui.setPanelNav({ id: 'market', title: `🏪 Market — ${tile.settlement.name || 'Market'}`, active, items, hosts });
}

Object.assign(ActionMenu, {
    /**
     * Show ship passage menu
     */
    showShipPassageMenu(game, tile) {
        const settlements = game.world.getAllSettlements();
        const coastalSettlements = settlements.filter(s => {
            if (s.q === tile.q && s.r === tile.r) return false;
            return Hex.neighbors(s.q, s.r).some(n => {
                const nt = game.world.getTile(n.q, n.r);
                return nt && ['ocean', 'deep_ocean', 'coast', 'lake', 'sea'].includes(nt.terrain.id);
            });
        });

        if (coastalSettlements.length === 0) {
            game.ui.showNotification('No Destinations', 'No other coastal settlements found!', 'default');
            return;
        }

        // The action menu's voice (uiKit): a lede, then one row a port with the fare at the right
        let html = lede('Hire a ship: travel across the seas to distant shores.');
        html += chips([['⚓', 'Ports', coastalSettlements.length], purse(game.player.gold)]);

        const rows = [];
        for (const dest of coastalSettlements) {
            const dist = Hex.wrappingDistance(tile.q, tile.r, dest.q, dest.r, game.world.width);
            const cost = 15 + (dist * 2);
            const travelDays = Math.max(1, Math.ceil(dist / 10));
            const canAfford = game.player.gold >= cost;
            const desc = `Distance: ${dist} hexes · ${travelDays} day${travelDays > 1 ? 's' : ''} at sea`;
            rows.push({
                icon: '⛵',
                name: dest.name,
                desc,
                off: !canAfford,
                why: `${desc} · not enough gold`,
                attrs: `onclick="window.payForPassage(${dest.q}, ${dest.r}, ${cost}, '${String(dest.name).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;')}', ${travelDays})"`,
                side: price(cost, canAfford),
            });
        }
        html += `<div style="max-height: 400px; overflow-y: auto;">${rowList(rows, 'Hire a Ship')}</div>`;

        game.ui.showCustomPanel('Coastal Travel', html);

        window.payForPassage = (q, r, cost, name, travelDays) => {
            if (!ActionMenu.commitPendingAP(game)) return;
            if (game.player.gold >= cost) {
                game.player.gold -= cost;
                game.player.q = q;
                game.player.r = r;
                game.player.isMoving = false;
                game.player.path = [];

                // Advance time based on travel distance — chain endDay calls
                game.ui.hideCustomPanel();
                let daysProcessed = 0;

                const processNextDay = () => {
                    daysProcessed++;
                    // Force-bypass confirm modal for sea travel
                    game._endDayConfirmed = true;
                    game.endDay();

                    if (daysProcessed < travelDays && game.player.health > 0) {
                        // Wait for the current endDay's setTimeout to finish, then queue next
                        const waitForTurn = setInterval(() => {
                            if (!game.isProcessingTurn) {
                                clearInterval(waitForTurn);
                                processNextDay();
                            }
                        }, 60);
                    } else {
                        // All days processed — show arrival
                        const waitDone = setInterval(() => {
                            if (!game.isProcessingTurn) {
                                clearInterval(waitDone);
                                game.recenterCamera();
                                game.ui.showNotification('Safe Voyage', `You arrived at ${name}. The journey took ${travelDays} day${travelDays > 1 ? 's' : ''}.`, 'success');
                                game.ui.updateStats(game.player, game.world);
                            }
                        }, 60);
                    }
                };

                processNextDay();
            } else {
                game.ui.showNotification('Insufficient Gold', 'You do not have enough gold for passage.', 'error');
            }
        };
    },

    /**
     * Collect stored goods from every property on this tile
     */
    collectGoods(game, tile) {
        if (!game.player.inventory) game.player.inventory = {};
        const parts = [];
        let full = false;
        for (const prop of PlayerEconomy.getPropertiesAt(tile)) {
            // Taverns pay out directly; their storage only tallies earnings
            if (!prop.produces || prop.produces === 'gold' || !(prop.storage > 0)) continue;
            const good = prop.produces;
            // No room for a new kind of good — it waits in the property's storage
            if (!PlayerInventory.addItem(game.player, good, prop.storage).success) { full = true; continue; }
            const goodDef = PlayerEconomy.GOODS[good.toUpperCase()];
            parts.push(`${prop.storage} ${goodDef ? goodDef.name : good}`);
            prop.storage = 0;
        }
        // ...and the eggs, milk, wool and feathers of your beasts kept here (systems/livestock.js)
        const herd = Livestock.collectAt(game.world, game.player, tile.q, tile.r);
        for (const [good, n] of Object.entries(herd.taken)) {
            const goodDef = PlayerEconomy.GOODS[good.toUpperCase()];
            parts.push(`${n} ${goodDef ? goodDef.name : good}`);
        }
        if (herd.full) full = true;
        if (full) game.ui.showNotification('🎒 Packs Full', `Some goods stay in storage. ${PlayerInventory.fullMessage(game.player)}`, 'warning');
        if (parts.length === 0) return;

        game.ui.showNotification('Goods Collected', `Collected ${parts.join(', ')}`, 'success');
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Pick which of the player's properties on this tile to manage. A tile can
     * hold one of each property type; the chosen one becomes the tile's
     * focused `playerProperty`, which the manage menu (and its refreshes) use.
     */
    showPropertyPicker(game, tile) {
        const props = PlayerEconomy.getPropertiesAt(tile);
        if (props.length <= 1) {
            ActionMenu.showManagePropertyMenu(game, tile);
            return;
        }
        const html = lede('You hold more than one property here. Which will you see to?') + rowList(props.map((p, i) => {
            const status = p.underConstruction
                ? `🏗️ ${p.constructionDaysLeft} day(s) left`
                : `Lv ${p.level} · ${p.storage > 0 && p.produces !== 'gold' ? `${p.storage} ${p.produces} stored` : 'running'}`;
            return { icon: p.icon || '🏠', name: p.name, side: status, attrs: `onclick="window._pickProperty(${i})"` };
        }));
        game.ui.showCustomPanel('🛠️ Your Properties Here', html);
        window._pickProperty = (i) => {
            tile.playerProperty = props[i];
            ActionMenu.showManagePropertyMenu(game, tile);
        };
    },

    /**
     * Show Manage Property Menu
     */
    showManagePropertyMenu(game, tile) {
        if (!tile.playerProperty) return;

        const prop = tile.playerProperty;
        const propType = PlayerEconomy.getPropertyDef(prop.type);
        const isWorkshop = PlayerEconomy.isRecipeBuilding(prop.type);

        // Calculate upgrade info
        const isMaxLevel = prop.level >= 5;
        const upgradeCost = Math.floor(propType.cost * 0.5 * (prop.level + 1));
        const canAffordUpgrade = game.player.gold >= upgradeCost;

        // Calculate upkeep
        const upkeep = PlayerEconomy.getPropertyUpkeep(game.player, prop);

        // Determine what is being produced and rate
        let productionText = 'Nothing selected';
        let prodRateText = '0';

        if (isWorkshop) {
            if (prop.activeRecipe) {
                const recipe = PlayerEconomy.RECIPES[prop.activeRecipe];
                if (recipe) {
                    const outputGood = PlayerEconomy.GOODS[recipe.output.toUpperCase()];
                    productionText = `${outputGood ? outputGood.name : recipe.output}`;
                    // Rate is tricky for workshop, maybe just show base rate
                    prodRateText = `${prop.productionRate * prop.level}`;
                }
            }
        } else if (prop.type === 'tavern') {
            productionText = 'Gold (patrons)';
            prodRateText = `~${prop.todayIncome || '15-35'}`;
        } else if (Hospitality.isKind(prop.type)) {
            // Guest houses, inns, hotels, roadhouses are run from their own panel (ui/actionMenu/lodging.js)
            productionText = `Guests (${prop.hosp ? prop.hosp.guests : 0} last night) · <a href="#" data-am-act="lodgingAct" data-am-args='${JSON.stringify(['tab', `p:${tile.q},${tile.r}:${prop.type}`, 'run'])}' style="color:var(--gold);">Run the house</a>`;
            prodRateText = `~${prop.todayIncome || 0}`;
        } else {
            // Standard prop
            const goodKey = (prop.produces || '').toUpperCase();
            const good = PlayerEconomy.GOODS[goodKey];
            productionText = good ? good.name : (prop.produces || 'Nothing');
            prodRateText = `${prop.productionRate * prop.level}`;
        }

        // Render menu
        // The action menu's voice (uiKit): a card for the house, chips and kv for its
        // numbers, rows for what can be done, small kit buttons where one item has several
        const bar = (pct, fill, h = 6) => `<div style="background:rgba(0,0,0,0.35); border-radius:4px; height:${h}px; overflow:hidden; margin:6px 0 3px;"><div style="width:${pct}%; height:100%; background:${fill}; transition:width 0.3s;"></div></div>`;
        const muted = (t) => `<div style="font-size:11px; color:#9d937c;">${t}</div>`;
        let html = '<div>';

        // Header info
        html += card(muted(propType.description), {
            icon: prop.icon,
            title: `${prop.name} <span style="font-size:12px; color:#9d937c; font-weight:400;">Lvl ${prop.level}</span>`,
            side: `Owned: ${prop.daysOwned} days`,
        });

        // If under construction, show only the construction banner and sell button — no management
        if (prop.underConstruction) {
            const pct = prop.constructionDaysTotal > 0 ? ((prop.constructionDaysTotal - prop.constructionDaysLeft) / prop.constructionDaysTotal * 100) : 100;
            const barColor = pct > 66 ? '#8fd18a' : pct > 33 ? '#f0b35a' : '#e0846a';
            html += card(bar(pct, barColor, 10) + muted(`${pct.toFixed(0)}% complete — no production or upkeep until finished`), {
                icon: '🏗️',
                title: 'Under Construction',
                side: `${prop.constructionDaysLeft} day${prop.constructionDaysLeft !== 1 ? 's' : ''} remaining`,
                tone: 'gold',
            });
            html += rowList([{
                icon: '💰',
                name: 'Sell Property',
                desc: 'Give up the works and take back a quarter of the cost',
                side: `Refund: ${Math.floor(propType.cost * 0.25)}g`,
                tone: 'bad',
                attrs: 'onclick="window.sellPropertyAction()"',
            }]);
            html += `</div>`;
            game.ui.showCustomPanel('Manage Property', html);

            // (There is no PlayerEconomy.sellProperty — this button used to throw.)
            window.sellPropertyAction = () => {
                const player = game.player;
                if (tile.playerProperty !== prop) {
                    game.ui.showNotification('Cannot Sell', 'That property is no longer yours.', 'error');
                    return;
                }
                const refund = Math.floor(propType.cost * 0.25);
                if (Array.isArray(tile.playerProperties)) tile.playerProperties = tile.playerProperties.filter(p => p !== prop);
                tile.playerProperty = (tile.playerProperties && tile.playerProperties[0]) || null;
                if (tile.playerProperties && !tile.playerProperties.length) tile.playerProperties = null;
                const idx = (player.properties || []).findIndex(r => r.q === tile.q && r.r === tile.r && r.type === prop.type);
                if (idx !== -1) player.properties.splice(idx, 1);
                player.gold += refund;
                game.ui.showNotification('Property Sold', `${prop.name} sold for ${refund} gold`, 'success');
                game.ui.updateStats(player, game.world);
                game.ui.hideCustomPanel();
            };
            return;
        }

        // The beasts kept here (systems/livestock.js): a livestock property's output rides on its herd
        const herdCfg = Livestock.placeConfig({ kind: 'property', type: prop.type });
        if (herdCfg) {
            const herd = Livestock.herd(game.player, Livestock.placeKey({ kind: 'property', q: tile.q, r: tile.r, type: prop.type }));
            const heads = herd ? herd.animals.length : 0;
            const factor = herdCfg.works ? Livestock.workFactor(game.world, game.player, tile, prop) : null;
            const draft = herdCfg.draft ? Livestock.draftFactor(game.world, game.player, tile, prop) : null;
            const bits = [`${heads} head kept here (room for ${herdCfg.species.map(id => (Livestock.species(id) || {}).icon || '').join('')})`];
            if (factor != null && prop.herdFounded) bits.push(`the herd makes <b style="color:${factor >= 1 ? '#8fd18a' : '#e0846a'};">${Math.round(factor * 100)}%</b> of its output (target ${herdCfg.works.target} head)`);
            if (draft && draft > 1) bits.push(`horses and muck lift the harvest +${Math.round((draft - 1) * 100)}%`);
            html += rowList([{ icon: '🐑', name: 'Your Herds', desc: bits.join(' · '), side: '›', act: 'showHerds' }]);
        }

        // ── Operational property management below ──
        const adminMult = PlayerEconomy.getAdministrationMultiplier(game.player);
        const opRows = [
            { icon: '⚙️', name: 'Production', desc: productionText, side: `Rate: ${prodRateText}/day`, tone: 'good' },
            { icon: '💰', name: 'Upkeep', desc: adminMult > 1 ? `incl. +${Math.round((adminMult - 1) * 100)}% admin overhead (${(game.player.properties || []).length} properties)` : 'Paid daily from your purse', side: `-${upkeep}g/day`, tone: 'bad' },
        ];
        if (prop.type === 'tavern') {
            opRows.push({ icon: '💰', name: 'Total Earnings', side: `${prop.storage || 0}g`, tone: 'gold' });
        } else {
            const stored = `${prop.storage} / ${PlayerEconomy.getStorageCapacity(game.player, prop)}`;
            const wasted = prop.wastedToday > 0 ? `<span style="color:#e0846a;">Full — ${prop.wastedToday} lost today</span> · ` : '';
            opRows.push({
                icon: '📦',
                name: 'Storage (Output) · Collect',
                desc: `${wasted}Take what is stored into your packs`,
                off: prop.storage <= 0,
                why: `${wasted}Nothing stored to collect`,
                attrs: 'onclick="window.collectPropertyGoods()"',
                side: stored,
            });
        }
        opRows.push({
            icon: '🏷️',
            name: 'Auto-Sell (50% Value)',
            desc: `${prop.autoSell ? 'Disable' : 'Enable'} — sell the output at half its value as it is made`,
            attrs: 'onclick="window.toggleAutoSell()"',
            side: `<span style="font-weight:700; color:${prop.autoSell ? '#8fd18a' : '#9d937c'};">${prop.autoSell ? 'ENABLED' : 'DISABLED'}</span>`,
        });
        html += rowList(opRows, 'Operations');

        // Workshop Specific Section: Recipe Selector & Input
        if (isWorkshop) {
            const propType = PlayerEconomy.getPropertyDef(prop.type) || {};
            const retoolingBaseCost = propType.recipeChangeCost || 150;
            const retoolingCost = Math.floor(retoolingBaseCost * prop.level);
            const isRetooling = prop.retooling && prop.retoolingDaysLeft > 0;

            html += sectionHead('Production Configuration');
            html += `<div class="pk-card"${isRetooling ? ' style="border-color:rgba(240,179,90,0.35);"' : ''}>`;

            // Show retooling status banner
            if (isRetooling) {
                html += actRow({
                    icon: '🔧',
                    name: '<span style="color:#f0b35a;">Retooling in Progress</span>',
                    desc: `${prop.retoolingDaysLeft} day${prop.retoolingDaysLeft !== 1 ? 's' : ''} remaining — no production during retooling`,
                });
            }

            html += `
                <div style="margin-bottom:10px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                        <div style="font-size:11px; color:#9d937c; text-transform:uppercase; letter-spacing:1px;">Active Recipe</div>
                        ${prop.activeRecipe ? `<div style="font-size:11px; color:#9d937c;">Change cost: <span style="color:#ffcf6a; font-weight:600;">${retoolingCost}g</span></div>` : ''}
                    </div>
                    <select id="workshopRecipeSelector" onchange="window.selectRecipe(this.value)" ${isRetooling ? 'disabled' : ''} style="width:100%; padding:8px 32px 8px 10px; background:rgba(0,0,0,0.3); border:1px solid rgba(245,197,66,0.25); color:var(--gold); border-radius:var(--radius-sm); font-family:var(--font-body); font-size:13px; font-weight:600; outline:none; cursor:pointer; -webkit-appearance:none; -moz-appearance:none; appearance:none; background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23f5c542' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E\"); background-repeat:no-repeat; background-position:right 8px center; background-size:12px; transition:all var(--transition-fast);">
                        <option value="" style="background:#0c1220; color:var(--text-primary);">-- Select Recipe --</option>
                        ${(() => {
                            const allRecipes = (typeof Technology !== 'undefined') ? Technology.getUnlockedRecipes(game.player) : PlayerEconomy.RECIPES;
                            const allowed = propType && propType.allowedRecipes ? propType.allowedRecipes : null;
                            return Object.values(allRecipes).filter(r => !allowed || allowed.includes(r.id.toUpperCase())).map(r => `
                            <option value="${r.id.toUpperCase()}" ${prop.activeRecipe === r.id.toUpperCase() ? 'selected' : ''} style="background:#0c1220; color:var(--text-primary); padding:6px 10px;">
                                ${r.name} (${r.inputQty} ${PlayerEconomy.GOODS[r.input.toUpperCase()]?.name} ➔ ${r.outputQty} ${PlayerEconomy.GOODS[r.output.toUpperCase()]?.name})
                            </option>
                        `).join('');
                        })()}
                    </select>
                </div>
            `;

            if (isRetooling) {
                // During retooling, show muted input section
                html += `<div style="color:#9d937c; font-style:italic; font-size:12px;">Workshop is being retooled. Deposits disabled until retooling completes.</div>`;
            } else if (prop.activeRecipe) {
                const recipe = PlayerEconomy.RECIPES[prop.activeRecipe];
                const inputGood = PlayerEconomy.GOODS[recipe.input.toUpperCase()];
                const playerHas = (game.player.inventory && game.player.inventory[recipe.input]) || 0;
                const dep = (n, label, gold = false) => `<button onclick="window.depositToWorkshop('${recipe.input}', ${n === 'all' ? playerHas : n})" ${playerHas < (n === 'all' ? 1 : n) ? 'disabled' : ''} style="${playerHas < (n === 'all' ? 1 : n) ? BTN_OFF : gold ? BTN_GOLD : BTN_PLAIN}">${label}</button>`;

                html += actRow({
                    icon: inputGood.icon || '📥',
                    name: `Input Storage (${inputGood.name}): ${prop.inputStorage || 0} <span style="font-weight:400; color:#9d937c;">stored</span>`,
                    desc: `In Inventory: <b style="color:#ece2c8;">${playerHas}</b>`,
                    side: `${dep(1, '+1')}${dep(10, '+10')}${dep(100, '+100')}${dep('all', '+All', true)}`,
                });
            } else {
                html += `<div style="color:#9d937c; font-style:italic; font-size:12px;">Select a recipe to enable production.</div>`;
            }

            html += `</div>`;
        }

        // Tavern-specific management section
        const isTavern = prop.type === 'tavern';
        if (isTavern) {
            const beerStock = prop.beerStock || 0;
            const liquorStock = prop.liquorStock || 0;
            const tables = prop.gamblingTables || 0;
            const tableCost = 150 + tables * 100;
            const maxTables = prop.level + 1;
            const canBuyTable = game.player.gold >= tableCost && tables < maxTables;
            const tablesLaw = BackRooms.tablesRun(game.world, tile, prop);
            const backRoomCost = BackRooms.config().fitCost;
            const playerBeer = (game.player.inventory && game.player.inventory.beer) || 0;
            const playerLiquor = (game.player.inventory && game.player.inventory.liquor) || 0;
            const todayIncome = prop.todayIncome || 0;

            const stock = (good, n) => {
                const has = good === 'beer' ? playerBeer : playerLiquor;
                const amount = n === 'all' ? has : n;
                const off = has < (n === 'all' ? 1 : n);
                return `<button onclick="window.stockTavern('${good}', ${amount})" ${off ? 'disabled' : ''} style="${off ? BTN_OFF : n === 'all' ? BTN_GOLD : BTN_PLAIN}">${n === 'all' ? 'All' : `+${n}`}</button>`;
            };
            html += sectionHead('🍻 Tavern Operations');
            html += chips([
                { icon: '💰', label: "Today's Income", value: `<span style="color:#8fd18a;">${todayIncome}g</span>` },
                { icon: '🎲', label: 'Gambling Tables', value: `${tables} / ${maxTables}`, cls: 'gold' },
            ]);
            html += lede('Stock your tavern with beer and liquor to boost daily income. Each table adds +15% income.');
            html += rowList([
                {
                    icon: '🍺',
                    name: `Beer: ${beerStock} <span style="font-weight:400; font-size:11px; color:#9d937c;">-2/day</span>`,
                    desc: '+30% income when stocked',
                    note: `<span style="color:#9d937c;">You have: ${playerBeer} beer</span>`,
                    side: stock('beer', 5) + stock('beer', 20) + stock('beer', 'all'),
                },
                {
                    icon: '🥃',
                    name: `Liquor: ${liquorStock} <span style="font-weight:400; font-size:11px; color:#9d937c;">-1/day</span>`,
                    desc: '+20% income when stocked',
                    note: `<span style="color:#9d937c;">You have: ${playerLiquor} liquor</span>`,
                    side: stock('liquor', 5) + stock('liquor', 10) + stock('liquor', 'all'),
                },
                // Where gaming is forbidden the tables stand idle until a back room
                // hides them, and then the watch may come for them (systems/backRooms.js)
                !tablesLaw.open ? {
                    icon: '🚪',
                    name: 'Fit a hidden back room',
                    desc: 'A false wall and a stair to the cellar: the tavern stays the honest front, the tables run below',
                    note: `<span style="color:#f0b35a;">${tablesLaw.why}</span>`,
                    off: game.player.gold < backRoomCost,
                    why: `Fitting it out costs ${backRoomCost}g`,
                    attrs: 'onclick="window.fitBackRoom()"',
                    side: price(backRoomCost, game.player.gold >= backRoomCost),
                } : {
                    icon: '🎲',
                    name: tables >= maxTables ? 'Max Tables (upgrade to add more)' : (tablesLaw.hidden ? 'Add a Back-Room Table' : 'Add Gambling Table'),
                    desc: 'Each table adds +15% income',
                    note: tablesLaw.hidden ? `<span style="color:#f0b35a;">Hidden in the back room: the watch may raid it and seize the tables</span>` : '',
                    off: !canBuyTable,
                    why: tables >= maxTables ? `${tables} / ${maxTables} tables` : 'Not enough gold',
                    attrs: 'onclick="window.buyGamblingTable()"',
                    side: tables >= maxTables ? '' : price(tableCost, game.player.gold >= tableCost),
                },
            ]);
        }

        // Upgrade Section
        const upgradeBtnLocked = isMaxLevel || !canAffordUpgrade;
        html += rowList([{
            icon: '⬆️',
            name: isMaxLevel ? 'MAX LEVEL' : `Upgrade to Level ${prop.level + 1}`,
            desc: 'Increases production by 10% base value. Increases upkeep.',
            off: upgradeBtnLocked,
            why: isMaxLevel ? 'This property is at its highest level' : 'Increases production by 10% base value. Increases upkeep. · not enough gold',
            attrs: 'onclick="window.upgradePropertyAction()"',
            side: isMaxLevel ? 'MAX' : price(upgradeCost, canAffordUpgrade),
        }], 'Expansion & Upgrades');

        // Caravan Logistics Section
        html += sectionHead('Logistics Network <span style="float:right; letter-spacing:0.5px; text-transform:none; color:#ffcf6a;">Cost: 200g/caravan</span>');
        html += lede('Hire a caravan to transport your stored goods directly to a market for max profit.');
        html += `<div id="caravanDestinations" class="pk-rows" style="max-height:220px; overflow-y:auto;">
                    ${ActionMenu.getLogisticsDestinationsHtml(game, tile)}
                </div>`;

        // Fishing Wharf Logic
        const isFishingWharf = prop.type === 'fishing_wharf';
        if (isFishingWharf) {
            html += sectionHead('Fishing Operations');
            html += chips([['⛵', 'Active Boats', `${ActionMenu.countFishingBoats(game, tile)} / ${prop.level}`]]);
            html += `<div style="font-size:11px; color:#9d937c; margin-bottom:6px;">Select Fishing Grounds:</div>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; max-height:150px; overflow-y:auto; margin-bottom:12px;">
                    ${ActionMenu.getVariablesFishingGrounds(game, tile)}
                </div>`;

            // Add helpers
            window.sendFishingBoat = (targetQ, targetR) => {
                const result = PlayerEconomy.sendFishingBoat(game.player, tile, targetQ, targetR, game.world);
                if (result.success) {
                    game.ui.showNotification('Boat Dispatched', 'A fishing boat is heading out.', 'success');
                    ActionMenu.showManagePropertyMenu(game, tile); // Refresh
                } else {
                    game.ui.showNotification('Cannot Dispatch', result.reason, 'error');
                }
            };
        }

        // ═══ RESEARCH LAB SECTION ═══
        if (typeof Technology !== 'undefined') {
            const labConfig = Technology.getLabConfig(prop.type);
            if (labConfig) {
                if (prop.hasLab) {
                    // Lab exists — show lab info, research status, crafting
                    const labCategories = labConfig.categories.map(c => {
                        const cat = Object.values(Technology.CATEGORIES).find(cc => cc.id === c);
                        return cat ? `${cat.icon} ${cat.name}` : c;
                    }).join(', ');

                    html += sectionHead(`${prop.labIcon || '🔬'} ${prop.labName || 'Research Lab'}`);
                    html += `<div>
                        <div style="font-size:12px; color:#9d937c; margin-bottom:8px;">Research Categories: ${labCategories}</div>
                    `;

                    // Current research status
                    Technology.initPlayer(game.player);
                    const currentRes = game.player.technology.currentResearch;
                    if (currentRes) {
                        const resTech = Technology.getTechByID(currentRes.techId);
                        const pct = Math.floor((currentRes.progress / currentRes.totalDays) * 100);
                        const remaining = currentRes.totalDays - currentRes.progress;
                        html += card(bar(pct, 'linear-gradient(90deg, #9c27b0, #e040fb)') + `<div style="text-align:right; font-size:11px; color:#9d937c;">${pct}%</div>`, {
                            icon: resTech.icon,
                            title: `Researching: ${resTech.name}`,
                            side: `${remaining} day${remaining !== 1 ? 's' : ''} left`,
                        });
                    }

                    // Current crafting status
                    const currentCraft = game.player.technology.currentCrafting;
                    if (currentCraft) {
                        const craftRecipe = Technology.PARTS_CRAFTING[currentCraft.partsType];
                        const craftPct = Math.floor((currentCraft.progress / currentCraft.totalDays) * 100);
                        const craftRemaining = currentCraft.totalDays - currentCraft.progress;
                        html += card(bar(craftPct, 'linear-gradient(90deg, #ff9800, #ffb74d)') + `<div style="text-align:right; font-size:11px; color:#9d937c;">${craftPct}% — produces ${currentCraft.quantity} parts</div>`, {
                            icon: '🔧',
                            title: `Crafting: ${craftRecipe ? craftRecipe.name : currentCraft.partsType}`,
                            side: `${craftRemaining} day${craftRemaining !== 1 ? 's' : ''} left`,
                        });
                    }

                    // Craft Parts button
                    const craftCheck = Technology.canCraftParts(game.player, prop);
                    const partsType = Technology.CATEGORY_PARTS[labConfig.categories[0]];
                    const partsRecipe = Technology.PARTS_CRAFTING[partsType];
                    const partsInInv = (game.player.inventory && game.player.inventory[partsType]) || 0;

                    const craftCost = `Cost: ${partsRecipe ? partsRecipe.gold + 'g + ' + Technology.formatMaterials(partsRecipe.materials) : '?'} → ${partsRecipe ? partsRecipe.quantity : '?'} parts (${partsRecipe ? partsRecipe.days : '?'} days)`;
                    html += rowList([{
                        icon: partsRecipe ? partsRecipe.icon : '🔧',
                        name: `Craft Parts <span style="font-weight:400; color:#9d937c;">· ${partsRecipe ? partsRecipe.name : 'Parts'} in inventory: <b style="color:#ece2c8;">${partsInInv}</b></span>`,
                        desc: craftCost,
                        off: !craftCheck.can,
                        why: !currentCraft ? `${craftCost} · ${craftCheck.reason}` : craftCost,
                        attrs: 'onclick="window.startCraftingParts()"',
                        side: partsRecipe ? price(partsRecipe.gold, game.player.gold >= partsRecipe.gold) : '',
                    }]);
                    html += '</div>';
                } else {
                    // Lab not built — show build lab section
                    const labCheck = Technology.canBuildLab(game.player, prop);
                    html += sectionHead('🔬 Build Research Lab');
                    html += lede(labConfig.description);
                    html += kv('Lab', labConfig.labName);
                    html += kv('Enables research in', labConfig.categories.map(c => { const cat = Object.values(Technology.CATEGORIES).find(cc => cc.id === c); return cat ? cat.name : c; }).join(', '));
                    html += kv('Cost', `<span style="color:#ffcf6a;">${labConfig.labCost}g</span> + ${Technology.formatMaterials(labConfig.labMaterials)}`);
                    html += kv('Upkeep', `Adds ${labConfig.labUpkeep}g/day upkeep`);
                    html += rowList([{
                        icon: '🔬',
                        name: 'Build Lab',
                        desc: labConfig.labName,
                        off: !labCheck.can,
                        why: labCheck.reason,
                        attrs: 'onclick="window.buildLabAction()"',
                        side: price(labConfig.labCost, game.player.gold >= labConfig.labCost),
                    }]);
                }
            }
        }

        html += `</div>`;
        game.ui.showCustomPanel('Manage Property', html);

        // Bind window functions
        window.collectPropertyGoods = () => {
            ActionMenu.collectGoods(game, tile);
            ActionMenu.showManagePropertyMenu(game, tile); // Refresh
        };

        window.toggleAutoSell = () => {
            if (tile.playerProperty) {
                tile.playerProperty.autoSell = !tile.playerProperty.autoSell;
                game.ui.showNotification('Settings Updated', `Auto-sell ${tile.playerProperty.autoSell ? 'enabled' : 'disabled'}`, 'info');
                ActionMenu.showManagePropertyMenu(game, tile); // Refresh
            }
        };

        window.upgradePropertyAction = () => {
            const result = PlayerEconomy.upgradeProperty(game.player, tile);
            if (result.success) {
                game.ui.showNotification('Upgrade Complete!', `Property upgraded to Level ${result.level}`, 'success');
                game.ui.updateStats(game.player, game.world);
                ActionMenu.showManagePropertyMenu(game, tile); // Refresh
            } else {
                game.ui.showNotification('Cannot Upgrade', result.reason, 'error');
            }
        };

        window.sendStorageCaravan = (q, r, propertyType = null) => {
            const targetTile = game.world.getTile(q, r);
            if (!targetTile) return;

            // A named property type means an internal transfer to that building,
            // even when it stands inside a settlement
            const targetProp = propertyType ? PlayerEconomy.findPropertyAt(targetTile, propertyType) : null;
            let toObject = null;
            if (targetProp) {
                toObject = {
                    type: targetProp.type,
                    name: targetProp.name,
                    q: targetTile.q,
                    r: targetTile.r,
                    isPlayerProperty: true
                };
            } else if (targetTile.settlement) {
                toObject = { ...targetTile.settlement, q: targetTile.q, r: targetTile.r, isPlayerProperty: false };
            }

            if (!toObject) return;

            const result = PlayerEconomy.startStorageCaravan(game.player, tile, toObject, game.world);

            if (result.success) {
                game.ui.showNotification('Caravan Dispatched', `Transporting goods to ${toObject.name}`, 'success');
                game.ui.updateStats(game.player, game.world);
                ActionMenu.showManagePropertyMenu(game, tile); // Refresh
            } else {
                game.ui.showNotification('Logistics Error', result.reason, 'error');
            }
        };

        window.selectRecipe = (recipeId) => {
            if (!recipeId) return;
            const prop = tile.playerProperty;
            const isChange = prop && prop.activeRecipe && prop.activeRecipe !== recipeId;

            if (isChange) {
                const propType = PlayerEconomy.getPropertyDef(prop.type) || {};
                const baseCost = propType.recipeChangeCost || 150;
                const retoolingCost = Math.floor(baseCost * prop.level);
                const retoolingDays = propType.retoolingDays || 2;
                const oldRecipe = PlayerEconomy.RECIPES[prop.activeRecipe];
                const newRecipe = PlayerEconomy.RECIPES[recipeId];

                // Show confirmation dialog
                const inputReturn = (prop.inputStorage > 0 && oldRecipe)
                    ? `\n• ${prop.inputStorage} ${oldRecipe.input} returned to inventory`
                    : '';
                const msg = `Retool workshop to produce ${newRecipe ? newRecipe.name : recipeId}?\n\n• Cost: ${retoolingCost} gold\n• Downtime: ${retoolingDays} days (no production)${inputReturn}`;
                if (!confirm(msg)) {
                    // Reset dropdown to current value
                    const sel = document.getElementById('workshopRecipeSelector');
                    if (sel) sel.value = prop.activeRecipe;
                    return;
                }
            }

            const result = PlayerEconomy.setWorkshopRecipe(tile, recipeId, game.player);
            if (result.success) {
                if (result.wasChange) {
                    game.ui.showNotification('Workshop Retooled', 'Retooling in progress...', 'info');
                    game.ui.updateStats(game.player, game.world);
                }
                ActionMenu.showManagePropertyMenu(game, tile);
            } else {
                game.ui.showNotification('Cannot Change Recipe', result.reason, 'error');
                // Reset dropdown
                const sel = document.getElementById('workshopRecipeSelector');
                if (sel && prop) sel.value = prop.activeRecipe || '';
            }
        };

        window.depositToWorkshop = (goodId, amount) => {
            const result = PlayerEconomy.depositToWorkshop(game.player, tile, goodId, amount);
            if (result.success) {
                game.ui.showNotification('Deposited', `Added ${amount} ${goodId} to workshop`, 'success');
                game.ui.updateStats(game.player, game.world);
                ActionMenu.showManagePropertyMenu(game, tile);
            } else {
                game.ui.showNotification('Deposit Failed', result.reason, 'error');
            }
        };

        // Lab & crafting handlers
        window.buildLabAction = () => {
            if (typeof Technology === 'undefined') return;
            const result = Technology.buildLab(game.player, tile.playerProperty);
            if (result.success) {
                // Increase upkeep
                const config = Technology.getLabConfig(tile.playerProperty.type);
                if (config) tile.playerProperty.upkeep = (tile.playerProperty.upkeep || 0) + config.labUpkeep;
                game.ui.showNotification('Lab Built!', `${result.labName} is now operational`, 'success');
                game.ui.updateStats(game.player, game.world);
                ActionMenu.showManagePropertyMenu(game, tile);
            } else {
                game.ui.showNotification('Cannot Build Lab', result.reason, 'error');
            }
        };

        window.startCraftingParts = () => {
            if (typeof Technology === 'undefined') return;
            const result = Technology.startCrafting(game.player, tile.playerProperty);
            if (result.success) {
                game.ui.showNotification('Crafting Started', `${result.recipe.name} — ${result.estimatedDays} days`, 'info');
                game.ui.updateStats(game.player, game.world);
                ActionMenu.showManagePropertyMenu(game, tile);
            } else {
                game.ui.showNotification('Cannot Craft', result.reason, 'error');
            }
        };

        // Tavern handlers
        window.stockTavern = (goodType, amount) => {
            if (!tile.playerProperty || tile.playerProperty.type !== 'tavern') return;
            const inv = game.player.inventory || {};
            const has = inv[goodType] || 0;
            const actual = Math.min(amount, has);
            if (actual <= 0) return;
            inv[goodType] = has - actual;
            if (goodType === 'beer') {
                tile.playerProperty.beerStock = (tile.playerProperty.beerStock || 0) + actual;
            } else if (goodType === 'liquor') {
                tile.playerProperty.liquorStock = (tile.playerProperty.liquorStock || 0) + actual;
            }
            game.ui.showNotification('Tavern Stocked', `Added ${actual} ${goodType} to the tavern`, 'success');
            game.ui.updateStats(game.player, game.world);
            ActionMenu.showManagePropertyMenu(game, tile);
        };

        window.buyGamblingTable = () => {
            if (!tile.playerProperty || tile.playerProperty.type !== 'tavern') return;
            const tables = tile.playerProperty.gamblingTables || 0;
            const maxTables = tile.playerProperty.level + 1;
            if (tables >= maxTables) {
                game.ui.showNotification('Max Tables', 'Upgrade your tavern to add more tables', 'error');
                return;
            }
            const law = BackRooms.tablesRun(game.world, tile, tile.playerProperty);
            if (!law.open) {
                game.ui.showNotification('🚫 Gaming Forbidden', `${law.why} Fit a back room first.`, 'error');
                return;
            }
            const cost = 150 + tables * 100;
            if (game.player.gold < cost) {
                game.ui.showNotification('Not Enough Gold', `Need ${cost} gold`, 'error');
                return;
            }
            game.player.gold -= cost;
            tile.playerProperty.gamblingTables = tables + 1;
            game.ui.showNotification('🎲 Table Added!', `Gambling table installed! (${tables + 1}/${maxTables}) — +15% daily income`, 'success');
            game.ui.updateStats(game.player, game.world);
            ActionMenu.showManagePropertyMenu(game, tile);
        };

        window.fitBackRoom = () => {
            const res = BackRooms.fitBackRoom(game.player, game.world, tile);
            if (!res.success) {
                game.ui.showNotification('🚪 No Back Room', res.reason, 'error');
                return;
            }
            game.ui.showNotification('🚪 A Back Room', res.text, 'success');
            game.ui.updateStats(game.player, game.world);
            ActionMenu.showManagePropertyMenu(game, tile);
        };
    },

    /**
     * Helper to generate destination list for logistics
     */
    getLogisticsDestinationsHtml(game, tile) {
        if (!tile.playerProperty || tile.playerProperty.storage <= 0) {
            return '<div style="padding:10px; text-align:center; color:#9d937c; font-style:italic; font-size:12px;">No goods in storage to transport.<br>wait for production or collect manually.</div>';
        }
        // A tavern's takings (gold) and a workshop without a set output are not cargo
        const good = PlayerEconomy.GOODS[String(tile.playerProperty.produces || '').toUpperCase()];
        if (!good) {
            return '<div style="padding:10px; text-align:center; color:#9d937c; font-style:italic; font-size:12px;">Nothing here a caravan can carry to market.</div>';
        }

        const settlements = game.world.getAllSettlements();
        let html = '';
        let count = 0;

        // Sort by distance
        settlements.sort((a, b) => {
            const da = Hex.wrappingDistance(tile.q, tile.r, a.q, a.r, game.world.width);
            const db = Hex.wrappingDistance(tile.q, tile.r, b.q, b.r, game.world.width);
            return da - db;
        });

        for (const s of settlements) {
            const dist = Hex.wrappingDistance(tile.q, tile.r, s.q, s.r, game.world.width);

            // Filter: max range 20, don't show current tile if it's a settlement
            if (dist > 0 && dist <= 20) {
                let multiplier = 1.0;
                if (s.type === 'capital') multiplier = 1.5;
                else if (s.type === 'city') multiplier = 1.2;

                const basePrice = MarketDynamics.getPrice(good.id, s.q, s.r, game.world);
                const trend = MarketDynamics.getPriceTrend(good.id, s.q, s.r, game.world);

                let trendIcon = '→︎'; // plain text arrows: the emoji ones are blue boxes
                let trendColor = '#999';
                if (trend === 'rising') { trendIcon = '↗︎'; trendColor = '#2ecc71'; }
                else if (trend === 'falling') { trendIcon = '↘︎'; trendColor = '#e74c3c'; }

                // Estimate value (base calculation + commerce skill)
                const commerceBonus = 1 + (game.player.skills.commerce * 0.05);
                const estValue = Math.floor(basePrice * (1 + dist * 0.05) * multiplier * tile.playerProperty.storage * commerceBonus);

                html += actRow({
                    icon: '🐫',
                    name: `${s.name} <span style="font-size:10px; color:#9d937c; font-weight:normal;">(${s.type})</span>`,
                    desc: `📏 ${dist} hexes · <span style="color:${trendColor};" title="Market Trend">${trendIcon} ${basePrice}g/unit</span>`,
                    attrs: `onclick="window.sendStorageCaravan(${s.q}, ${s.r})"`,
                    side: `<span style="color:#8fd18a;">💰 ~${estValue}g</span> <span style="color:#9d937c; font-size:11px;">Send ›</span>`,
                });
                count++;
            }
        }

        // Add the player's processing buildings (workshops, mills, bakeries, ...)
        const playerWorkshops = game.player.properties.filter(p => {
            const t = game.world.getTile(p.q, p.r);
            return PlayerEconomy.isRecipeBuilding(p.type) && PlayerEconomy.findPropertyAt(t, p.type);
        });

        const producedGood = tile.playerProperty.produces;

        for (const ws of playerWorkshops) {
            // Don't ship to self
            if (ws.q === tile.q && ws.r === tile.r) continue;

            const wsTile = game.world.getTile(ws.q, ws.r);
            const wsProp = PlayerEconomy.findPropertyAt(wsTile, ws.type);

            // Check if workshop needs this good
            let needsGood = false;
            if (wsProp.activeRecipe) {
                const recipe = PlayerEconomy.RECIPES[wsProp.activeRecipe];
                if (recipe && recipe.input === producedGood) {
                    needsGood = true;
                }
            }

            if (needsGood) {
                const dist = Hex.wrappingDistance(tile.q, tile.r, ws.q, ws.r, game.world.width);
                if (dist > 0 && dist <= 20) {
                    html += actRow({
                        icon: wsProp.icon || '🏭',
                        name: `<span style="color:#aaddff;">${wsProp.name}</span>`,
                        desc: `📏 ${dist} hexes · <span style="color:#aaddff;">📦 Internal Transfer</span>`,
                        attrs: `onclick="window.sendStorageCaravan(${ws.q}, ${ws.r}, '${ws.type}')"`,
                        side: '<span style="color:#aaddff; font-size:11px;">Transfer ›</span>',
                    });
                    count++;
                }
            }
        }

        if (count === 0) {
            return '<div style="padding:10px; text-align:center; color:#9d937c; font-size:12px;">No valid destinations within range (20 hexes).</div>';
        }

        return html;
    },

    /**
     * Show trade menu
     */
    showTradeMenu(game, tile, section = null) {
        // A town that doesn't use coin yet barters (world/barter.js): one table, goods for goods
        if (tile && tile.settlement && Barter.active(game.world, tile.settlement)) return ActionMenu.showBarterTable(game, tile);
        // Buy or Sell: the one asked for, else the one last shown (a purchase re-renders the window)
        const tab = section === 'sell' || section === 'buy' ? section : (game.ui && game.ui._tradeTab === 'sell' ? 'sell' : 'buy');
        if (game.ui) game.ui._tradeTab = tab;
        const goods = Trading.getAvailableGoods(tile.settlement, tile, game.world);
        const playerGold = game.player.gold || 0;
        const settlementName = tile.settlement?.name || 'Market';
        const settlementType = tile.settlement?.type || 'village';

        // ── Categorise goods ──
        const CATEGORIES = {
            food:      { label: 'Food & Drink', icon: '🍞', keys: new Set(['grain','vegetables','flour','bread','fish','preserved_fish','beer','liquor','meat','berries','mushrooms','small_fish','large_fish','crab','swordfish','lobster','mussels','oysters','crayfish','golden_fish','cheese','dried_meat','honey','salt','tea','wine','mead','cider','sausage','meat_pie','honey_cake','jam','pickles','cooked_meal','cooked_fish','cooked_meat']) },
            materials: { label: 'Materials',     icon: '⛏️', keys: new Set(['wood','firewood','stone','iron','copper','ore','wool','hide','pelts','rope','candles','dyes','incense','pottery','lantern','arrows','compass','planks','resin','tallow','soap','parchment','ink','steel','silver_bar','glass','leather','linen']) },
            crafted:   { label: 'Crafted Goods', icon: '🔧', keys: new Set(['tools','steel_tools','bronze','weapons','textiles','clothes','agri_parts','industry_parts','military_parts','infra_parts','commerce_parts','leather_armor','shield','bow','joinery','barrel','boots','saddle','wool_cloak','fur_coat','chainmail','plate_armor','helmet','steel_sword','spear','crossbow','glassware']) },
            // Seed for your own fields (data/crops.json)
            seeds:     { label: 'Seed', icon: '🌱', keys: new Set(Object.values(PlayerEconomy.GOODS).map(g => g.id).filter(id => /_seed$/.test(id))) },
            luxury:    { label: 'Luxury & Rare', icon: '💎', keys: new Set(['luxuries','gems','gold_ore','spices','exotic_spices','silk','perfume','horses','horse','herbs','antler','feather','healing_salve','potion','elixir','treasure_map','ancient_coin','rare_book','amulet','enchanted_ring','book','silver_jewellery','gold_jewellery','fine_garments','tonic','poultice']) },
        };
        function getCat(id) {
            for (const [cat, def] of Object.entries(CATEGORIES)) { if (def.keys.has(id)) return cat; }
            return 'materials';
        }
        const grouped = {};
        for (const g of goods) {
            const cat = getCat(g.id);
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(g);
        }

        // ── Build sell list from player inventory ──
        const sellItems = [];
        if (game.player.inventory) {
            for (const [goodId, quantity] of Object.entries(game.player.inventory)) {
                if (quantity <= 0) continue;
                const good = PlayerEconomy.GOODS[goodId.toUpperCase()];
                if (!good) continue;
                // What this town pays for the first unit (its stock sets it)
                // ...less the crown's duty on goods bought in another realm (systems/tradePolicy.js)
                const policy = TradePolicy.saleCheck(game.player, game.world, tile.settlement, goodId, 1);
                // ...and the quality of crafted goods (player/crafting.js; Trading.sellGoods applies it)
                // ...and the grade (core/grades.js): one row for each grade held
                const unit = Trading.saleUnitPrice(game.player, good, tile.settlement, game.world) * (policy.ok ? policy.mult : 1);
                if (Grades.hasGraded(game.player, goodId)) {
                    for (const g of Grades.summary(game.player, goodId)) {
                        sellItems.push({ ...good, quantity: g.n, grade: g.id, sellPrice: Math.floor(unit * g.price), quality: Grades.labelHtml(g.id) });
                    }
                } else {
                    sellItems.push({ ...good, quantity, grade: null, sellPrice: Math.floor(unit), quality: '' });
                }
            }
        }

        // ── "Why?": the factors behind each price (player/causes.js → ui/whyPopover.js) ──
        const why = (goodId) => {
            try {
                return tile.settlement ? Causes.price(game.world, tile.settlement, goodId, game.player, tile) : null;
            } catch {
                return null;
            }
        };
        // ── The town's stores (world/settlementMarket.js): how full, which way the price moves ──
        const stockBadge = (goodId) => {
            if (!SettlementMarket.tracks(goodId) || !tile.settlement || !tile.settlement.market) return '';
            const info = SettlementMarket.info(tile.settlement, goodId);
            const pct = Math.round((info.scarcity - 1) * 100);
            const arrow = info.trend === 'rising' ? '▲' : info.trend === 'falling' ? '▼' : '';
            // An ordinary stock says nothing: only plenty, glut, scarcity or dearth get a word
            if (info.label === 'Steady' && !arrow) return '';
            const days = info.days != null ? ` · ${info.days >= 99 ? '99+' : Math.floor(info.days)}d in store` : '';
            return `<span class="trade-chip" style="color:${info.color};" title="${info.label} ${pct >= 0 ? '+' : ''}${pct}%${days}. Stock ${Math.floor(info.stock)}${info.need > 0 ? `, the town uses ${Math.round(info.need * 10) / 10} a day` : ', the town does not use it'}. Buying raises the price, selling lowers it.">${info.label}${arrow ? ` ${arrow}` : ''}</span>`;
        };
        // ── The crown's trade policy on a good: duty on goods bought abroad, an embargo, an export ban (systems/tradePolicy.js) ──
        const policyBadge = (goodId, selling) => {
            const n = TradePolicy.goodNotice(game.player, game.world, tile.settlement, goodId);
            if (!n) return '';
            const out = [];
            if (selling && n.embargoed > 0) out.push(`<span class="trade-chip" style="color:#e74c3c;" title="${n.embargoed} from a realm this crown embargoes: only a smuggler moves them here (More ▸ Tariffs)">⛔ Embargo</span>`);
            if (selling && n.foreign - n.embargoed > 0 && n.dutyRate > 0) out.push(`<span class="trade-chip" style="color:#e67e22;" title="${n.foreign} bought in another realm pay this crown's import duty">Duty −${Math.round(n.dutyRate * 100)}%</span>`);
            if (!selling && n.banned) out.push('<span class="trade-chip" style="color:#e67e22;" title="The crown bans its export: selling it in another realm is smuggling (heat here), unless you hold its licence">🚫 Export ban</span>');
            return out.join('');
        };
        // ── The town's guild on a good you sell: its toll on outsiders, or a master's mark (systems/guilds.js) ──
        const guildBadge = (goodId) => {
            const gd = tile.settlement && Guilds.guardOf(tile.settlement, goodId);
            if (!gd) return '';
            const f = Guilds.saleFactor(game.player, tile.settlement, goodId);
            const room = Guilds.outsiderRoom(game.player, tile.settlement, goodId);
            if (f > 1) return `<span class="trade-chip" style="color:#2ecc71;" title="Your goods carry the ${gd.name}'s mark">Guild mark +${Math.round((f - 1) * 100)}%</span>`;
            if (f < 1) return `<span class="trade-chip" style="color:#e67e22;" title="The ${gd.name} tolls goods sold by non-members${room !== Infinity ? `; outsiders may sell ${room} more this week` : ''}">Guild toll −${Math.round((1 - f) * 100)}%</span>`;
            return '';
        };
        const mkt = tile.settlement && tile.settlement.market;
        const dearth = tile.settlement && SettlementMarket.worstShortage(tile.settlement);
        const glut = tile.settlement && SettlementMarket.biggestGlut(tile.settlement);
        const nameOf = (id) => (PlayerEconomy.GOODS[id.toUpperCase()] && PlayerEconomy.GOODS[id.toUpperCase()].name) || id;
        const storesParts = [];
        if (dearth) storesParts.push(`<span style="color:#e74c3c;">Short of ${nameOf(dearth.id)}</span>`);
        if (glut) storesParts.push(`<span style="color:#3498db;">Glut of ${nameOf(glut.id)}</span>`);
        if (mkt && mkt.trade && (mkt.trade.in > 0 || mkt.trade.out > 0)) storesParts.push(`<span>Traders: ${Math.round(mkt.trade.in)} in / ${Math.round(mkt.trade.out)} out today</span>`);
        if (mkt && mkt.trade && mkt.trade.cut > 0) storesParts.push('<span style="color:#e67e22;">Trade roads disrupted</span>');
        if (SettlementMarket.inDearth(tile.settlement)) storesParts.push('<span style="color:#e74c3c;">Dearth: the poor go hungry</span>');
        // The town's people: welfare, idle hands, the artisans' wage (world/townLabour.js)
        const people = tile.settlement ? peopleLine(tile.settlement, game.world.day) : '';

        // ── Season outlook and price-trend arrows (world/seasons.js) ──
        const outlook = Seasons.outlook(game.world.day);
        // The season's pull on a price: a tooltip on the price, not a line of its own
        const trendTitle = (goodId) => {
            if (!Seasons.priceGroup(goodId)) return '';
            const st = Trading.getSeasonalTrend(goodId, game.world);
            const pct = Math.round(st.modifier * 100);
            const word = st.trend === 'rising' ? 'rising' : st.trend === 'falling' ? 'falling' : 'steady';
            return ` title="Season ${pct >= 0 ? '+' : ''}${pct}%, ${word} over the next ten days"`;
        };
        const outlookParts = [];
        if (outlook.cheap.length) outlookParts.push(`<span style="color:#3498db;">Cheap: ${outlook.cheap.map(c => `${c.label} ${Seasons.trendArrow(c.trend)}`).join(', ')}</span>`);
        if (outlook.dear.length) outlookParts.push(`<span style="color:#e67e22;">Dear: ${outlook.dear.map(c => `${c.label} ${Seasons.trendArrow(c.trend)}`).join(', ')}</span>`);
        if (outlook.producing.length) outlookParts.push(`<span style="color:#2ecc71;">Plenty: ${outlook.producing.map(p => p.label).join(', ')}</span>`);
        if (outlook.lean) outlookParts.push('<span style="color:#e74c3c;">Lean season</span>');
        const kingdom = tile.settlement && tile.settlement.kingdom != null ? game.world.getKingdom(tile.settlement.kingdom) : null;
        const fair = SettlementMarket.fair(tile.settlement);
        // One line up top (the season, and a dearth if there is one); the rest folds away
        const headline = [`${outlook.icon} ${outlook.season}, day ${outlook.dayInSeason}`];
        if (dearth) headline.push(`<span style="color:#e74c3c;">short of ${nameOf(dearth.id)}</span>`);
        if (outlook.lean) headline.push('<span style="color:#e74c3c;">lean season</span>');
        const outlookHtml = `<details class="trade-outlook">
            <summary>${headline.join(' · ')}<span class="trade-outlook-more">Town &amp; season</span></summary>
            <div class="trade-outlook-body">
                <div>${outlook.note}</div>
                ${outlookParts.length ? `<div class="trade-outlook-row">${outlookParts.join('')}</div>` : ''}
                ${storesParts.length ? `<div class="trade-outlook-row">🏚️ ${storesParts.join('')}</div>` : ''}
                ${people ? `<div>👥 ${people}</div>` : ''}
                ${kingdom ? `<div>⚖️ ${policyLine(game.world, kingdom)}</div>` : ''}
            </div>
        </details>
        ${fair ? `<div class="pk-lede" style="color:#ffcf6a;">🎪 The ${fair.name} is on until day ${fair.until}: the stalls ask less and buy dearer.</div>` : ''}`;

        // ── The town's craftsmanship (world/marketGrades.js): how much of its work is Fine, or Poor ──
        let craftBadge = '';
        if (tile.settlement) {
            const lv = MarketGrades.level(tile.settlement);
            const lb = MarketGrades.label(lv);
            craftBadge = ` · <span style="color:${lb.color};text-transform:none;" title="The town's craftsmanship (${lv.toFixed(1)}/10) sets how much of its made goods is Fine or better, and how much Poor">${lb.name} craftsmen</span>`;
            // Your haggling against the town's merchants (systems/socialSkills.js)
            if (SocialSkills.has('haggling')) {
                const hg = SocialSkills.haggle(game.player, tile.settlement);
                const pct = Math.round(hg.bonus * 1000) / 10;
                craftBadge += ` · <span style="color:${pct > 0 ? '#9fd6a8' : '#bbb'};text-transform:none;" title="Haggling ${hg.level} against merchants of ${hg.merchants}: your level's edge, ±0.5% a level between you, never below nothing. It cheapens what you buy and lifts what you sell.">⚖️ Haggling ${hg.level} vs ${hg.merchants}: ${pct > 0 ? `${pct}% better prices` : 'no edge'}</span>`;
            }
        }

        // ── Render HTML ──
        let html = `
        <style>
            /* The action menu's voice (styles.css .pk-row / .amx-row): rows lit by a gold bar
               at the left on hover, hairline rules, the buy/sell buttons as lit outlines */
            .trade-header { display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:10px; }
            .trade-purse { display:inline-flex; align-items:center; gap:4px; padding:2px 9px; border-radius:999px; background:rgba(0,0,0,0.28);
                           border:1px solid rgba(245,197,66,0.16); font-size:12px; font-weight:600; color:#ffcf6a; white-space:nowrap; }
            .trade-tabs { display:flex; gap:0; border-bottom:1px solid rgba(245,197,66,0.12); margin-bottom:12px; }
            .trade-tab { padding:7px 16px; font-size:12px; font-weight:600; color:#a99f88; background:none; border:none;
                         border-bottom:2px solid transparent; cursor:pointer; font-family:var(--font-display); letter-spacing:0.5px;
                         transition:all .15s; margin-bottom:-1px; }
            .trade-tab:hover { color:#d8ccaf; }
            .trade-tab.active { color:#ffe08a; border-bottom-color:var(--gold); }
            .trade-section { display:none; }
            .trade-section.active { display:block; }
            .trade-cat { margin-bottom:8px; }
            .trade-cat > .pk-head { margin-top:10px; }
            .trade-rows { margin:0 -6px; }
            .trade-row { display:grid; grid-template-columns:30px minmax(0,1fr) auto auto; gap:10px; align-items:center; padding:7px 10px 7px 8px;
                         border-radius:7px; transition:background .12s, box-shadow .12s; }
            .trade-row + .trade-row { box-shadow:0 -1px 0 rgba(245,197,66,0.06); }
            .trade-row:hover { background:rgba(245,197,66,0.08); box-shadow:inset 3px 0 0 var(--gold); }
            .trade-row.sold-out { opacity:0.45; pointer-events:none; }
            .trade-row.sold-out .trade-icon { filter:grayscale(1); }
            .trade-row.trade-grade { padding-left:26px; }
            .trade-icon { font-size:19px; line-height:1; text-align:center; }
            .trade-name { font-size:13px; font-weight:600; color:#ece2c8; }
            .trade-price { font-size:12.5px; font-weight:700; color:#ffcf6a; white-space:nowrap; text-align:right; min-width:64px; }
            .trade-price .trade-qty { font-weight:400; font-size:10.5px; color:#9d937c; display:block; }
            .trade-price.trade-price-sell { color:#8fd18a; }
            .trade-btn { padding:3px 12px; border:1px solid transparent; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer;
                         font-family:var(--font-body); transition:filter .12s, background .12s, border-color .12s; white-space:nowrap; letter-spacing:0.2px; }
            .trade-btn-buy { background:linear-gradient(180deg,rgba(245,197,66,0.22),rgba(245,197,66,0.12)); border-color:rgba(245,197,66,0.6); color:#ffe08a; }
            .trade-btn-sell { background:linear-gradient(180deg,rgba(143,209,138,0.2),rgba(143,209,138,0.1)); border-color:rgba(143,209,138,0.55); color:#bfe8b8; }
            .trade-btn:hover { filter:brightness(1.2); }
            .trade-btn.trade-btn-disabled { background:transparent; border-color:rgba(255,255,255,0.08); color:#8f8a7e; }
            .trade-sold-out { font-size:11px; color:#c98a6a; font-weight:600; white-space:nowrap; }
            .trade-empty { text-align:center; padding:18px; color:#9d937c; font-size:12.5px; font-style:italic; }
            .trade-settlement-badge { font-size:11px; color:#9d937c; font-weight:400; letter-spacing:0.5px; }
            .trade-meta { display:flex; flex-wrap:wrap; gap:8px; font-size:11px; color:rgba(220,210,190,0.55); }
            .trade-chip { font-size:11px; white-space:nowrap; cursor:help; }
            .trade-outlook { margin-bottom:10px; padding:6px 10px; border-radius:8px; background:rgba(0,0,0,0.22); border:1px solid rgba(245,197,66,0.12); font-size:12px; }
            .trade-outlook summary { cursor:pointer; color:#ece2c8; list-style:none; display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
            .trade-outlook summary::-webkit-details-marker { display:none; }
            .trade-outlook-more { margin-left:auto; font-size:11px; color:#9d937c; }
            .trade-outlook-more::after { content:' ▾'; color:var(--gold); }
            .trade-outlook[open] .trade-outlook-more::after { content:' ▴'; }
            .trade-outlook-body { margin-top:6px; padding-top:6px; border-top:1px solid rgba(245,197,66,0.07); display:flex; flex-direction:column; gap:4px; color:#b9ae94; }
            .trade-outlook-row { display:flex; flex-wrap:wrap; gap:10px; }
        </style>

        <div class="trade-header">
            <span class="trade-settlement-badge" style="text-transform:capitalize;">${settlementType} market${craftBadge}</span>
            <span class="trade-purse">💰 ${Math.floor(playerGold).toLocaleString()} gold</span>
        </div>
        ${outlookHtml}

        <!-- BUY SECTION -->
        <div class="trade-section${tab === 'buy' ? ' active' : ''}" data-trade-section="buy">`;

        const catOrder = ['food','seeds','materials','crafted','luxury'];
        let hasBuyGoods = false;
        for (const cat of catOrder) {
            const items = grouped[cat];
            if (!items || items.length === 0) continue;
            hasBuyGoods = true;
            const def = CATEGORIES[cat];
            html += `<div class="trade-cat">
                ${sectionHead(`${def.icon} ${def.label}`)}<div class="trade-rows">`;
            for (const good of items) {
                const isSoldOut = good.quantity <= 0;
                // What one unit really costs this buyer (discounts and the difficulty's prices — Trading.buyCost)
                const unitCost = Trading.buyCost(game.player, good, 1, tile.settlement) || good.price;
                const canAfford = playerGold >= unitCost;
                // The price climbs as the stall empties: offer what the purse covers
                const maxBuy = Math.max(1, Trading.affordable(game.player, good, tile.settlement));
                // Graded lots on the stall (world/marketGrades.js): Common is the rest
                const lots = good.lots;
                const commonQty = lots ? lots.common : good.quantity;
                html += `<div class="trade-row ${isSoldOut ? 'sold-out' : ''}">
                    <span class="trade-icon">${good.icon}</span>
                    <div>
                        <div class="trade-name">${good.name}${goodInfoIcon(good.id)}${lots ? ` <span style="font-size:11px;color:${Grades.get('common').color}">${Grades.get('common').icon} Common</span>` : ''}</div>
                        <div class="trade-meta">${stockBadge(good.id)}${policyBadge(good.id, false)}</div>
                    </div>
                    <div class="trade-price"${trendTitle(good.id)}>${isSoldOut ? '' : unitCost + ' 💰' + whyIcon(priceWhy(why(good.id)), 'Why this price?')}
                        <span class="trade-qty">${isSoldOut ? '' : commonQty + ' avail.'}</span>
                    </div>
                    <div>${isSoldOut
                        ? '<span class="trade-sold-out">Sold Out</span>'
                        : `<button class="trade-btn trade-btn-buy ${canAfford ? '' : 'trade-btn-disabled'}" title="The price rises as the stall empties" onclick="window._tradeBuy('${good.id}', ${good.price}, ${lots ? Math.max(1, Math.min(maxBuy, commonQty)) : maxBuy})">Buy</button>`
                    }</div>
                </div>`;
                // ...and the better (and worse) work on the stall, each at its grade's price
                if (lots && !isSoldOut) {
                    for (const gid of ['masterwork', 'excellent', 'fine', 'poor']) {
                        const n = lots[gid];
                        if (!(n > 0)) continue;
                        const gc = Trading.buyGradeCost(game.player, good, 1, tile.settlement, gid);
                        const gmax = Math.max(1, Trading.affordableGrade(game.player, good, tile.settlement, gid));
                        html += `<div class="trade-row trade-grade">
                            <span class="trade-icon" style="font-size:14px;">${Grades.get(gid).icon}</span>
                            <div><div class="trade-name" style="font-size:12px;">${good.name} ${Grades.labelHtml(gid)}</div></div>
                            <div class="trade-price">${gc} 💰<span class="trade-qty">${n} avail.</span></div>
                            <div><button class="trade-btn trade-btn-buy ${playerGold >= gc ? '' : 'trade-btn-disabled'}" onclick="window._tradeBuy('${good.id}', ${gc}, ${gmax}, '${gid}')">Buy</button></div>
                        </div>`;
                    }
                }
            }
            html += '</div></div>';
        }
        if (!hasBuyGoods) {
            html += '<div class="trade-empty">No goods available at this market.</div>';
        }

        html += `</div>

        <!-- SELL SECTION -->
        <div class="trade-section${tab === 'sell' ? ' active' : ''}" data-trade-section="sell">`;

        if (sellItems.length > 0) {
            html += sectionHead('Your goods') + '<div class="trade-rows">';
            for (const item of sellItems) {
                html += `<div class="trade-row">
                    <span class="trade-icon">${item.icon}</span>
                    <div>
                        <div class="trade-name">${item.name}${goodInfoIcon(item.id)}${item.quality ? ` <span style="font-size:11px;" title="The grade of the ${item.name} you carry sets its price">${item.quality}</span>` : ''}</div>
                        <div class="trade-meta"><span class="trade-chip" style="cursor:default">You have ${item.quantity}</span>${stockBadge(item.id)}${guildBadge(item.id)}${policyBadge(item.id, true)}</div>
                    </div>
                    <div class="trade-price trade-price-sell"${trendTitle(item.id)}>${item.sellPrice} 💰${whyIcon(sellWhy(why(item.id)), 'Why this price?')}
                        <span class="trade-qty">per unit</span>
                    </div>
                    <div>
                        <button class="trade-btn trade-btn-sell" onclick="window._tradeSell('${item.id}', ${item.sellPrice}, ${item.quantity}, ${item.grade ? `'${item.grade}'` : 'null'})">Sell</button>
                    </div>
                </div>`;
            }
            html += '</div>';
        } else {
            html += '<div class="trade-empty">You have no goods to sell.</div>';
        }

        html += '</div>';

        setMarketNav(game, tile, tab);
        game.ui.showCustomPanel(`🏪 Trade — ${settlementName}`, html);


        // ── Buy / Sell handlers ──
        window.currentTile = tile;
        window._tradeBuy = (goodId, price, maxQty, grade = null) => {
            const gName = grade ? `${Grades.get(grade).name} ` : '';
            ActionMenu.showQuantityInput(`Buy ${gName}${PlayerEconomy.GOODS[goodId.toUpperCase()]?.name || goodId}`, maxQty, (qty) => {
                const good = goods.find(g => g.id === goodId);
                if (good) {
                    if (!ActionMenu.commitPendingAP(game)) return;
                    const result = Trading.buyGoods(game.player, good, qty, tile.settlement, grade);
                    if (result.success) {
                        game.ui.showNotification('Purchase Complete', `Bought ${qty}x ${gName}${good.name} for ${result.spent} gold`, 'success');
                        if (tile.settlement.kingdom) {
                            game.player.learnAboutKingdom(tile.settlement.kingdom, 'economy');
                        }
                        if (typeof Titles !== 'undefined' && game.player.currentTitle === 'trade_envoy' &&
                            tile.settlement.kingdom && tile.settlement.kingdom !== game.player.allegiance) {
                            const tradeResult = Titles.recordTradeMission(game.player);
                            if (tradeResult) {
                                game.ui.showNotification('📦 Trade Mission!', `Envoy duty complete (+${tradeResult.gold} gold bonus). Missions: ${tradeResult.count}`, 'success');
                            }
                        }
                        game.ui.updateStats(game.player, game.world);
                        ActionMenu.showTradeMenu(game, tile);
                    } else {
                        game.ui.showNotification('Cannot Buy', result.reason, 'error');
                    }
                }
            });
        };

        window._tradeSell = (goodId, price, maxQty, grade = null) => {
            const gName = grade ? `${Grades.get(grade).name} ` : '';
            ActionMenu.showQuantityInput(`Sell ${gName}${PlayerEconomy.GOODS[goodId.toUpperCase()]?.name || goodId}`, maxQty, (qty) => {
                if (!ActionMenu.commitPendingAP(game)) return;
                const result = Trading.sellGoods(game.player, goodId, qty, tile.settlement, game.world, grade);
                if (result.success) {
                    const good = PlayerEconomy.GOODS[goodId.toUpperCase()];
                    game.ui.showNotification('Sale Complete', `Sold ${qty}x ${gName}${good.name} for ${result.earned} gold`, 'success');
                    if (tile.settlement.kingdom) {
                        game.player.learnAboutKingdom(tile.settlement.kingdom, 'economy');
                    }
                    game.ui.updateStats(game.player, game.world);
                    ActionMenu.showTradeMenu(game, tile);
                } else {
                    game.ui.showNotification('Cannot Sell', result.reason, 'error');
                }
            });
        };
    },

    /**
     * Show NPC personal trade menu (merchants, travelers, blacksmiths)
     * Uses the NPC's shopInventory instead of the settlement market.
     */
    showNpcTradeMenu(game, npc, section = null) {
        if (!npc || !npc.shopInventory) {
            game.ui.showNotification('No Goods', `${npc?.name || 'This person'} has nothing to trade.`, 'info');
            return;
        }

        // Disposition & personality set this trader's prices (both ways)
        // ...and the player's name in this realm (systems/fame.js)
        const fameCtx = { player: game.player, kingdomId: Fame._kingdomAt(game.world, game.player.q, game.player.r) };
        const priceMods = NpcDisposition.getPriceModifiers(npc, fameCtx);
        if (priceMods.refuses) {
            game.ui.showNotification('🚫 No Deal', priceMods.refuseReason, 'warning');
            return;
        }

        const playerGold = game.player.gold || 0;
        const npcName = npc.name || 'Trader';
        const npcIcon = npc.icon || '🧑';
        const npcType = npc.type || 'merchant';

        const TYPE_LABELS = {
            merchant: 'Merchant',
            traveler: 'Traveling Trader',
            blacksmith_npc: 'Blacksmith',
        };
        const typeLabel = TYPE_LABELS[npcType] || 'Trader';
        // Buy or Sell: the one asked for, else the one last shown to this trader (a sale re-renders the window)
        const ui = game.ui || {};
        const last = ui._npcTradeTab && ui._npcTradeTab.npc === npc ? ui._npcTradeTab.tab : 'buy';
        const tab = section === 'sell' || section === 'buy' ? section : last;
        ui._npcTradeTab = { npc, tab };

        // Build goods list from NPC inventory
        const CATEGORIES = {
            food:      { label: 'Food & Drink',   icon: '🍞', keys: new Set(['grain','vegetables','flour','bread','fish','preserved_fish','beer','liquor','meat','berries','mushrooms','cheese','dried_meat','honey','salt','tea','wine']) },
            materials: { label: 'Materials',       icon: '⛏️', keys: new Set(['wood','firewood','stone','iron','copper','ore','wool','hide','pelts','rope','candles','dyes','incense','pottery','lantern','arrows','compass']) },
            crafted:   { label: 'Equipment',       icon: '⚔️', keys: new Set(['tools','bronze','weapons','textiles','clothes','leather_armor','shield','bow','agri_parts','industry_parts','military_parts','infra_parts','commerce_parts']) },
            rare:      { label: 'Exotic & Rare',   icon: '✨', keys: new Set(['luxuries','gems','gold_ore','spices','exotic_spices','silk','perfume','horses','horse','herbs','antler','feather','healing_salve','potion','elixir','treasure_map','ancient_coin','rare_book','amulet','enchanted_ring']) },
        };
        function getCat(id) {
            for (const [cat, def] of Object.entries(CATEGORIES)) { if (def.keys.has(id)) return cat; }
            return 'materials';
        }

        // Resolve inventory items
        const shopGoods = [];
        for (const [itemId, data] of Object.entries(npc.shopInventory)) {
            const goodDef = PlayerEconomy.GOODS[itemId.toUpperCase()] || Object.values(PlayerEconomy.GOODS).find(g => g.id === itemId);
            if (!goodDef || data.qty <= 0) continue;
            const price = NpcDisposition.buyPrice(npc, goodDef.basePrice * (data.markup || 1), fameCtx);
            shopGoods.push({ ...goodDef, quantity: data.qty, price, _itemId: itemId });
        }

        // Group by category
        const grouped = {};
        for (const g of shopGoods) {
            const cat = getCat(g.id);
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(g);
        }

        // Build sell list from player inventory
        const sellItems = [];
        if (game.player.inventory) {
            for (const [goodId, quantity] of Object.entries(game.player.inventory)) {
                if (quantity <= 0) continue;
                const good = PlayerEconomy.GOODS[goodId.toUpperCase()];
                if (!good) continue;
                const sellPrice = Math.floor(NpcDisposition.sellPrice(npc, good.basePrice * 0.65, fameCtx) * Crafting.saleMult(game.player, goodId));
                sellItems.push({ ...good, quantity, sellPrice, quality: Crafting.qualityTag(game.player, goodId) });
            }
        }

        // ── Render ──
        let html = `
        <style>
            /* The action menu's voice (styles.css .pk-row): a quiet header, rows lit by a gold
               bar at the left on hover, the buy/sell buttons as lit outlines */
            .npc-trade-header { display:flex; align-items:center; gap:12px; margin-bottom:12px; padding-bottom:10px; border-bottom:1px solid rgba(245,197,66,0.1); }
            .npc-trade-portrait { font-size:28px; width:44px; height:44px; display:flex; align-items:center; justify-content:center;
                background:rgba(0,0,0,0.28); border:1px solid rgba(245,197,66,0.22); border-radius:50%; }
            .npc-trade-info { flex:1; min-width:0; }
            .npc-trade-name { font-size:15px; font-weight:600; color:#ffe9a8; font-family:var(--font-display); letter-spacing:0.5px; }
            .npc-trade-type { font-size:10.5px; color:#9d937c; text-transform:uppercase; letter-spacing:1.5px; }
            .npc-trade-purse { display:inline-flex; align-items:center; gap:4px; padding:2px 9px; border-radius:999px; background:rgba(0,0,0,0.28);
                border:1px solid rgba(245,197,66,0.16); font-size:12px; font-weight:600; color:#ffcf6a; white-space:nowrap; }
            .npc-trade-section { display:none; }
            .npc-trade-section.active { display:block; }
            .npc-cat { margin-bottom:8px; }
            .npc-cat > .pk-head { margin-top:10px; }
            .npc-rows { margin:0 -6px; }
            .npc-row { display:grid; grid-template-columns:30px minmax(0,1fr) auto auto; gap:10px; align-items:center; padding:7px 10px 7px 8px; border-radius:7px; transition:background .12s, box-shadow .12s; }
            .npc-row + .npc-row { box-shadow:0 -1px 0 rgba(245,197,66,0.06); }
            .npc-row:hover { background:rgba(245,197,66,0.08); box-shadow:inset 3px 0 0 var(--gold); }
            .npc-row.out { opacity:0.45; pointer-events:none; }
            .npc-ico { font-size:19px; line-height:1; text-align:center; }
            .npc-gname { font-size:13px; font-weight:600; color:#ece2c8; }
            .npc-gmeta { font-size:11px; color:rgba(220,210,190,0.55); }
            .npc-gprice { font-size:12.5px; font-weight:700; color:#ffcf6a; white-space:nowrap; text-align:right; min-width:60px; }
            .npc-gprice .npc-qty { font-weight:400; font-size:10.5px; color:#9d937c; display:block; }
            .npc-gprice.npc-gprice-sell { color:#8fd18a; }
            .npc-btn { padding:3px 12px; border:1px solid transparent; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; font-family:var(--font-body); transition:filter .12s; white-space:nowrap; letter-spacing:0.2px; }
            .npc-btn-buy { background:linear-gradient(180deg,rgba(245,197,66,0.22),rgba(245,197,66,0.12)); border-color:rgba(245,197,66,0.6); color:#ffe08a; }
            .npc-btn-sell { background:linear-gradient(180deg,rgba(143,209,138,0.2),rgba(143,209,138,0.1)); border-color:rgba(143,209,138,0.55); color:#bfe8b8; }
            .npc-btn:hover { filter:brightness(1.2); }
            .npc-empty { text-align:center; padding:18px; color:#9d937c; font-size:12.5px; font-style:italic; }
        </style>

        <div class="npc-trade-header">
            <div class="npc-trade-portrait">${npcIcon}</div>
            <div class="npc-trade-info">
                <div class="npc-trade-name">${npcName}</div>
                <div class="npc-trade-type">${typeLabel}</div>
            </div>
            <span class="npc-trade-purse">💰 ${Math.floor(playerGold).toLocaleString()}</span>
        </div>
        ${priceMods.reasons.length > 0 ? `<div class="pk-lede" style="font-size:11.5px; color:${priceMods.pct > 0 ? '#e0846a' : priceMods.pct < 0 ? '#8fd18a' : '#9d937c'};"
            title="Disposition and personality change what this trader charges and pays">
            🏷️ Prices ${priceMods.pct > 0 ? '+' : ''}${priceMods.pct}% · ${priceMods.reasons.map(r => `${r.label} ${r.pct > 0 ? '+' : ''}${r.pct}%`).join(', ')}
        </div>` : ''}

        <div class="npc-trade-section${tab === 'buy' ? ' active' : ''}" data-npc-section="buy">`;

        const catOrder = ['food','materials','crafted','rare'];
        let hasGoods = false;
        for (const cat of catOrder) {
            const items = grouped[cat];
            if (!items || items.length === 0) continue;
            hasGoods = true;
            const def = CATEGORIES[cat];
            html += `<div class="npc-cat">${sectionHead(`${def.icon} ${def.label}`)}<div class="npc-rows">`;
            for (const good of items) {
                const canAfford = playerGold >= good.price;
                html += `<div class="npc-row">
                    <span class="npc-ico">${good.icon}</span>
                    <div><div class="npc-gname">${good.name}</div></div>
                    <div class="npc-gprice">${good.price} 💰<span class="npc-qty">${good.quantity} avail.</span></div>
                    <div><button class="npc-btn npc-btn-buy" onclick="window._npcBuy('${good._itemId}',${good.price},${good.quantity})">Buy</button></div>
                </div>`;
            }
            html += '</div></div>';
        }
        if (!hasGoods) html += '<div class="npc-empty">This trader has nothing left to sell.</div>';

        html += `</div><div class="npc-trade-section${tab === 'sell' ? ' active' : ''}" data-npc-section="sell">`;

        if (sellItems.length > 0) {
            html += sectionHead('Your goods') + '<div class="npc-rows">';
            for (const item of sellItems) {
                html += `<div class="npc-row">
                    <span class="npc-ico">${item.icon}</span>
                    <div>
                        <div class="npc-gname">${item.name}${item.quality ? ` <span style="color:#8fc3ff; font-size:11px;">${item.quality}</span>` : ''}</div>
                        <div class="npc-gmeta">You have: ${item.quantity}</div>
                    </div>
                    <div class="npc-gprice npc-gprice-sell">${item.sellPrice} 💰<span class="npc-qty">per unit</span></div>
                    <div><button class="npc-btn npc-btn-sell" onclick="window._npcSell('${item.id}',${item.sellPrice},${item.quantity})">Sell</button></div>
                </div>`;
            }
            html += '</div>';
        } else {
            html += '<div class="npc-empty">You have no goods to sell.</div>';
        }

        html += '</div>';

        // Buy / Sell are the window's tab bar (ui/ui/panels.js setPanelNav)
        if (typeof game.ui.setPanelNav === 'function') {
            game.ui.setPanelNav({
                id: 'npcTrade', title: `${npcIcon} ${npcName} — ${typeLabel}`, active: tab,
                items: [
                    { key: 'buy', label: '🛒 Buy', run: () => ActionMenu.showNpcTradeMenu(game, npc, 'buy') },
                    { key: 'sell', label: `💰 Sell to ${npcName}`, run: () => ActionMenu.showNpcTradeMenu(game, npc, 'sell') },
                ],
            });
        }
        game.ui.showCustomPanel(`${npcIcon} ${npcName} — ${typeLabel}`, html);

        // Buy handler — deducts from NPC's shopInventory
        window._npcBuy = (itemId, price, maxQty) => {
            const goodDef = PlayerEconomy.GOODS[itemId.toUpperCase()] || Object.values(PlayerEconomy.GOODS).find(g => g.id === itemId);
            const displayName = goodDef ? goodDef.name : itemId;
            ActionMenu.showQuantityInput(`Buy ${displayName}`, maxQty, (qty) => {
                const totalCost = price * qty;
                if (game.player.gold < totalCost) {
                    game.ui.showNotification('Not Enough Gold', `You need ${totalCost} gold but only have ${Math.floor(game.player.gold)}.`, 'error');
                    return;
                }
                if (!PlayerInventory.canAdd(game.player, itemId)) {
                    game.ui.showNotification('🎒 Inventory Full', PlayerInventory.fullMessage(game.player), 'error');
                    return;
                }
                // Deduct gold, add to player inventory, reduce NPC stock
                game.player.gold -= totalCost;
                PlayerInventory.addItem(game.player, itemId, qty);
                npc.shopInventory[itemId].qty -= qty;
                if (npc.shopInventory[itemId].qty <= 0) delete npc.shopInventory[itemId];
                game.ui.showNotification('Purchase Complete', `Bought ${qty}x ${displayName} for ${totalCost} gold`, 'success');
                game.ui.updateStats(game.player, game.world);
                ActionMenu.showNpcTradeMenu(game, npc);
            });
        };

        // Sell handler — gives gold to player, NPC absorbs item
        window._npcSell = (goodId, sellPrice, maxQty) => {
            const goodDef = PlayerEconomy.GOODS[goodId.toUpperCase()];
            const displayName = goodDef ? goodDef.name : goodId;
            ActionMenu.showQuantityInput(`Sell ${displayName}`, maxQty, (qty) => {
                // (the row's price is for the first unit sold — Common first; the grades of the rest count too, core/grades.js)
                const unitBase = sellPrice / Math.max(0.01, Crafting.saleMult(game.player, goodId, 1));
                const totalEarned = Math.floor(unitBase * qty * Crafting.saleMult(game.player, goodId, qty));
                // Remove from player inventory
                if (!game.player.inventory || (game.player.inventory[goodId] || 0) < qty) {
                    game.ui.showNotification('Cannot Sell', 'You don\'t have enough of this item.', 'error');
                    return;
                }
                Crafting.takeForSale(game.player, goodId, qty);
                game.player.inventory[goodId] -= qty;
                if (game.player.inventory[goodId] <= 0) delete game.player.inventory[goodId];
                game.player.gold += totalEarned;
                game.ui.showNotification('Sale Complete', `Sold ${qty}x ${displayName} for ${totalEarned} gold`, 'success');
                game.ui.updateStats(game.player, game.world);
                ActionMenu.showNpcTradeMenu(game, npc);
            });
        };
    },

    /**
     * Show a quantity input modal
     */
    showQuantityInput(title, max, callback) {
        // Remove existing input if any
        const existing = document.getElementById('quantityInputModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'quantityInputModal';
        modal.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: linear-gradient(180deg, rgba(28, 24, 18, 0.98), rgba(16, 14, 11, 0.98));
            backdrop-filter: blur(10px);
            border: 1px solid rgba(245, 197, 66, 0.35);
            border-radius: 10px;
            padding: 16px 18px;
            min-width: 300px;
            z-index: 2000;
            box-shadow: 0 10px 40px rgba(0,0,0,0.8);
            display: flex;
            flex-direction: column;
            gap: 12px;
            color: #ddd3bb;
            font-family: var(--font-body);
        `;

        modal.innerHTML = `
            <h3 style="margin: 0; color: #ffe9a8; font-family: var(--font-display); font-size: 15px; font-weight: 600; letter-spacing: 0.5px;">${title}</h3>
            <div style="display: flex; flex-direction: column; gap: 8px;">
                <label style="color: #9d937c; font-size: 12px;">Quantity: <span id="qtyDisplay" style="color: #ece2c8; font-weight: 600;">1</span> / ${max}</label>
                <input type="range" id="qtyRange" min="1" max="${max}" value="1" style="width: 100%; accent-color: var(--gold);">
                <input type="number" id="qtyNumber" min="1" max="${max}" value="1" style="width: 100%; box-sizing: border-box; padding: 7px 9px; background: rgba(0,0,0,0.3); border: 1px solid rgba(245,197,66,0.2); color: #ece2c8; border-radius: 6px;">
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 4px;">
                <button id="qtyCancel" style="${BTN_PLAIN}">Cancel</button>
                <button id="qtyConfirm" style="${BTN_GOLD}">Confirm</button>
            </div>
        `;

        document.body.appendChild(modal);

        const range = document.getElementById('qtyRange');
        const number = document.getElementById('qtyNumber');
        const display = document.getElementById('qtyDisplay');
        const confirm = document.getElementById('qtyConfirm');
        const cancel = document.getElementById('qtyCancel');

        const updateVal = (val) => {
            let v = parseInt(val);
            if (isNaN(v)) v = 1;
            if (v < 1) v = 1;
            if (v > max) v = max;
            range.value = v;
            number.value = v;
            display.textContent = v;
        };

        range.addEventListener('input', (e) => updateVal(e.target.value));
        number.addEventListener('input', (e) => updateVal(e.target.value));

        confirm.addEventListener('click', () => {
            modal.remove();
            callback(parseInt(number.value));
        });

        cancel.addEventListener('click', () => {
            modal.remove();
        });
    },

    /**
     * Show recruit menu
     */
    showRecruitMenu(game, tile) {
        // Your parents' rules at this door too (ui/parentsGuard.js)
        if (!ParentsGuard.ok(game, 'recruit', tile)) return;
        const settlement = tile.settlement;
        const capacity = PlayerMilitary.getRecruitmentCapacity(settlement);
        const recruited = game.player._recruitedThisTurn || 0;
        const remaining = Math.max(0, capacity - recruited);
        // Warships are only raised at ports
        const recruitContext = { isPort: Ships.isPortTile(game.world, tile.q, tile.r) };
        const navalStrength = PlayerMilitary.getNavalStrength(game.player);

        // The action menu's voice (ui/actionMenu/uiKit.js): a lede and chips for the
        // town, then one row a unit — its cost at the right, what holds it back greyed
        const strength = PlayerMilitary.getArmyStrength(game.player);
        let html = lede(`Raise men in <b>${settlement.name}</b>, a ${settlement.type} of ${settlement.population.toLocaleString()} souls. Each recruit is armed from your stores, then the town's armourers.`);
        html += chips([
            ['⚔️', 'Army', strength],
            navalStrength > 0 ? ['⛵', 'At sea', navalStrength] : null,
            { icon: '👤', label: 'Recruits', value: `${remaining}/${capacity}`, cls: remaining > 0 ? 'gold' : 'dim' },
            purse(game.player.gold),
        ]);
        const mods = [];
        const peoplesRecruit = Peoples.recruitModifiers(settlement);
        if (Math.abs(peoplesRecruit.martial) >= 0.005) {
            const pct = Math.round(peoplesRecruit.martial * 100);
            const costPct = Math.round((1 - peoplesRecruit.costMult) * 100);
            mods.push(`<span style="color:${pct > 0 ? '#8fd18a' : '#e0846a'};" title="From the values, traits and status of the peoples living here">⚔️ Martial peoples: ${pct > 0 ? '+' : ''}${pct}% recruits, ${costPct >= 0 ? '−' : '+'}${Math.abs(costPct)}% recruit cost</span>`);
        }
        const armsPct = Math.round((1 - Economy.recruitCostMultiplier(game.world, settlement)) * 100);
        if (armsPct > 0) {
            const armsSources = ActionMenu._resourceSourceNames(game.world, settlement.q, settlement.r, 'military');
            mods.push(`<span style="color:#8fd18a;" title="Iron, horses and coal within 2 hexes arm recruits cheaply">⚒️ Local ${armsSources}: −${armsPct}% recruit cost</span>`);
        }
        if (mods.length) html += bullets(mods);

        const unitRow = (unit, ok, why, onclick, tech) => {
            const cost = PlayerMilitary.getRecruitCost(game.player, unit, tile.settlement, game.world);
            const traits = PlayerMilitary.describeUnitTraits(unit);
            const live = ok && remaining > 0;
            return actRow({
                icon: unit.icon,
                name: `${unit.name}${tech ? ' <span style="font-size:9.5px; letter-spacing:1px; color:#ce93d8;">TECH</span>' : ''}${ok ? '' : ' 🔒'}`,
                desc: `${unit.description} · Strength ${unit.strength} · Upkeep ${unit.upkeep}g/day`,
                note: [traits ? `<span style="color:#ce93d8;">✨ ${traits}</span>` : '', ok ? ActionMenu.recruitArmsNote(game, unit.id, tile.settlement) : ''].filter(Boolean).join(' '),
                off: !live,
                why: ok ? (remaining > 0 ? '' : 'No more recruits here today') : why,
                attrs: live ? `onclick="${onclick}"` : '',
                side: price(cost, game.player.gold >= cost),
            });
        };
        const rows = [];
        for (const [key, unit] of Object.entries(PlayerMilitary.UNIT_TYPES)) {
            const avail = PlayerMilitary.isUnitAvailable(unit, settlement, recruitContext);
            rows.push(unitRow(unit, avail.available, avail.reason, `window.recruitUnit('${key}')`, false));
        }
        html += rowList(rows, 'Companies');

        // Tech-unlocked units
        if (typeof Technology !== 'undefined') {
            const techRows = [];
            for (const [key, unit] of Object.entries(Technology.TECH_UNITS)) {
                if (!unit.requiredTech || !Technology.isImplemented(game.player, unit.requiredTech)) continue;
                const techAvail = PlayerMilitary.isTechUnitAvailable(unit, settlement, recruitContext);
                techRows.push(unitRow(unit, techAvail.available, techAvail.reason, `window.recruitTechUnit('${key}')`, true));
            }
            html += rowList(techRows, 'From your learning');
        }

        game.ui.showCustomPanel('Recruit', html);

        window.recruitUnit = (unitType) => {
            if (!ActionMenu.commitPendingAP(game)) return;
            const result = PlayerMilitary.recruitUnit(game.player, unitType, tile.settlement, { ...recruitContext, world: game.world });
            if (result.success) {
                const armed = result.arms && result.arms.kit
                    ? ` — armed ${result.armed >= 0.95 ? 'fully' : result.armed >= 0.75 ? 'in part' : 'poorly'}${result.arms.cost ? ` (${result.arms.cost} gold of arms bought)` : ''}`
                    : '';
                game.ui.showNotification('Unit Recruited!', result.unit.domain === 'sea'
                    ? `${result.unit.name} joined your squadron — it escorts your ships and blockades ports, but never fights on land`
                    : `${result.unit.name} joined your army${armed}`, 'success');
                game.ui.updateStats(game.player, game.world);
                ActionMenu.showRecruitMenu(game, tile); // Refresh
            } else {
                game.ui.showNotification('Cannot Recruit', result.reason, 'error');
            }
        };

        window.recruitTechUnit = (unitKey) => {
            if (!ActionMenu.commitPendingAP(game)) return;
            const unit = Technology.TECH_UNITS[unitKey];
            if (!unit) return;

            // Check settlement availability
            const techAvail = PlayerMilitary.isTechUnitAvailable(unit, tile.settlement, recruitContext);
            if (!techAvail.available) {
                game.ui.showNotification('Cannot Recruit', techAvail.reason, 'error');
                return;
            }

            // Check recruitment capacity
            const cap = PlayerMilitary.getRecruitmentCapacity(tile.settlement);
            const rec = game.player._recruitedThisTurn || 0;
            if (rec >= cap) {
                game.ui.showNotification('Cannot Recruit', `This settlement can only supply ${cap} recruit${cap > 1 ? 's' : ''} right now`, 'error');
                return;
            }

            const techCost = PlayerMilitary.getRecruitCost(game.player, unit, tile.settlement, game.world);
            if (game.player.gold < techCost) {
                game.ui.showNotification('Cannot Recruit', `Need ${techCost} gold`, 'error');
                return;
            }

            game.player.gold -= techCost;
            Economy.payTown(tile.settlement, techCost); // the bounty is spent in town
            game.player._recruitedThisTurn = (game.player._recruitedThisTurn || 0) + 1;
            if (!game.player.army) game.player.army = [];
            const made = PlayerMilitary.makeArmyUnit(unit);
            game.player.army.push(made);
            // His arms: from your stores, then the town's armourers (systems/arms.js)
            PlayerMilitary.armRecruit(game.player, made, tile.settlement, { world: game.world });

            game.player.skills.combat = Math.min(10, game.player.skills.combat + 0.3);
            game.ui.showNotification('Unit Recruited!', `${unit.name} joined your army`, 'success');
            game.ui.updateStats(game.player, game.world);
            ActionMenu.showRecruitMenu(game, tile);
        };
    },

    /**
     * Show legendary artifact reforging menu
     */
    showReforgeArtifactMenu(game, tile) {
        if (typeof LegendaryArtifacts === 'undefined') {
            game.ui.showNotification('Unavailable', 'Legendary artifact system is not loaded.', 'error');
            return;
        }

        LegendaryArtifacts.initialize(game.player);
        const artifactProgress = LegendaryArtifacts.getProgress(game.player);

        let html = lede('Artifacts are reforged from fragments recovered at ruins, caves, and monuments.');

        if (artifactProgress.length === 0) {
            html += sectionHead('Legendary Artifacts');
            html += '<div style="color: #9d937c; font-size: 12px;">No artifact records found.</div>';
        } else {
            html += chips([['✦', 'Reforged', `${artifactProgress.filter(a => a.isForged).length}/${artifactProgress.length}`, 'gold']]);
            html += rowList(artifactProgress.map(artifact => {
                const canReforge = artifact.isForgeable;
                const status = artifact.isForged
                    ? 'Reforged'
                    : `${artifact.fragmentsOwned}/${artifact.fragmentsRequired} Fragments`;
                const live = canReforge && !artifact.isForged;
                return {
                    icon: artifact.icon,
                    name: artifact.name,
                    desc: artifact.description,
                    note: artifact.passiveText ? `<span style="color:#e6b35c;">✦ ${artifact.passiveText}${artifact.isForged ? '' : ' (once reforged)'}</span>` : '',
                    off: !live,
                    attrs: `onclick="window.reforgeArtifact('${artifact.id}')"`,
                    side: live ? `${status} · Reforge ›` : status,
                    tone: artifact.isForged ? 'good' : canReforge ? 'gold' : '',
                };
            }), 'Legendary Artifacts');
        }
        game.ui.showCustomPanel('Artifact Forge', html);

        window.reforgeArtifact = (artifactId) => {
            if (!ActionMenu.commitPendingAP(game)) return;
            const result = LegendaryArtifacts.reforgeArtifact(game.player, artifactId, game.world);
            if (result.success) {
                const artifact = result.artifact;
                game.ui.showNotification('Artifact Reforged!', `${artifact.icon} ${artifact.name} has been restored to glory.`, 'success');
                if (typeof Quests !== 'undefined') {
                    Quests.generateAvailableQuests(game.player);
                }
                game.ui.updateStats(game.player, game.world);
                ActionMenu.showReforgeArtifactMenu(game, tile);
            } else {
                game.ui.showNotification('Cannot Reforge', result.reason, 'error');
            }
        };
    },

    /**
     * Show contract menu
     */
    showContractMenu(game, tile) {
        // Your parents' rules at this door too (ui/parentsGuard.js)
        if (!ParentsGuard.ok(game, 'contract', tile)) return;
        const armyStrength = PlayerMilitary.getArmyStrength(game.player);
        const offers = PlayerMilitary.getMercenaryOffers(game.player, tile, game.world);
        const activeCompanies = game.player.mercenaryCompanies || [];

        // The action menu's voice (uiKit): a lede and chips, then a row a company or a job
        const empty = (t) => `<div style="font-size: 12px; color: #9d937c; padding: 4px 2px 8px; font-style: italic;">${t}</div>`;
        let html = lede('Mercenary Contracts: hire a famous company to march under your banner, or sell your own swords for coin.');
        html += chips([['⚔️', 'Your army strength', armyStrength], ['🛡️', 'Hired companies', activeCompanies.length], purse(game.player.gold)]);

        html += sectionHead('Famous Companies for Hire');
        if (offers.length === 0) {
            const why = PlayerMilitary.hostsMercenaryCompanies(tile.settlement)
                ? 'No companies are recruiting here today.'
                : 'No free company seeks work in a village. Look for them in the towns.';
            html += empty(why);
        } else {
            html += rowList(offers.map(offer => {
                const totalUnits = (offer.roster || []).reduce((sum, row) => sum + row.count, 0);
                const rosterText = (offer.roster || []).map(row => `${row.count}x ${row.type}`).join(', ');
                const canHire = game.player.gold >= offer.hireCost;
                return {
                    icon: offer.icon,
                    name: offer.name,
                    desc: offer.reputation,
                    why: `${offer.reputation} · not enough gold to hire`,
                    note: `<span style="color:#b9ae94;">Roster: ${totalUnits} units (${rosterText}) · Loyalty: ${Math.floor(offer.loyalty)} | Daily Wage: ${offer.dailyWage}g | Contract: ${offer.duration} days</span>`,
                    off: !canHire,
                    attrs: `onclick="window.hireMercCompany('${offer.offerId}')"`,
                    side: `<span style="font-size:11px; color:#9d937c;">Hire</span> ${price(offer.hireCost, canHire)}`,
                };
            }));
        }

        html += sectionHead('Active Hired Companies');
        if (activeCompanies.length === 0) {
            html += empty('You have no hired companies.');
        } else {
            html += rowList(activeCompanies.map(company => {
                const loyalty = Math.floor(company.loyalty || 0);
                const loyaltyColor = loyalty >= 65 ? '#8fd18a' : loyalty >= 45 ? '#f0b35a' : '#e0846a';
                return {
                    icon: company.icon || '⚔️',
                    name: company.name,
                    desc: company.reputation || 'Professional mercenary company',
                    note: `<span style="color:${loyaltyColor};">Loyalty: ${loyalty} | Wage: ${company.dailyWage}g/day | Days Left: ${company.daysRemaining}</span>`,
                    side: `<button onclick="window.payMercBonus('${company.id}')" style="${BTN_GOLD}">+ Loyalty (120g)</button><button onclick="window.dismissMercCompany('${company.id}')" style="${BTN_RED}">Dismiss</button>`,
                };
            }));
        }

        html += '<div style="font-size: 11px; color: #9d937c; margin: 2px 0 10px;">Low loyalty companies can defect if rival kingdoms outbid you.</div>';

        html += sectionHead('Take Mercenary Work');
        const mercRep = MercContracts.repWith(game.player, tile.settlement && tile.settlement.kingdom);
        if (mercRep) html += `<div style="font-size: 11px; color: ${mercRep > 0 ? '#8fd18a' : '#f0b35a'}; margin-bottom: 6px;">Your name as a sellsword here: ${mercRep > 0 ? '+' : ''}${Math.round(mercRep)} (fees ${mercRep > 0 ? 'raised' : 'cut'})</div>`;
        const workRows = [];
        for (const [key, contract] of Object.entries(PlayerMilitary.CONTRACT_TYPES)) {
            const quote = MercContracts.quote(game.player, contract, tile.settlement);
            const canAccept = armyStrength >= contract.minStrength && !quote.refused && !game.player.activeContract;
            const winPct = Math.round(MercContracts.winChance(armyStrength, quote.opposition, game.player) * 100);
            const reason = quote.refused ? quote.reason
                : game.player.activeContract ? 'You are already under contract'
                : armyStrength < contract.minStrength ? `Your army is too weak (needs ${contract.minStrength})` : '';
            workRows.push({
                icon: contract.icon,
                name: contract.name,
                desc: contract.description,
                why: `${contract.description} · ${reason}`,
                note: `<span style="color:#b9ae94;">Duration: ${contract.duration} days | Min Strength: ${contract.minStrength} | Foe ≈${quote.opposition} | Odds ≈${winPct}%</span>`,
                off: !canAccept,
                attrs: `onclick="window.acceptContract('${key}')"`,
                side: `${quote.payment} gold`,
                tone: 'good',
            });
        }
        html += rowList(workRows);

        game.ui.showCustomPanel('Contracts', html);

        window.hireMercCompany = (offerId) => {
            if (!ActionMenu.commitPendingAP(game)) return;
            const result = PlayerMilitary.hireMercenaryCompany(game.player, tile, offerId, game.world);
            if (result.success) {
                const company = result.company;
                game.ui.showNotification('Mercenaries Hired!', `${company.icon} ${company.name} joined your banner`, 'success');
                game.ui.updateStats(game.player, game.world);
                ActionMenu.showContractMenu(game, tile);
            } else {
                game.ui.showNotification('Cannot Hire', result.reason, 'error');
            }
        };

        window.payMercBonus = (companyId) => {
            const result = PlayerMilitary.payMercenaryBonus(game.player, companyId, 120);
            if (result.success) {
                game.ui.showNotification('Bonus Paid', `+${result.loyaltyGain} loyalty to ${result.company.name}`, 'success');
                game.ui.updateStats(game.player, game.world);
                ActionMenu.showContractMenu(game, tile);
            } else {
                game.ui.showNotification('Cannot Pay Bonus', result.reason, 'error');
            }
        };

        window.dismissMercCompany = (companyId) => {
            const result = PlayerMilitary.dismissMercenaryCompany(game.player, companyId);
            if (result.success) {
                game.ui.showNotification('Company Dismissed', `${result.company.name} was released (${result.unitsRemoved} units left)`, 'default');
                game.ui.updateStats(game.player, game.world);
                ActionMenu.showContractMenu(game, tile);
            } else {
                game.ui.showNotification('Cannot Dismiss', result.reason, 'error');
            }
        };

        window.acceptContract = (contractType) => {
            if (!ActionMenu.commitPendingAP(game)) return;
            const result = PlayerMilitary.acceptContract(game.player, contractType, tile.settlement);
            if (result.success) {
                game.ui.showNotification('Contract Accepted!', `${result.contract.name} - ${result.contract.daysRemaining} days remaining`, 'success');
                ActionMenu.close();
            } else {
                game.ui.showNotification('Cannot Accept', result.reason, 'error');
            }
        };
    },
});
