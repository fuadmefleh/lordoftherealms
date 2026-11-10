// ActionMenu — the Underworld panel, in four tabs:
//   🔪 Streets  — the town's gangs (systems/gangs.js): who runs which streets,
//                the watch's crackdown and who has bought its captain and
//                magistrate; joining a crew, its errands, rising in it,
//                challenging the boss, founding your own; each gang's books
//                (taken and paid by kind, last week and all time); and, as boss, the
//                cut, crew, lieutenants, the bought watch, dens, smuggling,
//                war and truce, the purse.
//   🗝️ Guild    — heat per realm, guild rank, jobs and heists (systems/underworld.js).
//   🧺 Market   — the fence, the black market, contraband here.
//   🧼 Coin     — dirty coin and laundering it through your fronts.
// Logic lives in the systems; this panel presents it.
import { ActionMenu } from './_ref.js';
import { Underworld } from '../../systems/underworld.js';
import { Gangs } from '../../systems/gangs.js';
import { BTN_GOLD, BTN_DIM, BTN_RED, CARD, panelTabs, esc } from './uiKit.js';

const LEVEL_COLOR = { clear: '#7fd07f', watched: '#e0b040', poster: '#e08040', warrant: '#e05050' };
const LEVEL_LABEL = { clear: 'Clear', watched: 'Watched', poster: 'Wanted posters', warrant: 'Warrant' };
const STATUS_COLOR = { illegal: '#e05050', tariff: '#e0b040', legal: '#7fd07f' };
const NOTE = 'font-size:11px; color:#aaa;';

const pct = v => `${Math.round(v * 100)}%`;
const label = id => String(id).replace(/_/g, ' ');

function heatBar(heat, level) {
    return `<div style="background:rgba(255,255,255,0.06); border-radius:3px; height:6px; overflow:hidden; margin-top:2px;">
        <div style="width:${Math.min(100, heat)}%; height:100%; background:${LEVEL_COLOR[level]};"></div></div>`;
}

function crackBar(v) {
    const c = v >= 60 ? '#e05050' : v >= 35 ? '#e0b040' : '#7fd07f';
    return `<div style="background:rgba(255,255,255,0.06); border-radius:3px; height:6px; overflow:hidden; margin-top:2px;">
        <div style="width:${Math.min(100, v)}%; height:100%; background:${c};"></div></div>`;
}

function btn(on, call, text, style = BTN_GOLD, title = '') {
    return on
        ? `<button onclick="${call}" style="${style}"${title ? ` title="${esc(title)}"` : ''}>${text}</button>`
        : `<button disabled style="${BTN_DIM}"${title ? ` title="${esc(title)}"` : ''}>${text}</button>`;
}

// ── 🔪 Streets ──────────────────────────────────────────

const g0 = v => `${Math.floor(v || 0)}g`;

/** A gang's books (Gangs.bookView): last week and all time, taken and paid, by kind. */
function booksHtml(b) {
    if (!b || !b.all) return '';
    const last = b.last || { took: 0, paid: 0, in: {}, out: {} };
    const weeks = Math.max(1, b.weeks);
    let html = `<div style="${NOTE}">📒 Last week took ${g0(last.took)}, paid out ${g0(last.paid)} · all time${b.weeks ? ` (${b.weeks} wk)` : ''} took ${g0(b.all.took)} (≈${g0(b.all.took / weeks)}/wk), paid ${g0(b.all.paid)} (≈${g0(b.all.paid / weeks)}/wk)</div>`;
    const rows = (dir) => {
        const labels = Gangs.BOOK_LABELS[dir];
        const kinds = Object.keys({ ...b.all[dir], ...((b.cur || {})[dir] || {}) }).sort((x, y) => (b.all[dir][y] || 0) - (b.all[dir][x] || 0));
        return kinds.map(k => `<tr><td>${esc(labels[k] || label(k))}</td><td style="text-align:right;">${g0(last[dir][k])}</td><td style="text-align:right;">${g0(b.all[dir][k])}</td></tr>`).join('');
    };
    const head = (t) => `<tr style="color:#ccc;"><th style="text-align:left;">${t}</th><th style="text-align:right;">last wk</th><th style="text-align:right;">all time</th></tr>`;
    const ins = rows('in');
    const outs = rows('out');
    if (ins || outs) {
        html += `<details style="font-size:11px; color:#bbb;"><summary style="cursor:pointer;">The books</summary><table style="width:100%; border-collapse:collapse;">`
            + `${ins ? head('Taken') + ins : ''}${outs ? head('Paid out') + outs : ''}</table>`
            + `${b.cur && (b.cur.took || b.cur.paid) ? `<div>This week so far: took ${g0(b.cur.took)}, paid ${g0(b.cur.paid)}.</div>` : ''}</details>`;
    }
    return html;
}

