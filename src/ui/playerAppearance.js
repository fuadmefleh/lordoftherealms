// PlayerAppearance — the look chosen at character creation, turned into LPC
// sprite layers. The player keeps a small plain-data record (player.appearance);
// this module builds the layer list from it and registers it with
// InnerMapCharacters as the player's own preset, used by the HUD portraits and
// the walking sprite in towns.
import { InnerMapCharacters } from './innerMapCharacters.js';

const HAIR_COLORS = ['Black', 'Raven', 'Charcoal', 'Brown', 'Chestnut', 'Ash Brown', 'Blonde', 'Platinum',
    'Orange', 'Red', 'Ruby', 'Gray', 'Silver', 'White', 'Pink', 'Purple', 'Violet', 'Blue', 'Teal', 'Green'];

const CLOTH_COLORS = ['Garnet', 'Wine', 'Red', 'Coral', 'Amber', 'Mustard', 'Forest', 'Emerald', 'Teal',
    'Royal', 'Navy', 'Midnight', 'Indigo', 'Purple', 'Plum', 'Lavender', 'Black', 'Charcoal', 'Gray',
    'White', 'Linen', 'Beige', 'Leather', 'Brown', 'Chocolate'];

/** Each option: the choices shown in the picker. `label` drops the asset-pack numbering. */
export const APPEARANCE_OPTIONS = {
    build: [['feminine', 'Feminine'], ['masculine', 'Masculine']],
    skin: ['Porcelain', 'Ivory', 'Peach', 'Honey', 'Tan', 'Bronze', 'Tawny', 'Brown', 'Coffee'],
    eyes: ['Brown', 'Hazel', 'Green', 'Blue', 'Gray', 'Black', 'Purple'],
    hair: ['none', 'Short 01 - Buzzcut', 'Short 02 - Parted', 'Short 03 - Curly', 'Short 04 - Cowlick',
        'Short 05 - Natural', 'Short 06 - Balding', 'Short 07 - Flat Top', 'Short 08 - Flat Top, Fade',
        'Medium 01 - Page', 'Medium 02 - Curly', 'Medium 03 - Idol', 'Medium 04 - Bangs & Bun',
        'Medium 05 - Cornrows', 'Medium 06 - Dreadlocks', 'Medium 07 - Bob, Side Part',
        'Medium 08 - Bob, Bangs', 'Medium 09 - Twists', 'Medium 10 - Twists, Fade'],
    hairColor: HAIR_COLORS,
    beard: ['none', 'Facial Hair 01 - Walrus Mustache', 'Facial Hair 02 - Chevron Mustache',
        'Facial Hair 03 - Handlebar Mustache', 'Facial Hair 04 - Lampshade Mustache',
        'Facial Hair 05 - Horseshoe Mustache', 'Facial Hair 06 - Trimmed Beard', 'Facial Hair 07 - Medium Beard'],
    shirt: ['Shirt 01 - Longsleeve Shirt', 'Shirt 02 - V-neck Longsleeve Shirt', 'Shirt 03 - Scoop Longsleeve Shirt',
        'Shirt 04 - T-shirt', 'Shirt 05 - V-neck T-shirt', 'Shirt 06 - Scoop T-shirt',
        'Shirt 07 - Buttoned Longsleeve Shirt', 'Shirt 08 - Buttoned T-shirt', 'Shirt 09 - Polo'],
    shirtColor: CLOTH_COLORS,
    legs: ['Pants 01 - Hose', 'Pants 02 - Leggings', 'Pants 03 - Pants', 'Pants 04 - Cuffed Pants',
        'Pants 05 - Overalls'],
    legsColor: CLOTH_COLORS,
};

/** Picker rows, in order. `when` hides a row that does not apply. */
export const APPEARANCE_ROWS = [
    { key: 'build', label: 'Build' },
    { key: 'skin', label: 'Skin' },
    { key: 'eyes', label: 'Eyes' },
    { key: 'hair', label: 'Hair' },
    { key: 'hairColor', label: 'Hair Colour', when: a => a.hair !== 'none' || a.beard !== 'none' },
    { key: 'beard', label: 'Beard' },
    { key: 'shirt', label: 'Shirt' },
    { key: 'shirtColor', label: 'Shirt Colour' },
    { key: 'legs', label: 'Legs' },
    { key: 'legsColor', label: 'Legs Colour' },
];

/** The option's value (first entry of a [value, label] pair, or the string). */
function _value(opt) {
    return Array.isArray(opt) ? opt[0] : opt;
}

