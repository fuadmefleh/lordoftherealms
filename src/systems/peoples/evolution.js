// Peoples — evolution members (split from the original monolith).
import { Peoples } from './_ref.js';
import { Utils, Kingdom } from './_imports.js';

// Module-scoped helper (was a top-level function in the original peoples.js;
// used by generateCulturalEvolution below).
function settlement_name_for_kingdom(kingdom) {
    return Kingdom.generateCityName(kingdom.culture);
}

Object.assign(Peoples, {
    // ─────────────────────────────────────────────
    // CULTURAL EVOLUTION HISTORY
    // ─────────────────────────────────────────────
    /**
     * Generate the history of how tribes came together to form villages and kingdoms.
     */
    generateCulturalEvolution(world) {
        if (!world.tribalHistory) world.tribalHistory = [];

        const tribes = Object.values(Peoples.TRIBAL_ROOTS);

        // Phase 1: Tribal Cooperation (Years 100-300)
        // Tribes start working together — forming proto-villages
        for (const kingdom of world.kingdoms) {
            const homeTribes = tribes.filter(t => t.parentCulture === kingdom.culture);
            if (homeTribes.length < 2) continue;

            const coopYear = Utils.randInt(100, 200);
            const t1 = homeTribes[0];
            const t2 = homeTribes[1];

            world.tribalHistory.push({
                year: coopYear,
                text: `${t1.icon}${t2.icon} The ${t1.name} and ${t2.name} sign the Compact of ${Utils.randPick(['Shared Fires', 'Broken Bread', 'Joined Hands', 'Open Roads', 'Common Waters'])}. Their bands begin settling together, forming the first permanent villages.`,
                type: 'cooperation',
                kingdom: kingdom.id,
            });

            // Phase 2: Village Formation (Years 200-400)
            const villageYear = coopYear + Utils.randInt(50, 150);
            const villageName = settlement_name_for_kingdom(kingdom);
            world.tribalHistory.push({
                year: villageYear,
                text: `🏘️ The village of ${villageName} is founded as a joint settlement of ${homeTribes.map(t => t.name).join(', ')}. Each people maintains its customs but shares governance through a Council of Elders.`,
                type: 'village_formation',
                kingdom: kingdom.id,
            });

            // Phase 3: Chiefdom Consolidation (Years 300-500)
            const chiefYear = villageYear + Utils.randInt(80, 200);
            const chiefName = Utils.randPick([t1.name, t2.name]);
            world.tribalHistory.push({
                year: chiefYear,
                text: `🦅 A great leader from the ${chiefName} unites the villages into a chiefdom. ${Utils.randPick([
                    'Skeptics are won over by promises of protection and shared prosperity.',
                    'The other peoples accept on the condition that their customs be forever honored.',
                    'A great feast is held where leaders of all peoples break bread together.',
                    'The unification is sealed by marriages between the leading families of each people.',
                ])}`,
                type: 'chiefdom',
                kingdom: kingdom.id,
            });

            // Phase 4: Kingdom Formation (Years 400-700)
            const kingdomYear = chiefYear + Utils.randInt(100, 250);
            world.tribalHistory.push({
                year: kingdomYear,
                text: `👑 ${kingdom.name} is formally established! The ${homeTribes.map(t => t.name).join(', ')} and various diaspora peoples are united under ${kingdom.ruler}. Each subculture retains its own quarter, festivals, and traditions within the new realm.`,
                type: 'kingdom_formation',
                kingdom: kingdom.id,
            });

            // Phase 5: Cultural Challenges (post-formation)
            const challengeYear = kingdomYear + Utils.randInt(20, 100);
            const t3 = homeTribes.length > 2 ? homeTribes[2] : t2;
            world.tribalHistory.push({
                year: challengeYear,
                text: `${Utils.randPick([
                    `⚔️ The ${t1.name} and ${t3.name} clash over representation in ${kingdom.name}'s council. A compromise grants rotating leadership between the peoples.`,
                    `🎊 ${kingdom.name} establishes the Festival of Many Peoples — a celebration where each subculture showcases its traditions. It becomes the realm's most beloved holiday.`,
                    `📜 ${kingdom.name} codifies the Rights of All Peoples, guaranteeing each subculture the freedom to practice its customs, speak its language, and honor its ancestors.`,
                    `🍲 A great famine forces the peoples of ${kingdom.name} to pool their knowledge. ${t1.name} foraging skills combined with ${t2.name} preservation techniques save thousands of lives.`,
                ])}`,
                type: 'cultural_challenge',
                kingdom: kingdom.id,
            });
        }

        world.tribalHistory.sort((a, b) => a.year - b.year);
    },

    // ─────────────────────────────────────────────
    // DIASPORA & MIGRATION
    // ─────────────────────────────────────────────
    /**
     * Generate migration and diaspora events that explain why foreign peoples are in settlements.
     */
    generateDiasporaHistory(world) {
        if (!world.tribalHistory) world.tribalHistory = [];

        const allSettlements = world.getAllSettlements();
        const tribes = Object.values(Peoples.TRIBAL_ROOTS);

        // Generate diaspora events
        const diasporaReasons = [
            { reason: 'famine', text: (tribe, dest) => `${tribe.icon} A terrible famine drives the ${tribe.name} from their homeland. Many find refuge in ${dest}, forming a small but resilient community.` },
            { reason: 'war', text: (tribe, dest) => `${tribe.icon} War in their homeland forces ${tribe.name} refugees to seek safety in ${dest}. They bring their skills and traditions to a new home.` },
            { reason: 'trade', text: (tribe, dest) => `${tribe.icon} ${tribe.name} merchants establish a permanent trading post in ${dest}. Over generations, their quarter becomes an integral part of the city.` },
            { reason: 'pilgrimage', text: (tribe, dest) => `${tribe.icon} ${tribe.name} pilgrims, drawn by sacred sites near ${dest}, decide to settle permanently, enriching the spiritual life of the community.` },
            { reason: 'exploration', text: (tribe, dest) => `${tribe.icon} Adventurous ${tribe.name} explorers discover ${dest} and send word home. A steady stream of settlers follows, drawn by opportunity.` },
            { reason: 'exile', text: (tribe, dest) => `${tribe.icon} A faction of the ${tribe.name} is exiled after a political dispute. They find welcome in ${dest} and bring unique knowledge.` },
            { reason: 'marriage', text: (tribe, dest) => `${tribe.icon} A marriage alliance between a ${tribe.name} noble family and a prominent household in ${dest} leads to a steady migration of kin and retainers.` },
        ];

        for (const s of allSettlements) {
            const tile = world.getTile(s.q, s.r);
            if (!tile || !tile.settlement || !tile.settlement.demographics) continue;

            const diasporaGroups = tile.settlement.demographics.filter(d =>
                ['immigrant', 'refugee', 'trader', 'exile', 'pilgrim'].includes(d.status)
            );

            for (const group of diasporaGroups) {
                const event = Utils.randPick(diasporaReasons);
                const year = group.arrivalYear;
                if (year < (world.year || 853)) {
                    world.tribalHistory.push({
                        year,
                        text: event.text(group.tribe, s.name || 'a distant settlement'),
                        type: 'diaspora',
                        tribe: group.tribe.id,
                        settlement: s.name,
                    });
                }
            }
        }

        world.tribalHistory.sort((a, b) => a.year - b.year);
    },

    // ─────────────────────────────────────────────
    // DAILY PROCESSING
    // ─────────────────────────────────────────────
    /**
     * Process daily cultural dynamics — called each turn.
     */
    processTurn(world) {
        // Read-only: positions only (the live settlement is read from its tile)
        const allSettlements = world.getSettlementViews ? world.getSettlementViews() : world.getAllSettlements();
        const kingdomTotals = {};

        for (const s of allSettlements) {
            const tile = world.getTile(s.q, s.r);
            if (!tile || !tile.settlement || !tile.settlement.demographics) continue;

            const settlement = tile.settlement;

            // 1. Organic population shifts between demographics
            Peoples.processPopulationDrift(settlement);

            // 1b. Peoples living on their homeland terrain slowly grow content
            Peoples.applyHomeland(settlement, s.q, s.r, world);

            // 2. Cultural interactions (rare events) — ~0.5% a day, more often
            // in later evolution stages (towns and cities mingle more)
            if (Utils.random() < Peoples.interactionChance(settlement)) {
                Peoples.generateCulturalInteraction(settlement, world);
            }

            // 3. Slow harmony drift; hybrid traditions bind the peoples together
            settlement.culturalHarmony = Math.min(100,
                Peoples.calculateHarmony(settlement.demographics) + Peoples.hybridHarmonyBonus(settlement));

            // 4. Cultural harmony effects on settlement
            if (settlement.culturalHarmony > 80) {
                // High harmony = population growth bonus
                settlement.population += Utils.randInt(0, 2);
            } else if (settlement.culturalHarmony < 30) {
                // Low harmony = some people leave
                if (Utils.random() < 0.1) {
                    settlement.population = Math.max(10, settlement.population - Utils.randInt(1, 5));
                }
            }

            // 5. What the peoples do: production, trade, growth, mood,
            // recruitment and the realm bonuses (systems/peoples/effects.js)
            Peoples.refreshEffects(settlement);
            Peoples.accumulateKingdom(kingdomTotals, settlement);
        }

        Peoples.applyKingdomTotals(world, kingdomTotals);
    },

    /**
     * Keep the demographic groups in step with the settlement's population.
     *
     * settlement.population is authoritative — the food model, plague,
     * famine, settlers and raids all change it — so the groups are rescaled to
     * match it rather than overwriting it. Contented groups slowly gain share
     * at the expense of unhappy ones.
     */
    processPopulationDrift(settlement) {
        if (!settlement.demographics || settlement.demographics.length < 2) return;
        const total = Math.max(0, Math.round(settlement.population || 0));

        // Sentiment (-100..100) nudges each group's share by up to ±0.05% a day
        const weights = settlement.demographics.map(d =>
            Math.max(0, d.population) * (1 + 0.0005 * ((d.sentiment || 0) / 100)));
        const weightSum = weights.reduce((a, w) => a + w, 0);
        if (weightSum <= 0) return;

        let assigned = 0;
        let largest = 0;
        settlement.demographics.forEach((demo, i) => {
            demo.share = weights[i] / weightSum;
            demo.population = Math.floor(demo.share * total);
            assigned += demo.population;
            if (demo.population > settlement.demographics[largest].population) largest = i;
        });
        // Rounding remainder goes to the largest group
        settlement.demographics[largest].population += total - assigned;
    },

    /**
     * Generate a random cultural interaction event within a settlement.
     */
    generateCulturalInteraction(settlement, world) {
        if (!settlement.demographics || settlement.demographics.length < 2) return;

        const d1 = Utils.randPick(settlement.demographics);
        const d2 = Utils.randPick(settlement.demographics.filter(d => d.tribe.id !== d1.tribe.id));
        if (!d2) return;

        const interaction = Utils.randPick(Object.values(Peoples.INTERACTION_TYPES));

        // Apply harmony effects
        d1.sentiment = Utils.clamp(d1.sentiment + interaction.harmonyBonus, 0, 100);
        d2.sentiment = Utils.clamp(d2.sentiment + interaction.harmonyBonus, 0, 100);

        // Generate event
        const eventText = `${interaction.icon} In ${settlement.name}: ${interaction.description} — The ${d1.tribe.name} and ${d2.tribe.name} ${interaction.harmonyBonus > 0 ? 'grow closer' : 'experience tension'}.`;

        world.events.push({
            category: 'cultural',
            text: eventText,
            settlement: settlement.name,
            impact: interaction.harmonyBonus > 0 ? 'positive' : 'negative',
        });

        // Occasionally generate a hybrid tradition
        if (interaction.harmonyBonus > 3 && Utils.random() < 0.1) {
            Peoples.generateHybridTradition(settlement, d1, d2, world);
        }
    },

    /**
     * Generate a hybrid cultural tradition from two subcultures mixing.
     */
    generateHybridTradition(settlement, demo1, demo2, world) {
        const t1 = demo1.tribe;
        const t2 = demo2.tribe;

        const hybridCustoms = [
            `The ${Utils.randPick(t1.customs).split(' ')[0]} ${Utils.randPick(t2.customs).split(' ').slice(-1)[0]}`,
            `${t1.name}-${t2.name} ${Utils.randPick(['Unity Dance', 'Harmony Feast', 'Bridge Festival', 'Shared Song'])}`,
        ];

        const hybridDish = `${Utils.randPick(t1.cuisine).split(' ')[0]} ${Utils.randPick(t2.cuisine).split(' ').slice(-1)[0]}`;

        if (!settlement.hybridTraditions) settlement.hybridTraditions = [];
        const tradition = {
            name: Utils.randPick(hybridCustoms),
            cuisine: hybridDish,
            parents: [t1.name, t2.name],
            year: world.year,
        };
        settlement.hybridTraditions.push(tradition);

        world.events.push({
            category: 'cultural',
            text: `🌟 A new tradition is born in ${settlement.name}! The "${tradition.name}" emerges from the blending of ${t1.name} and ${t2.name} customs. The locals also develop a taste for "${hybridDish}."`,
            settlement: settlement.name,
            impact: 'positive',
        });
    },

    // ─────────────────────────────────────────────
    // QUERY HELPERS
    // ─────────────────────────────────────────────
    /**
     * Get a formatted demographics summary for a settlement.
     */
    getDemographicsSummary(settlement) {
        if (!settlement || !settlement.demographics) return null;

        return settlement.demographics
            .sort((a, b) => b.population - a.population)
            .map(d => ({
                name: d.tribe.name,
                icon: d.tribe.icon,
                population: d.population,
                share: (d.share * 100).toFixed(1),
                status: d.status,
                sentiment: d.sentiment,
                influence: d.influence,
                parentCulture: d.tribe.parentCulture,
                proverb: d.tribe.proverb,
                homeland: Peoples.homelandLabel(d),
            }));
    },

    /**
     * Get cultural harmony label and color.
     */
    getHarmonyDisplay(harmony) {
        if (harmony >= 80) return { label: 'Harmonious', color: '#2ecc71', icon: '🕊️' };
        if (harmony >= 60) return { label: 'Cooperative', color: '#27ae60', icon: '🤝' };
        if (harmony >= 40) return { label: 'Stable', color: '#f1c40f', icon: '⚖️' };
        if (harmony >= 20) return { label: 'Tense', color: '#e67e22', icon: '😤' };
        return { label: 'Volatile', color: '#e74c3c', icon: '🔥' };
    },

    /**
     * Get all tribal roots for a given parent culture.
     */
    getTribesForCulture(cultureName) {
        return Object.values(Peoples.TRIBAL_ROOTS).filter(t => t.parentCulture === cultureName);
    },

    /**
     * Get formatted tribal history for the history panel.
     * Merges tribal history with world history for a unified timeline.
     */
    getMergedHistory(world) {
        const merged = [];

        // Regular world history — assign stable IDs
        if (world.history) {
            for (let i = 0; i < world.history.length; i++) {
                const event = world.history[i];
                merged.push({ ...event, id: event.id || `world_${i}`, source: 'world' });
            }
        }

        // Tribal/peoples history — assign stable IDs
        if (world.tribalHistory) {
            for (let i = 0; i < world.tribalHistory.length; i++) {
                const event = world.tribalHistory[i];
                merged.push({ ...event, id: event.id || `tribal_${i}`, source: 'peoples' });
            }
        }

        return merged.sort((a, b) => a.year - b.year);
    },

    /**
     * Discover a random piece of world history for the player.
     * @param {Player} player - The player
     * @param {Object} world - The world
     * @param {Object} [options] - Optional filters
     * @param {string} [options.kingdom] - Kingdom ID to prefer entries about
     * @param {string} [options.type] - Preferred entry type (e.g., 'tribal_origin', 'kingdom_formation')
     * @param {number[]} [options.eraRange] - [minYear, maxYear] to filter by era
     * @param {number} [options.count] - Number of entries to discover (default: 1)
     * @returns {Array} Array of newly discovered history entries (empty if nothing new)
     */
    discoverLore(player, world, options = {}) {
        if (!player.discoveredLore) player.discoveredLore = new Set();

        const allHistory = Peoples.getMergedHistory(world);
        let candidates = allHistory.filter(e => !player.discoveredLore.has(e.id));

        // Apply filters to narrow candidates
        if (options.kingdom) {
            const kingdomEntries = candidates.filter(e => e.kingdom === options.kingdom || (e.text && e.text.includes(world.getKingdom(options.kingdom)?.name)));
            if (kingdomEntries.length > 0) candidates = kingdomEntries;
        }

        if (options.type) {
            const typeEntries = candidates.filter(e => e.type === options.type);
            if (typeEntries.length > 0) candidates = typeEntries;
        }

        if (options.eraRange) {
            const eraEntries = candidates.filter(e => e.year >= options.eraRange[0] && e.year < options.eraRange[1]);
            if (eraEntries.length > 0) candidates = eraEntries;
        }

        if (candidates.length === 0) return [];

        const count = Math.min(options.count || 1, candidates.length);
        const discovered = [];

        for (let i = 0; i < count; i++) {
            const idx = Math.floor(Utils.random() * candidates.length);
            const entry = candidates[idx];
            player.discoveredLore.add(entry.id);
            discovered.push(entry);
            candidates.splice(idx, 1);
        }

        // Origin lore earns a people's trust (heritage trade bonus)
        Peoples.syncHeritage(player, world, allHistory);

        return discovered;
    },

    /**
     * Build HTML for displaying a settlement's demographics in the UI.
     */
    buildDemographicsHTML(settlement, player = null) {
        if (!settlement || !settlement.demographics) return '';

        const demos = Peoples.getDemographicsSummary(settlement);
        if (!demos || demos.length === 0) return '';

        const harmony = settlement.culturalHarmony || 50;
        const harmonyDisplay = Peoples.getHarmonyDisplay(harmony);
        const identity = settlement.culturalIdentity;

        let html = `
            <div class="info-section-title">Peoples & Cultures</div>
            <div style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px; margin-bottom: 8px;">
                <div class="info-row">
                    <span class="info-label">${harmonyDisplay.icon} Cultural Harmony</span>
                    <span class="info-value" style="color: ${harmonyDisplay.color};">${harmonyDisplay.label} (${harmony}/100)</span>
                </div>
                <div style="background: rgba(255,255,255,0.1); border-radius: 4px; height: 6px; margin: 4px 0 8px 0; overflow: hidden;">
                    <div style="background: ${harmonyDisplay.color}; height: 100%; width: ${harmony}%; border-radius: 4px; transition: width 0.3s;"></div>
                </div>
        `;

        if (identity) {
            html += `
                <div style="color: var(--text-secondary); font-size: 12px; font-style: italic; margin-bottom: 8px; line-height: 1.4;">
                    ${identity.description}
                </div>
                <div style="color: var(--gold); font-size: 11px; margin-bottom: 6px;">
                    🏛️ Founded by: <span style="color: #fff;">${identity.foundingPeople}</span>
                    &nbsp;&nbsp;|&nbsp;&nbsp;
                    🎨 Known for: <span style="color: #fff;">${identity.signatureArt}</span>
                </div>
                <div style="color: var(--gold); font-size: 11px; margin-bottom: 8px;">
                    🍲 Signature dish: <span style="color: #fff;">${identity.signatureDish}</span>
                    &nbsp;&nbsp;|&nbsp;&nbsp;
                    🎉 Festival: <span style="color: #fff;">${identity.signatureFestival}</span>
                </div>
            `;

            if (identity.dominantValues && identity.dominantValues.length > 0) {
                html += `
                    <div style="color: var(--gold); font-size: 11px; margin-bottom: 6px;">
                        ⭐ Core Values: <span style="color: #fff;">${identity.dominantValues.map(v => v.charAt(0).toUpperCase() + v.slice(1)).join(', ')}</span>
                    </div>
                `;
            }

            if (identity.culturalMotto) {
                html += `<div style="color: var(--text-secondary); font-size: 11px; font-style: italic;">📜 Motto: ${identity.culturalMotto}</div>`;
            }
        }

        const { stage } = Peoples.getEvolutionStage(settlement.population);
        if (stage) {
            html += `<div style="color: var(--text-secondary); font-size: 11px; margin-top: 6px;" title="Bigger, more mixed places see cultural exchanges more often">${stage.icon} ${stage.name} — ${stage.description}</div>`;
        }

        html += `</div>`;

        // What the peoples actually do here (systems/peoples/effects.js)
        const effects = Peoples.describeEffects(settlement, player);
        if (effects.length > 0) {
            html += `<div class="info-section-title" style="font-size: 12px;">What the Peoples Bring</div>`;
            html += `<div style="background: rgba(0,0,0,0.2); padding: 8px; border-radius: 6px; margin-bottom: 8px;">`;
            for (const e of effects) {
                const tip = e.why ? ` title="From: ${String(e.why).replace(/"/g, '&quot;')}"` : '';
                html += `<div style="font-size: 11px; padding: 2px 0; color: var(--text-secondary);"${tip}>${e.icon} <strong style="color: #fff;">${e.label}</strong> ${e.text}</div>`;
            }
            html += `</div>`;
        }

        // Population breakdown
        const hl = (Peoples.EFFECTS && Peoples.EFFECTS.homeland) || { sentimentGain: 1, everyDays: 10, sentimentCap: 85 };
        const homelandTip = `Living on their homeland: +${hl.sentimentGain} mood every ${hl.everyDays} days (up to ${hl.sentimentCap})`;
        html += `<div style="margin-bottom: 8px;">`;
        for (const demo of demos) {
            const barWidth = Math.max(5, demo.share);
            const sentimentColor = demo.sentiment > 70 ? '#2ecc71' : demo.sentiment > 40 ? '#f1c40f' : '#e74c3c';
            const statusLabel = demo.status.charAt(0).toUpperCase() + demo.status.slice(1);

            html += `
                <div style="background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px; margin-bottom: 4px; border-left: 3px solid ${demo.icon === '⚒️' ? '#8b8b8b' : sentimentColor};">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        <span style="color: #fff; font-size: 13px;">${demo.icon} <strong>${demo.name}</strong></span>
                        <span style="color: var(--text-secondary); font-size: 11px;">${Utils.formatNumber(demo.population)} (${demo.share}%)</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 10px; color: var(--text-secondary);">
                        <span>${statusLabel} • ${demo.parentCulture}${demo.homeland ? ` • <span style="color:#8bc34a;" title="${homelandTip}">🏞️ ${demo.homeland}</span>` : ''}</span>
                        <span style="color: ${sentimentColor};">Mood: ${demo.sentiment > 70 ? '😊' : demo.sentiment > 40 ? '😐' : '😠'} ${demo.sentiment}/100</span>
                    </div>
                    <div style="background: rgba(255,255,255,0.1); border-radius: 2px; height: 3px; margin-top: 4px; overflow: hidden;">
                        <div style="background: ${sentimentColor}; height: 100%; width: ${barWidth}%; border-radius: 2px;"></div>
                    </div>
                </div>
            `;
        }
        html += `</div>`;

        // Cultural quarters
        if (settlement.culturalQuarters && settlement.culturalQuarters.length > 0) {
            html += `<div class="info-section-title" style="font-size: 12px;">Cultural Quarters</div>`;
            for (const q of settlement.culturalQuarters) {
                const moodColor = q.mood === 'thriving' ? '#2ecc71' : q.mood === 'content' ? '#f1c40f' : '#e74c3c';
                html += `
                    <div style="display: flex; justify-content: space-between; font-size: 11px; padding: 3px 0; color: var(--text-secondary);">
                        <span>${q.tribeIcon} ${q.name}</span>
                        <span style="color: ${moodColor};">${q.mood}</span>
                    </div>
                `;
            }
        }

        // Hybrid traditions
        if (settlement.hybridTraditions && settlement.hybridTraditions.length > 0) {
            html += `<div class="info-section-title" style="font-size: 12px; margin-top: 8px;">Hybrid Traditions</div>`;
            for (const trad of settlement.hybridTraditions) {
                html += `
                    <div style="font-size: 11px; padding: 3px 0; color: var(--text-secondary);">
                        🌟 <strong style="color: #fff;">${trad.name}</strong> — born from ${trad.parents.join(' & ')} (Year ${trad.year})
                    </div>
                `;
            }
        }

        return html;
    },

    /**
     * Build HTML for displaying tribal history in the Peoples History panel.
     * If discoveredLore is provided, only discovered entries are shown; others appear as hidden.
     */
    buildTribalHistoryHTML(world, discoveredLore) {
        const history = Peoples.getMergedHistory(world);
        if (!history || history.length === 0) return '<p style="color: var(--text-secondary);">No recorded history.</p>';

        const totalEntries = history.length;
        const hasDiscoveryFilter = discoveredLore instanceof Set;
        const discoveredCount = hasDiscoveryFilter ? history.filter(e => discoveredLore.has(e.id)).length : totalEntries;

        let html = `
            <div style="margin-bottom: 16px;">
                <p style="color: var(--text-secondary); font-size: 13px; line-height: 1.5; margin-bottom: 12px;">
                    ${hasDiscoveryFilter
                        ? 'Piece together the world\'s history by exploring ruins, talking to locals, visiting taverns, and discovering ancient places. Each interaction may reveal a fragment of the past.'
                        : 'The peoples of this world trace their roots to ancient tribes that roamed the land. Over centuries, these tribes learned to cooperate — sharing fires, breaking bread, and building villages together. From those first tentative alliances grew the great kingdoms of today, each a tapestry of many peoples united under one banner but proud of their distinct heritages.'
                    }
                </p>
                ${hasDiscoveryFilter ? `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: rgba(255,255,255,0.05); border-radius: 6px; margin-bottom: 8px;">
                    <span style="color: var(--gold); font-size: 13px;">📜 Lore Discovered</span>
                    <span style="color: ${discoveredCount === totalEntries ? '#2ecc71' : 'var(--text-secondary)'}; font-size: 13px; font-weight: bold;">
                        ${discoveredCount} / ${totalEntries}
                    </span>
                </div>
                <div style="background: rgba(255,255,255,0.1); border-radius: 4px; height: 6px; margin-bottom: 12px; overflow: hidden;">
                    <div style="background: var(--gold); height: 100%; width: ${Math.round(discoveredCount / totalEntries * 100)}%; border-radius: 4px; transition: width 0.3s;"></div>
                </div>
                ` : ''}
            </div>
        `;

        // Group by era
        const eras = [
            { name: '🌅 The Dawn Age', range: [0, 100], desc: 'Tribes emerge and find their homelands' },
            { name: '🤝 Age of First Contact', range: [100, 250], desc: 'Peoples meet, trade, and sometimes clash' },
            { name: '🏘️ Age of Villages', range: [250, 450], desc: 'Tribes cooperate to build shared settlements' },
            { name: '👑 Age of Kingdoms', range: [450, 700], desc: 'Chiefdoms consolidate into realms' },
            { name: '🌍 The Present Age', range: [700, 9999], desc: 'A world of many peoples in many places' },
        ];

        for (const era of eras) {
            const eraEvents = history.filter(e => e.year >= era.range[0] && e.year < era.range[1]);
            if (eraEvents.length === 0) continue;

            const eraDiscovered = hasDiscoveryFilter ? eraEvents.filter(e => discoveredLore.has(e.id)).length : eraEvents.length;

            html += `
                <div style="margin-bottom: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div style="font-family: var(--font-display); color: var(--gold); font-size: 16px; margin-bottom: 4px;">${era.name}</div>
                        ${hasDiscoveryFilter ? `<span style="color: var(--text-secondary); font-size: 11px;">${eraDiscovered}/${eraEvents.length}</span>` : ''}
                    </div>
                    <div style="color: var(--text-secondary); font-size: 12px; margin-bottom: 12px; font-style: italic;">${era.desc}</div>
                    <div style="position: relative; padding-left: 20px;">
                        <div style="position: absolute; left: 6px; top: 0; bottom: 0; width: 2px; background: rgba(255,255,255,0.1);"></div>
            `;

            for (const event of eraEvents) {
                const isDiscovered = !hasDiscoveryFilter || discoveredLore.has(event.id);
                const dotColor = isDiscovered
                    ? (event.source === 'peoples' ? 'var(--gold)' : '#3498db')
                    : 'rgba(255,255,255,0.15)';

                if (isDiscovered) {
                    html += `
                        <div style="margin-bottom: 14px; position: relative;">
                            <div style="position: absolute; left: -20px; top: 4px; width: 10px; height: 10px; background: ${dotColor}; border-radius: 50%; box-shadow: 0 0 6px ${dotColor};"></div>
                            <div style="color: var(--gold); font-size: 13px; margin-bottom: 2px;">Year ${event.year}</div>
                            <div style="color: var(--text-primary); line-height: 1.4; font-size: 13px;">${event.text}</div>
                        </div>
                    `;
                } else {
                    html += `
                        <div style="margin-bottom: 14px; position: relative; opacity: 0.4;">
                            <div style="position: absolute; left: -20px; top: 4px; width: 10px; height: 10px; background: ${dotColor}; border-radius: 50%;"></div>
                            <div style="color: var(--text-secondary); font-size: 13px; margin-bottom: 2px;">Year ???</div>
                            <div style="color: var(--text-secondary); line-height: 1.4; font-size: 13px; font-style: italic;">Undiscovered — explore the world to learn more...</div>
                        </div>
                    `;
                }
            }

            html += `</div></div>`;
        }

        return html;
    },
});