function streetsTab(game, tile) {
    const player = game.player;
    const world = game.world;
    const v = Gangs.view(player, world, tile);
    if (!v) return `<div style="${NOTE}">No gang works a place this small. The underworld lives in towns and cities.</div>`;
    const sum = Underworld.summary(player, world);
    let html = '';

    // The watch
    const w = v.watch;
    const own = (who) => {
        const g = v.gangs.find(x => x.id === w[who].bribedBy);
        return g ? `<span style="color:#e0b040;">on ${esc(g.name)}'s payroll</span>` : '<span style="color:#7fd07f;">honest, for now</span>';
    };
    html += `<div style="${CARD}"><div style="display:flex; justify-content:space-between;"><strong>🛡️ The watch</strong><span>Crackdown ${v.crackdown}</span></div>${crackBar(v.crackdown)}`;
    html += `<div style="${NOTE}">${esc(w.captain.name)}: ${own('captain')}. ${esc(w.magistrate.name)}: ${own('magistrate')}.</div>`;
    html += `<div style="${NOTE}">Crime here stirs the crackdown: it raids gangs that haven't bought the captain, searches harder at the gate and spoils your jobs. It cools week by week.</div></div>`;

    // The gangs
    html += '<h5 style="margin:10px 0 4px;">🔪 Who runs the streets</h5>';
    for (const g of v.gangs) {
        const mine = v.gang && v.gang.id === g.id;
        html += `<div style="${CARD}${mine ? ' border-color: var(--gold);' : ''}"><div style="display:flex; justify-content:space-between; gap:6px;"><strong>${esc(g.name)}</strong><span style="color:#ccc;">${pct(g.turf)} of the streets</span></div>`;
        const tags = [`boss ${g.bossIsYou ? '<span style="color:var(--gold);">you</span>' : esc(g.boss)}`, `${g.crew} crew`, `strength ${g.strength}`];
        if (g.dens) tags.push(`${g.dens} den${g.dens === 1 ? '' : 's'}`);
        if (g.smuggling) tags.push('runs contraband');
        if (g.wars) tags.push(`<span style="color:#e05050;">at war</span>`);
        if (g.ownsCaptain) tags.push('owns the captain');
        if (g.ownsMagistrate) tags.push('owns the magistrate');
        if (g.raids) tags.push(`raided ${g.raids}×`);
        html += `<div style="${NOTE}">${tags.join(' · ')}</div>`;
        html += booksHtml(g.books);
        if (!v.membership && !g.banned && !g.bossIsYou) {
            const can = sum.contactMet || sum.member;
            html += btn(can, `window._uw.gang('join','${g.id}')`, `Ask to run with them`, BTN_GOLD, can ? '' : 'Find a guild contact first (a barkeep, "special work")');
        }
        if (g.banned) html += `<div style="font-size:11px; color:#e05050;">They will kill you on sight.</div>`;
        if (v.boss && !mine) {
            if (g.atWarWithYou) html += btn(true, `window._uw.gang('truce','${g.id}')`, '🕊️ Offer a truce (tribute)');
            else if (g.truceUntil > (world.day || 0)) html += `<span style="${NOTE}">Truce until day ${g.truceUntil}.</span>`;
            else html += btn(true, `window._uw.gang('war','${g.id}')`, '⚔️ Go to war', BTN_RED);
        }
        html += '</div>';
    }
    if (!v.membership) {
        const F = Gangs.c('found', {});
        const fee = (Gangs.cfg().recruitFee || 25) * (F.crew || 4) + (F.seed || 200);
        html += `<div style="${CARD}"><strong>👥 A crew of your own</strong><div style="${NOTE}">Prowler or above in the guild: ${fee}g buys a purse and ${F.crew || 4} men. The biggest crew in town won't like it.</div>`;
        html += btn((player.gold || 0) >= fee, 'window._uw.gang(\'found\')', `Found a crew here (${fee}g)`) + '</div>';
    }

    // Your place in it
    if (v.gang) {
        const g = v.gang;
        html += `<h5 style="margin:10px 0 4px;">${v.rank.icon} You: ${v.rank.name} of ${esc(g.name)}</h5>`;
        if (!v.boss) {
            const nx = v.next ? `${v.membership.standing}/${v.next.standing} standing to ${v.next.icon} ${v.next.name}` : 'as high as a man gets under the boss';
            html += `<div style="${NOTE}">${nx}. Pay: ${Gangs.rankDef(v.membership.rank).weeklyPay}g a week from the purse (dirty coin).</div>`;
        }
        // Errands
        html += '<div style="margin-top:4px;">';
        for (const e of Gangs.errands(player, world, tile)) {
            const can = !e.locked && (player.actionPoints || 0) >= e.ap;
            html += `<div style="${CARD}"><div style="display:flex; justify-content:space-between; gap:6px;"><strong>${e.icon} ${esc(e.name)}</strong><span style="color:#ccc; white-space:nowrap;">${pct(e.odds)} · ${e.ap} AP</span></div>`;
            html += `<div style="${NOTE}">${esc(e.description)}</div>`;
            html += can ? btn(true, `window._uw.errand('${e.id}')`, 'Do it', BTN_RED) : `<span style="font-size:11px; color:#999;">${esc(e.locked || 'Not enough action points')}</span>`;
            html += '</div>';
        }
        html += '</div>';
        if (!v.boss) {
            const top = v.membership.rank >= Gangs.BOSS_RANK() - 1;
            const odds = Gangs.challengeOdds(player, world, tile);
            html += `<div style="${CARD}"><strong>👑 Move against ${esc(g.boss.name)}</strong><div style="${NOTE}">A lieutenant may try for the gang: your fighting, your leadership, your standing and the lieutenants who are tired of the boss count. Fail, and you're bleeding in the gutter and hunted.</div>`;
            html += top ? btn((player.actionPoints || 0) >= 4, 'window._uw.gang(\'challenge\')', `Take the gang: ${pct(odds)} (4 AP)`, BTN_RED) : `<span style="${NOTE}">Only a lieutenant can.</span>`;
            html += '</div>';
            html += btn(true, 'window._uw.gang(\'leave\')', 'Walk away from the crew', BTN_DIM + ' cursor:pointer;');
        }
    }

    // The boss's hand
    if (v.boss) html += bossSection(game, tile, v);

    if (v.log.length) {
        html += '<h5 style="margin:10px 0 4px;">📓 On the street</h5><div style="font-size:11px; color:#bbb;">';
        for (const e of v.log) html += `<div>Day ${e.day}: ${esc(e.text)}</div>`;
        html += '</div>';
    }
    if (v.bossTowns.length) html += `<div style="${NOTE} margin-top:6px;">You are boss in: ${v.bossTowns.map(esc).join(', ')}.</div>`;
    return html;
}

