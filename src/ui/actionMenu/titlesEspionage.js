// ActionMenu — titlesEspionage methods (split from the original monolith).
import { ActionMenu } from './_ref.js';
import { PlayerActions, PlayerEconomy, Trading, PlayerMilitary, Hex, Utils, Banking, MarketDynamics, Taxation, Technology, Titles, Quests, Terrain, Kingdom, NPCLords, Peoples, LegendaryArtifacts, BountyHunting, Religion, Espionage, Infrastructure, Tavern, Ships, Housing, Cartography, Colonization, Relationships, Councils, SaveLoad, Economy, DataLoader } from './_imports.js';

Object.assign(ActionMenu, {
    // ════════════════════════════════════════════════════
    //  TITLE SYSTEM — Seek, View, Resign, Duty Actions
    // ════════════════════════════════════════════════════
    /**
     * Show the "Seek Royal Office" panel listing available titles
     */
    showSeekTitleMenu(game, tile) {
        const player = game.player;
        const world = game.world;

        if (typeof Titles === 'undefined') return;
        Titles.initialize(player);

        const kingdom = world.getKingdom(player.allegiance);
        const available = Titles.getAvailableTitles(player, tile, world);

        let html = `<div style="padding:10px;">
            <div style="text-align:center; margin-bottom:12px;">
                <span style="font-size:36px;">🏅</span>
                <div style="color:#ccc; font-size:12px; margin-top:4px;">Seek appointment to a political office in <span style="color:#ffd700;">${kingdom?.name || 'the realm'}</span></div>
            </div>`;

        if (available.length === 0) {
            html += `<div style="color:#888; text-align:center; padding:20px;">No titles available. Increase your reputation and renown.</div>`;
        } else {
            for (const t of available) {
                const reqColor = t.meetsRequirements ? '#4caf50' : '#ff6666';
                const reqText = t.meetsRequirements ? '✓ Qualified' : `✗ ${t.reason}`;
                html += `<div style="border:1px solid ${t.meetsRequirements ? '#4a6a4a' : '#4a3a3a'}; border-radius:8px; padding:10px; margin-bottom:8px; background:rgba(255,255,255,0.02);">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <span style="font-size:20px;">${t.icon || '🏅'}</span>
                            <span style="font-weight:bold; color:#ffd700; margin-left:6px;">${t.name}</span>
                            <span style="font-size:10px; color:#888; margin-left:6px;">Rank ${t.rank}</span>
                        </div>
                        <div style="font-size:11px; color:${reqColor};">${reqText}</div>
                    </div>
                    <div style="font-size:12px; color:#aaa; margin:6px 0;">${t.description}</div>
                    <div style="display:flex; gap:12px; font-size:11px; color:#888; margin-bottom:6px;">
                        <span>💰 ${t.salary} gold/day</span>
                        <span>📋 ${t.duties.type.replace(/_/g, ' ')}</span>
                    </div>`;

                if (t.meetsRequirements) {
                    html += `<button onclick="ActionMenu._appointTitle(game, '${t.id}')" style="
                        width:100%; padding:6px; margin-top:4px;
                        background:#2a4a2a; border:1px solid #4a6a4a; border-radius:4px;
                        color:#4caf50; cursor:pointer; font-size:12px;
                    ">Accept Appointment</button>`;
                } else {
                    // Show requirements
                    const reqs = t.requirements;
                    let reqList = [];
                    if (reqs.reputation) reqList.push(`Rep: ${reqs.reputation}`);
                    if (reqs.renown) reqList.push(`Renown: ${reqs.renown}`);
                    if (reqs.skills) for (const [s, v] of Object.entries(reqs.skills)) reqList.push(`${s}: ${v}`);
                    if (reqs.attributes) for (const [a, v] of Object.entries(reqs.attributes)) reqList.push(`${a}: ${v}`);
                    html += `<div style="font-size:10px; color:#666; margin-top:4px;">Requires: ${reqList.join(' · ')}</div>`;
                }

                html += `</div>`;
            }
        }

        html += `<button onclick="game.ui.hideCustomPanel();" style="
            width:100%; padding:8px; margin-top:6px;
            background:#444; border:1px solid #666; border-radius:6px;
            color:#eee; cursor:pointer; font-size:13px;
        ">Close</button></div>`;

        game.ui.showCustomPanel('🏅 Royal Offices', html);
    },

    /**
     * Internal — appoint player to a title
     */
    _appointTitle(game, titleId) {
        const player = game.player;
        const world = game.world;
        if (!ActionMenu.commitPendingAP(game)) return;

        if (typeof Titles === 'undefined') return;
        Titles.initialize(player);

        const result = Titles.appoint(player, titleId, world);
        if (!result.success) {
            game.ui.showNotification('❌ Cannot Accept', result.reason, 'error');
            game.ui.hideCustomPanel();
            return;
        }

        const title = result.title;
        const kingdom = world.getKingdom(player.allegiance);

        let html = `<div style="padding:15px; text-align:center;">
            <span style="font-size:48px;">${title.icon || '🏅'}</span>
            <h3 style="color:#ffd700;">Title Bestowed!</h3>
            <p style="color:#aaa;">You have been appointed <span style="color:#ffd700;">${title.name}</span> of <span style="color:#4fc3f7;">${kingdom?.name || 'the realm'}</span>.</p>
            <div style="background:#1a2a1a; padding:10px; border-radius:6px; margin:12px 0;">
                <div style="color:#4caf50;">💰 Daily salary: ${title.salary} gold</div>
                <div style="color:#4fc3f7; margin-top:4px;">📋 Duty: ${title.duties.type.replace(/_/g, ' ')}</div>
                <div style="color:#aaa; margin-top:4px; font-size:12px;">Complete your duties within ${title.duties.deadlineDays} days or face penalties!</div>
            </div>
            <button onclick="game.ui.hideCustomPanel(); game.ui.updateStats(game.player, game.world);" style="
                width:100%; padding:10px; margin-top:8px;
                background:#444; border:1px solid #666; border-radius:6px;
                color:#eee; cursor:pointer; font-size:14px;
            ">Accept Your Duties</button>
        </div>`;

        game.ui.showCustomPanel(`${title.icon || '🏅'} ${title.name}`, html);
    },

    /**
     * Show title status / duty progress panel
     */
    showTitleStatusPanel(game) {
        const player = game.player;
        if (typeof Titles === 'undefined' || !player.currentTitle) return;

        const progress = Titles.getDutyProgress(player);
        if (!progress) return;

        const title = progress.title;
        const kingdom = game.world.getKingdom(player.allegiance);
        const pct = progress.required > 0 ? Math.min(100, Math.round((progress.count / progress.required) * 100)) : 0;
        const barColor = progress.passed ? '#4caf50' : pct >= 50 ? '#ff9800' : '#f44336';

        let html = `<div style="padding:12px;">
            <div style="text-align:center; margin-bottom:12px;">
                <span style="font-size:36px;">${title.icon || '🏅'}</span>
                <div style="font-family:var(--font-display); font-size:18px; color:#ffd700;">${title.name}</div>
                <div style="font-size:12px; color:#888;">${kingdom?.name || 'the realm'}</div>
            </div>

            <div class="info-section-title">Duty Progress</div>
            <div style="margin:8px 0;">
                <div style="display:flex; justify-content:space-between; font-size:12px; color:#aaa;">
                    <span>${progress.progress}</span>
                    <span>${pct}%</span>
                </div>
                <div style="width:100%; height:8px; background:rgba(255,255,255,0.1); border-radius:4px; margin-top:4px; overflow:hidden;">
                    <div style="width:${pct}%; height:100%; background:${barColor}; border-radius:4px; transition:width 0.3s;"></div>
                </div>
            </div>

            <div class="info-row">
                <span class="info-label">⏰ Days Left</span>
                <span class="info-value" style="color:${progress.daysLeft <= 5 ? '#f44336' : '#aaa'};">${progress.daysLeft}</span>
            </div>
            <div class="info-row">
                <span class="info-label">💰 Daily Salary</span>
                <span class="info-value" style="color:#ffd700;">${title.salary} gold</span>
            </div>
            <div class="info-row">
                <span class="info-label">📅 Appointed</span>
                <span class="info-value">Day ${player.titleAppointedDay || '?'}</span>
            </div>`;

        // Show active fugitive info for jailer
        if (player.currentTitle === 'jailer' && player.activeFugitive) {
            const fug = player.activeFugitive;
            html += `
                <div class="info-section-title">Active Bounty</div>
                <div style="border:1px solid #6a4a2a; border-radius:6px; padding:8px; background:rgba(255,150,0,0.05);">
                    <div style="font-weight:bold; color:#ff9800;">${fug.name}</div>
                    <div style="font-size:11px; color:#aaa;">${fug.crime || 'Wanted for crimes'}</div>
                    <div style="font-size:11px; color:#888; margin-top:4px;">
                        📍 Last seen: (${fug.q}, ${fug.r}) · ⏰ ${fug.daysRemaining} days left · ⚔️ Difficulty: ${fug.difficulty}
                    </div>
                </div>`;
        }

        // Perks
        html += `<div class="info-section-title" style="margin-top:10px;">Perks</div>`;
        for (const [key, val] of Object.entries(title.perks)) {
            const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
            const display = typeof val === 'object' ? `${val.min}-${val.max}` : val;
            html += `<div class="info-row"><span class="info-label" style="font-size:11px;">${label}</span><span class="info-value" style="font-size:11px;">${display}</span></div>`;
        }

        // Resign button
        html += `<div style="margin-top:12px; display:flex; gap:8px;">
            <button onclick="game.ui.hideCustomPanel();" style="
                flex:1; padding:8px;
                background:#444; border:1px solid #666; border-radius:6px;
                color:#eee; cursor:pointer; font-size:13px;
            ">Close</button>
            <button onclick="ActionMenu._resignTitle(game);" style="
                flex:1; padding:8px;
                background:#4a2a2a; border:1px solid #6a3a3a; border-radius:6px;
                color:#ff6666; cursor:pointer; font-size:13px;
            ">Resign Office</button>
        </div></div>`;

        game.ui.showCustomPanel(`${title.icon || '🏅'} ${title.name}`, html);
    },

    /**
     * Internal — resign from title
     */
    _resignTitle(game) {
        const player = game.player;
        if (typeof Titles === 'undefined') return;

        const result = Titles.resign(player, game.world);
        if (!result.success) {
            game.ui.showNotification('❌ Error', result.reason, 'error');
            return;
        }

        game.ui.hideCustomPanel();
        game.ui.showNotification('🏅 Title Resigned',
            `You have resigned from the office of ${result.name}. Your reputation has decreased.`, 'warning');
        game.ui.updateStats(player, game.world);
    },

    /**
     * Tax Collector — collect taxes at settlement
     */
    doCollectTax(game, tile) {
        const player = game.player;
        if (typeof Titles === 'undefined') return;

        const result = Titles.collectTaxAtSettlement(player, tile, game.world);
        if (!result.success) {
            game.ui.showNotification('❌ Cannot Collect', result.reason, 'error');
            return;
        }

        let html = `<div style="padding:15px; text-align:center;">
            <span style="font-size:42px;">💰</span>
            <h3 style="color:#ffd700;">Taxes Collected!</h3>
            <p style="color:#aaa;">You collected <span style="color:#ffd700;">${result.gold} gold</span> in taxes from <span style="color:#4fc3f7;">${result.settlement}</span>.</p>
            <div style="background:#1a2a1a; padding:8px; border-radius:4px; margin:10px 0;">
                <div style="color:#4caf50;">Settlements this month: ${result.count}</div>
            </div>
            <button onclick="game.ui.hideCustomPanel(); game.ui.updateStats(game.player, game.world);" style="
                width:100%; padding:10px; margin-top:8px;
                background:#444; border:1px solid #666; border-radius:6px;
                color:#eee; cursor:pointer; font-size:14px;
            ">Continue</button>
        </div>`;

        game.ui.showCustomPanel('📜 Tax Collection', html);
    },

    /**
     * Jailer — request a bounty target
     */
    doRequestBounty(game, tile) {
        const player = game.player;
        if (typeof Titles === 'undefined') return;

        const result = Titles.spawnFugitive(player, game.world);
        if (!result.success) {
            game.ui.showNotification('❌ No Bounty', result.reason, 'error');
            return;
        }

        const fug = result.fugitive;
        let html = `<div style="padding:15px; text-align:center;">
            <span style="font-size:42px;">🔍</span>
            <h3 style="color:#ff9800;">Bounty Assigned!</h3>
            <div style="border:1px solid #6a4a2a; border-radius:8px; padding:12px; margin:10px 0; background:rgba(255,150,0,0.05);">
                <div style="font-size:18px; font-weight:bold; color:#ffd700;">${fug.name}</div>
                <div style="font-size:12px; color:#ff6666; margin:4px 0;">${fug.crime || 'Wanted for crimes against the realm'}</div>
                <div style="font-size:12px; color:#aaa;">${fug.description || ''}</div>
                <div style="display:flex; justify-content:center; gap:16px; margin-top:8px; font-size:12px;">
                    <span style="color:#888;">⚔️ Difficulty: ${fug.difficulty}</span>
                    <span style="color:#888;">⏰ ${fug.daysRemaining} days</span>
                    <span style="color:#888;">📍 Last seen: (${fug.q}, ${fug.r})</span>
                </div>
            </div>
            <p style="color:#aaa; font-size:12px;">Travel to the fugitive's location and capture them before time runs out!</p>
            <button onclick="game.ui.hideCustomPanel(); game.ui.updateStats(game.player, game.world);" style="
                width:100%; padding:10px; margin-top:8px;
                background:#444; border:1px solid #666; border-radius:6px;
                color:#eee; cursor:pointer; font-size:14px;
            ">Begin the Hunt</button>
        </div>`;

        game.ui.showCustomPanel('🔒 Jailer\'s Bounty', html);
    },

    /**
     * Jailer — attempt to capture fugitive
     */
    doCaptureFugitive(game, tile) {
        const player = game.player;
        if (typeof Titles === 'undefined') return;

        const result = Titles.captureFugitive(player, game.world);
        let html;

        if (result.success) {
            html = `<div style="padding:15px; text-align:center;">
                <span style="font-size:42px;">⛓️</span>
                <h3 style="color:#4caf50;">Fugitive Captured!</h3>
                <p style="color:#aaa;">You have captured <span style="color:#ffd700;">${result.fugitive.name}</span>!</p>
                <div style="background:#1a2a1a; padding:8px; border-radius:4px; margin:10px 0;">
                    <div style="color:#ffd700;">💰 Bounty: ${result.gold} gold</div>
                    <div style="color:#4caf50;">Total captures: ${result.captureCount}</div>
                </div>
                <button onclick="game.ui.hideCustomPanel(); game.ui.updateStats(game.player, game.world);" style="
                    width:100%; padding:10px; margin-top:8px;
                    background:#444; border:1px solid #666; border-radius:6px;
                    color:#eee; cursor:pointer; font-size:14px;
                ">Continue</button>
            </div>`;
        } else if (result.escaped) {
            html = `<div style="padding:15px; text-align:center;">
                <span style="font-size:42px;">💨</span>
                <h3 style="color:#ff9800;">Fugitive Escaped!</h3>
                <p style="color:#aaa;">${result.reason}</p>
                <button onclick="game.ui.hideCustomPanel();" style="
                    width:100%; padding:10px; margin-top:8px;
                    background:#444; border:1px solid #666; border-radius:6px;
                    color:#eee; cursor:pointer; font-size:14px;
                ">Continue Pursuit</button>
            </div>`;
        } else {
            game.ui.showNotification('❌ Cannot Capture', result.reason, 'error');
            return;
        }

        game.ui.showCustomPanel('🔒 Fugitive Hunt', html);
    },

    /**
     * Court Chaplain — bless a settlement
     */
    doBlessSettlement(game, tile) {
        const player = game.player;
        if (typeof Titles === 'undefined') return;

        const result = Titles.blessSettlement(player, tile, game.world);
        if (!result.success) {
            game.ui.showNotification('❌ Cannot Bless', result.reason, 'error');
            return;
        }

        let html = `<div style="padding:15px; text-align:center;">
            <span style="font-size:42px;">✨</span>
            <h3 style="color:#9c27b0;">Settlement Blessed!</h3>
            <p style="color:#aaa;">You have given a holy blessing to <span style="color:#4fc3f7;">${result.settlement}</span>.</p>
            <div style="background:#1a1a2a; padding:8px; border-radius:4px; margin:10px 0;">
                <div style="color:#9c27b0;">☯ Karma +2</div>
                <div style="color:#4fc3f7;">⭐ Renown +1</div>
                <div style="color:#4caf50;">Settlements blessed: ${result.count}</div>
            </div>
            <button onclick="game.ui.hideCustomPanel(); game.ui.updateStats(game.player, game.world);" style="
                width:100%; padding:10px; margin-top:8px;
                background:#444; border:1px solid #666; border-radius:6px;
                color:#eee; cursor:pointer; font-size:14px;
            ">Continue</button>
        </div>`;

        game.ui.showCustomPanel('✨ Holy Blessing', html);
    },

    /**
     * Chancellor — hold council
     */
    doHoldCouncil(game, tile) {
        const player = game.player;
        if (typeof Titles === 'undefined') return;

        const result = Titles.holdCouncil(player, tile, game.world);
        if (!result.success) {
            game.ui.showNotification('❌ Cannot Hold Council', result.reason, 'error');
            return;
        }

        let councilResult = null;
        if (typeof Councils !== 'undefined') {
            Councils.initializePlayer(player);
            councilResult = Councils.conveneCouncil(player, game.world);
            if (!councilResult.success) {
                game.ui.showNotification('Council Chamber', councilResult.reason, 'warning');
            }
        }

        let html = `<div style="padding:15px; text-align:center;">
            <span style="font-size:42px;">👑</span>
            <h3 style="color:#ffd700;">Council Held!</h3>
            <p style="color:#aaa;">You convened the royal council at <span style="color:#4fc3f7;">${result.settlement}</span>.</p>
            <div style="background:#1a2a1a; padding:8px; border-radius:4px; margin:10px 0;">
                <div style="color:#ffd700;">⭐ Renown +5</div>
                <div style="color:#4caf50;">📈 Reputation +3</div>
                ${councilResult && councilResult.success ? `<div style="color:#4fc3f7;">🗳️ Session active until day ${councilResult.sessionUntilDay}</div>` : ''}
            </div>
            <p style="color:#888; font-size:12px; font-style:italic;">The lords and ladies of the realm attended your council. Your authority is recognized.</p>
            ${typeof Councils !== 'undefined' ? `<button onclick="ActionMenu.showCouncilMenu(game, game.world.getTile(game.player.q, game.player.r))" style="
                width:100%; padding:10px; margin-top:8px;
                background:#1f4d7a; border:1px solid #357ab8; border-radius:6px;
                color:#fff; cursor:pointer; font-size:14px;
            ">Open Council Chamber</button>` : ''}
            <button onclick="game.ui.hideCustomPanel(); game.ui.updateStats(game.player, game.world);" style="
                width:100%; padding:10px; margin-top:8px;
                background:#444; border:1px solid #666; border-radius:6px;
                color:#eee; cursor:pointer; font-size:14px;
            ">Continue</button>
        </div>`;

        game.ui.showCustomPanel('👑 Royal Council', html);
    },

    /**
     * Show council & parliament chamber
     */
    showCouncilMenu(game, tile) {
        if (typeof Councils === 'undefined') {
            game.ui.showNotification('Unavailable', 'Council system not loaded.', 'error');
            return;
        }

        const player = game.player;
        Councils.initializePlayer(player);
        const summary = Councils.getSummary(player, game.world);

        if (!summary.canGovern) {
            game.ui.showCustomPanel('🏛️ Council Chamber', `
                <div style="padding:15px; color:#ccc;">
                    <p style="margin-top:0;">You need political authority to govern the realm.</p>
                    <div style="background:#2a1f1f; border:1px solid #5c3b3b; border-radius:6px; padding:10px; color:#ffb3b3;">
                        Required office: <strong>King, Chancellor, or Treasurer</strong> while pledged to a kingdom.
                    </div>
                </div>
            `);
            return;
        }

        const day = game.world.day;
        const canConveneIn = Math.max(0, (summary.lastConveneDay + Councils.CONVENE_COOLDOWN_DAYS) - day);
        const sessionText = summary.sessionActive
            ? `In session until day ${summary.activeSessionUntilDay}`
            : 'No active session';

        let html = '<div style="max-height:540px; overflow-y:auto; padding:12px;">';
        html += `<div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; margin-bottom:10px;">
            <div style="background:#1a2a1a; border:1px solid #2f6f3f; border-radius:6px; padding:8px; text-align:center;">
                <div style="font-size:11px; color:#8bc34a;">Approval</div>
                <div style="font-size:20px; color:#c8e6c9;">${summary.approval}%</div>
            </div>
            <div style="background:#1a1f2a; border:1px solid #2f4f7f; border-radius:6px; padding:8px; text-align:center;">
                <div style="font-size:11px; color:#64b5f6;">Session</div>
                <div style="font-size:12px; color:#bbdefb; margin-top:4px;">${sessionText}</div>
            </div>
            <div style="background:#2a2116; border:1px solid #7a5a2b; border-radius:6px; padding:8px; text-align:center;">
                <div style="font-size:11px; color:#ffcc80;">War Mandate</div>
                <div style="font-size:12px; color:#ffe0b2; margin-top:4px;">${summary.warMandateUntilDay >= day ? `Active to day ${summary.warMandateUntilDay}` : 'None'}</div>
            </div>
        </div>`;

        html += `<button onclick="ActionMenu.councilConvene(game)" style="width:100%; margin-bottom:10px; padding:10px; border-radius:6px; border:1px solid #3f6ca5; background:#244b78; color:#fff; cursor:pointer;">
            🏛️ Convene Council ${canConveneIn > 0 ? `(available in ${canConveneIn}d)` : ''}
        </button>`;

        html += '<div style="font-weight:bold; color:#ddd; margin:6px 0;">Factions</div>';
        for (const faction of summary.factions) {
            html += `<div style="background:#1a1a1a; border:1px solid #333; border-radius:6px; padding:8px; margin-bottom:6px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                    <div style="color:#eee;">${faction.icon} ${faction.name}</div>
                    <div style="font-size:11px; color:#aaa;">Support ${faction.support}% • Influence ${faction.influence}</div>
                </div>
                <div style="height:6px; background:#333; border-radius:3px; overflow:hidden; margin-bottom:6px;">
                    <div style="height:100%; width:${Math.max(0, Math.min(100, faction.support))}%; background:${faction.support >= 55 ? '#4caf50' : faction.support >= 40 ? '#ffb74d' : '#ef5350'};"></div>
                </div>
                <div style="display:flex; gap:6px;">
                    <button onclick="ActionMenu.councilManageFaction(game, '${faction.id}', 'manage')" style="flex:1; padding:7px; border-radius:4px; border:1px solid #456a4a; background:#1e3a22; color:#dcedc8; cursor:pointer;">🤝 Manage (80g)</button>
                    <button onclick="ActionMenu.councilManageFaction(game, '${faction.id}', 'suppress')" style="flex:1; padding:7px; border-radius:4px; border:1px solid #7a3b3b; background:#3a1f1f; color:#ffcdd2; cursor:pointer;">🛡️ Suppress</button>
                </div>
                ${faction.suppressed ? `<div style="margin-top:5px; font-size:11px; color:#ffb3b3;">Suppressed until day ${faction.suppressedUntilDay}</div>` : ''}
            </div>`;
        }

        html += '<div style="font-weight:bold; color:#ddd; margin:10px 0 6px;">Votes & Decrees</div>';

        if (typeof Taxation !== 'undefined' && Taxation.TAX_RATES) {
            const currentPolicy = Taxation.TAX_RATES[(player.taxRate || 'moderate').toUpperCase()] || Taxation.TAX_RATES.MODERATE;
            const higherRates = Object.values(Taxation.TAX_RATES).filter(rate => rate.rate > currentPolicy.rate).sort((a, b) => a.rate - b.rate);
            html += '<div style="margin-bottom:8px; color:#bbb; font-size:12px;">Tax Increase Votes</div>';
            if (higherRates.length === 0) {
                html += '<div style="font-size:11px; color:#999; margin-bottom:8px;">Tax rate is already at maximum.</div>';
            } else {
                for (const rate of higherRates) {
                    html += `<button onclick="ActionMenu.councilVoteTax(game, '${rate.id}')" style="width:100%; margin-bottom:6px; padding:8px; border-radius:4px; border:1px solid #755b2a; background:#3a2e18; color:#ffe0b2; cursor:pointer;">🗳️ Vote for ${rate.name}</button>`;
                }
            }
            if (summary.taxIncreaseApproval && summary.taxIncreaseApproval.expiresDay >= day) {
                html += `<div style="font-size:11px; color:#9ad1ff; margin:4px 0 8px;">Approved tax increase up to <strong>${summary.taxIncreaseApproval.rateId}</strong> until day ${summary.taxIncreaseApproval.expiresDay}.</div>`;
            }
        }

        const targets = Councils.getAvailableWarTargets(player, game.world);
        html += '<div style="margin-top:6px; margin-bottom:8px; color:#bbb; font-size:12px;">War Motions</div>';
        if (!summary.canDeclareWar) {
            html += '<div style="font-size:11px; color:#999;">Only King or Chancellor can initiate war votes.</div>';
        } else if (!targets.length) {
            html += '<div style="font-size:11px; color:#999;">No valid war targets at this time.</div>';
        } else {
            for (const target of targets) {
                const hasMandate = Councils.hasWarMandate(player, game.world, target.id);
                html += `<div style="display:flex; gap:6px; margin-bottom:6px;">
                    <button onclick="ActionMenu.councilVoteWar(game, '${target.id}')" style="flex:1; padding:8px; border-radius:4px; border:1px solid #7d4f2b; background:#3d2618; color:#ffccbc; cursor:pointer;">🗳️ Vote War: ${target.name}</button>
                    <button onclick="ActionMenu.councilDeclareWar(game, '${target.id}')" style="padding:8px 10px; border-radius:4px; border:1px solid ${hasMandate ? '#8b2d2d' : '#555'}; background:${hasMandate ? '#4a1e1e' : '#222'}; color:${hasMandate ? '#ffcdd2' : '#888'}; cursor:${hasMandate ? 'pointer' : 'not-allowed'};" ${hasMandate ? '' : 'disabled'}>⚔️ Declare</button>
                </div>`;
            }
        }

        if (summary.history && summary.history.length) {
            html += '<div style="font-weight:bold; color:#ddd; margin:10px 0 6px;">Recent Proceedings</div>';
            for (const item of summary.history.slice(0, 5)) {
                html += `<div style="font-size:11px; color:${item.passed ? '#9ccc65' : '#ef9a9a'}; margin-bottom:4px;">Day ${item.day}: ${item.text}</div>`;
            }
        }

        html += '</div>';
        game.ui.showCustomPanel('🏛️ Council Chamber', html);
    },

    councilConvene(game) {
        if (typeof Councils === 'undefined') return;
        const result = Councils.conveneCouncil(game.player, game.world);
        if (result.success) {
            game.ui.showNotification('Council Convened', `Session active until day ${result.sessionUntilDay}. Approval +${result.approvalGain}.`, 'success');
        } else {
            game.ui.showNotification('Council Chamber', result.reason, 'warning');
        }
        ActionMenu.showCouncilMenu(game, game.world.getTile(game.player.q, game.player.r));
        game.ui.updateStats(game.player, game.world);
    },

    councilVoteTax(game, rateId) {
        if (typeof Councils === 'undefined') return;
        const result = Councils.callVote(game.player, game.world, 'tax_increase', { newRate: rateId });
        if (!result.success) {
            game.ui.showNotification('Vote Failed', result.reason, 'error');
        } else {
            game.ui.showNotification(result.passed ? 'Tax Motion Passed' : 'Tax Motion Rejected', result.summaryText, result.passed ? 'success' : 'warning');
        }
        ActionMenu.showCouncilMenu(game, game.world.getTile(game.player.q, game.player.r));
        game.ui.updateStats(game.player, game.world);
    },

    councilVoteWar(game, targetKingdomId) {
        if (typeof Councils === 'undefined') return;
        const result = Councils.callVote(game.player, game.world, 'war_declaration', { targetKingdomId });
        if (!result.success) {
            game.ui.showNotification('Vote Failed', result.reason, 'error');
        } else {
            game.ui.showNotification(result.passed ? 'War Mandate Passed' : 'War Mandate Rejected', result.summaryText, result.passed ? 'success' : 'warning');
        }
        ActionMenu.showCouncilMenu(game, game.world.getTile(game.player.q, game.player.r));
        game.ui.updateStats(game.player, game.world);
    },

    councilDeclareWar(game, targetKingdomId) {
        if (typeof Councils === 'undefined') return;
        const result = Councils.declareWar(game.player, game.world, targetKingdomId);
        if (!result.success) {
            game.ui.showNotification('Declaration Blocked', result.reason, 'error');
        } else {
            game.ui.showNotification('⚔️ War Declared', `${result.kingdom} is now at war with ${result.target}.`, 'warning');
        }
        ActionMenu.showCouncilMenu(game, game.world.getTile(game.player.q, game.player.r));
        game.ui.updateStats(game.player, game.world);
    },

    councilManageFaction(game, factionId, mode) {
        if (typeof Councils === 'undefined') return;
        const result = Councils.manageFaction(game.player, game.world, factionId, mode);
        if (!result.success) {
            game.ui.showNotification('Faction Action Failed', result.reason, 'error');
        } else {
            const actionName = mode === 'manage' ? 'Negotiation' : 'Suppression';
            game.ui.showNotification(actionName, `${result.faction}: support ${result.support}% • approval ${result.approval}%`, mode === 'manage' ? 'success' : 'warning');
        }
        ActionMenu.showCouncilMenu(game, game.world.getTile(game.player.q, game.player.r));
        game.ui.updateStats(game.player, game.world);
    },

    /**
     * Close action menu
     */
    close() {
        const menu = document.getElementById('actionMenu');
        if (menu) menu.remove();
        const tooltip = document.getElementById('actionTooltip');
        if (tooltip) tooltip.remove();
    },

    // ═══════════════════════════════════════════════════
    //  ESPIONAGE UI
    // ═══════════════════════════════════════════════════
    /**
     * Show the main espionage hub — recruit spies, assign missions
     */
    showEspionageMenu(game, tile) {
        if (typeof Espionage === 'undefined') return;
        Espionage.initPlayer(game.player);

        const summary = Espionage.getMissionSummary(game.player);
        const config = Espionage._getConfig();

        let html = '<div style="max-height:520px; overflow-y:auto;">';
        html += '<p style="font-size:12px; color:var(--text-secondary); margin-top:0; margin-bottom:14px;">Your shadow network operates from the tavern back rooms. Recruit agents and assign them to covert missions.</p>';

        // ── Summary Bar ──
        html += `<div style="display:flex; gap:8px; margin-bottom:14px; flex-wrap:wrap;">
            <div style="flex:1; min-width:80px; background:rgba(155,89,182,0.12); border:1px solid rgba(155,89,182,0.3); border-radius:4px; padding:8px; text-align:center;">
                <div style="font-size:18px;">🕵️</div>
                <div style="font-size:11px; color:#9b59b6;">${summary.totalSpies}/${config.maxSpies} Spies</div>
            </div>
            <div style="flex:1; min-width:80px; background:rgba(52,152,219,0.12); border:1px solid rgba(52,152,219,0.3); border-radius:4px; padding:8px; text-align:center;">
                <div style="font-size:18px;">📋</div>
                <div style="font-size:11px; color:#3498db;">${summary.activeMissions}/${config.maxActiveMissions} Missions</div>
            </div>
            <div style="flex:1; min-width:80px; background:rgba(241,196,15,0.12); border:1px solid rgba(241,196,15,0.3); border-radius:4px; padding:8px; text-align:center;">
                <div style="font-size:18px;">💰</div>
                <div style="font-size:11px; color:#f1c40f;">${summary.dailyUpkeep}g/day</div>
            </div>
            <div style="flex:1; min-width:80px; background:rgba(46,204,113,0.12); border:1px solid rgba(46,204,113,0.3); border-radius:4px; padding:8px; text-align:center;">
                <div style="font-size:18px;">✅</div>
                <div style="font-size:11px; color:#2ecc71;">${summary.completedMissions} Done</div>
            </div>
        </div>`;

        // ── Active Rebellions ──
        if (game.player.espionage.rebellions.length > 0) {
            html += '<div style="margin-bottom:12px; padding:8px; background:rgba(231,76,60,0.1); border:1px solid rgba(231,76,60,0.3); border-radius:4px;">';
            html += '<div style="font-weight:bold; font-size:12px; color:#e74c3c; margin-bottom:4px;">🔥 Active Rebellions</div>';
            for (const reb of game.player.espionage.rebellions) {
                const kingdom = game.world.getKingdom(reb.kingdomId);
                html += `<div style="font-size:11px; color:var(--text-secondary);">
                    ${kingdom ? kingdom.name : reb.kingdomId} — ${reb.severity} (${reb.daysRemaining || reb.duration}d remaining)
                </div>`;
            }
            html += '</div>';
        }

        // ── Menu Buttons ──
        const menuOptions = [
            { id: 'recruit', icon: '🎯', label: 'Recruit New Spy', desc: `Hire an agent (${config.baseRecruitCost}+ gold)`, available: summary.totalSpies < config.maxSpies },
            { id: 'roster', icon: '📜', label: 'Spy Roster', desc: `View and manage your ${summary.totalSpies} agents`, available: summary.totalSpies > 0 },
            { id: 'assign', icon: '📋', label: 'Assign Mission', desc: `Send a spy on a covert operation`, available: summary.idleSpies > 0 },
            { id: 'missions', icon: '⏳', label: 'Active Missions', desc: `${summary.activeMissions} mission(s) in progress`, available: summary.activeMissions > 0 },
        ];

        for (const opt of menuOptions) {
            html += `<button onclick="window._espionageAction('${opt.id}')"
                ${!opt.available ? 'disabled' : ''}
                style="display:flex; align-items:center; gap:10px; width:100%;
                    padding:12px; margin-bottom:8px;
                    background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1);
                    border-radius:4px; cursor:${opt.available ? 'pointer' : 'default'};
                    text-align:left; color:${opt.available ? 'white' : '#666'};
                    font-family:var(--font-body); transition:all 0.2s;"
                onmouseover="if(!this.disabled){this.style.background='rgba(155,89,182,0.15)'; this.style.borderColor='#9b59b6'}"
                onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.borderColor='rgba(255,255,255,0.1)'">
                <span style="font-size:22px;">${opt.icon}</span>
                <div style="flex:1;">
                    <div style="font-weight:bold; font-size:13px;">${opt.label}</div>
                    <div style="font-size:11px; color:var(--text-secondary);">${opt.desc}</div>
                </div>
            </button>`;
        }

        html += '</div>';
        game.ui.showCustomPanel('🕵️ Espionage Network', html);

        window._espionageAction = (action) => {
            switch (action) {
                case 'recruit': ActionMenu._showSpyRecruitMenu(game, tile); break;
                case 'roster': ActionMenu.showManageSpiesMenu(game, tile); break;
                case 'assign': ActionMenu._showAssignMissionMenu(game, tile); break;
                case 'missions': ActionMenu._showActiveMissionsMenu(game, tile); break;
            }
        };
    },

    /**
     * Show spy recruitment candidates
     */
    _showSpyRecruitMenu(game, tile) {
        const candidates = Espionage.getRecruitCandidates(game.player, game.world);
        const spySkills = Espionage._getData()?.spySkills || {};
        const traits = Espionage._getSpyTraits();

        let html = '<div style="max-height:480px; overflow-y:auto;">';
        html += '<p style="font-size:12px; color:var(--text-secondary); margin-top:0; margin-bottom:12px;">Shadowy figures in the tavern are willing to work for you — for the right price.</p>';

        for (const spy of candidates) {
            const levelTitle = Espionage.getSpyLevelTitle(spy.level);
            const traitLabels = (spy.traits || []).map(tid => {
                const t = traits.find(tr => tr.id === tid);
                return t ? `<span title="${t.description}" style="cursor:help;">${t.icon} ${t.name}</span>` : tid;
            }).join(', ');

            html += `<div style="padding:12px; margin-bottom:10px; background:rgba(255,255,255,0.04);
                border:1px solid rgba(155,89,182,0.25); border-radius:6px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                    <div>
                        <span style="font-weight:bold; font-size:14px; color:white;">${spy.name}</span>
                        <span style="font-size:11px; color:#9b59b6; margin-left:6px;">${levelTitle.icon} ${levelTitle.title}</span>
                    </div>
                    <span style="font-weight:bold; color:var(--gold); font-size:13px;">${spy.recruitCost}g</span>
                </div>

                <div style="display:flex; gap:6px; margin-bottom:6px; flex-wrap:wrap;">
                    ${Object.entries(spy.skills).map(([k, v]) => {
                        const sk = spySkills[k] || {};
                        return `<span style="font-size:10px; padding:2px 6px; background:rgba(255,255,255,0.08); border-radius:3px; color:var(--text-secondary);">${sk.icon || '⬤'} ${sk.name || k}: ${v}</span>`;
                    }).join('')}
                </div>

                <div style="font-size:11px; color:var(--text-secondary); margin-bottom:6px;">Traits: ${traitLabels || 'None'}</div>
                <div style="font-size:11px; color:var(--text-secondary); margin-bottom:8px;">🔄 Upkeep: ${spy.upkeep}g/day &nbsp; ❤️ Loyalty: ${Math.floor(spy.loyalty)}%</div>

                <button onclick="window._recruitSpy(${spy.id})"
                    ${game.player.gold < spy.recruitCost ? 'disabled' : ''}
                    style="width:100%; padding:8px; background:rgba(155,89,182,0.25); border:1px solid rgba(155,89,182,0.5);
                    border-radius:4px; cursor:${game.player.gold >= spy.recruitCost ? 'pointer' : 'default'};
                    color:${game.player.gold >= spy.recruitCost ? 'white' : '#666'}; font-family:var(--font-body); font-weight:bold;">
                    ${game.player.gold >= spy.recruitCost ? '🎯 Recruit' : '❌ Not Enough Gold'}
                </button>
            </div>`;
        }

        html += `<button onclick="ActionMenu.showEspionageMenu(window._espGame, window._espTile)" style="width:100%; padding:8px; margin-top:4px;
            background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); border-radius:4px;
            color:var(--text-secondary); cursor:pointer; font-family:var(--font-body);">← Back</button>`;
        html += '</div>';

        game.ui.showCustomPanel('🎯 Recruit Spy', html);

        window._espGame = game;
        window._espTile = tile;
        window._recruitSpy = (spyId) => {
            const spy = candidates.find(c => c.id === spyId);
            if (!spy) return;
            const result = Espionage.recruitSpy(game.player, spy, game.world);
            if (result.success) {
                game.ui.showNotification('🕵️ Spy Recruited!', `${spy.name} has joined your network. (-${result.cost}g)`, 'success');
                game.ui.updateStats(game.player, game.world);
                ActionMenu.showEspionageMenu(game, tile);
            } else {
                game.ui.showNotification('❌ Recruitment Failed', result.reason, 'error');
            }
        };
    },

    /**
     * Show spy roster and management
     */
    showManageSpiesMenu(game, tile) {
        if (typeof Espionage === 'undefined') return;
        Espionage.initPlayer(game.player);

        const spies = game.player.espionage.spies;
        const spySkills = Espionage._getData()?.spySkills || {};
        const traits = Espionage._getSpyTraits();

        let html = '<div style="max-height:480px; overflow-y:auto;">';

        if (spies.length === 0) {
            html += '<p style="color:var(--text-secondary); text-align:center; padding:20px;">No spies recruited yet. Visit a city tavern to recruit agents.</p>';
        }

        for (const spy of spies) {
            const levelTitle = Espionage.getSpyLevelTitle(spy.level);
            const config = Espionage._getConfig();
            const xpNeeded = spy.level * config.levelUpThreshold;
            const xpPct = Math.min(100, Math.floor((spy.experience / xpNeeded) * 100));

            const statusColors = { idle: '#2ecc71', on_mission: '#3498db', captured: '#e74c3c', dead: '#666' };
            const statusLabels = { idle: '✅ Idle', on_mission: '📋 On Mission', captured: '🔒 Captured', dead: '💀 Dead' };

            const traitLabels = (spy.traits || []).map(tid => {
                const t = traits.find(tr => tr.id === tid);
                return t ? `<span title="${t.description}" style="cursor:help;">${t.icon} ${t.name}</span>` : tid;
            }).join(', ');

            // Find active mission if on one
            let missionInfo = '';
            if (spy.status === 'on_mission') {
                const mission = game.player.espionage.activeMissions.find(m => m.spyId === spy.id);
                if (mission) {
                    const mDef = Espionage._getMissions()[mission.type];
                    const pct = Math.floor((mission.progress / mission.duration) * 100);
                    const kingdom = game.world.getKingdom(mission.targetKingdom);
                    missionInfo = `<div style="margin-top:6px; padding:6px; background:rgba(52,152,219,0.1); border-radius:3px; font-size:11px;">
                        ${mDef ? mDef.icon : '📋'} ${mDef ? mDef.name : mission.type} → ${kingdom ? kingdom.name : '?'}
                        <div style="margin-top:4px; background:#333; border-radius:2px; height:6px;">
                            <div style="width:${pct}%; background:#3498db; height:100%; border-radius:2px;"></div>
                        </div>
                        <span style="color:#3498db;">${pct}% (${mission.duration - mission.progress}d left)</span>
                    </div>`;
                }
            }

            html += `<div style="padding:12px; margin-bottom:10px; background:rgba(255,255,255,0.04);
                border-left:3px solid ${statusColors[spy.status] || '#666'}; border-radius:0 6px 6px 0;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                    <div>
                        <span style="font-weight:bold; font-size:14px; color:white;">${spy.name}</span>
                        <span style="font-size:11px; color:#9b59b6; margin-left:6px;">${levelTitle.icon} Lv${spy.level}</span>
                    </div>
                    <span style="font-size:11px; color:${statusColors[spy.status] || '#666'};">${statusLabels[spy.status] || spy.status}</span>
                </div>

                <div style="display:flex; gap:6px; margin-bottom:4px; flex-wrap:wrap;">
                    ${Object.entries(spy.skills).map(([k, v]) => {
                        const sk = spySkills[k] || {};
                        return `<span style="font-size:10px; padding:2px 6px; background:rgba(255,255,255,0.08); border-radius:3px; color:var(--text-secondary);">${sk.icon || '⬤'} ${v}</span>`;
                    }).join('')}
                </div>

                <div style="font-size:11px; color:var(--text-secondary);">Traits: ${traitLabels || 'None'}</div>
                <div style="font-size:11px; color:var(--text-secondary); margin-top:2px;">
                    ❤️ Loyalty: <span style="color:${spy.loyalty > 50 ? '#2ecc71' : spy.loyalty > 25 ? '#f39c12' : '#e74c3c'};">${Math.floor(spy.loyalty)}%</span>
                    &nbsp; 💰 ${spy.upkeep}g/day &nbsp; ⭐ ${spy.missionsCompleted} missions
                </div>

                <!-- XP Bar -->
                <div style="margin-top:4px; font-size:10px; color:var(--text-secondary);">
                    XP: ${spy.experience}/${xpNeeded}
                    <div style="background:#333; border-radius:2px; height:4px; margin-top:2px;">
                        <div style="width:${xpPct}%; background:#9b59b6; height:100%; border-radius:2px;"></div>
                    </div>
                </div>

                ${missionInfo}

                <div style="display:flex; gap:6px; margin-top:8px;">
                    ${spy.status === 'idle' ? `
                        <button onclick="window._assignSpyMission(${spy.id})" style="flex:1; padding:6px; background:rgba(52,152,219,0.2); border:1px solid rgba(52,152,219,0.4); border-radius:3px; color:#3498db; cursor:pointer; font-size:11px; font-family:var(--font-body);">📋 Assign Mission</button>
                        <button onclick="window._dismissSpy(${spy.id})" style="padding:6px 10px; background:rgba(231,76,60,0.15); border:1px solid rgba(231,76,60,0.3); border-radius:3px; color:#e74c3c; cursor:pointer; font-size:11px; font-family:var(--font-body);">🗑️</button>
                    ` : spy.status === 'on_mission' ? `
                        <button onclick="window._recallSpy(${spy.id})" style="flex:1; padding:6px; background:rgba(241,196,15,0.15); border:1px solid rgba(241,196,15,0.3); border-radius:3px; color:#f1c40f; cursor:pointer; font-size:11px; font-family:var(--font-body);">↩️ Recall Spy</button>
                    ` : ''}
                </div>
            </div>`;
        }

        html += `<button onclick="ActionMenu.showEspionageMenu(window._espGame, window._espTile)" style="width:100%; padding:8px; margin-top:4px;
            background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); border-radius:4px;
            color:var(--text-secondary); cursor:pointer; font-family:var(--font-body);">← Back</button>`;
        html += '</div>';

        game.ui.showCustomPanel('📜 Spy Roster', html);

        window._espGame = game;
        window._espTile = tile;

        window._assignSpyMission = (spyId) => {
            ActionMenu._showAssignMissionForSpy(game, tile, spyId);
        };

        window._dismissSpy = (spyId) => {
            const result = Espionage.dismissSpy(game.player, spyId);
            if (result.success) {
                game.ui.showNotification('🕵️ Spy Dismissed', `${result.spy.name} has been released from service.`, 'info');
                ActionMenu.showManageSpiesMenu(game, tile);
            } else {
                game.ui.showNotification('❌ Cannot Dismiss', result.reason, 'error');
            }
        };

        window._recallSpy = (spyId) => {
            const result = Espionage.recallSpy(game.player, spyId);
            if (result.success) {
                game.ui.showNotification('↩️ Spy Recalled', `${result.spy.name} has been recalled. Loyalty: -5.`, 'warning');
                ActionMenu.showManageSpiesMenu(game, tile);
            } else {
                game.ui.showNotification('❌ Cannot Recall', result.reason, 'error');
            }
        };
    },

    /**
     * Show mission assignment — select a spy first
     */
    _showAssignMissionMenu(game, tile) {
        Espionage.initPlayer(game.player);
        const idleSpies = game.player.espionage.spies.filter(s => s.status === 'idle');

        let html = '<div style="max-height:450px; overflow-y:auto;">';
        html += '<p style="font-size:12px; color:var(--text-secondary); margin-top:0; margin-bottom:12px;">Select an agent to send on a mission.</p>';

        for (const spy of idleSpies) {
            const levelTitle = Espionage.getSpyLevelTitle(spy.level);
            html += `<button onclick="window._selectSpyForMission(${spy.id})"
                style="display:flex; align-items:center; gap:10px; width:100%;
                    padding:12px; margin-bottom:8px;
                    background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1);
                    border-radius:4px; cursor:pointer; text-align:left; color:white;
                    font-family:var(--font-body); transition:all 0.2s;"
                onmouseover="this.style.background='rgba(155,89,182,0.15)'; this.style.borderColor='#9b59b6'"
                onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.borderColor='rgba(255,255,255,0.1)'">
                <span style="font-size:22px;">🕵️</span>
                <div style="flex:1;">
                    <div style="font-weight:bold; font-size:13px;">${spy.name}</div>
                    <div style="font-size:11px; color:var(--text-secondary);">${levelTitle.icon} Level ${spy.level} • ❤️ ${Math.floor(spy.loyalty)}%</div>
                </div>
            </button>`;
        }

        html += `<button onclick="ActionMenu.showEspionageMenu(window._espGame, window._espTile)" style="width:100%; padding:8px; margin-top:4px;
            background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); border-radius:4px;
            color:var(--text-secondary); cursor:pointer; font-family:var(--font-body);">← Back</button>`;
        html += '</div>';

        game.ui.showCustomPanel('📋 Select Agent', html);

        window._espGame = game;
        window._espTile = tile;
        window._selectSpyForMission = (spyId) => {
            ActionMenu._showAssignMissionForSpy(game, tile, spyId);
        };
    },

    /**
     * Show available missions for a specific spy
     */
    _showAssignMissionForSpy(game, tile, spyId) {
        const spy = Espionage.getSpyById(game.player, spyId);
        if (!spy) return;

        const missions = Espionage.getAvailableMissions(spy);

        let html = '<div style="max-height:480px; overflow-y:auto;">';
        html += `<p style="font-size:12px; color:var(--text-secondary); margin-top:0; margin-bottom:12px;">Assign <strong style="color:white;">${spy.name}</strong> (Level ${spy.level}) to a mission.</p>`;

        for (const mission of missions) {
            const locked = !mission.unlocked;
            html += `<button onclick="${locked ? '' : `window._selectMissionTarget('${mission.id}', ${spyId})`}"
                ${locked ? 'disabled' : ''}
                style="display:flex; align-items:center; gap:10px; width:100%;
                    padding:12px; margin-bottom:8px;
                    background:rgba(255,255,255,0.05); border:1px solid ${locked ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.1)'};
                    border-radius:4px; cursor:${locked ? 'default' : 'pointer'};
                    text-align:left; color:${locked ? '#666' : 'white'};
                    font-family:var(--font-body); transition:all 0.2s;"
                ${locked ? '' : `onmouseover="this.style.background='rgba(155,89,182,0.15)'; this.style.borderColor='#9b59b6'"
                onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.borderColor='rgba(255,255,255,0.1)'"`}>
                <span style="font-size:22px;">${locked ? '🔒' : mission.icon}</span>
                <div style="flex:1;">
                    <div style="font-weight:bold; font-size:13px;">${mission.name}</div>
                    <div style="font-size:11px; color:var(--text-secondary);">${locked ? mission.lockReason : mission.description}</div>
                    ${!locked ? `<div style="font-size:10px; color:var(--text-secondary); margin-top:2px;">
                        ⏱️ ${mission.baseDuration}d • 💰 ${mission.goldCost}g • ⚡ ${mission.apCost} AP • ⚠️ ${Math.floor((mission.failChance || 0) * 100)}% fail
                    </div>` : ''}
                </div>
            </button>`;
        }

        html += `<button onclick="ActionMenu.showManageSpiesMenu(window._espGame, window._espTile)" style="width:100%; padding:8px; margin-top:4px;
            background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); border-radius:4px;
            color:var(--text-secondary); cursor:pointer; font-family:var(--font-body);">← Back to Roster</button>`;
        html += '</div>';

        game.ui.showCustomPanel(`📋 Missions for ${spy.name}`, html);

        window._espGame = game;
        window._espTile = tile;
        window._selectMissionTarget = (missionType, sid) => {
            ActionMenu._showMissionTargetSelect(game, tile, sid, missionType);
        };
    },

    /**
     * Show target kingdom selection for a mission
     */
    _showMissionTargetSelect(game, tile, spyId, missionType) {
        const targets = Espionage.getTargetKingdoms(game.player, game.world, missionType);
        const mDef = Espionage._getMissions()[missionType];

        if (targets.length === 0) {
            game.ui.showNotification('❌ No Targets', 'No valid target kingdoms found for this mission.', 'error');
            return;
        }

        let html = '<div style="max-height:420px; overflow-y:auto;">';
        html += `<p style="font-size:12px; color:var(--text-secondary); margin-top:0; margin-bottom:12px;">Select a target for <strong style="color:white;">${mDef ? mDef.name : missionType}</strong>.</p>`;

        if (mDef && mDef.consequences) {
            html += `<div style="padding:6px; margin-bottom:10px; background:rgba(231,76,60,0.1); border:1px solid rgba(231,76,60,0.2); border-radius:4px; font-size:11px; color:#e74c3c;">
                ⚠️ Warning: ${mDef.consequences.diplomaticPenalty ? `Diplomatic penalty: ${mDef.consequences.diplomaticPenalty}` : ''} ${mDef.consequences.warChanceIncrease ? `War risk: +${Math.floor(mDef.consequences.warChanceIncrease * 100)}%` : ''} ${mDef.consequences.karmaPenalty ? `Karma: ${mDef.consequences.karmaPenalty}` : ''}
            </div>`;
        }

        for (const target of targets) {
            html += `<button onclick="window._confirmMission('${missionType}', ${spyId}, '${target.id}')"
                style="display:flex; align-items:center; gap:10px; width:100%;
                    padding:12px; margin-bottom:8px;
                    background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1);
                    border-radius:4px; cursor:pointer; text-align:left; color:white;
                    font-family:var(--font-body); transition:all 0.2s;"
                onmouseover="this.style.background='rgba(155,89,182,0.15)'; this.style.borderColor='#9b59b6'"
                onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.borderColor='rgba(255,255,255,0.1)'">
                <span style="font-size:22px; width:28px; height:28px; border-radius:50%; background:${target.color || '#555'}; display:flex; align-items:center; justify-content:center;">👑</span>
                <div style="flex:1;">
                    <div style="font-weight:bold; font-size:13px;">${target.name}</div>
                    <div style="font-size:11px; color:var(--text-secondary);">⚔️ Military: ${target.military} • 💰 Treasury: ${target.treasury} • 🗺️ Territory: ${target.territory}</div>
                </div>
            </button>`;
        }

        html += `<button onclick="ActionMenu._showAssignMissionForSpy(window._espGame, window._espTile, ${spyId})" style="width:100%; padding:8px; margin-top:4px;
            background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); border-radius:4px;
            color:var(--text-secondary); cursor:pointer; font-family:var(--font-body);">← Back to Missions</button>`;
        html += '</div>';

        game.ui.showCustomPanel(`🎯 Select Target`, html);

        window._espGame = game;
        window._espTile = tile;
        window._confirmMission = (mt, sid, targetId) => {
            // Check AP cost
            const missionDef = Espionage._getMissions()[mt];
            const apCost = missionDef ? missionDef.apCost || 3 : 3;
            if ((game.player.actionPoints || 0) < apCost) {
                game.ui.showNotification('⚡ Not Enough AP', `This mission requires ${apCost} AP but you only have ${game.player.actionPoints || 0}.`, 'error');
                return;
            }
            game.player.actionPoints -= apCost;

            const result = Espionage.assignMission(game.player, sid, mt, targetId, game.world);
            if (result.success) {
                const targetK = game.world.getKingdom(targetId);
                game.ui.showNotification('📋 Mission Assigned',
                    `${result.spy.name} has been sent to ${targetK ? targetK.name : 'the target'}. (-${result.cost}g, ${result.mission.duration}d)`, 'success');
                game.ui.updateStats(game.player, game.world);
                ActionMenu.showEspionageMenu(game, tile);
            } else {
                game.player.actionPoints += apCost; // Refund AP
                game.ui.showNotification('❌ Mission Failed', result.reason, 'error');
            }
        };
    },

    /**
     * Show active missions with progress
     */
    _showActiveMissionsMenu(game, tile) {
        Espionage.initPlayer(game.player);
        const missions = game.player.espionage.activeMissions;

        let html = '<div style="max-height:450px; overflow-y:auto;">';
        html += '<p style="font-size:12px; color:var(--text-secondary); margin-top:0; margin-bottom:12px;">Active covert operations in progress.</p>';

        if (missions.length === 0) {
            html += '<p style="color:var(--text-secondary); text-align:center; padding:20px;">No active missions.</p>';
        }

        for (const mission of missions) {
            const spy = Espionage.getSpyById(game.player, mission.spyId);
            const mDef = Espionage._getMissions()[mission.type];
            const kingdom = game.world.getKingdom(mission.targetKingdom);
            const pct = Math.floor((mission.progress / mission.duration) * 100);
            const daysLeft = mission.duration - mission.progress;

            html += `<div style="padding:12px; margin-bottom:10px; background:rgba(255,255,255,0.04);
                border-left:3px solid #3498db; border-radius:0 6px 6px 0;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                    <span style="font-weight:bold; font-size:13px; color:white;">
                        ${mDef ? mDef.icon : '📋'} ${mDef ? mDef.name : mission.type}
                    </span>
                    <span style="font-size:11px; color:#3498db;">${daysLeft}d remaining</span>
                </div>
                <div style="font-size:12px; color:var(--text-secondary); margin-bottom:6px;">
                    🕵️ ${spy ? spy.name : 'Unknown'} → 👑 ${kingdom ? kingdom.name : 'Unknown'}
                </div>
                <div style="background:#333; border-radius:3px; height:8px; margin-bottom:4px;">
                    <div style="width:${pct}%; background:linear-gradient(90deg, #9b59b6, #3498db); height:100%; border-radius:3px; transition:width 0.3s;"></div>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:10px; color:var(--text-secondary);">
                    <span>${pct}% complete</span>
                    <span>Difficulty: ${Math.floor(mission.difficulty * 100)}%</span>
                </div>
            </div>`;
        }

        html += `<button onclick="ActionMenu.showEspionageMenu(window._espGame, window._espTile)" style="width:100%; padding:8px; margin-top:4px;
            background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); border-radius:4px;
            color:var(--text-secondary); cursor:pointer; font-family:var(--font-body);">← Back</button>`;
        html += '</div>';

        game.ui.showCustomPanel('⏳ Active Missions', html);

        window._espGame = game;
        window._espTile = tile;
    },
});
