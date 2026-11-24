# Builds scripts/pixel_icons/icons.json: the most-used emoji in src/ and data/,
# each with a PixelLab prompt (generate.mjs makes the art; src/ui/pixelIcons.js
# swaps the emoji for it). Run: python scripts/pixel_icons/make_list.py [count]
import collections
import json
import os
import re
import sys
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
COUNT = int(sys.argv[1]) if len(sys.argv) > 1 else 250
PAT = re.compile(r'(?:[\U0001F1E6-\U0001F1FF]{2})|(?:[\U0001F300-\U0001FAFF☀-➿⬀-⯿⌀-⏿]️?(?:‍[\U0001F300-\U0001FAFF☀-➿]️?)*)')

SKIPWORDS = ['check mark', 'heavy check', 'music', 'eighth note', 'beamed', 'circle', 'square', 'ballot box with',
             'multiplication', 'cross mark', 'plus sign', 'minus', 'digit', 'keycap', 'black small', 'white small',
             'question', 'exclamation', 'copyright', 'registered', 'trade mark', 'curly loop', 'double vertical bar',
             'triangle', 'four pointed star', 'black star', 'white star', 'diamond suit', 'heart suit', 'spade suit',
             'club suit', 'arrow', 'counterclockwise', 'clockwise', 'black square', 'large', 'medium small']
KEEP_ANYWAY = {'🏹', '🍀', '🗳', '⭐', '🌟', '⚠'}