function bossSection(game, tile, v) {
    const g = v.gang;
    const w = v.watch;
    const wk = g.week || {};
    let html = '<h5 style="margin:10px 0 4px;">👑 The boss\'s hand</h5>';
    html += `<div style="${CARD}"><div style="display:flex; justify-content:space-between;"><strong>💰 The purse</strong><span style="color:var(--gold);">${Math.floor(g.purse)}g</span></div>`;
    if (wk.protection != null) {
        const parts = [`protection ${Math.floor(wk.protection)}g`, `dens ${Math.floor(wk.dens || 0)}g`, `black market ${Math.floor(wk.sales || 0)}g`, `resale ${Math.floor(wk.resale || 0)}g`, `wages −${Math.floor(wk.wages || 0)}g`];
        if (wk.bossCut != null) parts.push(`your cut ${wk.bossCut}g`);
        if (wk.smuggled) parts.push(`ran ${wk.smuggled.units} ${label(wk.smuggled.good)} in from ${esc(wk.smuggled.from)}`);
        if (wk.raided) parts.push(`<span style="color:#e05050;">raided: −${wk.raided}g</span>`);
        html += `<div style="${NOTE}">Last week: ${parts.join(' · ')}.</div>`;
    }
    html += `<div style="${NOTE}">Wages ${v.wages}g a week (${g.crew} crew and ${g.lieutenants.length} lieutenants). Unpaid men walk, and lieutenants sour.</div>`;
    html += btn(g.purse >= 1, 'window._uw.gang(\'withdraw\',100)', 'Take 100g') + btn(g.purse >= 1, `window._uw.gang('withdraw',${Math.floor(g.purse)})`, 'Take it all');
    html += btn((game.player.gold || 0) >= 100, 'window._uw.gang(\'deposit\',100)', 'Put in 100g') + '</div>';

    // The cut
    const cuts = Gangs.c('cuts', [0.1, 0.25, 0.4]);
    html += `<div style="${CARD}"><strong>✂️ Your cut of the week's take</strong> <span style="${NOTE}">(more than ${pct(Gangs.c('lieutenants', {}).fairCut || 0.25)} sours the lieutenants)</span><div>`;
    cuts.forEach((c, i) => {
        html += `<button onclick="window._uw.gang('cut',${i})" style="${Math.abs(g.cut - c) < 0.001 ? BTN_GOLD : BTN_DIM + ' cursor:pointer;'}">${pct(c)}</button>`;
    });
    html += '</div></div>';

    // Crew & lieutenants
    const fee = Gangs.cfg().recruitFee || 25;
    html += `<div style="${CARD}"><strong>👥 Crew ${g.crew}/${v.crewCap}</strong> ${btn(g.purse >= fee * 2 && g.crew < v.crewCap, 'window._uw.gang(\'hire\',2)', `Sign 2 men (${fee * 2}g)`)}`;
    const L = Gangs.c('lieutenants', {});
    for (const lt of g.lieutenants) {
        const col = lt.loyalty >= 60 ? '#7fd07f' : lt.loyalty >= 30 ? '#e0b040' : '#e05050';
        html += `<div style="display:flex; justify-content:space-between; align-items:center; gap:6px; padding:3px 0; border-bottom:1px solid rgba(255,255,255,0.05);">`;
        html += `<span>🎖️ ${esc(lt.name)} <span style="${NOTE}">${esc(lt.role)}, skill ${lt.skill}${lt.ambition > 0.6 ? ', ambitious' : ''}</span> <span style="color:${col};">loyalty ${Math.round(lt.loyalty)}</span></span>`;
        html += `<span>${btn(g.purse >= (L.bonusCost || 50), `window._uw.gang('bonus','${lt.id}')`, `Bonus ${L.bonusCost || 50}g`)}${btn(true, `window._uw.gang('purge','${lt.id}')`, 'Purge', BTN_RED)}</span></div>`;
    }
    html += `<div style="${NOTE}">A lieutenant below ${L.betrayBelow || 30} loyalty may inform, split off with men and coin, or move against you.</div></div>`;

    // The watch
    html += `<div style="${CARD}"><strong>🛡️ Buy the watch</strong>`;
    for (const who of ['captain', 'magistrate']) {
        const ours = w[who].bribedBy === g.id;
        const fee2 = v.retainer[who];
        const what = who === 'captain' ? 'fewer searches, no raids on you, cheaper bribes, better odds on jobs' : 'an arrest in this town is dismissed after a night';
        html += `<div style="display:flex; justify-content:space-between; align-items:center; gap:6px;"><span>${esc(w[who].name)} <span style="${NOTE}">${fee2}g/week: ${what}</span></span>`;
        html += ours ? btn(true, `window._uw.gang('${who}')`, 'Stop paying', BTN_DIM + ' cursor:pointer;') : btn(g.purse >= fee2 * 2, `window._uw.gang('${who}')`, w[who].bribedBy ? `Turn him (${fee2 * 4}g)` : `Buy him (${fee2 * 2}g)`);
        html += '</div>';
    }
    html += '</div>';

    // Rackets
    const D = Gangs.c('dens', {});
    html += `<div style="${CARD}"><strong>🎲 Rackets</strong><div style="${NOTE}">Protection on ${pct(g.turf)} of the streets. ${g.dens} den${g.dens === 1 ? '' : 's'}; the realm's law on vice decides what dens take and draw.</div>`;
    html += btn(g.purse >= (D.openCost || 220), 'window._uw.gang(\'den\')', `🎲 Open a dice den (${D.openCost || 220}g)`);
    html += btn(true, 'window._uw.gang(\'smuggle\')', g.smuggling ? '📦 Stop the border runs' : '📦 Run contraband over the border weekly');
    const stash = Object.entries(g.stash || {}).filter(([, n]) => n >= 1);
    if (stash.length) html += `<div style="${NOTE}">Stash: ${stash.map(([id, n]) => `${Math.floor(n)} ${label(id)}`).join(', ')}.</div>`;
    if ((g.fenced || []).length) html += `<div style="${NOTE}">Cooling at the fence: ${g.fenced.map(f => `${f.qty} ${label(f.good)}`).join(', ')}.</div>`;
    html += '</div>';
    return html;
}

