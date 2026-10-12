// ============================================
// ICONS — the realm's engraved glyph set
// One set of hand-drawn line glyphs on a 24×24 grid, used both as inline SVG in
// the HUD (icon(), components/Icon.jsx) and as Path2D on the map canvas
// (drawGlyph(), the unit tokens). Everything is drawn in currentColor, so a
// glyph takes the gold, crimson or steel of whatever holds it.
//
// A glyph is a list of parts. A plain string is a stroked path; '~' before it
// is a faint tinted fill (the body of the shape); '#' is a solid fill.
// ============================================

/** Circle as a path (so every part is a `d` string). */
function circle(cx, cy, r) {
    return `M${cx} ${cy - r}a${r} ${r} 0 1 0 0 ${2 * r}a${r} ${r} 0 1 0 0 ${-2 * r}z`;
}

/** A cog: `teeth` teeth between radii r1 (root) and r2 (tip). */
function gear(cx, cy, r1, r2, teeth) {
    const pts = [];
    const step = (Math.PI * 2) / teeth;
    for (let i = 0; i < teeth; i++) {
        const a = i * step - Math.PI / 2;
        const w = step * 0.22;
        pts.push([a - step / 2 + w, r1], [a - w * 1.1, r2], [a + w * 1.1, r2], [a + step / 2 - w, r1]);
    }
    const f = (n) => Math.round(n * 100) / 100;
    return pts.map(([a, r], i) => `${i ? 'L' : 'M'}${f(cx + Math.cos(a) * r)} ${f(cy + Math.sin(a) * r)}`).join('') + 'z';
}

/** Radiating rays between radii r1 and r2. */
function rays(cx, cy, r1, r2, n, offset = 0) {
    let d = '';
    for (let i = 0; i < n; i++) {
        const a = offset + (i * Math.PI * 2) / n;
        const f = (v) => Math.round(v * 100) / 100;
        d += `M${f(cx + Math.cos(a) * r1)} ${f(cy + Math.sin(a) * r1)}L${f(cx + Math.cos(a) * r2)} ${f(cy + Math.sin(a) * r2)}`;
    }
    return d;
}

const STAR = 'M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z';
const SHIELD = 'M12 2.8l8 3v5.4c0 5-3.4 8.6-8 10.2-4.6-1.6-8-5.2-8-10.2V5.8z';
const CROWN = 'M3 8.2l4.2 4.3L12 5.2l4.8 7.3L21 8.2l-2 10.3H5z';
const HOURGLASS = [
    'M6 3h12M6 21h12',
    'M7.5 3c0 5.2 4.5 6 4.5 9s-4.5 3.8-4.5 9',
    'M16.5 3c0 5.2-4.5 6-4.5 9s4.5 3.8 4.5 9',
    '~M8.8 6.5h6.4c-.9 1.9-3.2 3-3.2 3s-2.3-1.1-3.2-3z',
    '~M8.6 20c.3-2 3.4-3 3.4-4.6 0 1.6 3.1 2.6 3.4 4.6z',
];

