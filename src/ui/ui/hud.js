// UI — hud methods.
import { UI } from './core.js';
import { Utils, ActionMenu, Religion, Economy, PlayerEconomy, PlayerReligion, Infrastructure, Peoples, CustomObjects, Characters, Culture, Quests, Technology, Banking, MarketDynamics, Taxation, Hex, SaveLoad, audioManager, NpcFamily, Relationships, Housing } from './_imports.js';

Object.assign(UI.prototype, {
    setupEventListeners() {
        // Top bar buttons (use ?. for safety in React mode where DOM may not be ready)
        document.getElementById('btnCharacter')?.addEventListener('click', () => this.toggleCharacterPanel());
        document.getElementById('btnSettings')?.addEventListener('click', () => this.showSettingsPanel());
        document.getElementById('btnInventory')?.addEventListener('click', () => this.showInventoryPanel());
        document.getElementById('btnQuests')?.addEventListener('click', () => this.showQuestsPanel());
        const btnHistory = document.getElementById('btnHistory');
        if (btnHistory) {
            btnHistory.addEventListener('click', () => this.showHistoryPanel());
        }
        document.getElementById('btnTreasury')?.addEventListener('click', () => this.showTreasuryPanel(this.game.player, this.game.world));
        document.getElementById('btnProperties')?.addEventListener('click', () => this.showPropertiesPanel(this.game.player, this.game.world));

        // Dynasties button
        const btnDynasties = document.getElementById('btnDynasties');
        if (btnDynasties) {
            btnDynasties.addEventListener('click', () => this.showDynastiesPanel());
        }

        // Intel Journal button
        const btnIntel = document.getElementById('btnIntel');
        if (btnIntel) {
            btnIntel.addEventListener('click', () => ActionMenu.showIntelJournal(this.game));
        }

        // Event Log button
        const btnEventLog = document.getElementById('btnEventLog');
        if (btnEventLog) {
            btnEventLog.addEventListener('click', () => this.showEventLogPanel());
        }

        // Technology button
        const btnTech = document.getElementById('btnTechnology');
        if (btnTech) {
            btnTech.addEventListener('click', () => this.showTechnologyPanel(this.game.player, this.game.world));
        }

        // Religion & Culture button
        const btnReligion = document.getElementById('btnReligion');
        if (btnReligion) {
            btnReligion.addEventListener('click', () => this.showReligionCulturePanel(this.game.player, this.game.world));
        }

        // Peoples & Subcultures button
        const btnPeoples = document.getElementById('btnPeoples');
        if (btnPeoples) {
            btnPeoples.addEventListener('click', () => this.showPeoplesPanel());
        }

        // Relationships button (Empire menu)
        const btnRelationships = document.getElementById('btnRelationships');
        if (btnRelationships) {
            btnRelationships.addEventListener('click', () => {
                const tile = this.game.world.getTile(this.game.player.q, this.game.player.r);
                ActionMenu.showRelationshipsMenu(this.game, tile);
            });
        }

        // Travel Party button (Empire menu)
        const btnTravelParty = document.getElementById('btnTravelParty');
        if (btnTravelParty) {
            btnTravelParty.addEventListener('click', () => {
                const tile = this.game.world.getTile(this.game.player.q, this.game.player.r);
                ActionMenu.showTravelPartyMenu(this.game, tile);
            });
        }

        // Council button (Empire menu)
        const btnCouncil = document.getElementById('btnCouncil');
        if (btnCouncil) {
            btnCouncil.addEventListener('click', () => {
                const tile = this.game.world.getTile(this.game.player.q, this.game.player.r);
                ActionMenu.showCouncilMenu(this.game, tile);
            });
        }

        // Global Control buttons
        document.getElementById('btnToggleResources')?.addEventListener('click', () => {
            const renderer = this.game.renderer;
            renderer.showResources = !renderer.showResources;
            const stateEl = document.getElementById('resourceToggleState');
            if (stateEl) {
                stateEl.textContent = renderer.showResources ? 'ON' : 'OFF';
                stateEl.classList.toggle('on', renderer.showResources);
            }
            this.showNotification('Display', `Resource Icons: ${renderer.showResources ? 'ON' : 'OFF'}`, 'info');
        });
        document.getElementById('btnToggleBorders')?.addEventListener('click', () => {
            const renderer = this.game.renderer;
            renderer.showTerritories = !renderer.showTerritories;
            const stateEl = document.getElementById('borderToggleState');
            if (stateEl) {
                stateEl.textContent = renderer.showTerritories ? 'ON' : 'OFF';
                stateEl.classList.toggle('on', renderer.showTerritories);
            }
            this.showNotification('Display', `Kingdom Borders: ${renderer.showTerritories ? 'ON' : 'OFF'}`, 'info');
        });

        // Map Modes button
        const btnMapModes = document.getElementById('btnMapModes');
        if (btnMapModes) {
            btnMapModes.addEventListener('click', () => this.showMapModeSelector());
        }

        document.getElementById('btnEndTurn')?.addEventListener('click', () => this.game.endDay());

        // ── Sims-style time controls ──
        this._setupTimeControls();

        // --- Civ-style dropdown menu behavior ---
        this.setupCivDropdowns();

        // Gold stat click — show finance tracker
        const goldStat = document.getElementById('goldStat');
        if (goldStat) {
            goldStat.style.cursor = 'pointer';
            goldStat.addEventListener('click', () => this.showFinancesPanel(this.game.player, this.game.world));
        }

        // Panel close buttons
        document.getElementById('hexInfoClose')?.addEventListener('click', () => this.hidePanel('hexInfoPanel'));
        document.getElementById('kingdomClose')?.addEventListener('click', () => this.hidePanel('kingdomPanel'));
        document.getElementById('characterClose')?.addEventListener('click', () => this.hidePanel('characterPanel'));

        // ── Sims HUD tab buttons ──
        document.getElementById('simsTabStats')?.addEventListener('click', () => this.switchHudTab('stats'));
        document.getElementById('simsTabRelationships')?.addEventListener('click', () => this.switchHudTab('relationships'));
        document.getElementById('simsTabInventory')?.addEventListener('click', () => this.switchHudTab('inventory'));
    },

    /**
     * Setup Sims-style time control buttons (pause / play / fast / ultra)
     */
    _setupTimeControls() {
        // Old top-bar buttons (hidden but still bound for compatibility)
        const btnPause = document.getElementById('btnTimePause');
        const btnPlay  = document.getElementById('btnTimePlay');
        const btnFast  = document.getElementById('btnTimeFast');
        const btnUltra = document.getElementById('btnTimeUltra');
        const oldButtons = [btnPause, btnPlay, btnFast, btnUltra];

        // New bottom HUD buttons
        const sPause = document.getElementById('simsTimePause');
        const sPlay  = document.getElementById('simsTimePlay');
        const sFast  = document.getElementById('simsTimeFast');
        const sUltra = document.getElementById('simsTimeUltra');
        const newButtons = [sPause, sPlay, sFast, sUltra];

        const allButtons = [...oldButtons, ...newButtons];

        const setSpeed = (speed) => {
            this.game.timeSpeed = speed;
            // Update active state on both sets
            allButtons.forEach(b => { if (b) { b.classList.remove('active', 'paused-flash'); } });
            const activeOld = oldButtons[speed];
            const activeNew = newButtons[speed];
            if (activeOld) activeOld.classList.add('active');
            if (activeNew) activeNew.classList.add('active');
            if (speed === 0) {
                if (btnPause) btnPause.classList.add('paused-flash');
                if (sPause) sPause.classList.add('paused-flash');
            }
        };

        if (btnPause) btnPause.addEventListener('click', () => setSpeed(0));
        if (btnPlay)  btnPlay.addEventListener('click',  () => setSpeed(1));
        if (btnFast)  btnFast.addEventListener('click',  () => setSpeed(2));
        if (btnUltra) btnUltra.addEventListener('click', () => setSpeed(3));

        if (sPause) sPause.addEventListener('click', () => setSpeed(0));
        if (sPlay)  sPlay.addEventListener('click',  () => setSpeed(1));
        if (sFast)  sFast.addEventListener('click',  () => setSpeed(2));
        if (sUltra) sUltra.addEventListener('click', () => setSpeed(3));

        // Wire bottom HUD End Day button
        const simsEndDay = document.getElementById('simsEndDay');
        const btnEndTurn = document.getElementById('btnEndTurn');
        if (simsEndDay && btnEndTurn) {
            simsEndDay.addEventListener('click', () => btnEndTurn.click());
        }

        // Keyboard shortcuts: Space = toggle pause, 1/2/3 = speeds
        window.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
            if (e.code === 'Space' && !e.ctrlKey && !e.altKey) {
                e.preventDefault();
                setSpeed(this.game.timeSpeed === 0 ? 1 : 0);
            }
            if (e.key === '1' && !e.ctrlKey && !e.altKey) setSpeed(1);
            if (e.key === '2' && !e.ctrlKey && !e.altKey) setSpeed(2);
            if (e.key === '3' && !e.ctrlKey && !e.altKey) setSpeed(3);
        });
    },

    /**
     * Setup Civ-style dropdown menus for the top bar
     */
    setupCivDropdowns() {
        const menuPairs = [
            { btn: 'civMapBtn', dropdown: 'civMapDropdown' },
            { btn: 'civEmpireBtn', dropdown: 'civEmpireDropdown' },
            { btn: 'civJournalBtn', dropdown: 'civJournalDropdown' },
        ];

        // Toggle dropdown on button click
        menuPairs.forEach(({ btn, dropdown }) => {
            const btnEl = document.getElementById(btn);
            const dropEl = document.getElementById(dropdown);
            if (!btnEl || !dropEl) return;

            btnEl.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = dropEl.classList.contains('open');
                // Close all dropdowns first
                this.closeAllCivDropdowns(menuPairs);
                // Toggle the clicked one
                if (!isOpen) {
                    dropEl.classList.add('open');
                    btnEl.classList.add('active');
                }
            });
        });

        // Close dropdowns when clicking outside
        document.addEventListener('click', () => {
            this.closeAllCivDropdowns(menuPairs);
        });

        // Prevent dropdown clicks from closing (except for action items)
        document.querySelectorAll('.civ-dropdown').forEach(dd => {
            dd.addEventListener('click', (e) => {
                // Close dropdown after clicking an action item (not toggle items)
                const item = e.target.closest('.civ-dropdown-item');
                if (item) {
                    // Don't auto-close for toggle items (resources/borders)
                    const hasToggle = item.querySelector('.civ-dd-toggle');
                    if (!hasToggle) {
                        this.closeAllCivDropdowns(menuPairs);
                    }
                }
                e.stopPropagation();
            });
        });
    },

    /**
     * Close all Civ-style dropdown menus
     */
    closeAllCivDropdowns(menuPairs) {
        menuPairs.forEach(({ btn, dropdown }) => {
            const btnEl = document.getElementById(btn);
            const dropEl = document.getElementById(dropdown);
            if (btnEl) btnEl.classList.remove('active');
            if (dropEl) dropEl.classList.remove('open');
        });
    },

    /**
     * Open action menu at player's current location
     */
    openActionMenu() {
        const tile = this.game.world.getTile(this.game.player.q, this.game.player.r);
        if (tile) {
            ActionMenu.show(this.game, tile);
        }
    },

    /**
     * Update top bar stats display and bottom HUD needs bars
     */
    updateStats(player, world) {
        document.getElementById('goldValue').textContent = Utils.formatNumber(player.gold);
        document.getElementById('karmaValue').textContent = player.karma;
        document.getElementById('renownValue').textContent = player.renown;

        // Add movement points display
        const movementDisplay = document.getElementById('movementValue');
        if (movementDisplay) {
            movementDisplay.textContent = `${Math.floor(player.movementRemaining)}/${player.maxStamina}`;
        }

        // Update action points display
        const apDisplay = document.getElementById('apValue');
        if (apDisplay) {
            const ap = player.actionPoints != null ? player.actionPoints : 10;
            const maxAp = player.maxActionPoints || 10;
            apDisplay.textContent = `${ap}/${maxAp}`;
            apDisplay.style.color = ap === 0 ? '#e74c3c' : ap <= 3 ? '#f39c12' : '';
        }

        // Update food display
        const foodDisplay = document.getElementById('foodValue');
        if (foodDisplay) {
            const foodCount = player.getFoodCount ? player.getFoodCount() : 0;
            foodDisplay.textContent = foodCount;
            foodDisplay.style.color = foodCount === 0 ? '#e74c3c' : foodCount < 10 ? '#f39c12' : '';
        }

        // Update HP display
        const hpDisplay = document.getElementById('hpValue');
        if (hpDisplay) {
            const hp = player.health != null ? player.health : 100;
            const maxHp = player.maxHealth || 100;
            hpDisplay.textContent = `${hp}/${maxHp}`;
            const pct = hp / maxHp;
            hpDisplay.style.color = pct <= 0.25 ? '#e74c3c' : pct <= 0.5 ? '#f39c12' : '';
        }

        // === Update Bottom HUD (Sims-style needs bars) ===
        this._updateSimsHUD(player, world);

        // Show jail status if active
        let jailEl = document.getElementById('jailDisplay');
        if (player.jailState) {
            if (!jailEl) {
                jailEl = document.createElement('div');
                jailEl.id = 'jailDisplay';
                jailEl.style.cssText = 'color: #e74c3c; font-weight: bold; font-size: 12px; text-align: center; padding: 4px 8px; background: rgba(231,76,60,0.2); border-radius: 4px; margin-top: 4px;';
                const topBar = document.getElementById('topBar');
                if (topBar) topBar.appendChild(jailEl);
            }
            jailEl.textContent = `\ud83d\udd12 In Jail \u2014 ${player.jailState.daysRemaining} day(s) remain (${player.jailState.offense})`;
            jailEl.style.display = 'block';
        } else if (jailEl) {
            jailEl.style.display = 'none';
        }

        // Show servitude status if active
        let servitudeEl = document.getElementById('servitudeDisplay');
        if (player.indenturedServitude) {
            if (!servitudeEl) {
                servitudeEl = document.createElement('div');
                servitudeEl.id = 'servitudeDisplay';
                servitudeEl.style.cssText = 'color: #e74c3c; font-weight: bold; font-size: 12px; text-align: center; padding: 4px 8px; background: rgba(231,76,60,0.15); border-radius: 4px; margin-top: 4px;';
                const topBar = document.getElementById('topBar');
                if (topBar) topBar.appendChild(servitudeEl);
            }
            servitudeEl.textContent = `⛓️ Indentured Servitude — ${player.indenturedServitude.daysRemaining} days remain`;
            servitudeEl.style.display = 'block';
        } else if (servitudeEl) {
            servitudeEl.style.display = 'none';
        }

        const dayInSeason = ((world.day - 1) % 30) + 1;
        const turnEl = document.getElementById('turnDisplay');
        // Show time of day - DISABLED: Inner map feature disabled, show simple day display
        // const cachedTime = InnerMap.getCachedTimeForTile
        //     ? InnerMap.getCachedTimeForTile(this.game.player.q, this.game.player.r)
        //     : null;
        // if (cachedTime) {
        //     turnEl.textContent = `${cachedTime.periodIcon} ${cachedTime.timeString} — Day ${dayInSeason}, ${world.season}, Year ${world.year}`;
        // } else {
        //     // Fallback: derive time directly from InnerMap's live clock
        //     const timeStr = InnerMap.getTimeString ? InnerMap.getTimeString() : null;
        //     const period = InnerMap.getTimePeriod ? InnerMap.getTimePeriod() : null;
        //     const periodIcons = { morning: '🌅', midday: '☀️', afternoon: '🌤️', evening: '🌇', night: '🌙' };
        //     if (timeStr && period) {
        //         turnEl.textContent = `${periodIcons[period] || '🕐'} ${timeStr} — Day ${dayInSeason}, ${world.season}, Year ${world.year}`;
        //     } else {
        //         turnEl.textContent = `Day ${dayInSeason} — ${world.season}, Year ${world.year}`;
        //     }
        // }
        turnEl.textContent = `Day ${dayInSeason} — ${world.season}, Year ${world.year}`;
    },

    /**
     * Update the Sims-style bottom HUD — needs bars, resources, day display
     */
    _updateSimsHUD(player, world) {
        // Resource values
        const simsGold = document.getElementById('simsGold');
        const simsRenown = document.getElementById('simsRenown');
        const simsKarma = document.getElementById('simsKarma');
        if (simsGold) simsGold.textContent = Utils.formatNumber(player.gold);
        if (simsRenown) simsRenown.textContent = player.renown;
        if (simsKarma) simsKarma.textContent = player.karma;

        // ── Sims-style 6 Needs Bars (disabled) ──
        if (false && player.needs) {
            const needBars = {
                hunger:  'simsHungerBar',
                energy:  'simsEnergyBar',
                social:  'simsSocialBar',
                fun:     'simsFunBar',
                hygiene: 'simsHygieneBar',
                comfort: 'simsComfortBar',
            };
            for (const [need, barId] of Object.entries(needBars)) {
                const pct = Math.round(player.needs[need]);
                this._setNeedBar(barId, null, pct, '');
            }
        }

        // Mood indicator
        if (player.getMood) {
            const mood = player.getMood();
            const moodIcon = document.getElementById('simsMoodIcon');
            const moodLabel = document.getElementById('simsMoodLabel');
            if (moodIcon) moodIcon.textContent = mood.icon;
            if (moodLabel) moodLabel.textContent = mood.label;

            // Color the mood label based on score
            if (moodLabel) {
                if (mood.score >= 70) moodLabel.style.color = '#2ecc71';
                else if (mood.score >= 50) moodLabel.style.color = '#f1c40f';
                else if (mood.score >= 30) moodLabel.style.color = '#e67e22';
                else moodLabel.style.color = '#e74c3c';
            }

            // Update diamond portrait border + plumbob color based on mood
            const diamond = document.getElementById('simsPortrait');
            const plumbob = document.getElementById('simsPlumbob');
            if (diamond) {
                diamond.classList.remove('mood-happy', 'mood-neutral', 'mood-bad');
                if (mood.score >= 60) diamond.classList.add('mood-happy');
                else if (mood.score >= 35) diamond.classList.add('mood-neutral');
                else diamond.classList.add('mood-bad');
            }
            if (plumbob) {
                if (mood.score >= 60) { plumbob.style.color = '#2ecc71'; plumbob.style.filter = 'drop-shadow(0 0 6px rgba(46,204,113,0.5))'; }
                else if (mood.score >= 35) { plumbob.style.color = '#f1c40f'; plumbob.style.filter = 'drop-shadow(0 0 6px rgba(241,196,15,0.5))'; }
                else { plumbob.style.color = '#e74c3c'; plumbob.style.filter = 'drop-shadow(0 0 6px rgba(231,76,60,0.5))'; }
            }
        }

        // Day display
        const simsDay = document.getElementById('simsDay');
        if (simsDay && world) {
            const dayInSeason = ((world.day - 1) % 30) + 1;
            simsDay.textContent = `Day ${dayInSeason}`;
        }
    },

    /**
     * Helper: set a Sims-style need bar width, color class, and value text
     */
    _setNeedBar(barId, valId, pct, text) {
        const bar = document.getElementById(barId);
        const val = document.getElementById(valId);
        if (bar) {
            bar.style.width = pct + '%';
            bar.className = 'sims-need-bar-fill ' + (pct > 60 ? 'high' : pct > 25 ? 'mid' : 'low');
        }
        if (val) val.textContent = text;
    },

    // ══════════════════════════════════════════════════════════════════════════
    // SIMS HUD TAB SWITCHING (click active tab to collapse, click another to expand)
    // ══════════════════════════════════════════════════════════════════════════
    /**
     * Switch the center bar of the bottom HUD between pages: stats, relationships, inventory.
     * Clicking the already-active tab collapses the panel.
     * Clicking a different tab expands it and switches content.
     */
    switchHudTab(tabId) {
        const wrap = document.getElementById('simsCollapsible');
        const isCollapsed = wrap && wrap.classList.contains('collapsed');

        // If clicking the active tab, toggle collapse
        if (tabId === this._activeHudTab && !isCollapsed) {
            if (wrap) wrap.classList.add('collapsed');
            return;
        }

        // Expand if collapsed
        if (wrap && isCollapsed) {
            wrap.classList.remove('collapsed');
        }

        const tabs = ['stats', 'relationships', 'inventory'];
        const tabBtns = {
            stats: document.getElementById('simsTabStats'),
            relationships: document.getElementById('simsTabRelationships'),
            inventory: document.getElementById('simsTabInventory'),
        };
        const pages = {
            stats: document.getElementById('simsPageStats'),
            relationships: document.getElementById('simsPageRelationships'),
            inventory: document.getElementById('simsPageInventory'),
        };

        // Deactivate all tabs & hide all pages
        for (const t of tabs) {
            if (tabBtns[t]) tabBtns[t].classList.remove('active');
            if (pages[t]) pages[t].classList.add('hidden');
        }

        // Activate selected
        if (tabBtns[tabId]) tabBtns[tabId].classList.add('active');
        if (pages[tabId]) pages[tabId].classList.remove('hidden');

        // Populate content on switch
        if (tabId === 'relationships') {
            this._renderRelationshipsPanel();
            this._setupRelFilters();
        } else if (tabId === 'inventory') {
            this._renderInventoryPanel();
        }

        this._activeHudTab = tabId;
    },

    /**
     * Render the relationship panel as a grid of square tiles.
     * Each tile shows the NPC face; click/hover reveals a tooltip with stats.
     */
    _renderRelationshipsPanel() {
        const body = document.getElementById('simsRelBody');
        if (!body) return;

        const player = this.game?.player;
        if (!player) { body.innerHTML = '<p class="srel-empty">No data available.</p>'; return; }

        // Collect all entries into a flat list, then render as grid
        const entries = []; // { name, icon, preset, badge, badgeClass, score, maxScore, minScore, occupation, age, gender, subtitle, barColor, category }

        // ── SPOUSE & CHILDREN ──
        if (player.spouse) {
            const spouse = Relationships.getNPC(player.spouse);
            if (spouse) {
                const rel = Relationships.getRelationship(player, player.spouse);
                entries.push({
                    name: `${spouse.firstName} ${spouse.dynasty || ''}`.trim(),
                    icon: spouse.icon || (spouse.gender === 'female' ? '👩' : '👨'),
                    preset: spouse.preset || null,
                    badge: '💍 Spouse', badgeClass: 'romantic',
                    score: rel.affection ?? rel.score ?? 0, maxScore: 100, minScore: 0,
                    occupation: spouse.occupation || '', age: spouse.age, gender: spouse.gender,
                    barColor: '#ff69b4', category: 'family romantic',
                });
            }
        }
        if (player.children && player.children.length > 0) {
            for (const child of player.children) {
                if (!child.isAlive) continue;
                entries.push({
                    name: `${child.firstName} ${child.dynasty || ''}`.trim(),
                    icon: child.gender === 'male' ? '👦' : '👧',
                    preset: null,
                    badge: child.gender === 'male' ? '👦 Son' : '👧 Daughter', badgeClass: 'family',
                    score: 75, maxScore: 100, minScore: 0,
                    occupation: '', age: child.age, gender: child.gender,
                    barColor: '#66BB6A', category: 'family',
                });
            }
        }

        // ── INNER MAP NPCs ──
        const innerNpcs = NpcFamily._getInnerMapNpcs();
        const innerShown = new Set();
        if (innerNpcs && innerNpcs.length > 0) {
            const metNpcs = [];
            for (const npc of innerNpcs) {
                if (!npc || !npc.fullName) continue;
                if (!npc._dialogMemory && !player.relationships?.[npc.id]) continue;
                const status = NpcFamily.getPlayerNpcStatus(player, npc);
                metNpcs.push({ npc, status });
                innerShown.add(npc.id);
            }
            metNpcs.sort((a, b) => b.status.score - a.status.score);
            if (metNpcs.length > 0) {
                entries.push({ _sectionLabel: '🏘️ Locals' });
                for (const { npc, status } of metNpcs) {
                    const familyTag = npc.familyGroupId != null ? NpcFamily.getFamilyTagline(npc, innerNpcs) : '';
                    entries.push({
                        name: npc.fullName,
                        icon: npc.icon || '🧑',
                        preset: npc.preset || null,
                        badge: `${status.level.icon} ${status.level.label}`,
                        badgeClass: status.score >= 20 ? 'friend' : status.score <= -20 ? 'rival' : 'neutral',
                        score: status.score, maxScore: 100, minScore: -100,
                        occupation: npc.type ? npc.type.replace(/_/g, ' ') : '',
                        age: npc.age, gender: npc.gender, subtitle: familyTag,
                        barColor: status.level.color || '#888',
                        category: 'locals' + (status.score >= 20 ? ' friends' : '') + (status.score <= -20 ? ' rivals' : ''),
                    });
                }
            }
        }

        // ── PERSISTENT NPCs ──
        const allRels = Object.entries(player.relationships || {});
        const persistentEntries = [];
        for (const [npcId, rel] of allRels) {
            if (npcId === player.spouse) continue;
            const npc = Relationships.getNPC(npcId);
            if (!npc || !npc.isAlive) continue;
            if (innerShown.has(npcId) || innerShown.has(Number(npcId))) continue;
            persistentEntries.push({ npcId, npc, rel });
        }
        persistentEntries.sort((a, b) => (b.rel.score || 0) - (a.rel.score || 0));
        if (persistentEntries.length > 0) {
            entries.push({ _sectionLabel: '🌍 Known People' });
            for (const { npc, rel } of persistentEntries) {
                const label = Relationships.getRelationLabel(rel.score || 0);
                const isRomantic = rel.romantic;
                let badge, badgeClass;
                if (isRomantic) {
                    const stage = Relationships.getCourtingStage(rel.affection || 0, false);
                    badge = `${stage.icon} ${stage.label}`;
                    badgeClass = 'romantic';
                } else {
                    badge = `${label.icon} ${label.label}`;
                    badgeClass = rel.score >= 30 ? 'friend' : rel.score <= -30 ? 'rival' : 'neutral';
                }
                entries.push({
                    name: `${npc.firstName} ${npc.dynasty || ''}`.trim(),
                    icon: npc.icon || '🧑',
                    preset: npc.preset || null,
                    badge, badgeClass,
                    score: rel.score || 0, maxScore: 100, minScore: -100,
                    occupation: npc.occupation || '', age: npc.age, gender: npc.gender,
                    barColor: isRomantic ? '#ff69b4' : (rel.score >= 30 ? '#66BB6A' : rel.score <= -30 ? '#EF5350' : '#888'),
                    category: (isRomantic ? 'romantic' : '') + (rel.score >= 30 ? ' friends' : '') + (rel.score <= -30 ? ' rivals' : ''),
                });
            }
        }

        // ── Empty state ──
        if (entries.length === 0) {
            body.innerHTML = '<p class="srel-empty">You haven\'t met anyone yet.<br>Visit a settlement and talk to people!</p>';
            return;
        }

        // Build grid HTML
        let html = '<div class="srel-grid">';
        for (const entry of entries) {
            if (entry._sectionLabel) {
                html += `<div class="srel-section-label">${entry._sectionLabel}</div>`;
                continue;
            }
            html += this._renderRelTile(entry);
        }
        html += '</div>';
        body.innerHTML = html;

        // Draw sprite portraits into tile canvases
        this._drawTilePortraits(body);

        // Attach click/hover tooltip listeners
        this._attachTileTooltips(body);
    },

    /**
     * Render a single grid tile square.
     */
    _renderRelTile(entry) {
        const { name, icon, preset, badge, badgeClass, score, maxScore = 100, minScore = -100,
                occupation, age, gender, subtitle, barColor, category } = entry;
        const tileClass = badgeClass ? `srel-tile srel-tile--${badgeClass}` : 'srel-tile';
        const firstName = name.split(' ')[0];

        // Encode tooltip data as data attributes
        const genderIcon = gender === 'female' ? '♀' : gender === 'male' ? '♂' : '';
        const occStr = occupation ? occupation.charAt(0).toUpperCase() + occupation.slice(1) : '';
        const range = maxScore - minScore;
        const normalised = Math.max(0, Math.min(100, ((score - minScore) / range) * 100));

        let tile = `<div class="${tileClass}" data-category="${category || 'all'}"`;
        tile += ` data-tt-name="${this._escAttr(name)}"`;
        tile += ` data-tt-badge="${this._escAttr(badge)}"`;
        tile += ` data-tt-badgeclass="${badgeClass || 'neutral'}"`;
        tile += ` data-tt-score="${score}"`;
        tile += ` data-tt-bar="${normalised}"`;
        tile += ` data-tt-barcolor="${barColor}"`;
        tile += ` data-tt-occ="${this._escAttr(occStr)}"`;
        tile += ` data-tt-age="${age || ''}"`;
        tile += ` data-tt-gender="${genderIcon}"`;
        if (subtitle) tile += ` data-tt-subtitle="${this._escAttr(subtitle)}"`;
        tile += `>`;

        // Face — try sprite canvas first, fall back to emoji icon
        // DISABLED: InnerMapCharacters disabled
        if (false && preset && InnerMapCharacters.isReady()) {
            tile += `<canvas class="srel-tile-face" data-preset="${preset}" width="48" height="48" style="width:42px;height:42px;"></canvas>`;
        } else {
            tile += `<span class="srel-tile-face">${icon}</span>`;
        }
        tile += `<span class="srel-tile-name">${firstName}</span>`;
        tile += `</div>`;
        return tile;
    },

    /** HTML-escape for data attributes */
    _escAttr(s) { return (s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); },

    /**
     * Draw sprite portraits onto tile canvases that have a data-preset attribute.
     * DISABLED: InnerMapCharacters disabled
     */
    _drawTilePortraits(container) {
        if (true) return;  // DISABLED: Inner map feature disabled
        // if (!InnerMapCharacters.isReady()) return;
        const canvases = container.querySelectorAll('canvas[data-preset]');
        for (const cvs of canvases) {
            const presetId = cvs.dataset.preset;
            const comp = InnerMapCharacters.getComposited(presetId);
            if (!comp) continue;
            const sheet = comp.idle || comp.walk;
            if (!sheet) continue;
            const ctx = cvs.getContext('2d');
            // Draw frame 0, direction 2 (facing down/towards camera)
            const fw = InnerMapCharacters.FRAME_W;
            const fh = InnerMapCharacters.FRAME_H;
            const dir = InnerMapCharacters.DIR_DOWN;
            ctx.clearRect(0, 0, cvs.width, cvs.height);
            ctx.drawImage(sheet, 0, dir * fh, fw, fh, 0, 0, cvs.width, cvs.height);
        }
    },

    /**
     * Attach hover & click tooltip behavior to relationship tiles
     */
    _attachTileTooltips(container) {
        // Create or reuse tooltip element
        let tooltip = document.getElementById('srelTooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'srelTooltip';
            tooltip.className = 'srel-tooltip';
            document.body.appendChild(tooltip);
        }

        let activeTile = null;
        let hideTimeout = null;

        const showTooltip = (tile) => {
            clearTimeout(hideTimeout);
            if (activeTile) activeTile.classList.remove('active');
            activeTile = tile;
            tile.classList.add('active');

            const d = tile.dataset;
            let html = `<div class="srel-tooltip-name">${d.ttName}</div>`;
            html += `<span class="srel-tooltip-badge ${d.ttBadgeclass}">${d.ttBadge}</span>`;
            if (d.ttSubtitle) html += `<div style="font-size:9px;color:rgba(160,196,176,0.4);font-style:italic;margin-top:3px;">${d.ttSubtitle}</div>`;
            html += `<hr class="srel-tooltip-divider">`;
            if (d.ttOcc) html += `<div class="srel-tooltip-row"><span>Occupation</span><span>${d.ttOcc}</span></div>`;
            if (d.ttAge) html += `<div class="srel-tooltip-row"><span>Age</span><span>${d.ttAge}</span></div>`;
            if (d.ttGender) html += `<div class="srel-tooltip-row"><span>Gender</span><span>${d.ttGender}</span></div>`;
            html += `<div class="srel-tooltip-row"><span>Relationship</span><span>${d.ttScore}</span></div>`;
            html += `<div class="srel-bar-bg"><div class="srel-bar-fill" style="width:${d.ttBar}%;background:${d.ttBarcolor};"></div></div>`;
            tooltip.innerHTML = html;

            // Position above the tile
            const rect = tile.getBoundingClientRect();
            tooltip.style.left = Math.max(4, rect.left + rect.width / 2 - 100) + 'px';
            tooltip.style.top = (rect.top - tooltip.offsetHeight - 8) + 'px';

            // Make visible and re-check position (may need to flip below)
            tooltip.classList.add('visible');
            const ttRect = tooltip.getBoundingClientRect();
            if (ttRect.top < 4) {
                tooltip.style.top = (rect.bottom + 8) + 'px';
            }
        };

        const hideTooltip = () => {
            hideTimeout = setTimeout(() => {
                tooltip.classList.remove('visible');
                if (activeTile) activeTile.classList.remove('active');
                activeTile = null;
            }, 200);
        };

        const tiles = container.querySelectorAll('.srel-tile');
        tiles.forEach(tile => {
            tile.addEventListener('mouseenter', () => showTooltip(tile));
            tile.addEventListener('mouseleave', hideTooltip);
            tile.addEventListener('click', (e) => {
                e.stopPropagation();
                if (activeTile === tile && tooltip.classList.contains('visible')) {
                    hideTooltip();
                } else {
                    showTooltip(tile);
                }
            });
        });

        // Hide on click outside
        document.addEventListener('click', () => {
            tooltip.classList.remove('visible');
            if (activeTile) activeTile.classList.remove('active');
            activeTile = null;
        }, { once: true });
    },

    /**
     * Render a lightweight inventory summary inside the HUD inventory tab
     */
    _renderInventoryPanel() {
        const body = document.getElementById('simsInvBody');
        if (!body) return;
        const player = this.game?.player;
        if (!player || !player.inventory || Object.keys(player.inventory).length === 0) {
            body.innerHTML = '<p class="srel-empty">Your pack is empty.</p>';
            return;
        }

        let html = '';
        for (const [itemId, quantity] of Object.entries(player.inventory)) {
            if (quantity <= 0) continue;
            const item = PlayerEconomy.GOODS ? PlayerEconomy.GOODS[itemId.toUpperCase()] : null;
            const fallbackName = itemId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            const icon = (item && item.icon) ? item.icon : '📦';
            const name = (item && item.name) ? item.name : fallbackName;
            html += `<div class="sinv-tile" title="${name} ×${quantity}">`;
            html += `<span class="sinv-tile-icon">${icon}</span>`;
            if (quantity > 1) html += `<span class="sinv-tile-qty">${quantity}</span>`;
            html += `<span class="sinv-tile-name">${name}</span>`;
            html += `</div>`;
        }
        body.innerHTML = html || '<p class="srel-empty">Your pack is empty.</p>';
    },

    /**
     * Wire up the relationship filter buttons
     */
    _setupRelFilters() {
        const container = document.getElementById('simsRelFilters');
        if (!container) return;
        const buttons = container.querySelectorAll('.srel-filter-btn');
        const body = document.getElementById('simsRelBody');

        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                // Toggle active state
                buttons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const filter = btn.dataset.filter;
                if (!body) return;
                const tiles = body.querySelectorAll('.srel-tile');
                const sections = body.querySelectorAll('.srel-section-label');

                if (filter === 'all') {
                    tiles.forEach(c => c.style.display = '');
                    sections.forEach(s => s.style.display = '');
                } else {
                    tiles.forEach(c => {
                        const cats = (c.dataset.category || '').split(' ');
                        c.style.display = cats.includes(filter) ? '' : 'none';
                    });
                    // Hide section labels if all their following tiles are hidden
                    sections.forEach(s => {
                        let nextEl = s.nextElementSibling;
                        let anyVisible = false;
                        while (nextEl && !nextEl.classList.contains('srel-section-label')) {
                            if (nextEl.classList.contains('srel-tile') && nextEl.style.display !== 'none') {
                                anyVisible = true;
                            }
                            nextEl = nextEl.nextElementSibling;
                        }
                        s.style.display = anyVisible ? '' : 'none';
                    });
                }
            });
        });
    },
});