// ── 🗝️ Guild & heat ─────────────────────────────────────

function guildTab(game, tile) {
    const player = game.player;
    const world = game.world;
    const settlement = tile.settlement;
    const sum = Underworld.summary(player, world);
    const kingdom = settlement.kingdom && world.getKingdom ? world.getKingdom(settlement.kingdom) : null;
    const localHeat = Underworld.getHeat(player, settlement.kingdom);
    const guildHere = Underworld.hasGuildPresence(settlement);
    let html = '';

    html += `<div style="${CARD}">`;
    if (sum.member) {
        const next = sum.next ? ` — ${sum.standing}/${sum.next.standing} to ${sum.next.icon} ${sum.next.name}` : ' — the top of the guild';
        html += `<strong style="color:var(--gold);">${sum.rank.icon} ${sum.rank.name}</strong> of ${sum.guildName}<span style="color:#999;">${next}</span>`;
        if (sum.known) html += '<div style="font-size:11px; color:#e0b040;">Known as a guild man: guards and priests are cool to you, honorable lords frown, cunning ones smile.</div>';
        if (Underworld.isGuildmaster(player)) html += '<div style="font-size:11px; color:#7fd07f;">As Guildmaster the gangs of the realms pay you a weekly tithe out of their purses.</div>';
    } else if (sum.contactMet) {
        const fee = Underworld.cfg('guild').joinFee;
        html += `You have a contact in ${sum.guildName}, but you are not one of them.`;
        html += guildHere
            ? `<div><button onclick="window._uw.join()" style="${(player.gold || 0) >= fee ? BTN_GOLD : BTN_DIM}">Swear the oath (${fee}g)</button></div>`
            : '<div style="color:#999;">The guild meets in towns and cities.</div>';
    } else {
        html += `<span style="color:#999;">You have no friends in ${sum.guildName}. Ask a barkeep in a town or city tavern about "special work".</span>`;
    }
    html += '</div>';

    // Heat
    const lvl = Underworld.heatLevel(localHeat);
    html += '<h5 style="margin:10px 0 4px;">🔥 Heat</h5>';
    html += `<div style="${CARD}"><div style="display:flex; justify-content:space-between;"><span>${kingdom ? kingdom.name : 'Here'}</span>`;
    html += `<span style="color:${LEVEL_COLOR[lvl]};">${Math.round(localHeat)} · ${LEVEL_LABEL[lvl]}</span></div>${heatBar(localHeat, lvl)}`;
    const quote = Underworld.bribeCost(player, world, tile);
    if (quote) {
        html += `<button onclick="window._uw.bribe()" style="${(player.gold || 0) >= quote.gold ? BTN_GOLD : BTN_DIM}">💰 Bribe the watch: ${quote.gold}g (-${Math.round(quote.relief)} heat, ${pct(quote.fail)} it backfires)</button>`;
    }
    if (localHeat > 0) {
        const low = sum.lyingLow && sum.lyingLow.kingdom === settlement.kingdom;
        html += low
            ? `<div style="font-size:11px; color:#7fd07f;">Lying low until day ${sum.lyingLow.untilDay} — heat cools fast, no jobs here.</div>`
            : `<button onclick="window._uw.lieLow()" style="${BTN_GOLD}">🕯️ Lie low (${Underworld.cfg('heat').lieLowDays} days)</button>`;
    }
    html += '</div>';
    const others = sum.heat.filter(h => h.kingdomId !== settlement.kingdom);
    if (others.length) {
        html += '<div style="font-size:11px;">';
        for (const h of others) {
            html += `<div style="display:flex; justify-content:space-between;"><span>${h.name}</span><span style="color:${LEVEL_COLOR[h.level]};">${h.heat} · ${LEVEL_LABEL[h.level]}</span></div>${heatBar(h.heat, h.level)}`;
        }
        html += '</div>';
    }

    // Jobs
    if (sum.member && guildHere) {
        html += '<h5 style="margin:10px 0 4px;">🗝️ Jobs</h5>';
        for (const job of Underworld.availableJobs(player, world, tile)) {
            if (job.id === 'heist') continue;
            const can = !job.locked && (player.actionPoints || 0) >= job.ap;
            html += `<div style="${CARD}"><div style="display:flex; justify-content:space-between; gap:6px;"><strong>${job.icon} ${job.name}</strong>`;
            html += `<span style="color:#ccc; white-space:nowrap;">${pct(job.odds)} · ${job.ap} AP</span></div>`;
            html += `<div style="color:#aaa; font-size:11px;">${job.description}</div>`;
            html += can
                ? `<button onclick="window._uw.job('${job.id}')" style="${BTN_RED}">Do it</button>`
                : `<span style="font-size:11px; color:#999;">${job.locked || 'Not enough action points'}</span>`;
            html += '</div>';
        }

        // Heist
        const heistJob = Underworld.availableJobs(player, world, tile).find(j => j.id === 'heist');
        if (heistJob) {
            html += `<h5 style="margin:10px 0 4px;">${heistJob.icon} Heist</h5><div style="${CARD}">`;
            const plan = sum.heist;
            if (plan) {
                const here = plan.key === `${tile.q},${tile.r}`;
                html += `<strong>${plan.name}</strong> <span style="color:#999;">(planned day ${plan.startedDay})</span>`;
                html += `<div style="font-size:11px; color:#aaa;">Done: ${plan.steps.length ? plan.steps.map(label).join(', ') : 'nothing yet'} · +${pct(plan.bonus)} odds</div>`;
                if (here) {
                    for (const s of plan.open) {
                        const ok = (player.gold || 0) >= (s.gold || 0) && (player.actionPoints || 0) >= s.ap;
                        html += `<button ${ok ? `onclick="window._uw.step('${s.id}')"` : 'disabled'} style="${ok ? BTN_GOLD : BTN_DIM}" title="${s.description}">${s.icon} ${s.name} (${s.gold ? `${s.gold}g, ` : ''}${s.ap} AP, +${pct(s.bonus)})</button>`;
                    }
                    const odds = Underworld.heistOdds(player, world, tile);
                    html += `<div style="margin-top:6px;"><button onclick="window._uw.strike()" style="${BTN_RED}">Strike now — ${pct(odds)} (${heistJob.ap} AP)</button>`;
                } else {
                    html += '<div style="font-size:11px; color:#e0b040;">Travel back to the target to keep planning or strike.</div><div>';
                }
                html += `<button onclick="window._uw.abandon()" style="${BTN_DIM} cursor:pointer;">Call it off</button></div>`;
            } else if (heistJob.locked) {
                html += `<span style="color:#999;">${heistJob.locked}</span>`;
            } else {
                html += '<div style="color:#aaa; font-size:11px;">Pick a mark, then plan: case it, buy tools, hire a crew, bribe an inside man, plan the getaway. Each step raises the odds. The gold is the town\'s (or the crown\'s): a poor town has less to take.</div>';
                for (const t of Underworld.heistTargets(settlement)) {
                    html += `<button onclick="window._uw.heist('${t.id}')" style="${BTN_GOLD}">${t.icon} ${t.name} (${t.gold[0]}–${t.gold[1]}g)</button>`;
                }
            }
            html += '</div>';
        }
    }

    if (sum.rackets.length) {
        html += '<h5 style="margin:10px 0 4px;">🗡️ Your own rackets</h5><div style="font-size:11px;">';
        for (const rk of sum.rackets) html += `<div>${rk.name}: up to ${rk.weekly}g / week (from the shopkeepers' purse)</div>`;
        html += '<div style="color:#aaa;">A town\'s gangs run a freelancer off their streets unless you run with one of them.</div></div>';
    }

    if (sum.log.length) {
        html += '<h5 style="margin:10px 0 4px;">📓 Lately</h5><div style="font-size:11px; color:#bbb;">';
        for (const e of sum.log) html += `<div>Day ${e.day}: ${e.text}</div>`;
        html += '</div>';
    }
    return html;
}

