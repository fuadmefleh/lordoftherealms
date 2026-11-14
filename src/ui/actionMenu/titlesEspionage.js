// ActionMenu — titlesEspionage methods (split from the original monolith).
import { ActionMenu } from './_ref.js';
import { startTaxRound } from './dutyScenes.js';
import { RealmIntel } from '../../systems/realmIntel.js';
import { PlayerActions, PlayerEconomy, Trading, PlayerMilitary, Hex, Utils, Banking, MarketDynamics, Taxation, Technology, Titles, Quests, Terrain, Kingdom, NPCLords, Peoples, LegendaryArtifacts, BountyHunting, Religion, Espionage, Infrastructure, Tavern, Ships, Housing, Cartography, Colonization, Relationships, Councils, SaveLoad, Economy, DataLoader } from './_imports.js';
import { lede, chips, purse, sectionHead, kv, card, actRow, rowList, price, BTN_GOLD, BTN_PLAIN, BTN_DARK, BTN_RED, BTN_OFF } from './uiKit.js';

// The action menu's voice (ui/actionMenu/uiKit.js): muted notes, and the one
// full-width button a result panel ends on
const MUTED = 'font-size:11px; color:#9d937c;';
const WIDE = 'display:block; width:100%; padding:8px 12px; margin:10px 0 0; font-size:13px;';

/** "← Back" to the Espionage Network (the spy panels' shared footer). */
function _espBack() {
    return `<button onclick="ActionMenu.showEspionageMenu(window._espGame, window._espTile)" style="${BTN_PLAIN}${WIDE}">← Back</button>`;
}

/** A thin progress bar, in spans so it can sit inside a row's text. */
function _bar(pct, color) {
    return `<span style="display:block; height:5px; background:rgba(255,255,255,0.06); border-radius:3px; overflow:hidden; margin:3px 0;"><span style="display:block; width:${Math.max(0, Math.min(100, pct))}%; height:100%; background:${color};"></span></span>`;
}