export const GLYPHS = {
    // ── Top bar ──
    compass: [
        circle(12, 12, 9),
        '#M12 5.2l2.3 6.8h-4.6z',
        'M12 18.8l2.3-6.8h-4.6z',
        rays(12, 12, 9, 10.6, 4, 0),
        circle(12, 12, 1.1),
    ],
    castle: [
        '~M3 21V6h1.7v1.5h1.6V6H8v15zM16 21V6h1.7v1.5h1.6V6H21v15z',
        '~M8 21V11h8v10z',
        'M3 21V6h1.7v1.5h1.6V6H8v15',
        'M16 21V6h1.7v1.5h1.6V6H21v15',
        'M8 11h1.3v1.5h1.4V11h2.6v1.5h1.4V11H16',
        'M2 21h20',
        'M10 21v-3.3a2 2 0 0 1 4 0V21',
        'M5.5 10.5v2.2M18.5 10.5v2.2',
    ],
    swords: [
        'M14.5 17.5L3 6V3h3l11.5 11.5',
        'M13 19l6-6M16 16l4 4M19 21l2-2',
        'M14.5 6.5L18 3h3v3l-3.5 3.5',
        'M5 14l4 4M7 17l-3 3M3 19l2 2',
    ],
    pennant: [
        'M5 21.5V2.5',
        '~M5 4h13l-3.5 4.5L18 13H5z',
        'M5 4h13l-3.5 4.5L18 13H5',
        'M3 21.5h4',
    ],
    book: [
        '~M2.5 5.2c3-1 6.8-.8 9.5 1.6 2.7-2.4 6.5-2.6 9.5-1.6v13.6c-3-1-6.8-.8-9.5 1.6-2.7-2.4-6.5-2.6-9.5-1.6z',
        'M2.5 5.2c3-1 6.8-.8 9.5 1.6 2.7-2.4 6.5-2.6 9.5-1.6v13.6c-3-1-6.8-.8-9.5 1.6-2.7-2.4-6.5-2.6-9.5-1.6z',
        'M12 6.8v13.6',
        'M5 9c1.6-.3 3.2-.1 4.6.6M5 12.2c1.6-.3 3.2-.1 4.6.6M19 9c-1.6-.3-3.2-.1-4.6.6M19 12.2c-1.6-.3-3.2-.1-4.6.6',
    ],
    key: [
        '~' + circle(7.5, 16, 4),
        circle(7.5, 16, 4),
        circle(7.5, 16, 1.3),
        'M10.4 13.1L20.5 3',
        'M15.6 7.9l2.6 2.6M18.2 5.3l2.2 2.2',
    ],
    seal: [
        '~' + circle(12, 9.5, 6.3),
        circle(12, 9.5, 6.3),
        'M12 6.2l1 2.1 2.3.3-1.7 1.6.4 2.3-2-1.1-2 1.1.4-2.3-1.7-1.6 2.3-.3z',
        'M8.4 14.6L7 21.5l2.6-1.4 1.6 1.9.5-5.9',
        'M15.6 14.6L17 21.5l-2.6-1.4-1.6 1.9-.5-5.9',
    ],
    // ── Dropdowns ──
    gem: ['~M6 3.5h12l4 5.5-10 12-10-12z', 'M6 3.5h12l4 5.5-10 12-10-12z', 'M2 9h20', 'M9.5 3.5L8 9l4 12 4-12-1.5-5.5'],
    banner: ['M3.5 3h17', '~M6 3h12v16l-6-3.4L6 19z', 'M6 3h12v16l-6-3.4L6 19z', 'M12 7.2l1 2-1 2-1-2z'],
    layers: ['~M12 3l9 5-9 5-9-5z', 'M12 3l9 5-9 5-9-5z', 'M3 12.3l9 5 9-5', 'M3 16.3l9 5 9-5'],
    person: ['~' + circle(12, 7.5, 4), circle(12, 7.5, 4), 'M4 21c0-4.4 3.6-7.4 8-7.4s8 3 8 7.4'],
    satchel: [
        '~M4 9h16l-1.3 10.4a2 2 0 0 1-2 1.6H7.3a2 2 0 0 1-2-1.6z',
        'M4 9h16l-1.3 10.4a2 2 0 0 1-2 1.6H7.3a2 2 0 0 1-2-1.6z',
        'M8.5 9V7a3.5 3.5 0 0 1 7 0v2',
        'M4 9l8 4.5L20 9',
        'M12 13.5v2.5',
    ],
    coins: [
        '~M5 6c0-1.4 3.1-2.5 7-2.5s7 1.1 7 2.5-3.1 2.5-7 2.5S5 7.4 5 6z',
        'M5 6c0-1.4 3.1-2.5 7-2.5s7 1.1 7 2.5-3.1 2.5-7 2.5S5 7.4 5 6z',
        'M5 6v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6',
        'M5 10v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4',
        'M5 14v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4',
    ],
    house: ['~M5 9.6L12 4l7 5.6V21H5z', 'M2.5 11.2L12 3.8l9.5 7.4', 'M5 9.6V21h14V9.6', 'M10 21v-5.5h4V21', 'M15.5 6.5V3.8h2v4.3'],
    flask: [
        'M8.5 3h7',
        'M10 3v6.2l-5.4 9.3A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.4-2.5L14 9.2V3',
        '~M7.4 14.5h9.2l2.1 3.6a1.3 1.3 0 0 1-1.1 1.9h-11a1.3 1.3 0 0 1-1.1-1.9z',
        'M7.4 14.5h9.2',
        circle(13.5, 17.2, 0.6),
    ],
    chalice: [
        '~M6 3h12c0 5-2.7 8.2-6 8.2S6 8 6 3z',
        'M6 3h12c0 5-2.7 8.2-6 8.2S6 8 6 3z',
        'M12 11.2v5.3',
        'M7.5 21c0-2.3 2-3.9 4.5-3.9s4.5 1.6 4.5 3.9z',
        'M7.8 6.2h8.4',
    ],
    temple: ['~M3 8.5L12 3l9 5.5z', 'M3 8.5L12 3l9 5.5z', 'M4 10.5h16', 'M6 10.5v7.5M10 10.5v7.5M14 10.5v7.5M18 10.5v7.5', 'M4 18h16M3 21h18'],
    heart: [
        '~M12 20.3s-8.3-4.8-8.3-11.2A4.6 4.6 0 0 1 12 6.3a4.6 4.6 0 0 1 8.3 2.8c0 6.4-8.3 11.2-8.3 11.2z',
        'M12 20.3s-8.3-4.8-8.3-11.2A4.6 4.6 0 0 1 12 6.3a4.6 4.6 0 0 1 8.3 2.8c0 6.4-8.3 11.2-8.3 11.2z',
    ],
    boot: [
        '~M7 3h6v8.5l5.6 2.6A2.5 2.5 0 0 1 20 16.4V19H6.3z',
        'M7 3h6v8.5l5.6 2.6A2.5 2.5 0 0 1 20 16.4V19H6.3L7 3z',
        'M5.5 21.5H20.5',
        'M6.8 6.5h6.2',
    ],
    council: [
        '~M3 13.5c0-2 4-3.5 9-3.5s9 1.5 9 3.5-4 3.5-9 3.5-9-1.5-9-3.5z',
        'M3 13.5c0-2 4-3.5 9-3.5s9 1.5 9 3.5-4 3.5-9 3.5-9-1.5-9-3.5z',
        'M6 16.2V21M18 16.2V21M12 17v4',
        circle(5.5, 5.8, 1.7), circle(12, 4.3, 1.7), circle(18.5, 5.8, 1.7),
    ],
    scroll: [
        '~M6 5h12v13a2.5 2.5 0 0 1-2.5 2.5H5.5A2.5 2.5 0 0 0 8 18V5z',
        'M8.5 3.5h10a2 2 0 0 1 2 2v1.5h-4',
        'M8.5 3.5a2 2 0 0 0-2 2V18a2.5 2.5 0 0 1-2.5 2.5h11.5a2.5 2.5 0 0 0 2.5-2.5V7',
        'M4 20.5A2.5 2.5 0 0 1 4 15.5h2.5',
        'M10 9h4.5M10 12.5h4.5',
    ],
    hourglass: HOURGLASS,
    crown: ['~' + CROWN, CROWN, 'M5 21h14', circle(12, 14.5, 1.2)],
    lyre: [
        'M9 16C5 14 4 8.5 6.6 4',
        'M15 16c4-2 5-7.5 2.4-12',
        'M5.2 7h13.6',
        'M10 7v9M12 7v9M14 7v9',
        '~M8.5 16h7l-.8 4.5H9.3z',
        'M8.5 16h7l-.8 4.5H9.3z',
    ],
    spyglass: [
        '~M3.2 15.7l11.7-6.6 2 3.5L5.2 19.2z',
        'M3.2 15.7l11.7-6.6 2 3.5L5.2 19.2z',
        'M14.9 9.1l3.3-1.9 2 3.5-3.3 1.9',
        'M18.2 7.2l1.6-.9 2 3.5-1.6.9',
        'M10.5 16.5L8.5 21.5M11.5 16l2.5 5.5',
    ],
    fire: [
        '~M12 2.5c1 3.2 4.3 4.6 4.3 8.6a4.3 4.3 0 0 1-8.6 0c0-2.2 1-3.4 2-4.3 0 2 .8 3 2 3.3-.3-3 .3-4.8.3-7.6z',
        'M12 2.5c1 3.2 4.3 4.6 4.3 8.6a4.3 4.3 0 0 1-8.6 0c0-2.2 1-3.4 2-4.3 0 2 .8 3 2 3.3-.3-3 .3-4.8.3-7.6z',
        'M3.5 21.5l17-4.5M20.5 21.5l-17-4.5',
    ],
    medal: [
        'M7.5 2.5h3l1.5 3.4 1.5-3.4h3l-2.8 6.6M10.3 9.1L7.5 2.5',
        '~' + circle(12, 15, 6),
        circle(12, 15, 6),
        'M12 11.6l1 2.1 2.3.3-1.7 1.6.4 2.3-2-1.1-2 1.1.4-2.3-1.7-1.6 2.3-.3z',
    ],
    eye: [
        'M1.8 12S5.5 5 12 5s10.2 7 10.2 7-3.7 7-10.2 7S1.8 12 1.8 12z',
        '~' + circle(12, 12, 3.4),
        circle(12, 12, 3.4),
        '#' + circle(12, 12, 1.3),
    ],
    ledger: ['~M5 3h14v18H5z', 'M5 3h14v18H5z', 'M8.5 3v18', 'M11.5 7.5h4.5M11.5 11h4.5M11.5 14.5h3'],
    // ── Resources & status ──
    star: ['~' + STAR, STAR],
    shield: ['~' + SHIELD, SHIELD, 'M8 10.5l4 3 4-3'],
    pickaxe: [
        'M3.5 8.8C7.2 4 16.8 4 20.5 8.8',
        'M3.5 8.8l-.4 2.4M20.5 8.8l.4 2.4',
        'M12 5.3V21.5',
        '~M10.4 5h3.2v3.6h-3.2z',
        'M10.4 5h3.2v3.6h-3.2z',
    ],
    sun: ['~' + circle(12, 12, 4.2), circle(12, 12, 4.2), rays(12, 12, 6.8, 9.6, 8)],
    moon: ['~M19.8 14.6A8.2 8.2 0 1 1 9.4 4.2a6.5 6.5 0 0 0 10.4 10.4z', 'M19.8 14.6A8.2 8.2 0 1 1 9.4 4.2a6.5 6.5 0 0 0 10.4 10.4z'],
    bread: [
        '~M4.5 19V11.5a7.5 5.5 0 0 1 15 0V19z',
        'M4.5 19V11.5a7.5 5.5 0 0 1 15 0V19z',
        'M3 19h18',
        'M9 8.8l-1 3.2M12 8.2v3.6M15 8.8l1 3.2',
    ],
    speech: ['~M4 4.5h16v11H10.5L6 19.5v-4H4z', 'M4 4.5h16v11H10.5L6 19.5v-4H4z', 'M8 9h8M8 12h5'],
    dice: [
        '~M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
        'M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
        '#' + circle(8.5, 8.5, 1.3), '#' + circle(15.5, 15.5, 1.3), '#' + circle(12, 12, 1.3),
        '#' + circle(15.5, 8.5, 1.3), '#' + circle(8.5, 15.5, 1.3),
    ],
    droplet: ['~M12 3s6.2 6.6 6.2 11.2a6.2 6.2 0 0 1-12.4 0C5.8 9.6 12 3 12 3z', 'M12 3s6.2 6.6 6.2 11.2a6.2 6.2 0 0 1-12.4 0C5.8 9.6 12 3 12 3z', 'M9 14.5a3 3 0 0 0 2.5 3'],
    bed: ['M3 5.5v15M21 13v7.5', '~M3 13h18v4.5H3z', 'M3 13h18v4.5H3', '~M5 9.5h5v3.5H5z', 'M5 9.5h5v3.5H5z', 'M11.5 13v-3.5h7a2.5 2.5 0 0 1 2.5 2.5v1'],
    // ── Controls ──
    pause: ['#M6.5 5h4v14h-4zM13.5 5h4v14h-4z'],
    play: ['#M7 4.5l12.5 7.5L7 19.5z'],
    fast: ['#M2.5 5.5l9.5 6.5-9.5 6.5zM12 5.5l9.5 6.5-9.5 6.5z'],
    ultra: ['#M1.5 6l7 6-7 6zM8.5 6l7 6-7 6zM15.5 6l7 6-7 6z'],
    sound: ['~M4 9h3.5L13 4.5v15L7.5 15H4z', 'M4 9h3.5L13 4.5v15L7.5 15H4z', 'M16.2 9a4 4 0 0 1 0 6M18.8 6.4a7.6 7.6 0 0 1 0 11.2'],
    mute: ['~M4 9h3.5L13 4.5v15L7.5 15H4z', 'M4 9h3.5L13 4.5v15L7.5 15H4z', 'M16.5 9.5l5 5M21.5 9.5l-5 5'],
    gear: ['~' + gear(12, 12, 7.2, 9.8, 8), gear(12, 12, 7.2, 9.8, 8), circle(12, 12, 3)],
    help: [circle(12, 12, 9.2), 'M9.4 9.3a2.7 2.7 0 1 1 3.8 2.5c-.8.4-1.2 1-1.2 1.8v.6', '#' + circle(12, 17, 1.1)],
    // ── Map tokens ──
    wagon: [
        '~M4.5 13.5V8.2C4.5 5.6 7 3.5 10.5 3.5s6 2.1 6 4.7v5.3z',
        'M4.5 13.5V8.2C4.5 5.6 7 3.5 10.5 3.5s6 2.1 6 4.7v5.3',
        'M8 4.2v9.3M13 4.2v9.3',
        'M2.5 13.5h16.5l2.5-3',
        circle(7, 17.5, 2.5), circle(15, 17.5, 2.5),
    ],
    axe: [
        'M4.5 21.5L16.8 4.5',
        '~M12.6 6.6C14 3.2 18.8 2 21.5 4.4c-.4 4-3 6.8-6.6 7.2.5-2-.3-4-2.3-5z',
        'M12.6 6.6C14 3.2 18.8 2 21.5 4.4c-.4 4-3 6.8-6.6 7.2.5-2-.3-4-2.3-5z',
    ],
    helm: ['~M5 20.5v-7.5a7 7 0 0 1 14 0v7.5z', 'M5 20.5v-7.5a7 7 0 0 1 14 0v7.5z', 'M5 13.5h5.5v7M19 13.5h-5.5v7', 'M12 2.5v3.5'],
    tent: ['~M12 3.5L2.8 20h18.4z', 'M12 3.5L2.8 20h18.4z', 'M9.3 20L12 13.5l2.7 6.5', 'M12 3.5L10.5 1.5M12 3.5L13.5 1.5', 'M1.5 20h21'],
    ship: [
        '~M2.8 15h18.4l-3.2 5H6z',
        'M2.8 15h18.4l-3.2 5H6z',
        'M12 2.5V15',
        '~M12 4c3.6 2.2 5.2 5.4 5.2 9.2H12z',
        'M12 4c3.6 2.2 5.2 5.4 5.2 9.2H12',
        'M12 6.2c-2.4 2-3.6 4.3-3.6 7H12',
    ],
    skull: [
        '~M12 2.8a7.5 7.2 0 0 0-7.5 7.2c0 2.8 1.6 4.5 3 5.3v3.9h9v-3.9c1.4-.8 3-2.5 3-5.3A7.5 7.2 0 0 0 12 2.8z',
        'M12 2.8a7.5 7.2 0 0 0-7.5 7.2c0 2.8 1.6 4.5 3 5.3v3.9h9v-3.9c1.4-.8 3-2.5 3-5.3A7.5 7.2 0 0 0 12 2.8z',
        '#' + circle(9, 10.5, 1.8), '#' + circle(15, 10.5, 1.8),
        'M10.2 19.2v2.3M13.8 19.2v2.3',
    ],
    boat: ['~M2.8 13.5h18.4l-3.2 5H6z', 'M2.8 13.5h18.4l-3.2 5H6z', 'M7.5 13.5L17 3.5', 'M17 3.5v7', 'M16 10.5a1 1 0 0 0 2 0'],
    sack: [
        '~M7.2 9.5C5.2 11.5 4 14.2 4 16.8A4 4 0 0 0 8 20.8h8a4 4 0 0 0 4-4c0-2.6-1.2-5.3-3.2-7.3z',
        'M7.2 9.5C5.2 11.5 4 14.2 4 16.8A4 4 0 0 0 8 20.8h8a4 4 0 0 0 4-4c0-2.6-1.2-5.3-3.2-7.3z',
        'M7.2 9.5h9.6',
        'M9 9.5L7.5 4.5 12 7l4.5-2.5L15 9.5',
    ],
    paw: [
        '~M12 12c-3 0-6 3.5-6 6.2 0 1.6 1.3 2.5 2.8 2.3 1.2-.2 2-.8 3.2-.8s2 .6 3.2.8c1.5.2 2.8-.7 2.8-2.3C18 15.5 15 12 12 12z',
        'M12 12c-3 0-6 3.5-6 6.2 0 1.6 1.3 2.5 2.8 2.3 1.2-.2 2-.8 3.2-.8s2 .6 3.2.8c1.5.2 2.8-.7 2.8-2.3C18 15.5 15 12 12 12z',
        circle(4.8, 10.2, 1.9), circle(9, 5.8, 2), circle(15, 5.8, 2), circle(19.2, 10.2, 1.9),
    ],
    claw: ['M5.5 2.5c-1.5 6.2.2 12.6 4 18.5', 'M11 2.5c-1 6.2.7 12.4 4.5 18', 'M16.5 2.5c-.4 5.3 1.2 10.3 4.3 14.5'],
    // ── Panel crests ──
    fish: [
        '~M2.5 12c3-4.6 9.2-5.6 14.3-1.4L21 6.8v10.4l-4.2-3.8C11.7 17.6 5.5 16.6 2.5 12z',
        'M2.5 12c3-4.6 9.2-5.6 14.3-1.4L21 6.8v10.4l-4.2-3.8C11.7 17.6 5.5 16.6 2.5 12z',
        '#' + circle(7.5, 11, 1), 'M11.5 9.3c1 1.7 1 3.7 0 5.4',
    ],
    cards: [
        'M3.3 7.6l6.6-2.4 4.6 12.9-6.6 2.4z',
        '~M10.5 3.5h7a1.5 1.5 0 0 1 1.5 1.5v13.5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 9 18.5V5a1.5 1.5 0 0 1 1.5-1.5z',
        'M10.5 3.5h7a1.5 1.5 0 0 1 1.5 1.5v13.5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 9 18.5V5a1.5 1.5 0 0 1 1.5-1.5z',
        '#M14 8.3l2 3.4-2 3.4-2-3.4z',
    ],
    scales: [
        'M12 3.5V20', 'M7.5 20.5h9', 'M4 7h16', '#' + circle(12, 3.6, 1.3),
        '~M4 7l-2.6 6.2a2.6 2.1 0 0 0 5.2 0z', 'M4 7l-2.6 6.2a2.6 2.1 0 0 0 5.2 0z', 'M1.4 13.2h5.2',
        '~M20 7l-2.6 6.2a2.6 2.1 0 0 0 5.2 0z', 'M20 7l-2.6 6.2a2.6 2.1 0 0 0 5.2 0z', 'M17.4 13.2h5.2',
    ],
    anvil: [
        '~M2.5 6.5h14c.3 2.3 2.2 3.5 5 3.5v1.5h-4.2c-1.4 0-2.3 1-2.3 2.4v.6h-6v-.6c0-1.9-1.5-3.4-3.5-3.4h-.5C3.6 10.5 2.5 9 2.5 7.6z',
        'M2.5 6.5h14c.3 2.3 2.2 3.5 5 3.5v1.5h-4.2c-1.4 0-2.3 1-2.3 2.4v.6h-6v-.6c0-1.9-1.5-3.4-3.5-3.4h-.5C3.6 10.5 2.5 9 2.5 7.6z',
        'M9 14.5l-1.8 5.5M15 14.5l1.8 5.5', 'M5.5 20.5h13',
    ],
    wheat: [
        'M12 21.5V4.5', 'M12 4.5c-.9-1-.9-2 0-3 .9 1 .9 2 0 3z',
        'M12 8.5c-2.2-.2-3.5-1.6-3.6-3.6 2.2.1 3.5 1.4 3.6 3.6zM12 8.5c2.2-.2 3.5-1.6 3.6-3.6-2.2.1-3.5 1.4-3.6 3.6z',
        'M12 12.5c-2.2-.2-3.5-1.6-3.6-3.6 2.2.1 3.5 1.4 3.6 3.6zM12 12.5c2.2-.2 3.5-1.6 3.6-3.6-2.2.1-3.5 1.4-3.6 3.6z',
        'M12 16.5c-2.2-.2-3.5-1.6-3.6-3.6 2.2.1 3.5 1.4 3.6 3.6zM12 16.5c2.2-.2 3.5-1.6 3.6-3.6-2.2.1-3.5 1.4-3.6 3.6z',
    ],
    bow: ['M6.5 2.8c7.6 3 7.6 15.4 0 18.4', 'M6.5 2.8v18.4', 'M2.5 12h18', 'M17.5 9.2l3 2.8-3 2.8', 'M2.5 12l-1-1.6M2.5 12l-1 1.6M4.5 12l-1-1.6M4.5 12l-1 1.6'],
    anchor: [
        circle(12, 4.5, 1.8), 'M12 6.3V21', 'M8 9.5h8',
        'M4.5 13.5c0 4.1 3.4 7.5 7.5 7.5s7.5-3.4 7.5-7.5', 'M2.8 15.2l1.7-1.7 1.7 1.7M17.8 15.2l1.7-1.7 1.7 1.7',
    ],
    chart: ['M3 3v18h18', '~M6.5 15.5l4-4.5 3.5 3 5.5-6.5V18h-13z', 'M6.5 15.5l4-4.5 3.5 3 5.5-6.5', 'M16.5 7.5h3v3'],
    magnifier: ['~' + circle(10.5, 10.5, 6.5), circle(10.5, 10.5, 6.5), 'M15.3 15.3L21 21', 'M7.6 9.2a3.4 3.4 0 0 1 2.4-2.3'],
    candle: [
        '~M9 10h6v11H9z', 'M9 10h6v11H9z', 'M7 21h10',
        '~M12 2.5c1.8 2 2.2 3.5 1.5 4.8-.6 1-2.4 1-3 0-.7-1.3-.3-2.8 1.5-4.8z',
        'M12 2.5c1.8 2 2.2 3.5 1.5 4.8-.6 1-2.4 1-3 0-.7-1.3-.3-2.8 1.5-4.8z', 'M12 8.2V10', 'M13.5 10v3',
    ],
    note: [
        'M9 17.5V5.5l11-2.2v12', 'M9 9.2l11-2.2',
        '~M9 17.5a2.6 2.1 0 1 1-5.2 0a2.6 2.1 0 1 1 5.2 0z', 'M9 17.5a2.6 2.1 0 1 1-5.2 0a2.6 2.1 0 1 1 5.2 0z',
        '~M20 15.3a2.6 2.1 0 1 1-5.2 0a2.6 2.1 0 1 1 5.2 0z', 'M20 15.3a2.6 2.1 0 1 1-5.2 0a2.6 2.1 0 1 1 5.2 0z',
    ],
    mask: [
        '~M4 4.5c5.5 1.6 10.5 1.6 16 0v6.2c0 5-3.5 9-8 9.8-4.5-.8-8-4.8-8-9.8z',
        'M4 4.5c5.5 1.6 10.5 1.6 16 0v6.2c0 5-3.5 9-8 9.8-4.5-.8-8-4.8-8-9.8z',
        'M7.3 10.3c.9-.9 2.3-.9 3.2 0M13.5 10.3c.9-.9 2.3-.9 3.2 0', 'M8.5 14.5c2 2.1 5 2.1 7 0',
    ],
    lock: ['~M5 11h14v10H5z', 'M5 11h14v10H5z', 'M8 11V7.5a4 4 0 0 1 8 0V11', '#' + circle(12, 15.2, 1.3), 'M12 16.3v2.2'],
    target: [circle(12, 12, 9), '~' + circle(12, 12, 5.5), circle(12, 12, 5.5), '#' + circle(12, 12, 2)],
    dagger: [
        '~M12 2.5l2 3V15h-4V5.5z', 'M12 2.5l2 3V15h-4V5.5z', 'M12 6v7',
        'M6.5 15h11', 'M12 15v4.3', circle(12, 20.6, 1.3),
    ],
    trophy: [
        '~M7 3.5h10v5a5 5 0 0 1-10 0z', 'M7 3.5h10v5a5 5 0 0 1-10 0z',
        'M7 5.5H4.5a2.6 2.6 0 0 0 2.8 4.6M17 5.5h2.5a2.6 2.6 0 0 1-2.8 4.6',
        'M12 13.5V17', 'M8 21h8l-1-4H9z',
    ],
    tower: [
        '~M6.5 9V4.5h2V6h2V4.5h3V6h2V4.5h2V9z', 'M6.5 9V4.5h2V6h2V4.5h3V6h2V4.5h2V9z',
        '~M7.5 9h9v12h-9z', 'M7.5 9v12M16.5 9v12', 'M11 12h2v3h-2z',
        'M10.5 21v-2.5a1.5 1.5 0 0 1 3 0V21', 'M4.5 21h15',
    ],
    horseshoe: [
        '~M7 20.5H4.5C3.6 17 3 14 3 11.5a9 9 0 0 1 18 0c0 2.5-.6 5.5-1.5 9H17c.8-3 1.3-6 1.3-9a6.3 6.3 0 0 0-12.6 0c0 3 .5 6 1.3 9z',
        'M7 20.5H4.5C3.6 17 3 14 3 11.5a9 9 0 0 1 18 0c0 2.5-.6 5.5-1.5 9H17c.8-3 1.3-6 1.3-9a6.3 6.3 0 0 0-12.6 0c0 3 .5 6 1.3 9z',
        '#' + circle(4.6, 12, 0.7), '#' + circle(6.6, 6.6, 0.7), '#' + circle(17.4, 6.6, 0.7), '#' + circle(19.4, 12, 0.7),
    ],
    ring: [circle(12, 14.5, 6.3), circle(12, 14.5, 4.4), '~M9.5 6.2L12 3l2.5 3.2L12 8.4z', 'M9.5 6.2L12 3l2.5 3.2L12 8.4z'],
    quill: [
        '~M20.5 3c-7.2 1-12.2 6-13.6 13.6C13.6 15.3 18.4 10.3 20.5 3z',
        'M20.5 3c-7.2 1-12.2 6-13.6 13.6C13.6 15.3 18.4 10.3 20.5 3z', 'M6.9 16.6L4.5 21.5', 'M10.5 11.5l3.5.3M13 8.3l3 .1',
    ],
    map: [
        '~M3 6l6-2.5 6 2.5 6-2.5V18l-6 2.5-6-2.5-6 2.5z', 'M3 6l6-2.5 6 2.5 6-2.5V18l-6 2.5-6-2.5-6 2.5z',
        'M9 3.5V18M15 6v14.5', 'M17 9.5l2.2 2.2M19.2 9.5L17 11.7',
    ],
    orb: ['~' + circle(12, 10.5, 7), circle(12, 10.5, 7), 'M7 21h10l-1.6-3.6H8.6z', 'M8.6 9a4 4 0 0 1 3-3'],
    hammer: [
        '~M13 3.6l5.6 5.6-2.6 2.6-5.6-5.6z', 'M13 3.6l5.6 5.6-2.6 2.6-5.6-5.6z',
        'M12.7 9.8l-8.5 8.5a1.8 1.8 0 0 0 2.5 2.5l8.5-8.5',
    ],
    tankard: [
        '~M5 7h10v12a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 5 19z', 'M5 7h10v12a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 5 19z',
        'M15 9.5h2.5a2 2 0 0 1 2 2v3.5a2 2 0 0 1-2 2H15',
        'M4.5 7c0-1.6 1.3-2.9 2.9-2.6.6-1.2 2.2-1.6 3.3-.8 1.2-.8 3-.3 3.6 1 1-.2 1.9.7 1.9 1.7', 'M8.5 10.5v6.5M11.5 10.5v6.5',
    ],
    palette: [
        '~M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.8 0-1.2-1-1.5-1-2.6 0-1 .8-1.6 1.8-1.6H17a4 4 0 0 0 4-4C21 6.4 17 3 12 3z',
        'M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.8 0-1.2-1-1.5-1-2.6 0-1 .8-1.6 1.8-1.6H17a4 4 0 0 0 4-4C21 6.4 17 3 12 3z',
        '#' + circle(7.5, 12, 1.2), '#' + circle(8.8, 7.7, 1.2), '#' + circle(13.2, 6.5, 1.2), '#' + circle(17, 9.4, 1.2),
    ],
    close: ['M6.5 6.5l11 11M17.5 6.5l-11 11'],
    warning: ['~M12 3.2L22 20.5H2z', 'M12 3.2L22 20.5H2z', 'M12 9.5v5', '#' + circle(12, 17.4, 1.1)],
};