// ── 🧺 Fence & market ───────────────────────────────────

function marketTab(game, tile) {
    const player = game.player;
    const world = game.world;
    const settlement = tile.settlement;
    const sum = Underworld.summary(player, world);
    const kingdom = settlement.kingdom && world.getKingdom ? world.getKingdom(settlement.kingdom) : null;
    const fenceHere = Underworld.canUseFence(player, settlement);
    let html = '';
    if (!fenceHere) html += `<div style="${NOTE}">You know no fence here. A guild contact opens the fence and the black market to you.</div>`;
    const buyer = fenceHere ? Gangs.buyer(player, world, tile) : null;
    if (buyer) html += `<div style="${NOTE}">The buyer here is ${esc(buyer.name)}: they pay from a purse of ${Math.floor(buyer.purse)}g.</div>`;

    if (fenceHere) {
        html += '<h5 style="margin:10px 0 4px;">🧺 The Fence</h5>';
        html += `<div style="${NOTE}">Takes anything, hot or not, at ${pct(Underworld.fenceRate(player))} of its worth. The goods go back onto the market once they're cold.</div>`;
        const hotIds = new Set(sum.hot.map(h => h.item));
        const goods = Object.entries(player.inventory || {}).filter(([id, q]) => id !== 'gold' && q > 0)
            .sort((a, b) => (hotIds.has(b[0]) ? 1 : 0) - (hotIds.has(a[0]) ? 1 : 0));
        if (!goods.length) html += '<div style="color:#999;">You carry nothing to sell.</div>';
        for (const [id, qty] of goods.slice(0, 14)) {
            const hot = sum.hot.find(h => h.item === id);
            const price = Underworld.fencePrice(player, id, world, tile);
            html += '<div style="display:flex; align-items:center; justify-content:space-between; padding:3px 0; border-bottom:1px solid rgba(255,255,255,0.05);">';
            html += `<span>${label(id)} ×${qty}${hot ? ` <span style="color:#e08040;">🔥 hot ${hot.qty} (${hot.daysLeft}d)</span>` : ''}</span>`;
            html += `<span><span style="color:var(--gold);">${price}g</span> <button onclick="window._uw.fence('${id}', 1)" style="${BTN_GOLD}">1</button>`;
            if (qty > 1) html += `<button onclick="window._uw.fence('${id}', ${qty})" style="${BTN_GOLD}">All</button>`;
            html += '</span></div>';
        }

        const b = Underworld.blockadeAt(world, tile);
        html += '<h5 style="margin:10px 0 4px;">🏴‍☠️ The Black Market</h5>';
        const notes = ['Prices follow the gangs\' stash in town against what the town wants: scarce goods sell dear, a glut cheap'];
        if (b.blockaded) notes.push(b.closedPort ? 'The port is sealed by enemy fleets — anything that slips through sells dear, and the watch is everywhere' : 'The realm is blockaded — prices and patrols are up');
        if (sum.leanSeason) notes.push('Lean season — food and contraband fetch more');
        html += `<div style="font-size:11px; color:#e0b040;">${notes.join('. ')}.</div>`;
        const offers = Underworld.blackMarketOffers(player, world, tile);
        if (!offers.length) html += '<div style="color:#999;">Nothing to offer them (hot goods go to the fence).</div>';
        for (const o of offers.slice(0, 14)) {
            html += '<div style="display:flex; align-items:center; justify-content:space-between; padding:3px 0; border-bottom:1px solid rgba(255,255,255,0.05);">';
            html += `<span>${label(o.item)} ×${o.qty} <span style="color:${STATUS_COLOR[o.status]}; font-size:10px;">${o.status}</span></span>`;
            html += `<span><span style="color:var(--gold);">${o.price}g</span> <span style="color:#999; font-size:10px;">${pct(o.risk)} risk</span> <button onclick="window._uw.bm('${o.item}', 1)" style="${BTN_RED}">Sell 1</button></span></div>`;
        }
    }

    const list = Underworld.contrabandList(kingdom);
    if (list.illegal.length || list.tariff.length) {
        html += `<h5 style="margin:10px 0 4px;">📜 Contraband in ${kingdom ? kingdom.name : 'these lands'}</h5><div style="font-size:11px;">`;
        if (list.illegal.length) html += `<div><span style="color:${STATUS_COLOR.illegal};">Banned:</span> ${list.illegal.map(label).join(', ')}</div>`;
        if (list.tariff.length) html += `<div><span style="color:${STATUS_COLOR.tariff};">Tariffed:</span> ${list.tariff.map(label).join(', ')}</div>`;
        html += '</div>';
    }
    return html;
}

