// ConversationScene — the letterboxed "audience" from the inner-map NPC dialog,
// as a reusable stage for any conversation: royal audiences, caravan masters,
// the people of a town on the overworld. It owns the overlay, the speaker's
// portrait and mood ring, a typewritten transcript and grouped, numbered
// choices; the caller only decides what is said and what each choice does.
//
//   const scene = ConversationScene.open({ name, subtitle, where, icon, sprite,
//       mood: { value, label, icon, color }, facts, greeting, onClose });
//   scene.player('My lord.'); scene.npc('Speak.'); scene.note('+5 reputation', 'good');
//   scene.choices([{ icon, label, group, tooltip, onPick, chance, check, extra, cls }],
//       { groups: { key: 'Title' }, hint, back });
import { NpcPortrait } from './npcPortrait.js';

// Circumference of the mood ring (r = 54 in a 120 viewBox)
const RING_C = 2 * Math.PI * 54;

let _active = null;

function _esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escape a spoken line and render *stage directions* as italic asides. */
export function formatSpokenLine(text) {
    return _esc(text).replace(/\*([^*]+)\*/g, '<em class="npc-dialog-aside">$1</em>');
}

/**
 * Lay out choices as grouped, numbered buttons (keys 1–9). A choice in group
 * 'leave' is the footer, bound to Esc. `groupOf(choice)` and `titles` name the
 * groups; 'talk' groups go in the left column and the rest on the right.
 * Wires overlay._hotkeys / _escChoice / _back for the overlay's key handler.
 */
export function renderChoiceGrid(overlay, choicesEl, choices, opts = {}) {
    if (!choicesEl || !overlay) return;
    choicesEl.innerHTML = '';
    overlay._hotkeys = [];
    overlay._back = opts.back || null;
    const titles = opts.titles || {};
    const groupOf = opts.groupOf || (c => c.group || 'talk');
    const hint = overlay.querySelector('.npc-dialog-hint');
    const idleHint = opts.hint || 'Choose your words — press 1–9, or Esc to take your leave.';
    if (hint) hint.textContent = idleHint;

    // meta = { shift } — Shift+click or Shift+number asks for more (e.g. buy ×5)
    const pick = (choice, meta = {}) => {
        if (overlay._picked || choice.disabled) return;
        overlay._picked = true;
        setTimeout(() => { overlay._picked = false; }, 120);
        if (choice.onPick) choice.onPick(meta);
        else if (opts.onPick) opts.onPick(choice, meta);
    };

    // Group in order of first appearance; the farewell / back option is the footer
    const groups = [];
    let footer = null;
    for (const choice of choices) {
        const g = groupOf(choice);
        if (g === 'leave') { footer = choice; continue; }
        let grp = groups.find(x => x.key === g);
        if (!grp) { grp = { key: g, items: [] }; groups.push(grp); }
        grp.items.push(choice);
    }

    // Conversation on the left, everything else on the right
    const columns = [];
    const talk = groups.filter(g => g.key === 'talk');
    const rest = groups.filter(g => g.key !== 'talk');
    if (talk.length && rest.length) columns.push(talk, rest);
    else columns.push(groups);

    let n = 0;
    let stagger = 0;
    const makeBtn = (choice, key) => {
        const btn = document.createElement('button');
        btn.className = 'npc-dialog-choice';
        if (choice.cls) btn.classList.add(choice.cls);
        if (choice.skillTag) btn.classList.add(`npc-dialog-skill-${choice.skillTag}`);
        if (choice.disabled) { btn.classList.add('is-disabled'); btn.setAttribute('aria-disabled', 'true'); }
        btn.style.setProperty('--i', stagger++);
        let html = `<kbd class="npc-dialog-key">${key}</kbd>`
            + `<span class="npc-dialog-choice-icon">${choice.icon}</span>`
            + '<span class="npc-dialog-choice-label">';
        if (choice.check) html += `<span class="npc-dialog-check">${choice.check}</span>`;
        html += `${choice.label}</span>`;
        if (choice.extra) html += choice.extra;
        if (choice.chance != null) {
            html += `<span class="npc-dialog-odds npc-dialog-skill-tag-${choice.skillTag}" style="--p:${choice.chance}"><span>${choice.chance}%</span></span>`;
        }
        btn.innerHTML = html;
        const tip = choice.disabled && choice.disabledReason
            ? `${choice.tooltip || choice.label} — ${choice.disabledReason}.`
            : choice.tooltip;
        const show = () => { if (hint) hint.textContent = tip || idleHint; };
        btn.addEventListener('mouseenter', show);
        btn.addEventListener('focus', show);
        btn.addEventListener('mouseleave', () => { if (hint) hint.textContent = idleHint; });
        btn.addEventListener('click', (e) => pick(choice, { shift: e.shiftKey }));
        return btn;
    };

    const grid = document.createElement('div');
    grid.className = `npc-dialog-choice-grid cols-${columns.length}`;
    for (const col of columns) {
        const colEl = document.createElement('div');
        colEl.className = 'npc-dialog-choice-col';
        for (const grp of col) {
            const title = titles[grp.key];
            if (title) {
                const h = document.createElement('div');
                h.className = `npc-dialog-group-title group-${grp.key}`;
                h.textContent = title;
                colEl.appendChild(h);
            }
            for (const choice of grp.items) {
                n++;
                const key = n <= 9 ? String(n) : '·';
                colEl.appendChild(makeBtn(choice, key));
                if (n <= 9) overlay._hotkeys[n] = meta => pick(choice, meta);
            }
        }
        grid.appendChild(colEl);
    }
    choicesEl.appendChild(grid);

    if (footer) {
        const btn = makeBtn(footer, 'Esc');
        btn.classList.add('npc-dialog-choice-leave');
        overlay._escChoice = () => pick(footer);
        choicesEl.appendChild(btn);
    } else {
        overlay._escChoice = null;
    }
}