# Prompts: what each stands for in this game (the modern ones made medieval)
O = {
    '⚔': 'two steel swords crossed in an X', '💰': 'a leather money bag full of gold coins',
    '📜': 'a rolled parchment scroll with a red wax seal, tied with a ribbon', '👑': 'a golden royal crown with red gems',
    '🔥': 'a bright orange flame', '⚖': 'golden balance scales of justice', '🛡': 'a heater shield with a heraldic cross',
    '📦': 'a wooden crate with iron bands', '🗡': 'a steel dagger', '🏰': 'a stone castle with towers and a gate',
    '🏛': 'a classical stone temple with columns', '🤝': 'two hands clasped in a handshake',
    '🕯': 'a lit wax candle on a brass holder', '🌾': 'a sheaf of golden wheat', '🌿': 'a green herb sprig',
    '⚓': 'an iron ship anchor', '🧭': 'a brass compass', '💍': 'a gold ring with a gem',
    '🕊': 'a white dove with an olive branch', '⛓': 'iron chain links', '⛏': 'an iron pickaxe', '💀': 'a white skull',
    '⚠': 'a yellow warning triangle with an exclamation mark', '🌊': 'a blue ocean wave', '⭐': 'a gold star',
    '🗣': 'a speaking head silhouette with sound lines', '🔨': 'an iron hammer', '🗺': 'an unrolled parchment map',
    '⛵': 'a small sailing ship', '🏗': 'a wooden building under construction with scaffolding',
    '🙏': 'two hands pressed together in prayer', '🗝': 'an old iron key', '💺': 'a simple wooden chair',
    '⛪': 'a stone chapel with a bell tower', '📖': 'an open old book', '🛏': 'a wooden bed with a blanket',
    '👥': 'two people silhouettes', '⚒': 'a hammer and a pick crossed', '⏳': 'an hourglass with flowing sand',
    '🧺': 'a woven wicker basket', '🚪': 'a wooden door with iron hinges', '🎒': 'a leather travel backpack',
    '🏘': 'a cluster of medieval cottages', '⛰': 'a rocky mountain peak', '💧': 'a blue water droplet',
    '🍞': 'a loaf of bread', '⚰': 'a wooden coffin', '🏠': 'a medieval timber cottage', '🐴': 'a brown horse head',
    '🏚': 'a ruined cottage with a broken roof', '🌲': 'a pine tree', '🚩': 'a red pennant flag on a pole',
    '📚': 'a stack of old leather books', '🎲': 'a bone die', '✨': 'golden sparkles',
    '🍺': 'a wooden tankard of ale with foam', '✉': 'a sealed letter with a wax seal', '🐎': 'a galloping brown horse',
    '📋': 'a parchment list pinned to a wooden board', '🍖': 'a roasted meat leg on the bone',
    '🎭': 'theatre masks of comedy and tragedy', '👤': 'a person silhouette bust', '🏳': 'a white flag on a pole',
    '🛶': 'a small wooden rowing boat', '🔒': 'a closed iron padlock', '🕵': 'a hooded spy in a dark cloak',
    '❄': 'a white snowflake', '💔': 'a broken red heart', '⚡': 'a yellow lightning bolt', '🌱': 'a green seedling sprout',
    '🏃': 'a running person', '🏴‍☠': 'a black pirate flag with a white skull and crossbones',
    '🏦': 'a stone counting house with columns and a gold coin sign', '🏆': 'a golden trophy cup',
    '🎓': 'a black scholar cap', '🎣': 'a fishing rod with a caught fish',
    '🎯': 'an archery target with an arrow in the bullseye', '💎': 'a blue cut gemstone', '🔧': 'an iron spanner tool',
    '🔪': 'a kitchen knife', '🛢': 'a wooden barrel', '🐟': 'a silver fish', '🍲': 'an iron cooking pot of stew',
    '☠': 'a skull and crossbones', '❤': 'a red heart', '📈': 'a parchment chart with a rising green line',
    '🛒': 'a wooden market handcart', '🚶': 'a walking person', '🎖': 'a military medal with a ribbon',
    '✋': 'a raised open hand', '💬': 'a white speech bubble', '🏡': 'a cottage with a garden fence',
    '🤒': 'a sick face with a thermometer', '🌑': 'a dark new moon', '👁': 'a single eye', '📒': 'a ledger book',
    '🧱': 'a stack of red bricks', '🕳': 'a dark hole in the ground', '😠': 'an angry red face',
    '🐫': 'a camel with two humps', '🎁': 'a gift box with a ribbon', '🔱': 'a golden trident', '🦅': 'an eagle',
    '🐚': 'a spiral sea shell', '🧑': 'a medieval peasant person', '🏅': 'a gold medal', '🧾': 'a parchment receipt',
    '🐀': 'a grey rat', '✒': 'a quill pen nib', '🛤': 'a dirt road with cart tracks', '🐾': 'animal paw prints',
    '🐑': 'a white sheep', '🧶': 'a ball of wool yarn', '🏕': 'a campsite with a tent and a campfire',
    '📯': 'a brass post horn', '🐉': 'a green dragon', '🏺': 'a clay amphora', '🏇': 'a rider on a galloping horse',
    '🥀': 'a wilted rose', '🏪': 'a market stall with a striped awning',
    '📉': 'a parchment chart with a falling red line', '🎨': 'a painter palette with paint',
    '😊': 'a smiling happy face', '🗿': 'a carved stone head statue', '🖋': 'a quill pen and ink pot',
    '🧪': 'a glass potion vial', '⛺': 'a canvas tent', '⚕': 'a staff with a serpent, the healer sign',
    '🏴': 'a black flag on a pole', '💨': 'a puff of wind', '🚧': 'a wooden barricade with striped boards',
    '📣': 'a herald brass horn', '🍷': 'a goblet of red wine', '🦊': 'a red fox head', '💪': 'a flexed arm muscle',
    '🌅': 'a sun rising over hills', '👶': 'a baby swaddled in cloth', '🍂': 'a fallen autumn leaf',
    '📮': 'a courier satchel with letters', '✊': 'a raised fist', '🦴': 'a white bone', '🚫': 'a red prohibition sign',
    '🤫': 'a face with a finger to the lips', '📍': 'a red map pin', '🏮': 'a hanging paper lantern',
    '☀': 'a bright yellow sun', '🤕': 'a face with a head bandage', '🔗': 'two iron chain links',
    '🌳': 'a leafy oak tree', '🌙': 'a crescent moon', '💤': 'sleeping zzz letters', '🐺': 'a grey wolf head',
    '🏜': 'desert sand dunes', '🏭': 'a smoking blacksmith workshop', '🔓': 'an open iron padlock',
    '🥅': 'a rope net', '⚜': 'a golden fleur-de-lis', '🔍': 'a brass magnifying glass',
    '🧳': 'a leather travelling trunk', '💢': 'a red anger mark', '🙂': 'a slightly smiling face',
    '🔮': 'a glowing crystal ball', '🛁': 'a wooden bathtub', '🦌': 'a deer with antlers', '😐': 'a neutral face',
    '📿': 'prayer beads', '💊': 'a small pouch of medicinal herbs', '✍': 'a hand writing with a quill',
    '🌟': 'a glowing gold star', '👂': 'an ear', '🏝': 'a small island with a palm tree',
    '🎉': 'a burst of festive confetti', '💛': 'a yellow heart', '🐍': 'a green snake', '👣': 'bare footprints',
    '👛': 'a small coin purse', '🌋': 'an erupting volcano', '💥': 'an explosion burst', '📕': 'a closed red book',
    '💂': 'a medieval guard with a spear and helmet', '🎪': 'a striped fair pavilion tent',
    '🧂': 'a small bowl of salt', '📨': 'an incoming letter', '📐': 'a wooden carpenter set square',
    '🗼': 'a stone watchtower', '🚢': 'a large sailing galleon', '🦵': 'a leg', '📅': 'a parchment calendar',
    '🧵': 'a spool of thread', '🛣': 'a paved stone road', '👀': 'a pair of eyes', '🏫': 'a stone schoolhouse',
    '⚙': 'an iron cog gear', '🛠': 'a hammer and wrench crossed', '🧼': 'a bar of soap', '🍄': 'a red mushroom',
    '⛲': 'a stone fountain', '🌍': 'a globe of the world', '💸': 'gold coins with wings flying away',
    '🌉': 'a stone arch bridge', '🖐': 'an open hand with fingers spread', '🌰': 'a chestnut',
    '🚨': 'a ringing alarm bell', '🐄': 'a cow', '🥈': 'a silver medal', '🔑': 'a golden key',
    '🥩': 'a raw cut of meat', '🛌': 'a person asleep in a bed', '🚣': 'a person rowing a boat',
    '📢': 'a herald horn blaring', '🔎': 'a brass magnifying glass', '😤': 'a huffing triumphant face',
    '😒': 'an unamused face', '🤐': 'a face with a sealed mouth', '🏷': 'a price tag on a string',
    '💼': 'a leather satchel', '✂': 'iron shears', '🔬': 'a brass magnifying lens on a stand',
    '🧹': 'a straw broom', '⛈': 'a dark storm cloud with rain and lightning', '🦁': 'a lion head',
    '👪': 'a family of three', '🔔': 'a brass bell', '⛔': 'a red no entry sign', '⚗': 'an alchemist alembic',
    '🙇': 'a person bowing deeply', '🗑': 'a wicker waste basket', '⛩': 'a wooden wayside shrine',
    '🕸': 'a spider web', '🧘': 'a person meditating cross-legged', '🥶': 'a freezing blue face',
    '🏟': 'a tournament arena with stands', '🍽': 'a plate with a knife and fork',
    '💌': 'a love letter with a heart seal', '🌫': 'a bank of grey fog', '🥾': 'a leather boot',
    '🔭': 'a brass spyglass', '🍻': 'two clinking tankards of ale', '🌴': 'a palm tree', '👦': 'a boy',
    '🍇': 'a bunch of purple grapes', '🥕': 'a carrot', '🏹': 'a wooden bow with an arrow',
    '🍀': 'a four leaf clover', '💫': 'swirling yellow stars of dizziness', '📊': 'a parchment bar chart',
    '🪟': 'a wooden framed window', '🌀': 'a blue swirling whirlwind', '🥣': 'a wooden bowl with a spoon',
    '☯': 'a yin yang symbol', '🧠': 'a pink brain', '🗳': 'a wooden ballot box', '🔔️': 'a brass bell',
}

