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
// Logic lives in the systems; this panel presents it, in the action menu's
// voice (ui/actionMenu/uiKit.js): cards for status, one row a thing to do.
import { ActionMenu } from './_ref.js';
import { Underworld } from '../../systems/underworld.js';
import { Gangs } from '../../systems/gangs.js';
import { BTN_GOLD, BTN_DIM, BTN_DARK, BTN_RED, panelTabs, esc, lede, chips, sectionHead, kv, card, actRow, rowList } from './uiKit.js';
import { ParentsGuard } from '../parentsGuard.js';

const LEVEL_COLOR = { clear: '#8fd18a', watched: '#f0b35a', poster: '#e0a060', warrant: '#e0846a' };
const LEVEL_LABEL = { clear: 'Clear', watched: 'Watched', poster: 'Wanted posters', warrant: 'Warrant' };
const LEVEL_TONE = { clear: 'good', watched: 'warn', poster: 'warn', warrant: 'bad' };
const STATUS_COLOR = { illegal: '#e0846a', tariff: '#f0b35a', legal: '#8fd18a' };
const NOTE = 'font-size:11px; color:#9d937c; margin:2px 0;';
/** A small inline button inside a row's side column (the row itself is not a button). */
const SMALL = 'padding:3px 9px; margin:0 0 0 4px; font-size:11px;';

const pct = v => `${Math.round(v * 100)}%`;
const label = id => String(id).replace(/_/g, ' ');

function bar(width, color) {
    return `<div style="background:rgba(255,255,255,0.06); border-radius:3px; height:5px; overflow:hidden; margin:4px 0 2px;">
        <div style="width:${Math.min(100, width)}%; height:100%; background:${color};"></div></div>`;
}

function heatBar(heat, level) {
    return bar(heat, LEVEL_COLOR[level]);
}

function crackBar(v) {
    return bar(v, v >= 60 ? '#e0846a' : v >= 35 ? '#f0b35a' : '#8fd18a');
}

function btn(on, call, text, style = BTN_GOLD, title = '') {
    return on
        ? `<button onclick="${call}" style="${style}"${title ? ` title="${esc(title)}"` : ''}>${text}</button>`
        : `<button disabled style="${BTN_DIM}"${title ? ` title="${esc(title)}"` : ''}>${text}</button>`;
}

/** One action-menu row that runs `call` (an inline onclick) when `on`; greyed with `why` when not. */
function row(on, call, o) {
    return actRow({ ...o, off: !on, attrs: on ? `onclick="${call}"` : '' });
}

// ── 🔪 Streets ──────────────────────────────────────────

const g0 = v => `${Math.floor(v || 0)}g`;

/** A gang's books (Gangs.bookView): last week and all time, taken and paid, by kind. */
function booksHtml(b) {
    if (!b || !b.all) return '';
    const last = b.last || { took: 0, paid: 0, in: {}, out: {} };
    const weeks = Math.max(1, b.weeks);
    // (the weekly average is of its trade: its first purse is not a week's take)
    const firstPurse = Number((b.all.in || {}).founding) || 0;
    let html = `<div style="${NOTE}">📒 Last week took ${g0(last.took)}, paid out ${g0(last.paid)} · all time${b.weeks ? ` (${b.weeks} wk)` : ''} took ${g0(b.all.took)} (≈${g0((b.all.took - firstPurse) / weeks)}/wk${firstPurse ? ` besides its first purse` : ''}), paid ${g0(b.all.paid)} (≈${g0(b.all.paid / weeks)}/wk)</div>`;
    const TD = 'padding:3px 0; border-top:1px solid rgba(245,197,66,0.07);';
    const rows = (dir) => {
        const labels = Gangs.BOOK_LABELS[dir];
        const kinds = Object.keys({ ...b.all[dir], ...((b.cur || {})[dir] || {}) }).sort((x, y) => (b.all[dir][y] || 0) - (b.all[dir][x] || 0));
        return kinds.map(k => `<tr><td style="${TD}">${esc(labels[k] || label(k))}</td><td style="${TD} text-align:right;">${g0(last[dir][k])}</td><td style="${TD} text-align:right;">${g0(b.all[dir][k])}</td></tr>`).join('');
    };
    const TH = 'padding:6px 0 3px; font-size:10px; font-weight:600; letter-spacing:1px; text-transform:uppercase; color:rgba(245,197,66,0.75);';
    const head = (t) => `<tr><th style="${TH} text-align:left;">${t}</th><th style="${TH} text-align:right;">last wk</th><th style="${TH} text-align:right;">all time</th></tr>`;
    const ins = rows('in');
    const outs = rows('out');
    if (ins || outs) {
        html += `<details class="pk-more" style="font-size:11px; color:#cbbf9f;"><summary style="cursor:pointer;">The books</summary><table style="width:100%; border-collapse:collapse;">`
            + `${ins ? head('Taken') + ins : ''}${outs ? head('Paid out') + outs : ''}</table>`
            + `${b.cur && (b.cur.took || b.cur.paid) ? `<div style="${NOTE}">This week so far: took ${g0(b.cur.took)}, paid ${g0(b.cur.paid)}.</div>` : ''}</details>`;
    }
    return html;
}