/**
 * A box to type in (free talk, systems/npcChat.js), set into `container`.
 * opts: { placeholder, onSend(text) (may return a promise: the box waits for
 * it), onDone() (the Done button and Esc), doneLabel, hint, maxLength,
 * isClosed() }. Returns { box, focus, finish }.
 */
export function renderTalkBox(container, opts = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'npc-scene-input';
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:4px 2px;';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;align-items:stretch;';
    const box = document.createElement('textarea');
    box.rows = 2;
    box.maxLength = opts.maxLength || 300;
    box.placeholder = opts.placeholder || 'Say something…';
    box.style.cssText = 'flex:1;min-width:0;resize:none;padding:8px 10px;font:inherit;font-size:15px;line-height:1.35;color:#e8e2d0;background:rgba(0,0,0,0.35);border:1px solid rgba(245,197,66,0.35);border-radius:6px;outline:none;';
    const send = document.createElement('button');
    send.type = 'button';
    send.textContent = 'Say';
    send.style.cssText = 'padding:0 16px;font-weight:600;color:#1a1408;background:var(--gold,#f5c542);border:none;border-radius:6px;cursor:pointer;';
    row.appendChild(box);
    row.appendChild(send);
    const foot = document.createElement('div');
    foot.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;color:rgba(255,255,255,0.45);';
    const hint = document.createElement('span');
    hint.textContent = opts.hint || 'Enter to speak · Shift+Enter for a new line · Esc when you are done';
    const done = document.createElement('button');
    done.type = 'button';
    done.textContent = opts.doneLabel || 'Done talking';
    done.style.cssText = 'padding:5px 12px;color:#e0e0e0;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);border-radius:5px;cursor:pointer;';
    foot.appendChild(hint);
    foot.appendChild(done);
    wrap.appendChild(row);
    wrap.appendChild(foot);
    container.appendChild(wrap);

    const closed = () => (opts.isClosed ? opts.isClosed() : false);
    let busy = false;
    const finish = () => { if (busy) return; if (opts.onDone) opts.onDone(); };
    const go = () => {
        const text = box.value.trim();
        if (!text || busy || closed()) return;
        busy = true;
        box.value = '';
        box.disabled = true; send.disabled = true;
        send.style.opacity = '0.5';
        Promise.resolve(opts.onSend ? opts.onSend(text) : null).catch(() => {}).finally(() => {
            busy = false;
            if (closed() || !box.isConnected) return;
            box.disabled = false; send.disabled = false;
            send.style.opacity = '';
            box.focus();
        });
    };
    send.addEventListener('click', go);
    done.addEventListener('click', finish);
    box.addEventListener('keydown', (e) => {
        e.stopPropagation(); // (the game's keys are not for typing)
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(); }
    });
    setTimeout(() => { if (box.isConnected) box.focus(); }, 30);
    return { box, focus: () => box.focus(), finish };
}