// ── 🧼 Coin ─────────────────────────────────────────────

function coinTab(game, tile) {
    const player = game.player;
    const world = game.world;
    const dirty = Gangs.dirty(player);
    const cap = Gangs.launderCapacity(player, world, tile);
    const D = Gangs.c('dirty', {});
    let html = `<div style="${CARD}"><div style="display:flex; justify-content:space-between;"><strong>🧼 Dirty coin</strong><span style="color:${dirty > 0 ? '#e0b040' : '#7fd07f'};">${Math.floor(dirty)}g of ${Math.floor(player.gold || 0)}g</span></div>`;
    html += `<div style="${NOTE}">Every coin from crime is dirty until it's washed. A guard search takes ${pct(D.seizeOnSearch || 0.5)} of it and an arrest ${pct(D.seizeOnArrest || 0.7)}; from ${D.unexplainedFrom || 1500}g the talk about your money brings heat every week. Spending spends the dirty coin first.</div></div>`;
    html += `<div style="${CARD}"><strong>🏠 Fronts here</strong>`;
    if (!cap.fronts.length) {
        html += `<div style="${NOTE}">You own no front in this town. A tavern, inn, guest house, trading post, brewery or any shop you own washes coin through its books; so do your gang's dice dens if you're the boss.</div>`;
    } else {
        html += `<div style="${NOTE}">${cap.fronts.map(f => `${esc(f.name)} (${f.cap}g a week)`).join(', ')}. ${cap.left}g more can go through this week. The fee, ${pct(cap.fee)}, goes out to the town as the books' false trade.</div>`;
        const amt = Math.min(Math.floor(dirty), cap.left);
        html += btn(amt > 0, `window._uw.launder(${amt})`, `Launder ${amt}g (fee ${Math.ceil(amt * cap.fee)}g)`);
    }
    html += '</div>';
    return html;
}

