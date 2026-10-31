// ActionMenu — 📖 The Annals: the player's life and dynasty as a book, one
// chapter per ruler (tabs in the panel bar), the House's legacy, and the
// books of lines that ended before a new life ("Before"). Copy as text to
// share; with the local LLM on, the court scribe can retell a chapter.
// Logic lives in systems/annals.js; this panel presents it.
//
// Opener: ActionMenu.showAnnals(game, opts) — opts { chapter (id | 'legacy'
// | 'before0'…), onBack (fn), backLabel, locked (the death screen) }.
import { ActionMenu } from './_ref.js';
import { Relationships } from './_imports.js';
import { Annals } from '../../systems/annals.js';
import { BTN_GOLD, BTN_PLAIN, BTN_DIM, panelTabs, esc } from './uiKit.js';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];
const BOOK = 'font-family: Georgia, "Palatino Linotype", "Book Antiqua", serif; font-size: 14px; line-height: 1.65; color: #e8dcc0;';
const PAGE = 'background: linear-gradient(180deg, rgba(60,48,30,0.35), rgba(30,24,16,0.35)); border: 1px solid rgba(201,178,122,0.28); border-radius: 6px; padding: 16px 20px; max-width: 640px; margin: 0 auto;';

function _roman(i) {
    return ROMAN[i] || String(i + 1);
}

function _theme(id) {
    const T = Annals.config().themeLabels || {};
    return T[id] || { label: '', icon: '·' };
}

/** Paragraphs as book text: the first gets a drop capital. */
function _paragraphsHtml(paragraphs) {
    return paragraphs.map((p, i) => {
        const t = _theme(p.theme);
        let text = esc(p.text);
        if (i === 0 && text.length > 1) {
            text = `<span style="float:left; font-family:var(--font-display); font-size:40px; line-height:34px; padding:4px 6px 0 0; color:var(--gold); font-weight:bold;">${text[0]}</span>${text.slice(1)}`;
        }
        const quiet = p.quiet ? ' font-style: italic; color: #b9ad92;' : '';
        return `<div style="display:flex; gap:10px; margin: 0 0 12px;">
            <span title="${esc(t.label)}" style="flex:0 0 18px; font-size:12px; opacity:0.55; padding-top:3px;">${p.quiet ? '' : t.icon}</span>
            <p style="margin:0; text-align: justify;${quiet}">${text}</p></div>`;
    }).join('');
}

function _spouseName(player) {
    try {
        const s = player && player.spouse ? Relationships.getNPC(player.spouse) : null;
        return s ? `${s.firstName}${s.dynasty ? ` ${s.dynasty}` : ''}` : null;
    } catch (e) {
        return null;
    }
}