function streetsTab(game, tile) {
    const player = game.player;
    const world = game.world;
    const v = Gangs.view(player, world, tile);
    if (!v) return lede('No gang works a place this small. The underworld lives in towns and cities.');
    const sum = Underworld.summary(player, world);
    let html = '';

    // The watch
    const w = v.watch;
    const own = (who) => {
        const g = v.gangs.find(x => x.id === w[who].bribedBy);
        return g ? `<span style="color:#f0b35a;">on ${esc(g.name)}'s payroll</span>` : '<span style="color:#8fd18a;">honest, for now</span>';
    };
    html += card(crackBar(v.crackdown)
        + `<div style="font-size:12px; color:#cbbf9f; margin:4px 0 2px;">${esc(w.captain.name)}: ${own('captain')}. ${esc(w.magistrate.name)}: ${own('magistrate')}.</div>`
        + `<div style="${NOTE}">Crime here stirs the crackdown: it raids gangs that haven't bought the captain, searches harder at the gate and spoils your jobs. It cools week by week.</div>`,
    { icon: '🛡️', title: 'The watch', side: `Crackdown ${v.crackdown}`, tone: v.crackdown >= 60 ? 'bad' : v.crackdown >= 35 ? 'warn' : 'good' });

    // The gangs
    html += sectionHead('🔪 Who runs the streets');
    for (const g of v.gangs) {
        const mine = v.gang && v.gang.id === g.id;
        const tags = [`boss ${g.bossIsYou ? '<span style="color:#ffcf6a;">you</span>' : esc(g.boss)}`, `${g.crew} crew`, `strength ${g.strength}`];
        if (g.dens) tags.push(`${g.dens} den${g.dens === 1 ? '' : 's'}`);
        if (g.smuggling) tags.push('runs contraband');
        if (g.wars) tags.push(`<span style="color:#e0846a;">at war</span>`);
        if (g.ownsCaptain) tags.push('owns the captain');
        if (g.ownsMagistrate) tags.push('owns the magistrate');
        if (g.raids) tags.push(`raided ${g.raids}×`);
        let body = `<div style="${NOTE}">${tags.join(' · ')}</div>`;
        body += booksHtml(g.books);
        const acts = [];
        if (!v.membership && !g.banned && !g.bossIsYou) {
            const can = sum.contactMet || sum.member;
            acts.push(row(can, `window._uw.gang('join','${g.id}')`, { icon: '🤝', name: 'Ask to run with them', why: 'Find a guild contact first (a barkeep, "special work")' }));
        }
        if (g.banned) body += `<div style="font-size:11px; color:#e0846a; margin-top:2px;">They will kill you on sight.</div>`;
        if (v.boss && !mine) {
            if (g.atWarWithYou) acts.push(row(true, `window._uw.gang('truce','${g.id}')`, { icon: '🕊️', name: 'Offer a truce (tribute)', side: 'tribute', tone: 'gold' }));
            else if (g.truceUntil > (world.day || 0)) body += `<div style="${NOTE}">Truce until day ${g.truceUntil}.</div>`;
            else acts.push(row(true, `window._uw.gang('war','${g.id}')`, { icon: '⚔️', name: 'Go to war', side: 'war', tone: 'bad' }));
        }
        if (acts.length) body += rowList(acts);
        html += card(body, { title: esc(g.name) + (mine ? ' <span style="font-size:10px; color:#ffcf6a; letter-spacing:1px;">YOURS</span>' : ''), side: `${pct(g.turf)} of the streets`, tone: mine ? 'gold' : null });
    }
    if (!v.membership) {
        const F = Gangs.c('found', {});
        const fee = (Gangs.cfg().recruitFee || 25) * (F.crew || 4) + (F.seed || 200);
        const can = (player.gold || 0) >= fee;
        html += rowList([row(can, 'window._uw.gang(\'found\')', {
            icon: '👥', name: 'Found a crew here',
            desc: `A crew of your own. Prowler or above in the guild: ${fee}g buys a purse and ${F.crew || 4} men. The biggest crew in town won't like it.`,
            why: `A crew of your own costs ${fee}g: a purse and ${F.crew || 4} men. Prowler or above in the guild.`,
            side: `${fee}g`, tone: can ? 'gold' : 'bad',
        })], '👥 A crew of your own');
    }

    // Your place in it
    if (v.gang) {
        const g = v.gang;
        html += sectionHead(`${v.rank.icon} You: ${v.rank.name} of ${esc(g.name)}`);
        if (!v.boss) {
            const nx = v.next ? `${v.membership.standing}/${v.next.standing} standing to ${v.next.icon} ${v.next.name}` : 'as high as a man gets under the boss';
            html += lede(`${nx}. Pay: ${Gangs.rankDef(v.membership.rank).weeklyPay}g a week from the purse (dirty coin).`);
        }
        // Errands
        const errands = [];
        for (const e of Gangs.errands(player, world, tile)) {
            const can = !e.locked && (player.actionPoints || 0) >= e.ap;
            errands.push(row(can, `window._uw.errand('${e.id}')`, {
                icon: e.icon, name: esc(e.name), desc: esc(e.description),
                why: `${esc(e.description)} — ${esc(e.locked || 'Not enough action points')}`,
                side: `${pct(e.odds)} · ${e.ap} AP`, tone: 'bad',
            }));
        }
        html += rowList(errands, 'Errands');
        if (!v.boss) {
            const top = v.membership.rank >= Gangs.BOSS_RANK() - 1;
            const odds = Gangs.challengeOdds(player, world, tile);
            const ap = (player.actionPoints || 0) >= 4;
            const desc = 'A lieutenant may try for the gang: your fighting, your leadership, your standing and the lieutenants who are tired of the boss count. Fail, and you\'re bleeding in the gutter and hunted.';
            html += rowList([
                row(top && ap, 'window._uw.gang(\'challenge\')', {
                    icon: '👑', name: `Move against ${esc(g.boss.name)}`, desc,
                    why: top ? `${desc} Not enough action points.` : `${desc} Only a lieutenant can.`,
                    side: top ? `Take the gang: ${pct(odds)} (4 AP)` : '—', tone: 'bad',
                }),
                row(true, 'window._uw.gang(\'leave\')', { icon: '🚶', name: 'Walk away from the crew' }),
            ]);
        }
    }

    // The boss's hand
    if (v.boss) html += bossSection(game, tile, v);

    if (v.log.length) {
        html += sectionHead('📓 On the street');
        html += `<div style="font-size:11px; color:#cbbf9f;">${v.log.map(e => `<div style="padding:2px 0;"><span style="color:#9d937c;">Day ${e.day}:</span> ${esc(e.text)}</div>`).join('')}</div>`;
    }
    if (v.bossTowns.length) html += `<div style="${NOTE} margin-top:6px;">You are boss in: ${v.bossTowns.map(esc).join(', ')}.</div>`;
    return html;
}

