// ============================================
// BARTER VOICE — money told as goods where there is no coin (world/barter.js)
// ============================================
// Where the player deals in kind (a barter town, or the wild after one) there
// is no gold to speak of: prices are the worth of goods. Two tools:
//
//   money(game, n)      the one formatter for a sum: '~12 ⚖' in kind, '12g' in coin
//   moneyWords(game, n) the same in prose: 'goods worth ~12' / '12 gold'
//   voice(game, html)   rewrites what hand-written panels say: "11 gold" / "4g"
//                       → "~11 ⚖", 💰 → 🎒, "Not enough gold" → "Not enough
//                       goods". Text only: tags, attributes (but a title's
//                       words), <style> and <script> are left alone.
//
// The UI's choke points call voice(): the custom panel (ui/ui/panels.js
// showCustomPanel), the notifications and their log, and the action menu
// (ui/actionMenu/core.js), so every panel speaks in goods at the dawn without
// each string knowing about barter. Panels that build a sum themselves use
// money() / moneyWords().

import { Barter } from '../world/barter.js';

const GOLD_NOT = '(?!\\s*(?:ore|bars?|jewellery|jewelry|leaf|thread|mines?|rush|dust|fish|en|smith))';
const RX_SUM_GOLD = /(\d[\d,]*(?:\.\d+)?)\s*(?:gold|gp)\b/gi;
const RX_SUM_G = /(\d[\d,]*(?:\.\d+)?)\s?g\b(?![-\w])/g;
const RX_GOLD_WORD = new RegExp(`\\bgold\\b${GOLD_NOT}`, 'g');
const RX_GOLD_WORD_CAP = new RegExp(`\\bGold\\b${GOLD_NOT}`, 'g');

/** Does the player deal in kind where they stand? */
export function inKind(game) {
    return !!(game && game.player && Barter.inKind(game.player));
}

/** A sum of money: '~12 ⚖' where the player deals in kind, else '12g' */
export function money(game, n) {
    const v = Math.round(Number(n) || 0).toLocaleString('en-US');
    return inKind(game) ? `~${v} ⚖` : `${v}g`;
}

/** A sum in prose: 'goods worth ~12' in kind, else '12 gold' */
export function moneyWords(game, n) {
    const v = Math.round(Number(n) || 0).toLocaleString('en-US');
    return inKind(game) ? `goods worth ~${v}` : `${v} gold`;
}

/** Rewrite plain text (no tags) into goods' worth */
export function goodsText(text) {
    return String(text)
        .replace(RX_SUM_GOLD, '~$1 ⚖')
        .replace(RX_SUM_G, '~$1 ⚖')
        .replace(/💰/g, '🎒')
        .replace(RX_GOLD_WORD, 'goods')
        .replace(RX_GOLD_WORD_CAP, 'Goods');
}

/** Rewrite an HTML string's words (not its tags, styles or scripts) into goods' worth */
export function goodsHtml(html) {
    const s = String(html == null ? '' : html);
    return s.replace(/(<(style|script)\b[\s\S]*?<\/\2>)|(<[^>]*>)|([^<]+)/gi, (m, block, _t, tag, text) => {
        if (block) return block;
        if (tag) return tag.replace(/\btitle="([^"]*)"/g, (t, v) => `title="${goodsText(v)}"`);
        return goodsText(text);
    });
}

/** voice(game, html): the HTML as the player should read it here */
export function voice(game, html) {
    return inKind(game) ? goodsHtml(html) : html;
}