Object.assign(ActionMenu, {
    /**
     * Open the Annals. Safe to call from anywhere with a game (the victory
     * scene, the death screen, the Journal): `ActionMenu.showAnnals(game)`.
     */
    showAnnals(game, opts = {}) {
        if (!game || !game.player) return;
        const view = game._annalsView = { ...(game._annalsView && opts._keep ? game._annalsView : {}), ...opts };
        delete view._keep;
        const book = Annals.compose(game.player, game.world, { spouseName: _spouseName(game.player) });
        view.book = book;

        const tabs = book.chapters.map((c, i) => [c.id, `${_roman(i)}. ${c.ruler.split(' ')[0]}`, c.title]);
        if (book.legacy) tabs.push(['legacy', '⭐ Legacy', 'The House as it stands']);
        book.before.forEach((b, i) => tabs.push([`before${i}`, `Before: ${b.house ? b.house.name : 'a line'}`, b.title]));
        const keys = tabs.map(t => t[0]);
        const last = book.chapters.length ? book.chapters[book.chapters.length - 1].id : 'legacy';
        const active = keys.includes(view.chapter) ? view.chapter : last;
        view.chapter = active;

        const tabRow = panelTabs(game, {
            id: 'annals', title: '📖 The Annals', tabs, active,
            go: (key) => ActionMenu.showAnnals(game, { chapter: key, _keep: true }),
            attrsFor: (key) => `data-am-act="annalsAct" data-am-args='${JSON.stringify(['tab', key])}'`,
        });

        let html = `<div style="max-height: 62vh; overflow-y: auto; padding: 2px 4px;">${tabRow}`;
        html += `<div style="text-align:center; margin: 4px 0 10px;"><div style="font-size:24px;">${esc((book.house && book.house.sigil && book.house.sigil.icon) || '📖')}</div>`;
        html += `<div style="${BOOK} font-size:18px; color:var(--gold); font-weight:bold; letter-spacing:0.5px;">${esc(book.title)}</div>`;
        if (book.house && book.house.motto) html += `<div style="${BOOK} font-size:12px; font-style:italic; color:#bba;">&ldquo;${esc(book.house.motto)}&rdquo;</div>`;
        html += '</div>';

        html += `<div style="${PAGE}"><div style="${BOOK}">`;
        let chapter = null;
        if (active === 'legacy' && book.legacy) {
            html += `<div style="text-align:center; font-size:16px; color:var(--gold); margin-bottom:12px;">${esc(book.legacy.rankIcon || '⭐')} ${esc(book.legacy.title)}</div>`;
            html += _paragraphsHtml(book.legacy.paragraphs);
        } else if (active.startsWith('before')) {
            const b = book.before[Number(active.slice(6))];
            if (b) {
                html += `<div style="text-align:center; font-size:16px; color:var(--gold); margin-bottom:12px;">${esc(b.title)}</div>`;
                for (const c of b.chapters || []) {
                    html += `<div style="text-align:center; font-size:14px; color:#d8c27a; margin:14px 0 8px;">${esc(c.title)}</div>`;
                    html += _paragraphsHtml(c.paragraphs || []);
                }
                if (b.legacy && b.legacy.paragraphs.length) {
                    html += `<div style="text-align:center; font-size:14px; color:#d8c27a; margin:14px 0 8px;">${esc(b.legacy.title)}</div>`;
                    html += _paragraphsHtml(b.legacy.paragraphs);
                }
            }
        } else {
            chapter = book.chapters.find(c => c.id === active) || null;
            if (chapter) {
                html += `<div style="text-align:center; font-size:11px; letter-spacing:2px; color:#a99a78; text-transform:uppercase;">Chapter ${_roman(book.chapters.indexOf(chapter))}</div>`;
                html += `<div style="text-align:center; font-size:16px; color:var(--gold); margin: 2px 0 14px;">${esc(chapter.title)}</div>`;
                const scribed = (game._annalsScribe || {})[chapter.id];
                if (scribed && scribed.status === 'done' && scribed.show) {
                    const paras = scribed.text.split(/\n\s*\n|\n/).map(t => t.trim()).filter(Boolean).map(text => ({ theme: 'years', text }));
                    html += `<div style="font-size:11px; color:#a99a78; text-align:center; margin-bottom:10px;">✒️ As the court scribe wrote it</div>`;
                    html += _paragraphsHtml(paras);
                } else {
                    html += _paragraphsHtml(chapter.paragraphs);
                }
            }
        }
        if (!book.chapters.length && !book.before.length) html += '<p style="text-align:center; color:#aaa;">The annals are not yet begun.</p>';
        html += '</div></div>';

        // Actions
        html += '<div style="display:flex; flex-wrap:wrap; gap:4px; justify-content:center; margin-top:10px;">';
        html += `<button data-am-act="annalsAct" data-am-args='["copy"]' style="${BTN_PLAIN}">📋 Copy as text</button>`;
        if (chapter && Annals.scribeAvailable()) {
            const s = (game._annalsScribe || {})[chapter.id];
            if (s && s.status === 'writing') html += `<button style="${BTN_DIM}">✒️ The scribe is writing…</button>`;
            else if (s && s.status === 'done') html += `<button data-am-act="annalsAct" data-am-args='${JSON.stringify(['toggleScribe', chapter.id])}' style="${BTN_PLAIN}">${s.show ? '📜 Show the plain annals' : '✒️ Show the scribe\'s chapter'}</button>`;
            else html += `<button data-am-act="annalsAct" data-am-args='${JSON.stringify(['scribe', chapter.id])}' style="${BTN_GOLD}" title="The court scribe (your local language model) retells this chapter from the annals">✒️ Have the court scribe write this chapter</button>`;
            if (s && s.status === 'failed') html += '<div style="width:100%; text-align:center; font-size:11px; color:#a99a78;">The scribe could not be reached; the annals stand as written.</div>';
        }
        if (typeof view.onBack === 'function') html += `<button data-am-act="annalsAct" data-am-args='["back"]' style="${BTN_PLAIN}">${esc(view.backLabel || '← Back')}</button>`;
        html += '</div>';
        html += '<div id="annalsCopyBox"></div>';
        html += '</div>';
        game.ui.showCustomPanel('📖 The Annals', html, { locked: !!view.locked });
    },

    /** The Annals panel's buttons. */
    annalsAct(game, action, arg) {
        const view = game._annalsView || {};
        if (action === 'tab') {
            ActionMenu.showAnnals(game, { chapter: arg, _keep: true });
        } else if (action === 'back') {
            const back = view.onBack;
            game._annalsView = null;
            if (typeof back === 'function') back();
            else game.ui.hideCustomPanel();
        } else if (action === 'copy') {
            const text = Annals.toText(view.book || Annals.compose(game.player, game.world, { spouseName: _spouseName(game.player) }));
            const fallback = () => {
                // No clipboard (an insecure page, a refusal): the text to select by hand
                const box = typeof document !== 'undefined' ? document.getElementById('annalsCopyBox') : null;
                if (!box) return;
                box.innerHTML = `<textarea readonly style="width:100%; height:180px; margin-top:8px; font-family: Georgia, serif; font-size:12px; background:#1c1813; color:#e8dcc0; border:1px solid rgba(201,178,122,0.3);">${esc(text)}</textarea>`;
                const ta = box.querySelector('textarea');
                if (ta) { ta.focus(); ta.select(); }
            };
            const clip = typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function' ? navigator.clipboard : null;
            if (!clip) { fallback(); return; }
            clip.writeText(text).then(
                () => game.ui.showNotification('📖 The Annals', 'Copied to the clipboard — the whole book, ready to share.', 'success'),
                () => fallback(),
            );
        } else if (action === 'scribe') {
            const chapter = view.book && view.book.chapters.find(c => c.id === arg);
            if (!chapter) return;
            game._annalsScribe = game._annalsScribe || {};
            game._annalsScribe[arg] = { status: 'writing' };
            ActionMenu.showAnnals(game, { chapter: arg, _keep: true });
            Annals.scribe(chapter).then((res) => {
                game._annalsScribe[arg] = res && res.ok ? { status: 'done', text: res.text, show: true } : { status: 'failed' };
                // Redraw only if the reader is still on this chapter
                const v = game._annalsView;
                if (v && v.chapter === arg && typeof document !== 'undefined' && document.getElementById('customPanel')) {
                    ActionMenu.showAnnals(game, { chapter: arg, _keep: true });
                }
            });
        } else if (action === 'toggleScribe') {
            const s = game._annalsScribe && game._annalsScribe[arg];
            if (s) s.show = !s.show;
            ActionMenu.showAnnals(game, { chapter: arg, _keep: true });
        }
    },
});
