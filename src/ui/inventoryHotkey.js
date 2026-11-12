// ============================================
// INVENTORY HOTKEY — I opens and closes the Inventory window
// ============================================
// Read by the game's keydown handler (ui/game/gameLoop.js). Pure, so the rules
// are tested without a running game (__tests__/inventoryHotkey.test.js): a key
// typed into a text box, a chord (Ctrl/Alt/⌘+I: the browser's own) or a held
// key's repeats never toggle the window.

/** Is `el` somewhere text is being typed (an input, a text area, a select, an editable)? */
export function isTextEntry(el) {
    if (!el) return false;
    const tag = String(el.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return !!(el.closest && el.closest('[contenteditable=""], [contenteditable="true"]'));
}

/** Is this keydown the Inventory hotkey (I, either case, alone, not typed into a field)? */
export function isInventoryKey(e) {
    if (!e || e.ctrlKey || e.altKey || e.metaKey || e.repeat) return false;
    if (e.key !== 'i' && e.key !== 'I') return false;
    return !isTextEntry(e.target);
}