class Scene {
    constructor(cfg) {
        this.cfg = cfg;
        this._queue = [];       // lines waiting for the speaker to finish
        this._said = [];        // what was said so far, { npc, text } (for the AI chat's memory of the scene)
        this._typing = null;    // { el, text, timer }
        this._closed = false;
        /** Pending exchange / afterSpoken timers, cleared on close. */
        this._timers = new Set();
        this._build();
    }

    // ── Stage ──

    _build() {
        const c = this.cfg;
        const mood = c.mood || { value: 50, label: 'Neutral', icon: '😐', color: '#FFD54F' };
        const overlay = document.createElement('div');
        overlay.id = 'npcDialogOverlay';
        overlay.className = `npc-scene${c.variant ? ` npc-scene-${c.variant}` : ''}`;
        overlay.style.setProperty('--mood', mood.color);
        overlay.innerHTML = `
            <div class="npc-dialog-backdrop"></div>
            <div class="npc-dialog-letterbox top"></div>
            <div class="npc-dialog-letterbox bottom"></div>
            <div class="npc-dialog-box">
                <aside class="npc-dialog-side">
                    <div class="npc-dialog-portrait">
                        <svg class="npc-dialog-ring" viewBox="0 0 120 120" aria-hidden="true">
                            <circle class="npc-dialog-ring-track" cx="60" cy="60" r="54"></circle>
                            <circle class="npc-dialog-disposition-fill" cx="60" cy="60" r="54"
                                stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}"></circle>
                        </svg>
                        <div class="npc-dialog-portrait-frame">
                            <canvas class="npc-dialog-portrait-canvas" width="144" height="144"></canvas>
                            <span class="npc-dialog-portrait-icon">${c.icon || '👤'}</span>
                        </div>
                        <span class="npc-dialog-portrait-badge">${c.badge || c.icon || '👤'}</span>
                    </div>
                    <div class="npc-dialog-mood" title="${_esc(c.moodTitle || 'How they regard you')}">
                        <span class="npc-dialog-disposition-label"></span>
                        <span class="npc-dialog-disposition-value"></span>
                    </div>
                    <div class="npc-dialog-facts">${c.facts || ''}</div>
                </aside>
                <section class="npc-dialog-main">
                    <header class="npc-dialog-header">
                        <div class="npc-dialog-header-info">
                            <div class="npc-dialog-name">${_esc(c.name || '')}</div>
                            <div class="npc-dialog-title">${c.subtitle || ''}${c.where ? `<span class="npc-dialog-where">${c.where}</span>` : ''}</div>
                        </div>
                        <button class="npc-dialog-close" title="Leave (Esc)">✕</button>
                    </header>
                    <div class="npc-dialog-body npc-dialog-transcript"></div>
                    <div class="npc-dialog-choices"></div>
                    <div class="npc-dialog-hint"></div>
                </section>
            </div>`;
        this.overlay = overlay;
        this.box = overlay.querySelector('.npc-dialog-box');
        this.log = overlay.querySelector('.npc-dialog-transcript');
        this.choicesEl = overlay.querySelector('.npc-dialog-choices');

        overlay.querySelector('.npc-dialog-close').addEventListener('click', () => this.close());
        overlay.querySelector('.npc-dialog-backdrop').addEventListener('click', () => this.close());
        this.log.addEventListener('click', () => this.skip());

        // The scene is modal: it owns the keyboard until it closes.
        // 1–9 choose, Esc backs out / leaves, Space & Enter hurry the speaker.
        overlay._keyHandler = (e) => {
            if (e.ctrlKey || e.altKey || e.metaKey) return;
            const tag = e.target && e.target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
            e.stopPropagation();
            if (e.key === 'Escape') {
                e.preventDefault();
                if (overlay._back) overlay._back();
                else if (overlay._escChoice && !this._leaving) overlay._escChoice();
                else this.close();
                return;
            }
            if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                this.skip();
                return;
            }
            // e.code, so Shift+1 still reads as 1 (not '!')
            const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code || '');
            const n = m ? +m[1] : parseInt(e.key, 10);
            if (n >= 1 && n <= 9) {
                e.preventDefault();
                const fn = overlay._hotkeys && overlay._hotkeys[n];
                if (fn) fn({ shift: e.shiftKey });
            }
        };
        window.addEventListener('keydown', overlay._keyHandler, true);
        document.body.appendChild(overlay);

        // A sprite bust when the speaker has one; the emoji stands in otherwise
        const canvas = overlay.querySelector('.npc-dialog-portrait-canvas');
        const fallback = overlay.querySelector('.npc-dialog-portrait-icon');
        if (c.sprite) {
            NpcPortrait.ensureLoaded();
            this._stopPortrait = NpcPortrait.mount(canvas, c.sprite, fallback);
        } else {
            canvas.style.visibility = 'hidden';
        }
        this.setMood(mood);
        // Sweep the ring up from empty
        const ring = overlay.querySelector('.npc-dialog-disposition-fill');
        if (ring) ring.style.strokeDashoffset = `${RING_C}`;
        requestAnimationFrame(() => this.setMood(mood));

        if (c.greeting) this.npc(c.greeting, { topic: 'a fitting greeting' });
    }

    get isOpen() { return !this._closed; }

    // ── Mood ──

    /** mood = { value: 0–100, label, icon, color, shown? } */
    setMood(mood, delta = 0) {
        if (this._closed || !mood) return;
        const o = this.overlay;
        o.style.setProperty('--mood', mood.color);
        const ring = o.querySelector('.npc-dialog-disposition-fill');
        const v = Math.max(0, Math.min(100, mood.value));
        if (ring) ring.style.strokeDashoffset = `${RING_C * (1 - v / 100)}`;
        o.querySelector('.npc-dialog-disposition-label').innerHTML = `${mood.icon || ''} ${mood.label}`;
        o.querySelector('.npc-dialog-disposition-value').textContent = mood.shown != null ? mood.shown : `${Math.round(mood.value)}`;
        if (delta) this._floatChange(delta);
    }

    _floatChange(amount) {
        const portrait = this.overlay.querySelector('.npc-dialog-portrait');
        if (!portrait) return;
        const change = document.createElement('span');
        change.className = `npc-dialog-disp-change ${amount > 0 ? 'is-up' : 'is-down'}`;
        change.textContent = amount > 0 ? `+${amount}` : `${amount}`;
        portrait.appendChild(change);
        portrait.classList.remove('pulse-up', 'pulse-down');
        void portrait.offsetWidth;
        portrait.classList.add(amount > 0 ? 'pulse-up' : 'pulse-down');
        setTimeout(() => change.remove(), 1600);
    }

    // ── Transcript ──

    /**
     * The speaker says a line (typewritten, after anything still being said).
     * With cfg.voice (an AI voice, ui/npcVoice.js) the line is said in the
     * speaker's own words: `how` tells it what the line is ({ topic, asked }),
     * false keeps the written line. The thinking dots stay up while it comes.
     */
    npc(text, how = null) {
        if (text) this._said.push({ npc: true, text: String(text).replace(/<[^>]+>/g, '') });
        const voice = how !== false && typeof this.cfg.voice === 'function' ? this.cfg.voice : null;
        this._enqueue({ kind: 'npc', text, voice, how: how || {} });
        return this;
    }

    /** The player says a line. */
    player(text) {
        if (text) this._said.push({ npc: false, text: String(text).replace(/<[^>]+>/g, '') });
        this._enqueue({ kind: 'player', text });
        return this;
    }

    /** The last n lines said in this scene: [{ npc, text }] */
    recentLines(n = 6) { return this._said.slice(-n); }

    /** An outcome ribbon in the transcript: tone is good / bad / gold / info. */
    note(html, tone = 'info') { this._enqueue({ kind: 'note', html, tone }); return this; }

    /** A block of rich content (a ledger, a list of tales) set into the transcript. */
    card(html) { this._enqueue({ kind: 'card', html }); return this; }

    /** Three bobbing dots while the speaker considers; cleared by the next line. */
    thinking() {
        if (this._closed || this.log.querySelector('.npc-dialog-thinking')) return this;
        const dots = document.createElement('div');
        dots.className = 'npc-dialog-line is-npc npc-dialog-thinking';
        dots.innerHTML = '<span></span><span></span><span></span>';
        this.log.appendChild(dots);
        this._scroll();
        return this;
    }

    /** The player speaks, the speaker thinks a beat, then fn() delivers the answer. */
    exchange(playerLine, fn, delay = 550) {
        if (this._closed) return;
        this.clearChoices();
        this.skip();
        if (playerLine) this.player(playerLine);
        this.thinking();
        this._later(fn, delay);
    }

    /** Run fn after ms unless the scene closes first (the timer is tracked and cleared on close). */
    _later(fn, ms) {
        const id = setTimeout(() => {
            this._timers.delete(id);
            if (!this._closed) fn();
        }, ms);
        this._timers.add(id);
        return id;
    }

    _enqueue(item) {
        if (this._closed) return;
        this._queue.push(item);
        if (!this._typing && !this._voicing) this._flush();
    }

    /** Ask the AI voice for an NPC line; the queue waits (the dots up) until it comes or times out. */
    _askVoice(item) {
        const voice = item.voice;
        item.voice = null;
        this._voicing = true;
        this.thinking();
        let settled = false;
        const settle = (said) => {
            if (settled) return;
            settled = true;
            if (typeof said === 'string' && said.trim()) item.text = said.trim();
            this._voicing = false;
            if (!this._closed) this._flush();
        };
        this._later(() => settle(null), Number(this.cfg.voiceTimeoutMs) || 6000);
        let p;
        try { p = voice(item.text, { ...item.how, history: (this._said || []).slice(-6) }); } catch { p = null; }
        Promise.resolve(p).then(settle, () => settle(null));
    }

    _flush() {
        while (this._queue.length && !this._typing && !this._voicing) {
            if (this._queue[0].kind === 'npc' && this._queue[0].voice) { this._askVoice(this._queue[0]); break; }
            const item = this._queue.shift();
            const thinking = this.log.querySelector('.npc-dialog-thinking');
            if (thinking) thinking.remove();
            const el = document.createElement('div');
            if (item.kind === 'note') {
                el.className = `npc-scene-note tone-${item.tone}`;
                el.innerHTML = item.html;
                this.log.appendChild(el);
                continue;
            }
            if (item.kind === 'card') {
                el.className = 'npc-scene-card';
                el.innerHTML = item.html;
                this.log.appendChild(el);
                continue;
            }
            el.className = `npc-dialog-line ${item.kind === 'npc' ? 'is-npc' : 'is-player'}`;
            // (what has been said, for the AI voice: ui/npcVoice.js)
            (this._said = this._said || []).push({ npc: item.kind === 'npc', text: item.text });
            const textEl = document.createElement('div');
            textEl.className = 'npc-dialog-line-text';
            el.appendChild(textEl);
            this.log.appendChild(el);
            if (item.kind === 'npc') {
                // Only the line being spoken stands out; older lines fade back
                this.log.querySelectorAll('.npc-dialog-text').forEach(t => t.classList.remove('npc-dialog-text'));
                textEl.classList.add('npc-dialog-text');
                this._typing = { el: textEl, text: item.text, timer: null };
                this._type(0);
            } else {
                textEl.innerHTML = formatSpokenLine(item.text);
            }
        }
        this._scroll();
        if (!this._typing && !this._voicing && !this._queue.length) this._idle();
    }

    _type(idx) {
        const t = this._typing;
        if (!t || this._closed) return;
        if (idx === 0) this._speaking(true);
        while (idx < t.text.length && t.text[idx] === '*') idx++;
        if (idx >= t.text.length) { this._finishTyping(); return; }
        const ch = t.text[idx];
        t.el.textContent += ch;
        if (idx % 12 === 0) this._scroll();
        // Speech has rhythm: a beat after sentences, a breath after commas
        const delay = '.!?'.includes(ch) && t.text[idx + 1] === ' ' ? 170 : ',;—'.includes(ch) ? 70 : 15;
        t.timer = setTimeout(() => this._type(idx + 1), delay);
    }

    _finishTyping() {
        const t = this._typing;
        if (!t) return;
        if (t.timer) clearTimeout(t.timer);
        t.el.innerHTML = formatSpokenLine(t.text);
        this._typing = null;
        this._speaking(false);
        this._flush();
    }

    /** Finish the line being spoken at once. Returns true if there was one. */
    skip() {
        if (!this._typing) return false;
        this._finishTyping();
        return true;
    }

    _speaking(on) {
        const portrait = this.overlay.querySelector('.npc-dialog-portrait');
        if (portrait) portrait.classList.toggle('speaking', on);
    }

    _scroll() {
        this.log.scrollTop = this.log.scrollHeight;
    }

    _idle() {
        const waiters = this._waiters || [];
        this._waiters = [];
        for (const fn of waiters) fn();
    }

    /** Run fn once everything queued has been said (plus `pause` ms to read it). */
    afterSpoken(pause, fn) {
        if (this._closed) return;
        const go = () => this._later(fn, pause);
        if (!this._typing && !this._voicing && !this._queue.length) go();
        else (this._waiters = this._waiters || []).push(go);
    }

    // ── Choices ──

    clearChoices() {
        this.choicesEl.innerHTML = '';
        this.overlay._hotkeys = [];
        this.overlay._back = null;
        this.overlay._escChoice = null;
    }

    choices(list, opts = {}) {
        if (this._closed) return;
        renderChoiceGrid(this.overlay, this.choicesEl, list, opts);
    }

    /**
     * A box to type in, in place of the choices (free talk, systems/npcChat.js).
     * opts: { placeholder, onSend(text) (may return a promise: the box waits
     * for it), onDone() (the Done button and Esc), doneLabel, hint }.
     */
    input(opts = {}) {
        if (this._closed) return;
        this.clearChoices();
        const box = renderTalkBox(this.choicesEl, { ...opts, isClosed: () => this._closed });
        this.overlay._escChoice = box.finish;
        return box;
    }

    // ── Flourishes ──

    /** A wax seal stamped across the scene: ok glows, a failure shakes it. */
    seal(skill, word, ok) {
        if (this._closed) return;
        const seal = document.createElement('div');
        seal.className = `npc-dialog-skill-result ${ok ? 'npc-dialog-skill-success' : 'npc-dialog-skill-fail'}`;
        seal.innerHTML = `<span class="npc-dialog-seal-skill">${skill}</span><span class="npc-dialog-seal-word">${word}</span>`;
        this.box.appendChild(seal);
        this.box.classList.remove('npc-dialog-shake', 'npc-dialog-glow');
        void this.box.offsetWidth;
        this.box.classList.add(ok ? 'npc-dialog-glow' : 'npc-dialog-shake');
        setTimeout(() => seal.remove(), 2200);
    }

    /** Say goodbye: no more choices; the scene closes once the last line is read. */
    leave(pause = 900) {
        this._leaving = true;
        this.clearChoices();
        this.afterSpoken(pause, () => this.close());
    }

    close() {
        if (this._closed) return;
        this._closed = true;
        if (this._typing && this._typing.timer) clearTimeout(this._typing.timer);
        for (const id of this._timers) clearTimeout(id);
        this._timers.clear();
        this._typing = null;
        this._queue = [];
        if (this._stopPortrait) this._stopPortrait();
        window.removeEventListener('keydown', this.overlay._keyHandler, true);
        this.overlay.classList.add('is-closing');
        const el = this.overlay;
        setTimeout(() => el.remove(), 180);
        if (_active === this) _active = null;
        if (this.cfg.onClose) this.cfg.onClose();
    }
}