/** A readable name for one option value. */
export function optionLabel(key, value) {
    if (value === 'none') return key === 'beard' ? 'Clean-shaven' : 'Shaved';
    const pair = (APPEARANCE_OPTIONS[key] || []).find(o => Array.isArray(o) && o[0] === value);
    if (pair) return pair[1];
    // "Facial Hair 03 - Handlebar Mustache" → "Handlebar"; "Shirt 07 - Buttoned Longsleeve Shirt" → "Buttoned Longsleeve"
    return String(value).replace(/^.*? - /, '').replace(/ (Mustache|Shirt)$/, '');
}

/** Step one option forwards or backwards, wrapping. */
export function cycleOption(appearance, key, step) {
    const opts = APPEARANCE_OPTIONS[key].map(_value);
    const i = Math.max(0, opts.indexOf(appearance[key]));
    const next = opts[(i + step + opts.length) % opts.length];
    return { ...appearance, [key]: next };
}

/** The build that goes with a gender ('other' keeps whatever is chosen). */
export function buildForGender(gender, current = 'masculine') {
    if (gender === 'female') return 'feminine';
    if (gender === 'male') return 'masculine';
    return current;
}

/** The look a new character starts with — the old noble presets. */
export function defaultAppearance(gender) {
    const feminine = buildForGender(gender) === 'feminine';
    return feminine
        ? { build: 'feminine', skin: 'Peach', eyes: 'Brown', hair: 'Medium 03 - Idol', hairColor: 'Blonde',
            beard: 'none', shirt: 'Shirt 03 - Scoop Longsleeve Shirt', shirtColor: 'Garnet',
            legs: 'Pants 02 - Leggings', legsColor: 'Midnight' }
        : { build: 'masculine', skin: 'Ivory', eyes: 'Brown', hair: 'Short 02 - Parted', hairColor: 'Black',
            beard: 'none', shirt: 'Shirt 02 - V-neck Longsleeve Shirt', shirtColor: 'Purple',
            legs: 'Pants 03 - Pants', legsColor: 'Midnight' };
}

/** A random look for the given gender. `rand` returns [0, 1). */
export function randomAppearance(gender, rand = Math.random) {
    const pick = key => _value(APPEARANCE_OPTIONS[key][Math.floor(rand() * APPEARANCE_OPTIONS[key].length)]);
    const build = buildForGender(gender, rand() < 0.5 ? 'feminine' : 'masculine');
    const look = { build };
    for (const key of Object.keys(APPEARANCE_OPTIONS)) if (key !== 'build') look[key] = pick(key);
    // Keep the wilder colours and the beards occasional
    if (rand() < 0.75) look.hairColor = HAIR_COLORS[Math.floor(rand() * 13)];
    if (build === 'feminine' || rand() < 0.5) look.beard = 'none';
    if (look.hair === 'none' && rand() < 0.7) look.hair = 'Short 02 - Parted';
    return look;
}

/** The LPC layer paths for a look, bottom to top. */
export function appearanceLayers(a) {
    const fem = a.build === 'feminine';
    const body = fem ? 'Body 01 - Feminine, Thin' : 'Body 02 - Masculine, Thin';
    const head = fem ? 'Head 01 - Feminine' : 'Head 02 - Masculine';
    const cloth = fem ? 'Clothing/Feminine, Thin' : 'Clothing/Masculine, Thin';
    const layers = [
        `Body/${body}/${a.skin}`,
        `Head/${head}/${a.skin}`,
        `Head/Head Overlay - Eyes/${a.eyes}`,
        `${cloth}/Legs/${a.legs}/${a.legsColor}`,
        `${cloth}/Torso/${a.shirt}/${a.shirtColor}`,
    ];
    if (a.beard && a.beard !== 'none') layers.push(`Hair/${a.beard}/${a.hairColor}`);
    if (a.hair && a.hair !== 'none') layers.push(`Hair/${a.hair}/${a.hairColor}`);
    return layers;
}

/** A preset id unique to this look, so a changed look is a new preset. */
export function appearancePresetId(a) {
    return 'player:' + APPEARANCE_ROWS.map(r => a[r.key]).join('|');
}

/** Composite the look as a character preset. Resolves to its id, or null. */
export function registerAppearance(a) {
    const id = appearancePresetId(a);
    if (InnerMapCharacters.getComposited(id)) return Promise.resolve(id);
    return InnerMapCharacters.registerPreset(id, appearanceLayers(a)).then(ok => (ok ? id : null));
}
