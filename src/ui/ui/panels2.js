// UI — panels2 methods.
import { UI } from './core.js';
import { Utils, ActionMenu, Religion, Economy, PlayerEconomy, PlayerReligion, Infrastructure, Peoples, CustomObjects, Characters, Culture, Quests, Technology, Banking, MarketDynamics, Taxation, Hex, SaveLoad, audioManager, NpcFamily, Relationships, Housing, KingdomBonuses, KingdomAtlas } from './_imports.js';

Object.assign(UI.prototype, {
    /**
     * Hide title screen
     */
    hideTitleScreen() {
        const titleScreen = document.getElementById('titleScreen');
        titleScreen.style.transition = 'opacity 0.8s ease';
        titleScreen.style.opacity = '0';
        setTimeout(() => {
            titleScreen.classList.add('hidden');
        }, 800);
    },

    /**
     * Show Religion & Culture overview panel
     */
    showReligionCulturePanel(player, world) {
        let html = '<div style="max-width: 650px;">';

        // ── PLAYER RELIGION ──
        html += '<div class="info-section-title">🙏 Your Religion</div>';
        if (player.religion) {
            html += `
                <div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: 6px; margin-bottom: 12px;">
                    <div style="font-size: 18px; color: var(--gold); font-family: var(--font-display);">${player.religion.name}</div>
                    <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">Tenets: ${player.religion.tenets.join(', ')}</div>
                    <div style="display: flex; gap: 16px; margin-top: 8px; font-size: 13px;">
                        <span>👥 ${Utils.formatNumber(player.religion.followers)} followers</span>
                        <span>📿 ${player.religion.influence} influence</span>
                        <span>🏛️ ${player.religion.buildings.length} buildings</span>
                        <span>💰 +${PlayerReligion.getFaithIncome(player)}/day</span>
                    </div>
                </div>
            `;
        } else {
            html += '<p style="color: var(--text-secondary); font-size: 13px;">You have not founded a religion yet. Build a temple to get started (requires 10 karma).</p>';
        }

        // ── PLAYER CULTURAL BUILDINGS ──
        html += '<div class="info-section-title">📚 Your Cultural Buildings</div>';
        if (player.culturalBuildings && player.culturalBuildings.length > 0) {
            for (const bRef of player.culturalBuildings) {
                const tile = world.getTile(bRef.q, bRef.r);
                if (!tile || !tile.culturalBuilding) continue;
                const b = tile.culturalBuilding;
                html += `
                    <div style="padding: 8px 12px; margin-bottom: 6px; background: rgba(255,255,255,0.05); border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <span style="font-size: 16px;">${b.icon}</span> <strong>${b.name}</strong>
                            <span style="font-size: 11px; color: var(--text-secondary);"> Lv ${b.level || 1}/${Culture.LEVELS.max} at (${bRef.q}, ${bRef.r})${b.underConstruction ? ' · under construction' : ''}</span>
                        </div>
                        <div style="font-size: 12px;">
                            Influence +${b.influencePerDay * (b.level || 1)} | Scholar +${b.scholarshipBonus}
                            ${b.researchBonus ? ` | Research +${Math.round(b.researchBonus * Culture.levelMultiplier(b) * 100)}%` : ''}
                            ${b.incomeBonus ? ` | +${Math.round(Culture.dailyIncome(b) * 10) / 10} gold/day` : ''}
                            ${Culture.getUpgradeCost(b) !== null ? ` | Upgrade: ${Culture.getUpgradeCost(b)}g (visit it)` : ''}
                        </div>
                    </div>
                `;
            }
            const totalInfluence = typeof Culture !== 'undefined' ? Culture.getInfluence(player, world) : 0;
            const totalResearch = typeof Culture !== 'undefined' ? Culture.getResearchBonus(player, world) : 0;
            html += `<div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">Total cultural influence: ${totalInfluence}${totalResearch > 0 ? ` · Research speed +${Math.round(totalResearch * 100)}%` : ''}</div>`;
        } else {
            html += '<p style="color: var(--text-secondary); font-size: 13px;">No cultural buildings yet. Visit settlements to build libraries, theaters, or universities.</p>';
        }

        // ── WORLD RELIGIONS ── (gated behind religion knowledge)
        if (typeof Religion !== 'undefined') {
            html += '<div class="info-section-title" style="margin-top: 16px;">☀️ World Religions</div>';

            // Active faiths — only show faiths the player knows about via kingdom knowledge or own faith
            const activeFaiths = Object.values(Religion.FAITHS).filter(f => !f.extinct);
            const knownActiveFaiths = activeFaiths.filter(faith => {
                // Always show player's own faith
                if (player.religion && player.religion.faithId === faith.id) return true;
                // Show if the player knows the religion of any kingdom that practices this faith
                return world.kingdoms.some(k => k.isAlive && k.religion && k.religion.faithId === faith.id && player.knowsAbout(k.id, 'religion'));
            });

            if (knownActiveFaiths.length > 0) {
                html += '<div style="font-size: 13px; color: var(--gold); margin-bottom: 6px;">Active Faiths</div>';
                for (const faith of knownActiveFaiths) {
                    const kingdoms = world.kingdoms.filter(k => k.isAlive && k.religion && k.religion.faithId === faith.id && player.knowsAbout(k.id, 'religion'));
                    html += `
                        <div style="padding: 10px 12px; margin-bottom: 6px; background: rgba(255,255,255,0.05); border-radius: 4px; border-left: 3px solid ${faith.holyColor};">
                            <div style="display: flex; justify-content: space-between;">
                                <div><span style="font-size: 18px;">${faith.icon}</span> <strong>${faith.name}</strong></div>
                                <span style="font-size: 11px; color: var(--text-secondary);">Founded yr ${faith.founded}</span>
                            </div>
                            <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">${faith.description}</div>
                            <div style="font-size: 11px; margin-top: 4px;">Tenets: ${faith.tenets.join(', ')}</div>
                            ${kingdoms.length > 0 ? `<div style="font-size: 11px; margin-top: 2px;">Practised by: ${kingdoms.map(k => k.name).join(', ')}</div>` : ''}
                        </div>
                    `;
                }
            }

            if (knownActiveFaiths.length < activeFaiths.length) {
                const unknownCount = activeFaiths.length - knownActiveFaiths.length;
                html += `<div style="color: #95a5a6; font-style: italic; font-size: 12px; margin-bottom: 8px;">There ${unknownCount === 1 ? 'is' : 'are'} ${unknownCount} other faith${unknownCount === 1 ? '' : 's'} in the world you have yet to learn about.</div>`;
            }

            // Extinct faiths — only show ones the player has discovered
            const extinctFaiths = Object.values(Religion.FAITHS).filter(f => f.extinct);
            const discoveredExtinct = extinctFaiths.filter(f => player.discoveredExtinctFaiths && player.discoveredExtinctFaiths.has(f.id));
            const undiscoveredExtinctCount = extinctFaiths.length - discoveredExtinct.length;

            if (discoveredExtinct.length > 0 || undiscoveredExtinctCount > 0) {
                html += '<div style="font-size: 13px; color: #95a5a6; margin: 12px 0 6px;">Extinct Faiths</div>';
                for (const faith of discoveredExtinct) {
                    html += `
                        <div style="padding: 8px 12px; margin-bottom: 6px; background: rgba(255,255,255,0.03); border-radius: 4px; border-left: 3px solid #555; opacity: 0.7;">
                            <div><span style="font-size: 16px;">${faith.icon}</span> <strong>${faith.name}</strong> <span style="font-size: 11px; color: #777;">(${faith.founded} – ${faith.extinctYear})</span></div>
                            <div style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">${faith.description}</div>
                        </div>
                    `;
                }
                if (undiscoveredExtinctCount > 0) {
                    html += `<div style="color: #95a5a6; font-style: italic; font-size: 12px; margin-bottom: 8px;">There ${undiscoveredExtinctCount === 1 ? 'is' : 'are'} ${undiscoveredExtinctCount} forgotten faith${undiscoveredExtinctCount === 1 ? '' : 's'} lost to history. Explore ancient holy sites, study ruins, or seek knowledge in taverns to uncover them.</div>`;
                }
            }

            // ── HOLY SITES ── (only show ones the player has discovered via exploration)
            const holySites = [];
            const discoveredHS = player.discoveredHolySites || new Set();
            for (let r = 0; r < world.height; r++) {
                for (let q = 0; q < world.width; q++) {
                    const tile = world.getTile(q, r);
                    if (tile && tile.holySite) {
                        // Only show if the player has explored this tile or discovered via other means
                        if (discoveredHS.has(`${q},${r}`)) {
                            holySites.push({ q, r, site: tile.holySite });
                        }
                    }
                }
            }
            // Count total holy sites for hint
            let totalHolySites = 0;
            for (let r = 0; r < world.height; r++) {
                for (let q = 0; q < world.width; q++) {
                    const tile = world.getTile(q, r);
                    if (tile && tile.holySite) totalHolySites++;
                }
            }
            const undiscoveredSiteCount = totalHolySites - holySites.length;

            if (holySites.length > 0 || undiscoveredSiteCount > 0) {
                html += '<div class="info-section-title" style="margin-top: 16px;">⛲ Holy Sites</div>';
                for (const hs of holySites) {
                    const controller = hs.site.controller ? world.getKingdom(hs.site.controller) : null;
                    html += `
                        <div style="padding: 8px 12px; margin-bottom: 6px; background: rgba(255,255,255,0.05); border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <span style="font-size: 16px;">${hs.site.icon}</span> <strong>${hs.site.name}</strong>
                                <span style="font-size: 11px; color: var(--text-secondary);"> (${hs.q}, ${hs.r})</span>
                            </div>
                            <div style="font-size: 12px;">
                                ${controller ? `<span style="color: ${controller.color};">${controller.name}</span>` : '<span style="color: #f39c12;">Unclaimed</span>'}
                                | 🧑‍🤝‍🧑 ${Utils.formatNumber(hs.site.pilgrimCount || 0)} pilgrims
                            </div>
                        </div>
                    `;
                }
                if (undiscoveredSiteCount > 0) {
                    html += `<div style="color: #95a5a6; font-style: italic; font-size: 12px; margin-top: 4px;">Rumors suggest ${undiscoveredSiteCount} more holy site${undiscoveredSiteCount === 1 ? ' exists' : 's exist'} in unexplored lands.</div>`;
                }
            }
        }

        // ── KINGDOM CULTURAL DATA ── (gated behind religion knowledge per kingdom)
        if (typeof Culture !== 'undefined') {
            html += '<div class="info-section-title" style="margin-top: 16px;">🎭 Kingdom Cultures</div>';
            let anyKnown = false;
            for (const kingdom of world.kingdoms) {
                if (!kingdom.isAlive || !kingdom.cultureData) continue;
                if (!player.knowsAbout(kingdom.id, 'religion')) continue;
                anyKnown = true;
                html += `
                    <div style="padding: 8px 12px; margin-bottom: 6px; background: rgba(255,255,255,0.05); border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <span class="kingdom-dot" style="color:${kingdom.color}; background:${kingdom.color}"></span>
                            <strong>${kingdom.name}</strong>
                            <span style="font-size: 12px; color: var(--text-secondary);"> – ${kingdom.cultureData.tradition.name}</span>
                            ${KingdomBonuses.describeTradition(kingdom.cultureData.tradition).length ? `<div style="font-size: 10px; color: var(--text-secondary); margin-top: 2px;">${KingdomBonuses.describeTradition(kingdom.cultureData.tradition).join(' · ')}</div>` : ''}
                        </div>
                        <div style="font-size: 12px;">
                            📖 ${Math.floor(kingdom.cultureData.scholarship)} | 🌐 ${Math.floor(kingdom.cultureData.influence)}
                            ${kingdom.religion ? ` | ${kingdom.religion.icon} ${Math.floor(kingdom.religion.piety)} piety` : ''}
                            ${(() => {
                                const d = Culture.describeKingdom(kingdom);
                                const extra = [...d.buildings, ...d.events];
                                return `<div style="font-size: 10px; color: var(--text-secondary); margin-top: 2px;">${d.effects.join(' · ')}${extra.length ? '<br>' + extra.join(' · ') : ''}</div>`;
                            })()}
                        </div>
                    </div>
                `;
            }
            if (!anyKnown) {
                html += `<div style="color: #95a5a6; font-style: italic; font-size: 12px;">You have not yet learned about the cultural traditions of any kingdom. Visit settlements and speak with locals to discover them.</div>`;
            }
        }

        html += '</div>';
        this.showCustomPanel('🙏 Religion & Culture', html);
    },

    /**
     * Show world history panel
     */
    showHistoryPanel() {
        // Use merged history if Peoples system is available (includes tribal history)
        let mergedHistory;
        if (typeof Peoples !== 'undefined') {
            mergedHistory = Peoples.getMergedHistory(this.game.world);
        } else {
            mergedHistory = (this.game.world.history || []).map(e => ({ ...e, source: 'world' }));
        }

        if (!mergedHistory || mergedHistory.length === 0) {
            this.showCustomPanel('World History', '<p style="color: var(--text-secondary);">No known history recorded.</p>');
            return;
        }

        // Use the rich Peoples history display if available — gated by discovered lore
        if (typeof Peoples !== 'undefined') {
            const discoveredLore = this.game.player.discoveredLore || new Set();
            const html = Peoples.buildTribalHistoryHTML(this.game.world, discoveredLore);
            this.showCustomPanel('📜 History of the Peoples', html);
            return;
        }

        // Fallback: simple timeline
        const sortedHistory = [...mergedHistory].sort((a, b) => a.year - b.year);

        let html = '<div class="history-timeline" style="position: relative; padding-left: 20px;">';
        html += '<div style="position: absolute; left: 6px; top: 0; bottom: 0; width: 2px; background: rgba(255,255,255,0.1);"></div>';

        for (const event of sortedHistory) {
            html += `
                <div class="history-event" style="margin-bottom: 20px; position: relative;">
                    <div style="position: absolute; left: -20px; top: 4px; width: 14px; height: 14px; background: var(--gold); border-radius: 50%; box-shadow: 0 0 10px var(--gold);"></div>
                    <div style="font-family: var(--font-display); color: var(--gold); font-size: 18px; margin-bottom: 4px;">Year ${event.year}</div>
                    <div style="color: var(--text-primary); line-height: 1.5; font-size: 14px;">${event.text}</div>
                </div>
            `;
        }

        html += '</div>';
        this.showCustomPanel('World History', html);
    },

    /**
     * Show settlement details modal
     */
    showSettlementDetails(q, r) {
        const tile = this.game.world.getTile(q, r);
        if (!tile || !tile.settlement) {
            this.showNotification('Error', 'No settlement found at this location', 'error');
            return;
        }

        const settlement = tile.settlement;
        const kingdom = settlement.kingdom ? this.game.world.getKingdom(settlement.kingdom) : null;
        const econ = Economy.getSummary(settlement, tile, this.game.world);

        // Find the lord of this settlement (for now, use kingdom lord)
        const lord = kingdom && kingdom.lord ? kingdom.lord : null;

        let html = `
            <div style="max-width: 600px;">
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="font-size: 48px; margin-bottom: 8px;">${settlement.type === 'capital' ? '🏰' : settlement.type === 'town' ? '🏘️' : '🏠'}</div>
                    <h2 style="margin: 0; color: var(--gold); font-family: var(--font-display);">${settlement.name}</h2>
                    <div style="color: var(--text-secondary); font-size: 14px; margin-top: 4px;">${settlement.type.charAt(0).toUpperCase() + settlement.type.slice(1)}</div>
                </div>

                <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                    <div class="info-row">
                        <span class="info-label">Population</span>
                        <span class="info-value">${Utils.formatNumber(settlement.population)}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Founded</span>
                        <span class="info-value">${settlement.founded ? `Year ${settlement.founded} (${this.game.world.year - settlement.founded} years ago)` : 'Ancient times'}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Coordinates</span>
                        <span class="info-value">${q}, ${r}</span>
                    </div>
                </div>
        `;

        const player = this.game.player;
        const knows = (cat) => kingdom ? player.knowsAbout(kingdom.id, cat) : false;

        // Kingdom and Lord Information
        if (kingdom) {
            html += `
                <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                    <div class="info-section-title">Allegiance</div>
                    <div class="info-row">
                        <span class="info-label">Kingdom</span>
                        <span class="info-value" style="cursor: pointer; text-decoration: underline; color: ${kingdom.color};" data-ui-act="showKingdomDetails" data-ui-args='["${kingdom.id}"]'>
                            <span class="kingdom-dot" style="color:${kingdom.color}; background:${kingdom.color}"></span>
                            ${kingdom.name}
                        </span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Ruler</span>
                        <span class="info-value">${knows('ruler') ? kingdom.ruler : '<span style="color:#95a5a6;font-style:italic;">Unknown</span>'}</span>
                    </div>
            `;

            if (knows('ruler') && lord) {
                const traitNames = lord.traits.map(t => t.name).join(', ');
                html += `
                    <div class="info-row">
                        <span class="info-label">Lord</span>
                        <span class="info-value">${lord.name}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Age</span>
                        <span class="info-value">${lord.age} years</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Traits</span>
                        <span class="info-value">${traitNames || 'None'}</span>
                    </div>
                `;
            }

            html += `</div>`;
        } else {
            html += `
                <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                    <div class="info-section-title">Allegiance</div>
                    <div class="info-row">
                        <span class="info-label">Status</span>
                        <span class="info-value" style="color: #95a5a6;">Independent</span>
                    </div>
                </div>
            `;
        }

        // Economy — gated behind knowledge
        if (knows('economy')) {
            html += `
                <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px;">
                    <div class="info-section-title">Economy</div>
                    <div class="info-row">
                        <span class="info-label">💰 Gold Production</span>
                        <span class="info-value" style="color: #f1c40f;">+${econ.production.gold}/day</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">🌾 Food Production</span>
                        <span class="info-value" style="color: #2ecc71;">+${econ.production.food}/day</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">📦 Goods Production</span>
                        <span class="info-value" style="color: #3498db;">+${econ.production.goods}/day</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Trade Routes</span>
                        <span class="info-value">${econ.tradeRoutes}</span>
                    </div>
                </div>
            `;
        } else {
            html += `
                <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px;">
                    <div class="info-section-title">Economy</div>
                    <div style="color: #95a5a6; font-style: italic; padding: 8px 0;">You don't know enough about this settlement's economy. Try trading here or asking locals.</div>
                </div>
            `;
        }

        // Cultural Demographics — gated behind knowledge
        if (typeof Peoples !== 'undefined' && settlement.demographics) {
            if (knows('peoples')) {
                html += `
                    <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px; margin-top: 16px;">
                `;
                html += Peoples.buildDemographicsHTML(settlement);
                html += `</div>`;
            } else {
                html += `
                    <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px; margin-top: 16px;">
                        <div class="info-section-title">Demographics</div>
                        <div style="color: #95a5a6; font-style: italic; padding: 8px 0;">You know little of the peoples who dwell here. Speak with locals or visit the tavern to learn more.</div>
                    </div>
                `;
            }
        }

        html += '</div>';

        this.showCustomPanel(`${settlement.name}`, html);
    },

    /**
     * Show kingdom details modal
     */
    showKingdomDetails(kingdomId) {
        const kingdom = this.game.world.getKingdom(kingdomId);
        if (!kingdom) {
            this.showNotification('Error', 'Kingdom not found', 'error');
            return;
        }

        const lord = kingdom.lord;
        const player = this.game.player;
        const knows = (cat) => player.knowsAbout(kingdom.id, cat);
        const unknownBox = (label) => `<div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px; margin-bottom: 16px;">
            <div class="info-section-title">${label}</div>
            <div style="color:#666; font-size:12px; font-style:italic;">You haven't discovered this yet. Talk to locals, visit taverns, or meet their lord to learn more.</div>
        </div>`;

        // Count settlements
        const settlements = this.game.world.getAllSettlements().filter(s => s.kingdom === kingdom.id);
        const capitals = settlements.filter(s => s.type === 'capital');
        const towns = settlements.filter(s => s.type === 'town');
        const villages = settlements.filter(s => s.type === 'village');

        // Calculate total population
        const totalPopulation = settlements.reduce((sum, s) => sum + s.population, 0);

        let html = `
            <div style="max-width: 700px;">
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="font-size: 64px; margin-bottom: 8px;">👑</div>
                    <h2 style="margin: 0; color: ${kingdom.color}; font-family: var(--font-display);">${kingdom.name}</h2>
                    <div style="color: var(--text-secondary); font-size: 14px; margin-top: 4px;">${knows('peoples') ? kingdom.culture + ' Culture' : 'Culture unknown'}</div>
                </div>

                <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                    <div class="info-row">
                        <span class="info-label">Ruler</span>
                        <span class="info-value" style="color: var(--gold);">${knows('ruler') ? kingdom.ruler : '<span style=color:#666>Unknown</span>'}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Status</span>
                        <span class="info-value" style="color: ${kingdom.isAlive ? '#2ecc71' : '#e74c3c'};">${kingdom.isAlive ? 'Active' : 'Fallen'}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Founded</span>
                        <span class="info-value">Year ${kingdom.foundedDay || 1}</span>
                    </div>
                </div>
        `;

        // Lord Details
        if (!knows('ruler')) {
            html += unknownBox('Lord of the Realm');
        } else if (lord) {
            const traitNames = lord.traits.map(t => t.name).join(', ');
            html += `
                <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                    <div class="info-section-title">Lord of the Realm</div>
                    <div class="info-row">
                        <span class="info-label">Name</span>
                        <span class="info-value">${lord.name}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Age</span>
                        <span class="info-value">${lord.age} years</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Traits</span>
                        <span class="info-value">${traitNames || 'None'}</span>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px;">
                        <div class="info-row" style="margin: 0;">
                            <span class="info-label">⚔️ Martial</span>
                            <span class="info-value">${lord.martial}/10</span>
                        </div>
                        <div class="info-row" style="margin: 0;">
                            <span class="info-label">🤝 Diplomacy</span>
                            <span class="info-value">${lord.diplomacy}/10</span>
                        </div>
                        <div class="info-row" style="margin: 0;">
                            <span class="info-label">📊 Stewardship</span>
                            <span class="info-value">${lord.stewardship}/10</span>
                        </div>
                        <div class="info-row" style="margin: 0;">
                            <span class="info-label">🎯 Ambition</span>
                            <span class="info-value">${lord.ambition}/10</span>
                        </div>
                    </div>
                </div>
            `;
        }

        // Territory and Population
        html += `
            <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                <div class="info-section-title">Territory</div>
                <div class="info-row">
                    <span class="info-label">Total Population</span>
                    <span class="info-value">${Utils.formatNumber(totalPopulation)}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Settlements</span>
                    <span class="info-value">${settlements.length} (${capitals.length} capital, ${towns.length} towns, ${villages.length} villages)</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Territory Tiles</span>
                    <span class="info-value">${kingdom.territory ? kingdom.territory.length : 0}</span>
                </div>
            </div>
        `;

        // Royal cartography (world/kingdomAtlas.js)
        if (knows('diplomacy') && kingdom.cartography) {
            const atlas = KingdomAtlas.summary(kingdom, this.game.world);
            html += `
            <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                <div class="info-section-title">🧭 Royal Cartography</div>
                <div class="info-row">
                    <span class="info-label">Court Cartographer</span>
                    <span class="info-value">${atlas.hired ? 'Employed' : 'None'}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Maps Drawn</span>
                    <span class="info-value">${atlas.mapsMade} (charts ${(atlas.accuracy * 100).toFixed(0)}% accurate)</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Charted Realms</span>
                    <span class="info-value">${atlas.charts.length ? atlas.charts.map(c => c.name).join(', ') : 'None'}</span>
                </div>
                <div style="color:#888; font-size:11px; margin-top:6px;">Realms fight better against lands they have charted, and prefer them as war targets.</div>
            </div>
            `;
        }

        // Diplomacy
        if (knows('diplomacy')) {
        html += `
            <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                <div class="info-section-title">Diplomacy</div>
        `;

        const otherKingdoms = this.game.world.kingdoms.filter(k => k.id !== kingdom.id && k.isAlive);
        if (otherKingdoms.length > 0) {
            for (const other of otherKingdoms) {
                const relation = kingdom.relations[other.id] || 0;
                const atWar = kingdom.wars && kingdom.wars.includes(other.id);
                let relationText = '';
                let relationColor = '';

                if (atWar) {
                    relationText = '⚔️ At War';
                    relationColor = '#e74c3c';
                } else if (relation > 50) {
                    relationText = '🤝 Friendly';
                    relationColor = '#2ecc71';
                } else if (relation > 0) {
                    relationText = '😐 Neutral';
                    relationColor = '#95a5a6';
                } else if (relation > -50) {
                    relationText = '😠 Unfriendly';
                    relationColor = '#e67e22';
                } else {
                    relationText = '💢 Hostile';
                    relationColor = '#e74c3c';
                }

                html += `
                    <div class="info-row">
                        <span class="info-label">
                            <span class="kingdom-dot" style="color:${other.color}; background:${other.color}"></span>
                            ${other.name}
                        </span>
                        <span class="info-value" style="color: ${relationColor};">${relationText} (${relation})</span>
                    </div>
                `;
            }
        } else {
            html += `<div style="color: var(--text-secondary); font-style: italic;">No other kingdoms</div>`;
        }

        html += `</div>`;
        } else {
            html += unknownBox('Diplomacy');
        }
        html += `
            <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                <div class="info-section-title">About</div>
                <p style="color: var(--text-secondary); line-height: 1.6; margin: 0;">${kingdom.description}</p>
            </div>
        `;

        // Constituent Peoples
        if (knows('peoples') && typeof Peoples !== 'undefined') {
            const kingdomTribes = Peoples.getTribesForCulture(kingdom.culture);
            if (kingdomTribes.length > 0) {
                html += `
                    <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                        <div class="info-section-title">Constituent Peoples</div>
                        <p style="color: var(--text-secondary); font-size: 12px; line-height: 1.4; margin: 0 0 12px 0;">
                            This realm was forged from the union of ancient tribes, each bringing their own heritage to the kingdom.
                        </p>
                `;
                for (const tribe of kingdomTribes) {
                    html += `
                        <div style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px; margin-bottom: 8px; border-left: 3px solid ${tribe.color};">
                            <div style="color: #fff; font-size: 14px; margin-bottom: 4px;">${tribe.icon} <strong>${tribe.name}</strong></div>
                            <div style="color: var(--text-secondary); font-size: 11px; margin-bottom: 4px;">Origin: ${tribe.origin} | Traits: ${tribe.traits.join(', ')}</div>
                            <div style="color: var(--text-secondary); font-size: 11px; font-style: italic;">${tribe.proverb}</div>
                            <div style="color: var(--gold); font-size: 11px; margin-top: 4px;">🎨 ${tribe.artForms.join(', ')} &nbsp;|&nbsp; 🍲 ${tribe.cuisine.slice(0, 2).join(', ')}</div>
                        </div>
                    `;
                }
                html += `</div>`;
            }
        }

        html += '</div>';

        this.showCustomPanel(kingdom.name, html);
    },

    /**
     * Show Peoples & Subcultures panel — a dedicated view of the multicultural world.
     */
    showPeoplesPanel() {
        if (typeof Peoples === 'undefined') {
            this.showNotification('Unavailable', 'Peoples system not loaded', 'error');
            return;
        }

        let html = `<div style="max-width: 700px;">`;

        // Header
        html += `
            <div style="text-align: center; margin-bottom: 20px;">
                <div style="font-size: 48px; margin-bottom: 8px;">🏛️</div>
                <h2 style="margin: 0; color: var(--gold); font-family: var(--font-display);">Peoples of the Realm</h2>
                <p style="color: var(--text-secondary); margin: 8px 0 0 0; font-size: 13px; line-height: 1.5;">
                    Every kingdom is a tapestry of ancient tribal peoples — each with their own customs, cuisine, art, and ancestral memories. 
                    Click a settlement to see its unique demographic composition.
                </p>
            </div>
        `;

        const player = this.game.player;

        // Show each kingdom's constituent peoples — gated behind knowledge
        for (const kingdom of this.game.world.kingdoms) {
            if (!kingdom.isAlive) continue;

            const tribes = Peoples.getTribesForCulture(kingdom.culture);
            if (tribes.length === 0) continue;

            const knowsPeoples = player.knowsAbout(kingdom.id, 'peoples');

            html += `
                <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px; margin-bottom: 16px; border-left: 4px solid ${kingdom.color};">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <div>
                            <span style="color: ${kingdom.color}; font-family: var(--font-display); font-size: 16px;">${kingdom.name}</span>
                            <span style="color: var(--text-secondary); font-size: 12px; margin-left: 8px;">${knowsPeoples ? kingdom.culture + ' Culture' : 'Culture unknown'}</span>
                        </div>
                    </div>
            `;

            if (knowsPeoples) {
                for (const tribe of tribes) {
                    html += `
                        <div style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px; margin-bottom: 8px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                                <span style="color: #fff; font-size: 14px;">${tribe.icon} <strong>${tribe.name}</strong></span>
                                <span style="color: var(--text-secondary); font-size: 11px;">${tribe.origin}</span>
                            </div>
                            <div style="color: var(--text-secondary); font-size: 11px; margin-bottom: 4px;">
                                Traits: <span style="color: #fff;">${tribe.traits.join(', ')}</span>
                            </div>
                            <div style="color: var(--text-secondary); font-size: 11px; margin-bottom: 4px;">
                                🎨 <span style="color: #fff;">${tribe.artForms.join(', ')}</span>
                            </div>
                            <div style="color: var(--text-secondary); font-size: 11px; margin-bottom: 4px;">
                                🍲 <span style="color: #fff;">${tribe.cuisine.join(', ')}</span>
                            </div>
                            <div style="color: var(--text-secondary); font-size: 11px; margin-bottom: 4px;">
                                🎉 <span style="color: #fff;">${tribe.customs.join(', ')}</span>
                            </div>
                            <div style="color: var(--gold); font-size: 11px; font-style: italic; margin-bottom: 4px;">
                                📜 ${tribe.proverb}
                            </div>
                            <div style="color: var(--text-secondary); font-size: 11px; font-style: italic; line-height: 1.4;">
                                ${tribe.ancestralMemory}
                            </div>
                        </div>
                    `;
                }
            } else {
                html += `<div style="color: #95a5a6; font-style: italic; padding: 8px 0;">You know nothing of the peoples of ${kingdom.name}. Visit their settlements, speak with locals, or ask their lord to learn more.</div>`;
            }

            html += `</div>`;
        }

        // Most diverse settlements — only show known kingdoms
        const allSettlements = this.game.world.getAllSettlements()
            .filter(s => s.demographics && s.demographics.length > 0 && s.kingdom && player.knowsAbout(s.kingdom, 'peoples'))
            .sort((a, b) => (b.demographics ? b.demographics.length : 0) - (a.demographics ? a.demographics.length : 0))
            .slice(0, 5);

        if (allSettlements.length > 0) {
            html += `
                <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                    <div class="info-section-title">🌍 Most Diverse Settlements</div>
            `;

            for (const s of allSettlements) {
                const tile = this.game.world.getTile(s.q, s.r);
                const settlement = tile ? tile.settlement : s;
                const harmony = settlement.culturalHarmony || 50;
                const harmonyDisplay = Peoples.getHarmonyDisplay(harmony);
                const numPeoples = settlement.demographics ? settlement.demographics.length : 0;
                const tribeIcons = settlement.demographics
                    ? settlement.demographics.map(d => d.tribe.icon).join(' ')
                    : '';

                html += `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05); cursor: pointer;" data-ui-act="showSettlementDetails" data-ui-args="[${s.q}, ${s.r}]">
                        <div>
                            <span style="color: #fff; font-size: 13px;">${s.name || settlement.name}</span>
                            <span style="color: var(--text-secondary); font-size: 11px; margin-left: 8px;">${numPeoples} peoples</span>
                            <span style="font-size: 11px; margin-left: 4px;">${tribeIcons}</span>
                        </div>
                        <span style="color: ${harmonyDisplay.color}; font-size: 11px;">${harmonyDisplay.icon} ${harmonyDisplay.label}</span>
                    </div>
                `;
            }

            html += `</div>`;
        }

        html += `</div>`;
        this.showCustomPanel('🏛️ Peoples & Subcultures', html);
    },
});