export const ConversationScene = {
    /** Open a scene (closing any other). See the file header for cfg. */
    open(cfg) {
        if (_active) _active.close();
        const stale = document.getElementById('npcDialogOverlay');
        if (stale) stale.remove();
        _active = new Scene(cfg);
        return _active;
    },

    /** The scene on stage, or null. */
    get active() { return _active && _active.isOpen ? _active : null; },

    /**
     * Map a signed standing (about -100…100) to the ring: value 0–100 plus the
     * five familiar tiers, so lords, merchants and townsfolk read alike.
     */
    moodFromStanding(score, labels = {}) {
        const v = Math.max(0, Math.min(100, 50 + score / 2));
        const tier = score >= 50 ? ['warm', '😊', 'Warm & Welcoming', '#4caf50']
            : score >= 20 ? ['fav', '🙂', 'Favorable', '#8bc34a']
                : score >= -10 ? ['neutral', '😐', 'Neutral', '#FFD54F']
                    : score >= -40 ? ['cool', '😒', 'Cool', '#ff9800']
                        : ['hostile', '😠', 'Hostile', '#f44336'];
        return {
            value: v, icon: tier[1], label: labels[tier[0]] || tier[2], color: tier[3],
            shown: `${score >= 0 ? '+' : ''}${Math.round(score)}`,
        };
    },

    /** A stable seed for a sprite from a name. */
    seedOf(str) {
        let h = 0;
        for (const ch of String(str || '')) h = (h * 31 + ch.charCodeAt(0)) | 0;
        return Math.abs(h);
    },
};