const TABS = [['streets', '🔪 Streets'], ['guild', '🗝️ Guild'], ['market', '🧺 Market'], ['coin', '🧼 Coin']];

Object.assign(ActionMenu, {
    /** The Underworld panel for the settlement on `tile`; `tab` is streets / guild / market / coin. */
    showUnderworldPanel(game, tile, tab = null) {
        const player = game.player;
        const world = game.world;
        const settlement = tile && tile.settlement;
        if (!settlement) return;
        const gangsHere = Gangs.hasGangs(settlement);
        const t = tab || (window._uwTab && window._uwTab.key === `${tile.q},${tile.r}` ? window._uwTab.tab : null) || (gangsHere ? 'streets' : 'guild');
        window._uwTab = { key: `${tile.q},${tile.r}`, tab: t };

        let html = '<div style="font-size:12px; max-height:520px; overflow-y:auto;">';
        html += panelTabs(game, {
            id: 'underworld', title: '🗝️ The Underworld', tabs: TABS.filter(([k]) => k !== 'streets' || gangsHere), active: t,
            go: (k) => ActionMenu.showUnderworldPanel(game, tile, k),
            attrsFor: (k) => `onclick="window._uw && window._uw.tab('${k}')"`,
        });
        html += t === 'streets' ? streetsTab(game, tile) : t === 'market' ? marketTab(game, tile) : t === 'coin' ? coinTab(game, tile) : guildTab(game, tile);
        html += '</div>';
        game.ui.showCustomPanel('🗝️ The Underworld', html);

        const after = (title, res) => {
            if (!res || !res.success) {
                game.ui.showNotification(title, (res && res.reason) || 'Not possible.', 'error');
            } else {
                const bad = res.caught || res.outcome === 'caught' || res.outcome === 'failed' || res.accepted === false;
                game.ui.showNotification(title, res.text, bad ? 'error' : 'success');
            }
            game.ui.updateStats(player, world);
            if (player.jailState) {
                game.ui.hideCustomPanel();
                return;
            }
            ActionMenu.showUnderworldPanel(game, tile, t);
        };
        const gangOp = (op, arg) => {
            switch (op) {
                case 'join': return Gangs.join(player, world, tile, arg);
                case 'leave': return Gangs.leave(player, world, tile);
                case 'found': return Gangs.found(player, world, tile);
                case 'challenge': return Gangs.challengeBoss(player, world, tile);
                default: return Gangs.bossAct(player, world, tile, op, arg);
            }
        };
        window._uw = {
            tab: (k) => ActionMenu.showUnderworldPanel(game, tile, k),
            join: () => after('🗝️ The Guild', Underworld.joinGuild(player, world, tile)),
            job: (id) => after('🗝️ Job', Underworld.doJob(player, world, tile, id)),
            heist: (id) => after('💎 Heist', Underworld.startHeist(player, world, tile, id)),
            step: (id) => after('💎 Planning', Underworld.planStep(player, world, tile, id)),
            strike: () => after('💎 The Heist', Underworld.executeHeist(player, world, tile)),
            abandon: () => after('💎 Heist', Underworld.abandonHeist(player)),
            fence: (id, qty) => after('🧺 The Fence', Underworld.sellToFence(player, world, tile, id, qty)),
            bm: (id, qty) => after('🏴‍☠️ Black Market', Underworld.sellBlackMarket(player, world, tile, id, qty)),
            bribe: () => after('💰 Bribe', Underworld.bribeGuards(player, world, tile)),
            lieLow: () => after('🕯️ Lying Low', Underworld.lieLow(player, world, tile)),
            gang: (op, arg = null) => after('🔪 The Streets', gangOp(op, arg)),
            errand: (id) => after('🔪 The Crew', Gangs.doErrand(player, world, tile, id)),
            launder: (amt) => after('🧼 Laundering', Gangs.launder(player, world, tile, amt)),
        };
    },
});
