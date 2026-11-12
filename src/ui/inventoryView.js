// ============================================
// INVENTORY VIEW — what the Inventory window
// lists, and how it is filtered and sorted
// ============================================
// Pure: the window (ui/ui/inventoryPanel.js) hands in the packs and a context
// of lookups (a good's name, icon and price; whether it is arms, a meal, a
// treasure), so this can be tested without the game data or a DOM
// (__tests__/inventoryView.test.js). The categories come from
// data/inventory.json.

/** The filters when data/inventory.json is missing (tests, an old build). */
const DEFAULT_CATALOG = {
    fallback: 'trade',
    categories: [
        { id: 'food', label: 'Food & drink', icon: '🍞', items: [] },
        { id: 'materials', label: 'Materials', icon: '⛏️', items: [] },
        { id: 'tools', label: 'Tools & gear', icon: '🔧', items: [] },
        { id: 'arms', label: 'Arms & armour', icon: '⚔️', items: [] },
        { id: 'clothing', label: 'Clothing', icon: '👕', items: [] },
        { id: 'physic', label: 'Physic', icon: '🌿', items: [] },
        { id: 'seeds', label: 'Seeds', icon: '🌱', items: [] },
        { id: 'trade', label: 'Trade goods', icon: '📦', items: [] },
        { id: 'valuables', label: 'Valuables', icon: '💎', items: [] },
    ],
    sorts: [
        { id: 'category', label: 'Kind' },
        { id: 'name', label: 'Name' },
        { id: 'qty', label: 'Quantity' },
        { id: 'value', label: 'Worth' },
        { id: 'unitValue', label: 'Price each' },
    ],
};

/** Keys of the packs that are not goods. */
const NOT_GOODS = new Set(['gold']);

/**
 * The catalog made ready: { categories, fallback, sorts, byItem: Map(itemId → categoryId), order: Map(categoryId → index) }.
 * `data` is data/inventory.json (DataLoader._gamedata.inventory) or nothing.
 */
export function catalogOf(data) {
    const src = data && Array.isArray(data.categories) && data.categories.length ? data : DEFAULT_CATALOG;
    const categories = src.categories.filter(c => c && c.id).map(c => ({ id: c.id, label: c.label || c.id, icon: c.icon || '', items: Array.isArray(c.items) ? c.items : [] }));
    const byItem = new Map();
    for (const c of categories) for (const id of c.items) if (!byItem.has(id)) byItem.set(id, c.id);
    const order = new Map(categories.map((c, i) => [c.id, i]));
    const fallback = order.has(src.fallback) ? src.fallback : (categories[categories.length - 1] || {}).id;
    const sorts = Array.isArray(src.sorts) && src.sorts.length ? src.sorts : DEFAULT_CATALOG.sorts;
    return { categories, fallback, sorts, byItem, order };
}

/**
 * Which filter a good falls under: the catalog's own list first, then by
 * what it is (arms → arms, a meal → food, a treasure → valuables, a seed →
 * seeds), else the fallback.
 * ctx = { isArms(id), isFood(id), isTreasure(id) } (each optional)
 */
export function categoryOf(itemId, catalog, ctx = {}) {
    const cat = catalog || catalogOf(null);
    if (cat.byItem.has(itemId)) return cat.byItem.get(itemId);
    const has = (id) => cat.order.has(id);
    if (ctx.isArms && ctx.isArms(itemId) && has('arms')) return 'arms';
    if (ctx.isFood && ctx.isFood(itemId) && has('food')) return 'food';
    if (ctx.isTreasure && ctx.isTreasure(itemId) && has('valuables')) return 'valuables';
    if (/_seeds?$/.test(String(itemId)) && has('seeds')) return 'seeds';
    return cat.fallback;
}

function _prettyId(id) {
    return String(id).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * One entry per good carried (positive stacks; not coin):
 * { id, name, icon, qty, unitValue, value, category }.
 * ctx = { goodOf(id) → { name, icon, basePrice } | null, isArms, isFood, isTreasure }
 */
export function buildEntries(inventory, catalog, ctx = {}) {
    const out = [];
    for (const id in (inventory || {})) {
        if (NOT_GOODS.has(id)) continue;
        const qty = Number(inventory[id]) || 0;
        if (qty <= 0) continue;
        const g = (ctx.goodOf && ctx.goodOf(id)) || null;
        const unitValue = Math.max(0, Number(g && g.basePrice) || 0);
        out.push({
            id,
            name: (g && g.name) || _prettyId(id),
            icon: (g && g.icon) || '📦',
            qty,
            unitValue,
            value: unitValue * qty,
            category: categoryOf(id, catalog, ctx),
        });
    }
    return out;
}

/** How many goods under each filter: { all, [categoryId]: n }. */
export function categoryCounts(entries) {
    const counts = { all: 0 };
    for (const e of entries || []) {
        counts.all++;
        counts[e.category] = (counts[e.category] || 0) + 1;
    }
    return counts;
}

/** The direction a sort reads best in when first chosen: names A→Z, numbers biggest first. */
export function defaultDir(sort) {
    return sort === 'name' || sort === 'category' ? 'asc' : 'desc';
}

/**
 * The entries to show: under `category` ('all' for every one), matching
 * `query` (name, id or the filter's label, any case), sorted by `sort`
 * ('category' | 'name' | 'qty' | 'value' | 'unitValue') in `dir` ('asc' |
 * 'desc'; the sort's own default when left out). Ties fall back to the name.
 */
export function filterSort(entries, opts = {}, catalog = null) {
    const cat = catalog || catalogOf(null);
    const category = opts.category || 'all';
    const sort = opts.sort || 'category';
    const dir = opts.dir === 'asc' || opts.dir === 'desc' ? opts.dir : defaultDir(sort);
    const q = String(opts.query || '').trim().toLowerCase();
    const labelOf = (id) => ((cat.categories.find(c => c.id === id) || {}).label || '').toLowerCase();
    let list = (entries || []).filter(e => category === 'all' || e.category === category);
    if (q) list = list.filter(e => e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q) || labelOf(e.category).includes(q));
    const byName = (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    const key = {
        name: null,
        qty: (e) => e.qty,
        value: (e) => e.value,
        unitValue: (e) => e.unitValue,
        category: (e) => (cat.order.has(e.category) ? cat.order.get(e.category) : 999),
    }[sort];
    const sign = dir === 'asc' ? 1 : -1;
    list = list.slice().sort((a, b) => {
        if (key) {
            const d = key(a) - key(b);
            if (d) return d * sign;
            return byName(a, b);
        }
        return byName(a, b) * sign;
    });
    return list;
}