# Second tries after review (2026-11-23): the first prompt drew the wrong thing
O.update({
    "🤝": "two forearms clasping hands in a firm handshake, side view",
    "🌾": "a bundle of golden wheat stalks with ears of grain, tied with twine",
    "🗣": "a bearded man's head in side profile, mouth open, shouting, with curved sound lines",
    "🔨": "a blacksmith hammer with a wooden handle and a heavy iron head, diagonal",
    "⚒": "a hammer and a pickaxe crossed in an X",
    "⛰": "a mountain with a snowy peak and grey rocky slopes",
    "🍖": "a roasted ham leg on a white bone, golden brown meat",
    "👤": "a dark grey silhouette of a person's head and shoulders",
    "💔": "a red heart cracked in two halves with a jagged split",
    "🎣": "a wooden fishing rod with a line and a fish hanging on the hook",
    "🛢": "a wooden barrel with iron hoops, side view",
    "✋": "an open palm raised in a stop gesture",
    "🤒": "a round pale sick face with a thermometer in its mouth",
    "👁": "a single human eye, almond shaped, blue iris",
    "🔱": "a golden three-pronged trident spear",
    "🐚": "a spiral conch sea shell, pink and cream",
    "🛤": "a dirt path with wheel ruts winding through grass",
    "🐾": "four dark animal paw prints",
    "📉": "a parchment chart with a red line going down",
    "😊": "a round yellow smiling face",
    "⚕": "a wooden staff with a green snake coiled around it",
    "💨": "a white puff of wind with swirling lines",
    "🚧": "a wooden barricade with red and white striped planks",
    "💪": "a flexed muscular arm with a bulging bicep",
    "🌅": "a sun rising over green hills at dawn",
    "✊": "a clenched fist raised",
    "🤫": "a round face with a white bandage wrapped around the head",
    "🤕": "a round face with a finger pressed to its lips, hushing",
    "💤": "blue letters Z Z Z floating, sleep",
    "🏭": "a stone blacksmith forge building with a smoking chimney",
    "🙂": "a round yellow face with a slight smile",
    "😐": "a round yellow face with a straight flat mouth",
    "👣": "two bare human footprints",
    "📨": "an envelope flying in with motion lines",
    "🦵": "a human leg in a leather boot",
    "🛣": "a cobblestone road going into the distance",
    "🛠": "a hammer and a wrench crossed in an X",
    "🚨": "a brass bell ringing with motion lines",
    "😤": "a round face snorting steam from its nose",
    "🤐": "a round face with a zipper across its mouth",
    "⛔": "a red circle sign with a white horizontal bar",
    "🙇": "a person bowing deeply from the waist, side view",
    "🏟": "a wooden tournament arena with banners and stands",
    "🌫": "a bank of grey mist drifting",
    "💫": "a ring of small yellow stars spinning",
    "📊": "a parchment with a bar chart of three bars",
})


