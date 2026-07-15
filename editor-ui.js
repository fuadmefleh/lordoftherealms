/* ============================================================
   EditorUI — shared in-app dialog helpers for the editor suite
   ------------------------------------------------------------
   Promise-based replacements for the native prompt()/alert()/
   confirm() calls scattered across the editors. Ships as a plain
   classic script (no ES module) so it works identically inside
   every editor iframe with a single <script src="editor-ui.js">.

   Styling lives in editor-ui.css (.eui-modal / .eui-toast / …).
   All DOM ids/classes are `eui-` scoped to avoid colliding with
   per-file #toast / .te-modal / #tt-prereq-modal implementations.

   API (all attached to window.EditorUI):
     toast(msg, {type, duration})              -> void   type: 'ok'|'err'|''
     confirm(message, {title, danger, okText, cancelText}) -> Promise<boolean>
     prompt(message, {title, placeholder, value, validate})-> Promise<string|null>
     form(title, fields[])                     -> Promise<object|null>
       fields: {key, label, type?, placeholder?, value?}
     modal({title, bodyEl|bodyHTML, actions[], onOpen}) -> {close()}
       actions: {label, value?, className?, primary?, danger?, onClick?}
   ============================================================ */
(function () {
  'use strict';

  if (window.EditorUI) return; // idempotent across re-includes

  // Deterministic id generator (no Math.random — repo lints against it).
  var _idSeq = 0;
  function nextId(prefix) { _idSeq += 1; return (prefix || 'eui') + '-' + _idSeq; }

  // ── Toast ────────────────────────────────────────────────
  var _toastEl = null;
  var _toastTimer = null;
  function toast(msg, opts) {
    opts = opts || {};
    if (!_toastEl) {
      _toastEl = document.createElement('div');
      _toastEl.className = 'eui-toast';
      document.body.appendChild(_toastEl);
    }
    _toastEl.textContent = msg;
    _toastEl.className = 'eui-toast show ' + (opts.type || '');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () {
      _toastEl.className = 'eui-toast ' + (opts.type || '');
    }, opts.duration || 2400);
  }

  // ── Low-level modal ──────────────────────────────────────
  // Returns { close(value) }. Handles overlay, focus trap, Esc,
  // backdrop click, and focus restore.
  function modal(cfg) {
    cfg = cfg || {};
    var prevFocus = document.activeElement;

    var overlay = document.createElement('div');
    overlay.className = 'eui-modal';

    var box = document.createElement('div');
    box.className = 'eui-modal-box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    if (cfg.title) {
      var h = document.createElement('div');
      h.className = 'eui-modal-title';
      h.textContent = cfg.title;
      var titleId = nextId('eui-title');
      h.id = titleId;
      box.setAttribute('aria-labelledby', titleId);
      box.appendChild(h);
    }

    var body = document.createElement('div');
    body.className = 'eui-modal-body';
    if (cfg.bodyEl) body.appendChild(cfg.bodyEl);
    else if (cfg.bodyHTML != null) body.innerHTML = cfg.bodyHTML;
    if (body.childNodes.length || cfg.bodyHTML != null) box.appendChild(body);

    var actionsWrap = document.createElement('div');
    actionsWrap.className = 'eui-modal-actions';
    box.appendChild(actionsWrap);

    var closed = false;
    function close(value) {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      if (prevFocus && typeof prevFocus.focus === 'function') {
        try { prevFocus.focus(); } catch (e) { /* element gone */ }
      }
      if (typeof cfg.onClose === 'function') cfg.onClose(value);
    }

    (cfg.actions || []).forEach(function (a) {
      var btn = document.createElement('button');
      btn.textContent = a.label;
      if (a.primary) btn.className = 'primary';
      else if (a.danger) btn.className = 'danger';
      if (a.className) btn.className += ' ' + a.className;
      btn.onclick = function () {
        if (typeof a.onClick === 'function') {
          var keep = a.onClick();
          if (keep === false) return; // action requested to stay open
        }
        close(a.value);
      };
      actionsWrap.appendChild(btn);
    });

    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(cfg.escValue); }
    }
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay && cfg.backdropClose !== false) close(cfg.escValue);
    });

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    if (typeof cfg.onOpen === 'function') cfg.onOpen(box, close);
    else {
      var focusable = box.querySelector('input, textarea, select, button.primary, button');
      if (focusable) focusable.focus();
    }

    return { close: close, box: box };
  }

  // ── confirm ──────────────────────────────────────────────
  function confirm(message, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      modal({
        title: opts.title || 'Confirm',
        bodyHTML: '<p>' + escapeHTML(message) + '</p>',
        escValue: false,
        onClose: function (v) { resolve(v === true); },
        actions: [
          { label: opts.cancelText || 'Cancel', value: false },
          {
            label: opts.okText || (opts.danger ? 'Delete' : 'Confirm'),
            value: true, primary: !opts.danger, danger: !!opts.danger
          }
        ],
        onOpen: function (box, close) {
          var ok = box.querySelector('.eui-modal-actions button.primary, .eui-modal-actions button.danger');
          if (ok) ok.focus();
          box.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); close(true); }
          });
        }
      });
    });
  }

  // ── prompt ───────────────────────────────────────────────
  function prompt(message, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'eui-modal-field';
      input.placeholder = opts.placeholder || '';
      input.value = opts.value != null ? opts.value : '';

      var body = document.createElement('div');
      if (message) {
        var p = document.createElement('p');
        p.textContent = message;
        body.appendChild(p);
      }
      body.appendChild(input);

      var ref = modal({
        title: opts.title || 'Enter value',
        bodyEl: body,
        escValue: null,
        onClose: function (v) { resolve(v === undefined ? null : v); },
        actions: [
          { label: opts.cancelText || 'Cancel', value: null },
          { label: opts.okText || 'OK', value: undefined, primary: true,
            onClick: function () {
              if (typeof opts.validate === 'function' && !opts.validate(input.value)) {
                input.focus();
                return false;
              }
              ref.close(input.value);
              return false; // we already closed with the value
            } }
        ],
        onOpen: function () { input.focus(); input.select(); }
      });

      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          if (typeof opts.validate === 'function' && !opts.validate(input.value)) return;
          ref.close(input.value);
        } else if (e.key === 'Escape') {
          ref.close(null);
        }
      });
    });
  }

  // ── form (multi-field) ───────────────────────────────────
  function form(title, fields) {
    fields = fields || [];
    return new Promise(function (resolve) {
      var inputs = {};
      var body = document.createElement('div');
      fields.forEach(function (f) {
        var row = document.createElement('div');
        row.className = 'eui-modal-row';
        var lbl = document.createElement('label');
        lbl.textContent = f.label;
        var inp = document.createElement('input');
        inp.type = f.type || 'text';
        inp.className = 'eui-modal-field';
        inp.placeholder = f.placeholder || '';
        inp.value = f.value != null ? f.value : '';
        inputs[f.key] = inp;
        row.appendChild(lbl);
        row.appendChild(inp);
        body.appendChild(row);
      });

      function collect() {
        var out = {};
        fields.forEach(function (f) { out[f.key] = inputs[f.key].value; });
        return out;
      }

      var ref = modal({
        title: title,
        bodyEl: body,
        escValue: null,
        onClose: function (v) { resolve(v === undefined ? null : v); },
        actions: [
          { label: 'Cancel', value: null },
          { label: 'OK', primary: true, onClick: function () { ref.close(collect()); return false; } }
        ],
        onOpen: function () {
          var first = fields[0] && inputs[fields[0].key];
          if (first) { first.focus(); first.select(); }
        }
      });

      var lastKey = fields.length ? fields[fields.length - 1].key : null;
      if (lastKey) inputs[lastKey].addEventListener('keydown', function (e) {
        if (e.key === 'Enter') ref.close(collect());
        if (e.key === 'Escape') ref.close(null);
      });
    });
  }

  function escapeHTML(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  window.EditorUI = {
    toast: toast,
    confirm: confirm,
    prompt: prompt,
    form: form,
    modal: modal,
    _mount: function () { /* DOM is created lazily; nothing eager to do */ }
  };
})();