/** A spy's skills as small tags (names too when `named`). */
function _skillChips(skills, spySkills, named) {
    return `<span style="display:flex; gap:4px; flex-wrap:wrap; margin:3px 0;">${Object.entries(skills || {}).map(([k, v]) => {
        const sk = spySkills[k] || {};
        return `<span style="font-size:10px; padding:1px 6px; border:1px solid rgba(245,197,66,0.14); border-radius:9px; color:#cbbf9f;">${sk.icon || '⬤'} ${named ? `${sk.name || k}: ` : ''}${v}</span>`;
    }).join('')}</span>`;
}

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

        // The action menu's voice (ui/actionMenu/uiKit.js): one row an office —
        // pay and duty at the right; the ones you don't yet qualify for greyed with why
        let html = lede(`🏅 Seek appointment to a political office in <b style="color:#ffcf6a;">${kingdom?.name || 'the realm'}</b>.`);

        if (available.length === 0) {
            html += `<div style="${MUTED}">No titles available. Increase your reputation and renown.</div>`;
        } else {
            html += rowList(available.map(t => {
                const reqs = t.requirements || {};
                const reqList = [];
                if (reqs.reputation) reqList.push(`Rep: ${reqs.reputation}`);
                if (reqs.renown) reqList.push(`Renown: ${reqs.renown}`);
                if (reqs.skills) for (const [s, v] of Object.entries(reqs.skills)) reqList.push(`${s}: ${v}`);
                if (reqs.attributes) for (const [a, v] of Object.entries(reqs.attributes)) reqList.push(`${a}: ${v}`);
                const ok = t.meetsRequirements;
                return {
                    icon: t.icon || '🏅',
                    name: `${t.name} <span style="font-size:10px; font-weight:400; color:#9d937c;">Rank ${t.rank}</span>`,
                    desc: t.description,
                    note: ok
                        ? `<span style="color:#8fd18a;">✓ Qualified · Accept Appointment</span> <span style="color:#9d937c;">· 📋 ${t.duties.type.replace(/_/g, ' ')}</span>`
                        : `<span style="color:#c98a6a;">✗ ${t.reason}</span><br><span style="color:#9d937c;">📋 ${t.duties.type.replace(/_/g, ' ')} · Requires: ${reqList.join(' · ')}</span>`,
                    act: ok ? '_appointTitle' : '', args: ok ? [t.id] : null, off: !ok,
                    side: `💰 ${t.salary} gold/day`, tone: 'gold',
                };
            }), 'Offices');
        }

        html += `<button data-am-act="closePanel" style="${BTN_PLAIN}${WIDE}">Close</button>`;

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

        let html = sectionHead('Title Bestowed!');
        html += lede(`You have been appointed <b style="color:#ffcf6a;">${title.name}</b> of <b>${kingdom?.name || 'the realm'}</b>.`);
        html += card(
            kv('💰 Daily salary', `<span style="color:#8fd18a;">${title.salary} gold</span>`)
            + kv('📋 Duty', title.duties.type.replace(/_/g, ' '))
            + `<div style="${MUTED} margin-top:6px;">Complete your duties within ${title.duties.deadlineDays} days or face penalties!</div>`,
            { icon: title.icon || '🏅', title: title.name, tone: 'gold' });
        html += `<button data-am-act="closePanelAndRefresh" style="${BTN_GOLD}${WIDE}">Accept Your Duties</button>`;

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
        const barColor = progress.passed ? '#8fd18a' : pct >= 50 ? '#f0b35a' : '#e0846a';

        let html = lede(`${title.icon || '🏅'} <b style="color:#ffcf6a;">${title.name}</b> of ${kingdom?.name || 'the realm'}`);
        html += chips([
            { icon: '⏰', label: 'Days Left', value: `<span style="color:${progress.daysLeft <= 5 ? '#e0846a' : 'inherit'};">${progress.daysLeft}</span>` },
            { icon: '💰', label: 'Daily Salary', value: `${title.salary} gold`, cls: 'gold' },
            ['📅', 'Appointed', `Day ${player.titleAppointedDay || '?'}`],
        ]);

        html += sectionHead('Duty Progress');
        html += `<div style="margin:4px 0 10px;">
                <div style="display:flex; justify-content:space-between; font-size:12px; color:#cbbf9f;">
                    <span>${progress.progress}</span>
                    <span>${pct}%</span>
                </div>
                <div style="width:100%; height:6px; background:rgba(255,255,255,0.06); border-radius:3px; margin-top:4px; overflow:hidden;">
                    <div style="width:${pct}%; height:100%; background:${barColor}; border-radius:3px; transition:width 0.3s;"></div>
                </div>
            </div>`;

        // Show active fugitive info for jailer
        if (player.currentTitle === 'jailer' && player.activeFugitive) {
            const fug = player.activeFugitive;
            html += sectionHead('Active Bounty');
            html += card(`<div style="font-size:11px; color:#cbbf9f;">${fug.crime || 'Wanted for crimes'}</div>
                    <div style="${MUTED} margin-top:4px;">📍 Last seen: (${fug.q}, ${fug.r}) · ⏰ ${fug.daysRemaining} days left · ⚔️ Difficulty: ${fug.difficulty}</div>`,
            { icon: '🔍', title: fug.name, tone: 'warn' });
        }

        // Perks
        html += sectionHead('Perks');
        for (const [key, val] of Object.entries(title.perks)) {
            const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
            const display = typeof val === 'object' ? `${val.min}-${val.max}` : val;
            html += kv(label, display);
        }

        html += rowList([{ icon: '🚪', name: 'Resign Office', desc: 'Give up the title, its duties and its perks', tone: 'bad', act: '_resignTitle' }]);

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
        // How to collect is a choice: fair, squeeze, spare the poor, skim (ui/actionMenu/dutyScenes.js)
        const state = startTaxRound(game, tile);
        if (!state) {
            const res = Titles.collectTaxAtSettlement(player, tile, game.world);
            game.ui.showNotification('❌ Cannot Collect', res.reason || 'No taxes can be collected here.', 'error');
            return;
        }
        ActionMenu.showScene(game, 'tax_round', state);
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
        let html = sectionHead('Bounty Assigned!');
        html += lede('Travel to the fugitive\'s location and capture them before time runs out!');
        html += card(`<div style="font-size:12px; color:#e0846a; margin-bottom:3px;">${fug.crime || 'Wanted for crimes against the realm'}</div>
                <div style="font-size:12px; color:#cbbf9f;">${fug.description || ''}</div>
                ${chips([['⚔️', 'Difficulty', fug.difficulty], ['⏰', '', `${fug.daysRemaining} days`], ['📍', 'Last seen', `(${fug.q}, ${fug.r})`]])}
                <div style="font-size:12px; color:#ffcf6a;">💰 Warrant pays ${fug.pay || '?'} gold on delivery — or take them into your service instead.</div>`,
        { icon: '🔍', title: fug.name, tone: 'warn' });
        html += `<button data-am-act="closePanelAndRefresh" style="${BTN_GOLD}${WIDE}">Begin the Hunt</button>`;

        game.ui.showCustomPanel('🔒 Jailer\'s Bounty', html);
    },

    /**
     * Jailer — attempt to capture fugitive
     */
    doCaptureFugitive(game, tile) {
        const player = game.player;
        if (typeof Titles === 'undefined') return;

        // Taken as a bounty hunter takes a quarry (systems/bountyHunting.js), then judged
        const result = Titles.captureFugitive(player, game.world);
        if (result.success) {
            game.ui.showNotification('⛓️ Fugitive Captured!', `${result.fugitive.name} is in your custody. Turn them in, or take them into your service.`, 'success');
            game.ui.updateStats(player, game.world);
            ActionMenu._showCapturedBountyDecision(game, result.bounty);
            return;
        }
        if (!result.escaped) {
            game.ui.showNotification('❌ Cannot Capture', result.reason, 'error');
            return;
        }
        const html = sectionHead('💨 Fugitive Escaped!')
            + lede(result.reason)
            + `<button data-am-act="closePanelAndRefresh" style="${BTN_GOLD}${WIDE}">Continue Pursuit</button>`;
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

        let html = sectionHead('✨ Settlement Blessed!');
        html += lede(`You have given a holy blessing to <b>${result.settlement}</b>.`);
        html += chips([
            { icon: '☯', label: 'Karma', value: '+2', cls: 'gold' },
            { icon: '⭐', label: 'Renown', value: '+1', cls: 'gold' },
            ['', 'Settlements blessed:', result.count],
        ]);
        html += `<div style="font-size:12px; color:#8fd18a;">🙂 Mood in ${result.settlement} +${result.happiness || 0}; fewer fall sick there for ${result.days || 0} days</div>`;
        html += `<button data-am-act="closePanelAndRefresh" style="${BTN_GOLD}${WIDE}">Continue</button>`;

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

        let html = sectionHead('👑 Council Held!');
        html += lede(`You convened the royal council at <b>${result.settlement}</b>.`);
        html += chips([
            { icon: '⭐', label: 'Renown', value: '+5', cls: 'gold' },
            { icon: '📈', label: 'Reputation', value: '+3', cls: 'gold' },
            councilResult && councilResult.success ? ['🗳️', 'Session active until day', councilResult.sessionUntilDay] : null,
        ]);
        html += `<div style="${MUTED} font-style:italic;">The lords and ladies of the realm attended your council. Your authority is recognized.</div>`;
        if (typeof Councils !== 'undefined') {
            html += `<button data-am-act="openTileMenu" data-am-args='["showCouncilMenu"]' style="${BTN_GOLD}${WIDE}">Open Council Chamber</button>`;
        }
        html += `<button data-am-act="closePanelAndRefresh" style="${BTN_PLAIN}${WIDE}">Continue</button>`;

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
            game.ui.showCustomPanel('🏛️ Council Chamber',
                lede('You need political authority to govern the realm.')
                + card('<div style="color:#e0846a;">Required office: <strong>King, Chancellor, or Treasurer</strong> while pledged to a kingdom.</div>', { tone: 'bad' }));
            return;
        }

        const day = game.world.day;
        const canConveneIn = Math.max(0, (summary.lastConveneDay + Councils.CONVENE_COOLDOWN_DAYS) - day);
        const sessionText = summary.sessionActive
            ? `In session until day ${summary.activeSessionUntilDay}`
            : 'No active session';

        let html = chips([
            { icon: '👍', label: 'Approval', value: `${summary.approval}%`, cls: 'gold' },
            ['🏛️', 'Session', sessionText],
            ['⚔️', 'War Mandate', summary.warMandateUntilDay >= day ? `Active to day ${summary.warMandateUntilDay}` : 'None'],
        ]);

        html += rowList([{
            icon: '🏛️', name: 'Convene Council', desc: 'Call the lords to session: approval rises',
            act: 'councilConvene', off: canConveneIn > 0, why: `The lords can be called again in ${canConveneIn} day${canConveneIn === 1 ? '' : 's'}`,
        }]);

        // A card a faction: its support, then what you can do with it (a row each, never a button in a row)
        html += sectionHead('Factions');
        for (const faction of summary.factions) {
            const bar = `<div style="height:5px; background:rgba(255,255,255,0.06); border-radius:3px; overflow:hidden; margin:2px 0 4px;"><div style="height:100%; width:${Math.max(0, Math.min(100, faction.support))}%; background:${faction.support >= 55 ? '#8fd18a' : faction.support >= 40 ? '#f0b35a' : '#e0846a'};"></div></div>`;
            const status = faction.suppressed ? `<div style="font-size:11px; color:#e0846a;">Suppressed until day ${faction.suppressedUntilDay}</div>` : '';
            html += card(bar + status + rowList([
                { icon: '🤝', name: 'Negotiate', desc: 'Their support rises; approval +2', side: price(80, (player.gold || 0) >= 80), off: !summary.sessionActive, why: 'Only while the council sits', act: 'councilManageFaction', args: [faction.id, 'manage'] },
                { icon: '🛡️', name: 'Suppress', desc: 'Their support falls and they are silenced 10 days; approval −5', tone: 'bad', off: !summary.sessionActive, why: 'Only while the council sits', act: 'councilManageFaction', args: [faction.id, 'suppress'] },
            ]), {
                icon: faction.icon, title: faction.name,
                side: `${faction.support}% ${faction.trend === 'rising' ? '▲' : faction.trend === 'falling' ? '▼' : '•'} · influence ${faction.influence}`,
            });
        }

        html += sectionHead('Votes & Decrees');

        if (typeof Taxation !== 'undefined' && Taxation.TAX_RATES) {
            const currentPolicy = Taxation.TAX_RATES[(player.taxRate || 'moderate').toUpperCase()] || Taxation.TAX_RATES.MODERATE;
            const higherRates = Object.values(Taxation.TAX_RATES).filter(rate => rate.rate > currentPolicy.rate).sort((a, b) => a.rate - b.rate);
            html += `<div style="color:#cbbf9f; font-size:12px; margin-bottom:2px;">Tax Increase Votes</div>`;
            if (higherRates.length === 0) {
                html += `<div style="${MUTED} margin-bottom:8px;">Tax rate is already at maximum.</div>`;
            } else {
                html += rowList(higherRates.map(rate => ({
                    icon: '🗳️', name: `Vote for ${rate.name}`, act: 'councilVoteTax', args: [rate.id],
                })));
            }
            if (summary.taxIncreaseApproval && summary.taxIncreaseApproval.expiresDay >= day) {
                html += `<div style="font-size:11px; color:#8fd18a; margin:4px 0 8px;">Approved tax increase up to <strong>${summary.taxIncreaseApproval.rateId}</strong> until day ${summary.taxIncreaseApproval.expiresDay}.</div>`;
            }
        }

        const targets = Councils.getAvailableWarTargets(player, game.world);
        html += `<div style="margin-top:6px; color:#cbbf9f; font-size:12px; margin-bottom:2px;">War Motions</div>`;
        if (!summary.canDeclareWar) {
            html += `<div style="${MUTED}">Only King or Chancellor can initiate war votes.</div>`;
        } else if (!targets.length) {
            html += `<div style="${MUTED}">No valid war targets at this time.</div>`;
        } else {
            // A mandate in hand: declare; else put it to the vote first
            html += rowList(targets.map(target => (Councils.hasWarMandate(player, game.world, target.id)
                ? { icon: '⚔️', name: `Declare war on ${target.name}`, desc: 'The council has granted a war mandate', tone: 'bad', act: 'councilDeclareWar', args: [target.id] }
                : { icon: '🗳️', name: `Put war on ${target.name} to the vote`, desc: 'A war mandate lets you declare it', act: 'councilVoteWar', args: [target.id] })));
        }

        if (summary.history && summary.history.length) {
            html += sectionHead('Recent Proceedings');
            for (const item of summary.history.slice(0, 5)) {
                html += `<div style="font-size:11px; color:${item.passed ? '#8fd18a' : '#e0846a'}; margin-bottom:4px;">Day ${item.day}: ${item.text}</div>`;
            }
        }

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
        if (menu && typeof menu._amxCleanup === 'function') menu._amxCleanup();
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

        let html = lede('Your shadow network operates from the tavern back rooms. Recruit agents and assign them to covert missions.');

        // ── Summary Bar ──
        html += chips([
            { icon: '🕵️', label: '', value: `${summary.totalSpies}/${config.maxSpies} Spies`, cls: 'gold' },
            ['📋', '', `${summary.activeMissions}/${config.maxActiveMissions} Missions`],
            ['💰', '', `${summary.dailyUpkeep}g/day`],
            ['✅', '', `${summary.completedMissions} Done`],
        ]);

        // ── Active Rebellions ──
        if (game.player.espionage.rebellions.length > 0) {
            html += card(game.player.espionage.rebellions.map(reb => {
                const kingdom = game.world.getKingdom(reb.kingdomId);
                return `<div style="font-size:11px; color:#cbbf9f;">${kingdom ? kingdom.name : reb.kingdomId} — ${reb.severity} (${reb.daysRemaining || reb.duration}d remaining)</div>`;
            }).join(''), { icon: '🔥', title: 'Active Rebellions', tone: 'bad' });
        }

        // ── Menu Buttons ──
        const menuOptions = [
            { id: 'recruit', icon: '🎯', label: 'Recruit New Spy', desc: `Hire an agent (${config.baseRecruitCost}+ gold)`, available: summary.totalSpies < config.maxSpies, why: `Your network is full (${summary.totalSpies}/${config.maxSpies})` },
            { id: 'roster', icon: '📜', label: 'Spy Roster', desc: `View and manage your ${summary.totalSpies} agents`, available: summary.totalSpies > 0, why: 'No agents yet' },
            { id: 'assign', icon: '📋', label: 'Assign Mission', desc: `Send a spy on a covert operation`, available: summary.idleSpies > 0, why: 'No idle agent' },
            { id: 'missions', icon: '⏳', label: 'Active Missions', desc: `${summary.activeMissions} mission(s) in progress`, available: summary.activeMissions > 0, why: 'No mission in progress' },
        ];

        html += rowList(menuOptions.map(opt => ({
            icon: opt.icon, name: opt.label, desc: opt.desc,
            off: !opt.available, why: `${opt.desc} · ${opt.why}`,
            attrs: `onclick="window._espionageAction('${opt.id}')"`, side: opt.available ? '›' : '', tone: 'gold',
        })));
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

        let html = lede('Shadowy figures in the tavern are willing to work for you — for the right price.');
        html += chips([purse(game.player.gold)]);

        html += rowList(candidates.map(spy => {
            const levelTitle = Espionage.getSpyLevelTitle(spy.level);
            const traitLabels = (spy.traits || []).map(tid => {
                const t = traits.find(tr => tr.id === tid);
                return t ? `<span title="${t.description}" style="cursor:help;">${t.icon} ${t.name}</span>` : tid;
            }).join(', ');
            const canPay = game.player.gold >= spy.recruitCost;
            return {
                icon: levelTitle.icon,
                name: `${spy.name} <span style="font-size:11px; font-weight:400; color:#b48ad8;">${levelTitle.title}</span>`,
                desc: `Traits: ${traitLabels || 'None'} · 🔄 Upkeep: ${spy.upkeep}g/day · ❤️ Loyalty: ${Math.floor(spy.loyalty)}%`,
                note: _skillChips(spy.skills, spySkills, true),
                off: !canPay, why: `❌ Not Enough Gold · Traits: ${traitLabels || 'None'} · 🔄 Upkeep: ${spy.upkeep}g/day · ❤️ Loyalty: ${Math.floor(spy.loyalty)}%`,
                attrs: `onclick="window._recruitSpy(${spy.id})"`,
                side: price(spy.recruitCost, canPay),
                title: canPay ? '🎯 Recruit' : '',
            };
        }), 'Candidates');

        html += _espBack();

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

        let html = '';

        if (spies.length === 0) {
            html += lede('No spies recruited yet. Visit a city tavern to recruit agents.');
        }

        for (const spy of spies) {
            const levelTitle = Espionage.getSpyLevelTitle(spy.level);
            const config = Espionage._getConfig();
            const xpNeeded = spy.level * config.levelUpThreshold;
            const xpPct = Math.min(100, Math.floor((spy.experience / xpNeeded) * 100));

            const statusColors = { idle: '#8fd18a', on_mission: '#7fb2e0', captured: '#e0846a', dead: '#8f8a7e' };
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
                    missionInfo = `<div style="margin-top:6px; font-size:11px; color:#cbbf9f;">
                        ${mDef ? mDef.icon : '📋'} ${mDef ? mDef.name : mission.type} → ${kingdom ? kingdom.name : '?'}
                        ${_bar(pct, '#7fb2e0')}
                        <span style="color:#7fb2e0;">${pct}% (${mission.duration - mission.progress}d left)</span>
                    </div>`;
                }
            }

            const body = `${_skillChips(spy.skills, spySkills, false)}
                <div style="${MUTED}">Traits: ${traitLabels || 'None'}</div>
                <div style="${MUTED} margin-top:2px;">
                    ❤️ Loyalty: <span style="color:${spy.loyalty > 50 ? '#8fd18a' : spy.loyalty > 25 ? '#f0b35a' : '#e0846a'};">${Math.floor(spy.loyalty)}%</span>
                    &nbsp; 💰 ${spy.upkeep}g/day &nbsp; ⭐ ${spy.missionsCompleted} missions
                </div>
                <div style="margin-top:4px; font-size:10px; color:#9d937c;">XP: ${spy.experience}/${xpNeeded}${_bar(xpPct, '#b48ad8')}</div>
                ${missionInfo}
                ${rowList(spy.status === 'idle' ? [
                    { icon: '📋', name: 'Assign a mission', desc: 'Choose the work and the realm', side: '›', attrs: `onclick="window._assignSpyMission(${spy.id})"` },
                    { icon: '🗑️', name: 'Dismiss', desc: 'Release them from your service', tone: 'bad', attrs: `onclick="window._dismissSpy(${spy.id})"` },
                ] : spy.status === 'on_mission' ? [
                    { icon: '↩️', name: 'Recall', desc: 'Abandon the mission and bring them home', attrs: `onclick="window._recallSpy(${spy.id})"` },
                ] : [])}`;
            html += card(body, {
                icon: levelTitle.icon,
                title: `${spy.name} <span style="font-size:11px; color:#b48ad8; font-family:var(--font-body);">Lv${spy.level}</span>`,
                side: `<span style="color:${statusColors[spy.status] || '#8f8a7e'};">${statusLabels[spy.status] || spy.status}</span>`,
            });
        }

        html += _espBack();

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

        let html = lede('Select an agent to send on a mission.');

        html += rowList(idleSpies.map(spy => {
            const levelTitle = Espionage.getSpyLevelTitle(spy.level);
            return {
                icon: '🕵️', name: spy.name,
                desc: `${levelTitle.icon} Level ${spy.level} • ❤️ ${Math.floor(spy.loyalty)}%`,
                attrs: `onclick="window._selectSpyForMission(${spy.id})"`, side: '›', tone: 'gold',
            };
        }), 'Idle agents');

        html += _espBack();

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

        let html = lede(`Assign <b>${spy.name}</b> (Level ${spy.level}) to a mission.`);
        html += chips([['⚡', 'AP', game.player.actionPoints || 0], purse(game.player.gold)]);

        html += rowList(missions.map(mission => {
            const locked = !mission.unlocked;
            return {
                icon: locked ? '🔒' : mission.icon,
                name: mission.name,
                desc: mission.description,
                note: locked ? '' : `⏱️ ${mission.baseDuration}d • ⚡ ${mission.apCost} AP • ⚠️ ${Math.floor((mission.failChance || 0) * 100)}% fail`,
                off: locked, why: mission.lockReason,
                attrs: `onclick="window._selectMissionTarget('${mission.id}', ${spyId})"`,
                side: locked ? '' : price(mission.goldCost, game.player.gold >= mission.goldCost),
            };
        }), 'Missions');

        html += `<button onclick="ActionMenu.showManageSpiesMenu(window._espGame, window._espTile)" style="${BTN_PLAIN}${WIDE}">← Back to Roster</button>`;

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

        let html = lede(`Select a target for <b>${mDef ? mDef.name : missionType}</b>.`);

        if (mDef && mDef.consequences) {
            html += card(`<div style="font-size:11px; color:#e0846a;">
                ⚠️ Warning: ${mDef.consequences.diplomaticPenalty ? `Diplomatic penalty: ${mDef.consequences.diplomaticPenalty}` : ''} ${mDef.consequences.warChanceIncrease ? `War risk: +${Math.floor(mDef.consequences.warChanceIncrease * 100)}%` : ''} ${mDef.consequences.karmaPenalty ? `Karma: ${mDef.consequences.karmaPenalty}` : ''}
            </div>`, { tone: 'bad' });
        }

        html += rowList(targets.map(target => {
            // What the spy goes to learn is not known before it goes (systems/realmIntel.js)
            const p = game.player;
            const knows = (cat) => typeof p.knowsAbout !== 'function' || p.knowsAbout(target.id, cat);
            const mil = RealmIntel.seen(p, game.world, target.id, 'military', 'military', target.military, knows('military'));
            const tre = RealmIntel.seen(p, game.world, target.id, 'books', 'treasury', target.treasury, knows('economy'));
            return {
                icon: `<span style="display:inline-flex; width:24px; height:24px; border-radius:50%; background:${target.color || '#555'}; align-items:center; justify-content:center; font-size:13px;">👑</span>`,
                name: target.name,
                desc: `⚔️ Military: ${mil.text} • 💰 Treasury: ${tre.text} • 🗺️ Territory: ${target.territory}`,
                attrs: `onclick="window._confirmMission('${missionType}', ${spyId}, '${target.id}')"`,
                side: '›', tone: 'gold',
            };
        }), 'Targets');

        html += `<button onclick="ActionMenu._showAssignMissionForSpy(window._espGame, window._espTile, ${spyId})" style="${BTN_PLAIN}${WIDE}">← Back to Missions</button>`;

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

        let html = lede('Active covert operations in progress.');

        if (missions.length === 0) {
            html += `<div style="${MUTED}">No active missions.</div>`;
        }

        html += rowList(missions.map(mission => {
            const spy = Espionage.getSpyById(game.player, mission.spyId);
            const mDef = Espionage._getMissions()[mission.type];
            const kingdom = game.world.getKingdom(mission.targetKingdom);
            const pct = Math.floor((mission.progress / mission.duration) * 100);
            const daysLeft = mission.duration - mission.progress;
            return {
                icon: mDef ? mDef.icon : '📋', name: mDef ? mDef.name : mission.type,
                desc: `🕵️ ${spy ? spy.name : 'Unknown'} → 👑 ${kingdom ? kingdom.name : 'Unknown'}`,
                note: `${_bar(pct, 'linear-gradient(90deg, #b48ad8, #7fb2e0)')}<span style="color:#9d937c;">${pct}% complete · Difficulty: ${Math.floor(mission.difficulty * 100)}%</span>`,
                side: `${daysLeft}d remaining`,
            };
        }));

        html += _espBack();

        game.ui.showCustomPanel('⏳ Active Missions', html);

        window._espGame = game;
        window._espTile = tile;
    },
});