def uname(e):
    try:
        return ' + '.join(unicodedata.name(ch).lower() for ch in e if ch not in '‍️')
    except ValueError:
        return ''


def main():
    cnt = collections.Counter()
    for base in ('src', 'data'):
        for dp, _dn, fn in os.walk(os.path.join(ROOT, base)):
            if '__tests__' in dp:
                continue
            for f in fn:
                if not f.endswith(('.js', '.jsx', '.json')) or f == 'gamedata.json':
                    continue
                s = open(os.path.join(dp, f), encoding='utf-8', errors='ignore').read()
                for m in PAT.findall(s):
                    cnt[m.replace('️', '')] += 1
    keep = []
    for e, n in cnt.most_common():
        nm = uname(e)
        if e not in KEEP_ANYWAY and any(k in nm for k in SKIPWORDS):
            continue
        keep.append((e, n, nm))
        if len(keep) == COUNT:
            break
    icons = []
    for e, n, nm in keep:
        icons.append({
            'emoji': e, 'uses': n, 'name': nm,
            'desc': O.get(e) or ('a ' + nm.replace(' + ', ' with ')),
            'file': '-'.join(f'{ord(ch):x}' for ch in e if ch not in '‍️') + '.png',
        })
    # Two tries and still wrong: left as emoji (build_sheet.py skips them)
    rejected = ['🤝', '⚒', '🛤', '📉', '💨', '🚧', '💪', '✊', '💤', '🛣', '🛠', '😤', '🤐', '⛔', '🏟', '🌫', '💫', '📊', '👁', '🤫', '🎣']
    out = {
        'rejected': rejected,
        '_doc': 'Pixel icons made with PixelLab (scripts/pixel_icons/generate.mjs) standing in for emoji in the HUD and on the canvas (src/ui/pixelIcons.js). desc is the prompt, file the emoji code points. The most-used emoji (make_list.py).',
        'suffix': ', medieval fantasy game UI icon, centered, transparent background, bold dark outline',
        'icons': icons,
    }
    path = os.path.join(ROOT, 'scripts', 'pixel_icons', 'icons.json')
    json.dump(out, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    missing = [i['emoji'] + ' ' + i['desc'] for i in icons if i['emoji'] not in O]
    print(len(icons), 'icons;', len(missing), 'with an automatic prompt:')
    print('\n'.join(missing))


main()