function bossSection(game, tile, v) {
    const g = v.gang;
    const w = v.watch;
    const wk = g.week || {};
    let html = sectionHead('👑 The boss\'s hand');
    let purseBody = '';
    if (wk.protection != null) {
        const parts = [`protection ${Math.floor(wk.protection)}g`, `dens ${Math.floor(wk.dens || 0)}g`, `black market ${Math.floor(wk.sales || 0)}g`, `resale ${Math.floor(wk.resale || 0)}g`, `wages −${Math.floor(wk.wages || 0)}g`];
        if (wk.bossCut != null) parts.push(`your cut ${wk.bossCut}g`);
        if (wk.smuggled) parts.push(`ran ${wk.smuggled.units} ${label(wk.smuggled.good)} in from ${esc(wk.smuggled.from)}`);
        if (wk.raided) parts.push(`<span style="color:#e0846a;">raided: −${wk.raided}g</span>`);
        purseBody += `<div style="${NOTE}">Last week: ${parts.join(' · ')}.</div>`;
    }
    purseBody += `<div style="${NOTE}">Wages ${v.wages}g a week (${g.crew} crew and ${g.lieutenants.length} lieutenants). Unpaid men walk, and lieutenants sour.</div>`;
    purseBody += `<div style="margin-top:4px;">${btn(g.purse >= 1, 'window._uw.gang(\'withdraw\',100)', 'Take 100g')}${btn(g.purse >= 1, `window._uw.gang('withdraw',${Math.floor(g.purse)})`, 'Take it all')}`;
    purseBody += `${btn((game.player.gold || 0) >= 100, 'window._uw.gang(\'deposit\',100)', 'Put in 100g', BTN_DARK)}</div>`;
    html += card(purseBody, { icon: '💰', title: 'The purse', side: `${Math.floor(g.purse)}g`, tone: 'gold' });

    // The cut
    const cuts = Gangs.c('cuts', [0.1, 0.25, 0.4]);
    let cutBody = `<div style="${NOTE}">More than ${pct(Gangs.c('lieutenants', {}).fairCut || 0.25)} sours the lieutenants.</div><div>`;
    cuts.forEach((c, i) => {
        cutBody += `<button onclick="window._uw.gang('cut',${i})" style="${Math.abs(g.cut - c) < 0.001 ? BTN_GOLD : BTN_DARK}">${pct(c)}</button>`;
    });
    cutBody += '</div>';
    html += card(cutBody, { icon: '✂️', title: 'Your cut of the week\'s take', side: pct(g.cut || 0), tone: 'gold' });

    // Crew & lieutenants
    const fee = Gangs.cfg().recruitFee || 25;
    const L = Gangs.c('lieutenants', {});
    const lts = g.lieutenants.map(lt => {
        const col = lt.loyalty >= 60 ? '#8fd18a' : lt.loyalty >= 30 ? '#f0b35a' : '#e0846a';
        return actRow({
            icon: '🎖️', name: esc(lt.name),
            desc: `${esc(lt.role)}, skill ${lt.skill}${lt.ambition > 0.6 ? ', ambitious' : ''} · <span style="color:${col};">loyalty ${Math.round(lt.loyalty)}</span>`,
            side: btn(g.purse >= (L.bonusCost || 50), `window._uw.gang('bonus','${lt.id}')`, `Bonus ${L.bonusCost || 50}g`, BTN_GOLD + SMALL)
                + btn(true, `window._uw.gang('purge','${lt.id}')`, 'Purge', BTN_RED + SMALL),
        });
    });
    const canHire = g.purse >= fee * 2 && g.crew < v.crewCap;
    html += rowList([
        row(canHire, 'window._uw.gang(\'hire\',2)', {
            icon: '👥', name: `Crew ${g.crew}/${v.crewCap}`, desc: `Sign 2 men (${fee * 2}g)`,
            why: g.crew >= v.crewCap ? `Sign 2 men (${fee * 2}g) — the crew is full` : `Sign 2 men (${fee * 2}g) — the purse is short`,
            side: `${fee * 2}g`, tone: 'gold',
        }),
        ...lts,
    ], '👥 Crew & lieutenants');
    html += `<div style="${NOTE}">A lieutenant below ${L.betrayBelow || 30} loyalty may inform, split off with men and coin, or move against you.</div>`;

    // The watch
    const watchRows = ['captain', 'magistrate'].map(who => {
        const ours = w[who].bribedBy === g.id;
        const fee2 = v.retainer[who];
        const what = who === 'captain' ? 'fewer searches, no raids on you, cheaper bribes, better odds on jobs' : 'an arrest in this town is dismissed after a night';
        const desc = `${fee2}g/week: ${what}`;
        if (ours) return row(true, `window._uw.gang('${who}')`, { icon: '🛡️', name: esc(w[who].name), desc, side: 'Stop paying', tone: 'good' });
        const cost = w[who].bribedBy ? fee2 * 4 : fee2 * 2;
        const verb = w[who].bribedBy ? `Turn him (${cost}g)` : `Buy him (${cost}g)`;
        return row(g.purse >= fee2 * 2, `window._uw.gang('${who}')`, { icon: who === 'captain' ? '🛡️' : '⚖️', name: esc(w[who].name), desc, why: `${desc} — the purse is short`, side: verb, tone: 'gold' });
    });
    html += rowList(watchRows, '🛡️ Buy the watch');

    // Rackets
    const D = Gangs.c('dens', {});
    html += sectionHead('🎲 Rackets');
    html += `<div style="${NOTE}">Protection on ${pct(g.turf)} of the streets. ${g.dens} den${g.dens === 1 ? '' : 's'}; the realm's law on vice decides what dens take and draw.</div>`;
    html += rowList([
        row(g.purse >= (D.openCost || 220), 'window._uw.gang(\'den\')', { icon: '🎲', name: 'Open a dice den', why: 'The purse is short', side: `${D.openCost || 220}g`, tone: 'gold' }),
        row(true, 'window._uw.gang(\'smuggle\')', { icon: '📦', name: g.smuggling ? 'Stop the border runs' : 'Run contraband over the border weekly', side: g.smuggling ? 'running' : '', tone: 'good' }),
    ]);
    const stash = Object.entries(g.stash || {}).filter(([, n]) => n >= 1);
    if (stash.length) html += `<div style="${NOTE}">Stash: ${stash.map(([id, n]) => `${Math.floor(n)} ${label(id)}`).join(', ')}.</div>`;
    if ((g.fenced || []).length) html += `<div style="${NOTE}">Cooling at the fence: ${g.fenced.map(f => `${f.qty} ${label(f.good)}`).join(', ')}.</div>`;
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

    if (sum.member) {
        const next = sum.next ? ` — ${sum.standing}/${sum.next.standing} to ${sum.next.icon} ${sum.next.name}` : ' — the top of the guild';
        html += lede(`<strong style="color:#ffcf6a;">${sum.rank.icon} ${sum.rank.name}</strong> of ${sum.guildName}<span style="color:#9d937c;">${next}</span>`);
        if (sum.known) html += '<div style="font-size:11px; color:#f0b35a; margin:2px 0;">Known as a guild man: guards and priests are cool to you, honorable lords frown, cunning ones smile.</div>';
        if (Underworld.isGuildmaster(player)) html += '<div style="font-size:11px; color:#8fd18a; margin:2px 0;">As Guildmaster the gangs of the realms pay you a weekly tithe out of their purses.</div>';
    } else if (sum.contactMet) {
        const fee = Underworld.cfg('guild').joinFee;
        html += lede(`You have a contact in ${sum.guildName}, but you are not one of them.`);
        html += guildHere
            ? rowList([actRow({ icon: '🗝️', name: 'Swear the oath', desc: `Join ${sum.guildName}`, side: `${fee}g`, tone: (player.gold || 0) >= fee ? 'gold' : 'bad', attrs: 'onclick="window._uw.join()"' })])
            : `<div style="${NOTE}">The guild meets in towns and cities.</div>`;
    } else {
        html += lede(`You have no friends in ${sum.guildName}. Ask a barkeep in a town or city tavern about "special work".`);
    }

    // Heat
    const lvl = Underworld.heatLevel(localHeat);
    html += sectionHead('🔥 Heat');
    html += card(heatBar(localHeat, lvl), { title: kingdom ? kingdom.name : 'Here', side: `${Math.round(localHeat)} · ${LEVEL_LABEL[lvl]}`, tone: LEVEL_TONE[lvl] });
    const heatRows = [];
    const quote = Underworld.bribeCost(player, world, tile);
    if (quote) {
        heatRows.push(actRow({
            icon: '💰', name: 'Bribe the watch', desc: `-${Math.round(quote.relief)} heat, ${pct(quote.fail)} it backfires`,
            side: `${quote.gold}g`, tone: (player.gold || 0) >= quote.gold ? 'gold' : 'bad', attrs: 'onclick="window._uw.bribe()"',
        }));
    }
    if (localHeat > 0) {
        const low = sum.lyingLow && sum.lyingLow.kingdom === settlement.kingdom;
        heatRows.push(low
            ? actRow({ icon: '🕯️', name: 'Lying low', desc: `<span style="color:#8fd18a;">Lying low until day ${sum.lyingLow.untilDay} — heat cools fast, no jobs here.</span>`, side: `day ${sum.lyingLow.untilDay}`, tone: 'good' })
            : actRow({ icon: '🕯️', name: `Lie low (${Underworld.cfg('heat').lieLowDays} days)`, side: `${Underworld.cfg('heat').lieLowDays} days`, attrs: 'onclick="window._uw.lieLow()"' }));
    }
    html += rowList(heatRows);
    const others = sum.heat.filter(h => h.kingdomId !== settlement.kingdom);
    if (others.length) {
        html += `<div style="font-size:11px; margin-bottom:8px;">${others.map(h => kv(h.name, `<span style="color:${LEVEL_COLOR[h.level]};">${h.heat} · ${LEVEL_LABEL[h.level]}</span>`) + heatBar(h.heat, h.level)).join('')}</div>`;
    }

    // Jobs
    if (sum.member && guildHere) {
        const jobs = [];
        for (const job of Underworld.availableJobs(player, world, tile)) {
            if (job.id === 'heist') continue;
            const can = !job.locked && (player.actionPoints || 0) >= job.ap;
            jobs.push(row(can, `window._uw.job('${job.id}')`, {
                icon: job.icon, name: job.name, desc: job.description,
                why: `${job.description} — ${job.locked || 'Not enough action points'}`,
                side: `${pct(job.odds)} · ${job.ap} AP`, tone: 'bad',
            }));
        }
        html += rowList(jobs, '🗝️ Jobs');

        // Heist
        const heistJob = Underworld.availableJobs(player, world, tile).find(j => j.id === 'heist');
        if (heistJob) {
            html += sectionHead(`${heistJob.icon} Heist`);
            const plan = sum.heist;
            if (plan) {
                const here = plan.key === `${tile.q},${tile.r}`;
                html += card(`<div style="${NOTE}">Done: ${plan.steps.length ? plan.steps.map(label).join(', ') : 'nothing yet'} · +${pct(plan.bonus)} odds</div>`
                    + (here ? '' : '<div style="font-size:11px; color:#f0b35a;">Travel back to the target to keep planning or strike.</div>'),
                { icon: heistJob.icon, title: plan.name, side: `planned day ${plan.startedDay}` });
                const steps = [];
                if (here) {
                    for (const s of plan.open) {
                        const ok = (player.gold || 0) >= (s.gold || 0) && (player.actionPoints || 0) >= s.ap;
                        steps.push(row(ok, `window._uw.step('${s.id}')`, {
                            icon: s.icon, name: s.name, desc: s.description, title: s.description,
                            why: `${s.description} — ${(player.gold || 0) >= (s.gold || 0) ? 'Not enough action points' : 'Not enough gold'}`,
                            side: `${s.gold ? `${s.gold}g, ` : ''}${s.ap} AP, +${pct(s.bonus)}`, tone: 'gold',
                        }));
                    }
                    const odds = Underworld.heistOdds(player, world, tile);
                    steps.push(row(true, 'window._uw.strike()', { icon: '💎', name: 'Strike now', side: `${pct(odds)} (${heistJob.ap} AP)`, tone: 'bad' }));
                }
                steps.push(row(true, 'window._uw.abandon()', { icon: '🚫', name: 'Call it off' }));
                html += rowList(steps);
            } else if (heistJob.locked) {
                html += `<div style="${NOTE}">${heistJob.locked}</div>`;
            } else {
                html += `<div style="${NOTE}">Pick a mark, then plan: case it, buy tools, hire a crew, bribe an inside man, plan the getaway. Each step raises the odds. The gold is the town's (or the crown's): a poor town has less to take.</div>`;
                html += rowList(Underworld.heistTargets(settlement).map(t => row(true, `window._uw.heist('${t.id}')`, {
                    icon: t.icon, name: t.name, side: `${t.gold[0]}–${t.gold[1]}g`, tone: 'gold',
                })));
            }
        }
    }

    if (sum.rackets.length) {
        html += sectionHead('🗡️ Your own rackets');
        html += `<div style="font-size:11px;">${sum.rackets.map(rk => kv(rk.name, `up to ${rk.weekly}g / week`)).join('')}</div>`;
        html += `<div style="${NOTE}">(from the shopkeepers' purse) A town's gangs run a freelancer off their streets unless you run with one of them.</div>`;
    }

    if (sum.log.length) {
        html += sectionHead('📓 Lately');
        html += `<div style="font-size:11px; color:#cbbf9f;">${sum.log.map(e => `<div style="padding:2px 0;"><span style="color:#9d937c;">Day ${e.day}:</span> ${e.text}</div>`).join('')}</div>`;
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
    if (!fenceHere) html += lede('You know no fence here. A guild contact opens the fence and the black market to you.');
    const buyer = fenceHere ? Gangs.buyer(player, world, tile) : null;
    if (buyer) html += lede(`The buyer here is ${esc(buyer.name)}: they pay from a purse of ${Math.floor(buyer.purse)}g.`);

    if (fenceHere) {
        html += sectionHead('🧺 The Fence');
        html += `<div style="${NOTE}">Takes anything, hot or not, at ${pct(Underworld.fenceRate(player))} of its worth. The goods go back onto the market once they're cold.</div>`;
        const hotIds = new Set(sum.hot.map(h => h.item));
        const goods = Object.entries(player.inventory || {}).filter(([id, q]) => id !== 'gold' && q > 0)
            .sort((a, b) => (hotIds.has(b[0]) ? 1 : 0) - (hotIds.has(a[0]) ? 1 : 0));
        if (!goods.length) html += `<div style="${NOTE}">You carry nothing to sell.</div>`;
        html += rowList(goods.slice(0, 14).map(([id, qty]) => {
            const hot = sum.hot.find(h => h.item === id);
            const price = Underworld.fencePrice(player, id, world, tile);
            return actRow({
                icon: hot ? '🔥' : '📦', name: `${label(id)} ×${qty}`,
                desc: hot ? `<span style="color:#e0a060;">hot ${hot.qty} (${hot.daysLeft}d)</span>` : '',
                side: `<span class="pk-price">${price}<small>g</small></span> <button onclick="window._uw.fence('${id}', 1)" style="${BTN_GOLD}${SMALL}">1</button>`
                    + (qty > 1 ? `<button onclick="window._uw.fence('${id}', ${qty})" style="${BTN_GOLD}${SMALL}">All</button>` : ''),
            });
        }));

        const b = Underworld.blockadeAt(world, tile);
        html += sectionHead('🏴‍☠️ The Black Market');
        const notes = ['Prices follow the gangs\' stash in town against what the town wants: scarce goods sell dear, a glut cheap'];
        if (b.blockaded) notes.push(b.closedPort ? 'The port is sealed by enemy fleets — anything that slips through sells dear, and the watch is everywhere' : 'The realm is blockaded — prices and patrols are up');
        if (sum.leanSeason) notes.push('Lean season — food and contraband fetch more');
        html += `<div style="font-size:11px; color:#f0b35a; margin:2px 0;">${notes.join('. ')}.</div>`;
        const offers = Underworld.blackMarketOffers(player, world, tile);
        if (!offers.length) html += `<div style="${NOTE}">Nothing to offer them (hot goods go to the fence).</div>`;
        html += rowList(offers.slice(0, 14).map(o => actRow({
            icon: '🏴‍☠️', name: `${label(o.item)} ×${o.qty}`,
            desc: `<span style="color:${STATUS_COLOR[o.status]};">${o.status}</span> · ${pct(o.risk)} risk`,
            // One choice: the row itself sells one
            note: 'Sell one', tone: 'bad', attrs: `onclick="window._uw.bm('${o.item}', 1)"`,
            side: `<span class="pk-price">${o.price}<small>g</small></span>`,
        })));
    }

    const list = Underworld.contrabandList(kingdom);
    if (list.illegal.length || list.tariff.length) {
        html += sectionHead(`📜 Contraband in ${kingdom ? kingdom.name : 'these lands'}`);
        html += '<div style="font-size:11px;">';
        if (list.illegal.length) html += kv(`<span style="color:${STATUS_COLOR.illegal};">Banned</span>`, list.illegal.map(label).join(', '));
        if (list.tariff.length) html += kv(`<span style="color:${STATUS_COLOR.tariff};">Tariffed</span>`, list.tariff.map(label).join(', '));
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
    let html = lede(`Every coin from crime is dirty until it's washed. A guard search takes ${pct(D.seizeOnSearch || 0.5)} of it and an arrest ${pct(D.seizeOnArrest || 0.7)}; from ${D.unexplainedFrom || 1500}g the talk about your money brings heat every week. Spending spends the dirty coin first.`);
    html += chips([
        { icon: '🧼', label: 'Dirty coin', value: `${Math.floor(dirty)}g of ${Math.floor(player.gold || 0)}g`, cls: dirty > 0 ? 'gold' : '' },
        cap.fronts.length ? ['🏠', 'Fronts', cap.fronts.length] : null,
        cap.fronts.length ? ['⚖️', 'Room this week', `${cap.left}g`] : null,
    ]);
    if (!cap.fronts.length) {
        html += sectionHead('🏠 Fronts here');
        html += `<div style="${NOTE}">You own no front in this town. A tavern, inn, guest house, trading post, brewery or any shop you own washes coin through its books; so do your gang's dice dens if you're the boss.</div>`;
    } else {
        html += rowList(cap.fronts.map(f => actRow({ icon: '🏠', name: esc(f.name), side: `${f.cap}g a week` })), '🏠 Fronts here');
        html += `<div style="${NOTE}">${cap.left}g more can go through this week. The fee, ${pct(cap.fee)}, goes out to the town as the books' false trade.</div>`;
        const amt = Math.min(Math.floor(dirty), cap.left);
        html += rowList([row(amt > 0, `window._uw.launder(${amt})`, {
            icon: '🧼', name: `Launder ${amt}g`, desc: `fee ${Math.ceil(amt * cap.fee)}g`, why: `fee ${Math.ceil(amt * cap.fee)}g — nothing to wash`,
            side: `${amt}g`, tone: 'gold',
        })]);
    }
    return html;
}

const TABS = [['streets', '🔪 Streets'], ['guild', '🗝️ Guild'], ['market', '🧺 Market'], ['coin', '🧼 Coin']];

Object.assign(ActionMenu, {
    /** The Underworld panel for the settlement on `tile`; `tab` is streets / guild / market / coin. */
    showUnderworldPanel(game, tile, tab = null) {
        // Your parents' rules at this door too (ui/parentsGuard.js)
        if (!ParentsGuard.ok(game, 'underworld', tile)) return;
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