const FILL_TINT = 0.2;

/** Inline SVG markup for a glyph (for the innerHTML-built panels). */
export function icon(name, cls = '') {
    const parts = GLYPHS[name];
    if (!parts) return '';
    const body = parts.map((p) => {
        if (p[0] === '~') return `<path d="${p.slice(1)}" fill="currentColor" fill-opacity="${FILL_TINT}" stroke="none"/>`;
        if (p[0] === '#') return `<path d="${p.slice(1)}" fill="currentColor" stroke="none"/>`;
        return `<path d="${p}"/>`;
    }).join('');
    return `<svg class="ico${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** Glyph parts as {d, mode} records (for components/Icon.jsx). */
export function glyphParts(name) {
    return (GLYPHS[name] || []).map((p) => (
        p[0] === '~' ? { d: p.slice(1), mode: 'tint' }
            : p[0] === '#' ? { d: p.slice(1), mode: 'solid' }
                : { d: p, mode: 'stroke' }
    ));
}

const _pathCache = new Map();

/**
 * Draw a glyph on a canvas centred at (cx, cy), `size` px across.
 * Returns false when Path2D is unavailable (tests) so callers can fall back.
 */
export function drawGlyph(ctx, name, cx, cy, size, color, lineWidth = 1.8) {
    if (typeof Path2D === 'undefined' || !GLYPHS[name]) return false;
    let paths = _pathCache.get(name);
    if (!paths) {
        paths = glyphParts(name).map((p) => ({ path: new Path2D(p.d), mode: p.mode }));
        _pathCache.set(name, paths);
    }
    const k = size / 24;
    ctx.save();
    ctx.translate(cx - size / 2, cy - size / 2);
    ctx.scale(k, k);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const p of paths) {
        if (p.mode === 'stroke') {
            ctx.stroke(p.path);
        } else {
            ctx.globalAlpha = p.mode === 'tint' ? 0.28 : 1;
            ctx.fill(p.path);
            ctx.globalAlpha = 1;
        }
    }
    ctx.restore();
    return true;
}

// ── Title crests: the glyph a panel title (or tab label) is known by ──

/** Leading emoji the panels title themselves with → the glyph that replaces it. */
const EMOJI_GLYPHS = {
    '🎣': 'fish', '📋': 'ledger', '🃏': 'cards', '🂡': 'cards', '📜': 'scroll', '⚔': 'swords', '👑': 'crown',
    '⚖': 'scales', '🏰': 'castle', '💰': 'coins', '🕯': 'candle', '🏛': 'temple', '⛪': 'chalice', '🔍': 'magnifier',
    '⚓': 'anchor', '⛏': 'pickaxe', '📖': 'book', '📚': 'book', '🌾': 'wheat', '🤝': 'seal', '🏅': 'medal',
    '🗝': 'key', '🔑': 'key', '🧭': 'compass', '🎲': 'dice', '🔮': 'orb', '📿': 'candle', '⚒': 'anvil', '🏃': 'boot',
    '📯': 'note', '🐴': 'horseshoe', '🏇': 'horseshoe', '🔒': 'lock', '🎯': 'target', '🧾': 'ledger', '🏦': 'temple',
    '📈': 'chart', '📉': 'chart', '📊': 'chart', '🍺': 'tankard', '🗨': 'speech', '💬': 'speech', '⛲': 'droplet',
    '📢': 'pennant', '🗺': 'map', '✏': 'quill', '✍': 'quill', '🎁': 'seal', '🏳': 'banner', '🚩': 'pennant',
    '💔': 'heart', '❤': 'heart', '💕': 'heart', '💍': 'ring', '📰': 'scroll', '🐉': 'claw', '🎭': 'mask', '🤹': 'mask',
    '🎵': 'note', '🎶': 'note', '👶': 'person', '👤': 'person', '🧑': 'person', '🚢': 'ship', '⛵': 'ship', '🚣': 'boat',
    '🛶': 'boat', '📦': 'satchel', '🎒': 'satchel', '🔨': 'hammer', '🛠': 'hammer', '🔧': 'hammer', '🌿': 'wheat',
    '🏹': 'bow', '👥': 'council', '🐫': 'wagon', '🐪': 'wagon', '📒': 'ledger', '🏭': 'anvil', '🏕': 'fire', '🎨': 'palette',
    '🛣': 'compass', '🧶': 'satchel', '🔥': 'fire', '🗡': 'dagger', '🏆': 'trophy', '🗼': 'tower', '🤏': 'dagger',
    '🏴': 'skull', '☠': 'skull', '💀': 'skull', '🧘': 'sun', '☀': 'sun', '✨': 'star', '⭐': 'star', '🌟': 'star',
    '🕵': 'eye', '👁': 'eye', '⏳': 'hourglass', '⌛': 'hourglass', '🕰': 'hourglass', '🏪': 'coins',
    '🛡': 'shield', '🙏': 'chalice', '🏠': 'house', '🏡': 'house', '🏘': 'house', '⚙': 'gear', '🔬': 'flask', '⚗': 'flask',
    '💎': 'gem', '🐟': 'fish', '⛺': 'tent', '🌙': 'moon', '🐺': 'paw', '🍞': 'bread', '🍖': 'bread', '🏗': 'hammer',
    '📝': 'quill', '✉': 'seal', '📨': 'seal', '👪': 'council', '🎪': 'mask', '🍻': 'tankard', '🗳': 'council',
    '💱': 'coins', '💼': 'satchel', '👗': 'gem', '🧺': 'bread', '⚠': 'warning', '✊': 'anvil', '😊': 'heart',
    '🏷': 'ledger', '💹': 'chart', '🖼': 'palette', '🌍': 'compass', '🌎': 'compass', '🏖': 'boat', '🌊': 'ship',
    '🌀': 'anchor', '🛒': 'coins', '📍': 'banner', '🖌': 'palette', '🗑': 'close', '🚧': 'lock', '🚪': 'house',
    '🚫': 'close', '🛤': 'wagon', '❗': 'warning', '⛔': 'close',
};

/** Plain titles (no emoji) by keyword → glyph; the first match wins. */
const TITLE_GLYPHS = [
    [/propert|real estate|^house$|housing/i, 'house'],
    [/temple|miracle|religio|holy|donation|faith|pray/i, 'chalice'],
    [/colon|pioneer|native|form kingdom/i, 'banner'],
    [/ship|sail|coastal|harbo/i, 'ship'],
    [/bank|treasury|tax|coin/i, 'coins'],
    [/ledger|contract|econom|account/i, 'ledger'],
    [/trade|market|merchant/i, 'scales'],
    [/tournament|joust|archery|hero/i, 'trophy'],
    [/festival|feast|performance|stories/i, 'mask'],
    [/smuggl|pirate/i, 'skull'],
    [/relationship|wedding|divorce|meet people|character|romance/i, 'heart'],
    [/dynast|heir|house name|death|appoint|ambition|court|crown/i, 'crown'],
    [/travel|journey|road/i, 'boot'],
    [/history|quest|notice|journal|chronicle/i, 'scroll'],
    [/inventory|goods|stores/i, 'satchel'],
    [/recruit|army|military|war|siege|attack/i, 'swords'],
    [/forge|labou?r|work|craft|guild/i, 'anvil'],
    [/criminal|jail|prison/i, 'lock'],
    [/people|town|council/i, 'council'],
    [/build|infrastructure|construct/i, 'hammer'],
    [/spy|intel|espionage/i, 'eye'],
    [/setting|option/i, 'gear'],
];

// A leading emoji (with its variation selectors, skin tones and joined sequences)
const LEADING_EMOJI = /^\s*((?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:️|\p{Emoji_Modifier}|‍(?:\p{Extended_Pictographic}|\p{Regional_Indicator}))*️?)\s*/u;

/**
 * Split a title into its crest and its words: { glyph, emoji, text }.
 * `glyph` is a GLYPHS name when one stands for the title; otherwise `emoji`
 * keeps an emoji the set has no glyph for. `text` is the title without it.
 */
export function titleCrest(title, fallback = 'scroll') {
    const str = String(title == null ? '' : title);
    const m = str.match(LEADING_EMOJI);
    const text = m ? str.slice(m[0].length) : str;
    if (m) {
        const base = m[1].replace(/[️‍].*$/u, '').replace(/\p{Emoji_Modifier}/gu, '');
        const glyph = EMOJI_GLYPHS[base] || EMOJI_GLYPHS[[...base][0]];
        return glyph ? { glyph, emoji: null, text } : { glyph: null, emoji: m[1], text };
    }
    for (const [re, glyph] of TITLE_GLYPHS) if (re.test(text)) return { glyph, emoji: null, text };
    return { glyph: fallback, emoji: null, text };
}

/** A label with its leading emoji swapped for the glyph, when the set has one (tab labels). */
export function glyphLabel(label) {
    const str = String(label == null ? '' : label);
    if (!LEADING_EMOJI.test(str)) return str;
    const c = titleCrest(str, null);
    return c.glyph ? `${icon(c.glyph, 'ico-label')}${c.text}` : str;
}
