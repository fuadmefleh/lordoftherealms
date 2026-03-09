// ============================================
// NPC DIALOG SYSTEM — Expanded Conversations with NPCs
// ============================================
// Features:
//   - NPC memory & disposition tracking (remembers past interactions)
//   - Context-aware dialog (time of day, weather, season, settlement, player title)
//   - Skill checks with visible requirements (Intimidate, Charm, Persuade)
//   - Quest offering through dialog
//   - Gift-giving & bribery
//   - Ask about location / kingdom info
//   - Relationship-aware greetings & moods
//   - Mood indicator & disposition bar in UI

import { InnerMap } from '../world/innerMap.js';
import { ActionMenu } from './actionMenu.js';
import { NpcFamily } from '../systems/npcFamily.js';

// ══════════════════════════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════════════════════════

let _active = false;
let _game = null;
let _npc = null;
let _lines = [];       // Array of { speaker, text, icon, isNpc, _action }
let _lineIndex = 0;
let _overlay = null;
let _typewriteTimer = null;
let _typewriteComplete = false; // Whether current text has finished typing

// ══════════════════════════════════════════════════════════════════════════════
// NPC MEMORY — persisted on the NPC object so it survives dialog close
// ══════════════════════════════════════════════════════════════════════════════

function _mem(npc) {
    if (!npc._dialogMemory) {
        npc._dialogMemory = {
            timesSpoken: 0,      // Total conversations
            disposition: 50,     // 0=hostile, 50=neutral, 100=friendly
            lastAction: null,    // Last player action toward this NPC
            giftsReceived: 0,    // How many gifts
            threatened: false,   // Ever threatened
            flattered: false,    // Ever flattered
            questOffered: false, // Already offered a quest this session
            rumorsTold: 0,       // How many rumors shared
            playerTitle: null,   // Last known player title
        };
    }
    return npc._dialogMemory;
}

function _dispositionLabel(d) {
    if (d >= 90) return { text: 'Devoted', color: '#4FC3F7', icon: '💙' };
    if (d >= 75) return { text: 'Friendly', color: '#66BB6A', icon: '😊' };
    if (d >= 55) return { text: 'Warm', color: '#A5D6A7', icon: '🙂' };
    if (d >= 40) return { text: 'Neutral', color: '#FFD54F', icon: '😐' };
    if (d >= 25) return { text: 'Wary', color: '#FF8A65', icon: '😒' };
    if (d >= 10) return { text: 'Unfriendly', color: '#EF5350', icon: '😠' };
    return { text: 'Hostile', color: '#D32F2F', icon: '🤬' };
}

// ══════════════════════════════════════════════════════════════════════════════
// DIALOG LINE POOLS
// ══════════════════════════════════════════════════════════════════════════════

const GREETINGS = {
    merchant:    ['Welcome! Looking to trade?', 'Fine goods at fair prices!', 'Step right up! What catches your eye?', 'Ah, a customer! What can I do for you?'],
    guard:       ['Halt. State your business.', 'Keep your weapons sheathed in town.', 'Move along, citizen.', 'No trouble here, I hope.'],
    farmer:      ['Good day! Harvest is coming along nicely.', '*wipes brow* Hard work, but honest.', 'Fields won\'t tend themselves!', 'Mornin\'. You here about the crops?'],
    priest:      ['Blessings upon you, child.', 'The gods watch over us all.', 'Peace be with you, traveler.', 'Come seeking wisdom, have you?'],
    blacksmith_npc: ['*clang clang* Ah, hello there!', 'Need something forged?', 'I can put an edge on any blade.', 'The forge runs hot today!'],
    villager:    ['Oh, hello there!', 'Nice day, isn\'t it?', 'Haven\'t seen you around before.', 'Good to see a fresh face!'],
    child:       ['*giggles* Hi!', 'Are you an adventurer?!', 'My mama says I shouldn\'t talk to strangers...', 'Wow, you look strong!'],
    noble:       ['Ah, a visitor. How delightful.', 'I trust you know proper etiquette.', 'One must maintain standards, you know.', 'Do you come bearing news from abroad?'],
    traveler:    ['Greetings, fellow wanderer!', 'The roads have been long.', 'I\'ve seen many lands on my journey.', 'Another traveler! Well met!'],
    beggar:      ['Spare a coin, kind soul?', '*coughs* Anything to eat?', 'The cold is terrible tonight...', 'Bless you if you can help...'],
};

// Returning greetings — when player has spoken to this NPC before
const RETURNING_GREETINGS = {
    merchant:    ['Back again! I knew you couldn\'t resist my prices.', 'My favorite customer returns!', 'I set aside something special for you.'],
    guard:       ['You again. Staying out of trouble?', 'I remember you. Carry on.', 'Back so soon? The patrol routes haven\'t changed.'],
    farmer:      ['Well well, the traveler returns! Good to see you.', 'Back for more stories? *chuckles*', 'Ah, my friend! How have the roads been?'],
    priest:      ['Ah, you have returned. The gods smile upon your devotion.', 'Welcome back, child. I sensed you would return.', 'Your spirit draws you here again. Good.'],
    blacksmith_npc: ['Back for more steel? I like your style!', 'Ah, you again! That blade holding up?', 'I\'ve been working on some new pieces since last time.'],
    villager:    ['Oh, it\'s you again! How lovely!', 'Welcome back, friend!', 'I was just thinking about you. Strange, that.'],
    child:       ['You came back! *jumps excitedly*', 'I told my friends about you!', 'Yay, my adventurer friend is here!'],
    noble:       ['Ah, you return. I trust you bring something of interest.', 'Back again? At least you have taste.', 'I recall your face. What news?'],
    traveler:    ['Our paths cross again! Fate weaves strangely.', 'My friend! I have new tales to share!', 'Well met again, fellow wanderer!'],
    beggar:      ['You... you remembered me? *tears up*', 'Kind soul, you\'ve returned...', 'I prayed someone would come. Thank you.'],
};

// Greetings when player has high reputation or title
const RESPECTFUL_GREETINGS = {
    merchant:    ['My lord! The finest goods in the land for you!', 'An honor to serve someone of your standing!'],
    guard:       ['*salutes* An honor, my lord! How may I serve?', 'Your reputation precedes you. Welcome.'],
    farmer:      ['M-my lord! *bows* I didn\'t expect someone so important here!', 'Your fame has reached even these humble fields!'],
    priest:      ['A soul of great renown graces our humble sanctum.', 'The gods have marked you for greatness, I can see it.'],
    blacksmith_npc: ['Your lordship! I\'d be honored to forge for you!', 'I\'ve heard of your exploits. Let me craft something worthy!'],
    villager:    ['Oh my! You\'re... you\'re actually here! *awestruck*', 'Everyone talks about you! Welcome!'],
    child:       ['Are you really THE adventurer?! I heard you fought a whole army!', 'My da says you\'re the most famous person in the realm!'],
    noble:       ['Ah, a person of genuine accomplishment. A rare pleasure.', 'Your reputation does you justice. Welcome.'],
    traveler:    ['The legendary wanderer! I\'ve heard your name in every tavern!', 'Songs are sung about you on the road, you know.'],
    beggar:      ['Even someone like me has heard your name. Please, a moment of your time...', 'They say you\'re a kind soul. I can see it.'],
};

// Greetings for hostile disposition
const HOSTILE_GREETINGS = {
    merchant:    ['Oh. It\'s you. *glares* Make it quick.', 'I\'d rather not deal with you, but gold is gold...'],
    guard:       ['YOU. Keep your hands where I can see them.', 'I\'ve got my eye on you. One wrong move...'],
    farmer:      ['*grips pitchfork tightly* What do you want?', 'I heard about you. Stay away from my family.'],
    priest:      ['Even the gods\' patience has limits, sinner.', 'I sense a dark aura about you. State your business.'],
    blacksmith_npc: ['*hefts hammer* I remember you. This better be good.', 'You\'ve got nerve showing your face here.'],
    villager:    ['Oh no, not you again... *backs away*', 'Please, I don\'t want trouble!'],
    child:       ['*hides behind barrel* Mama said to stay away from you!', 'Go away! You\'re mean!'],
    noble:       ['How dare you approach me after what you\'ve done.', 'Security! ...very well, speak. But mind your tongue.'],
    traveler:    ['I know your reputation. Don\'t expect kindness.', 'Word travels fast. You\'re not welcome.'],
    beggar:      ['Even I have standards. What do you want?', '*shuffles away nervously*'],
};

const RUMORS = {
    merchant: [
        'Business isn\'t what it used to be. Taxes are bleeding us dry.',
        'I heard a caravan from the east was robbed on the highway.',
        'If you\'re buying, I have some rare spices — fell off a cart, you know.',
        'The lord\'s been stockpiling weapons. Makes you wonder.',
        'Trade routes to the north have been dangerous of late.',
        'A wealthy merchant disappeared last week. Some say pirates, some say the crown.',
        'There\'s a secret auction happening soon. Only the connected know about it.',
    ],
    guard: [
        'We\'ve had reports of bandits in the forest nearby.',
        'There was a brawl at the tavern last night. Two men in the stocks.',
        'The captain wants patrols doubled. Something has him worried.',
        'If you see anything suspicious, report it to the barracks.',
        'A prisoner escaped from the dungeons. Keep your eyes open.',
        'Strange lights were seen on the old watchtower last midnight.',
        'The armory was broken into. Someone stole a cache of weapons.',
    ],
    farmer: [
        'The harvest festival should be grand this year, if the weather holds.',
        'Something\'s been getting into the grain stores. Rats, maybe worse.',
        'Old Thorvald says there\'ll be an early frost. He\'s usually right.',
        'We lost two goats last week. Wolves, the tracks suggest.',
        'They say the soil near the old ruins grows nothing but thorns.',
        'The well water tastes different lately. Metallic, almost.',
        'A strange traveler bought all our grain last week. Paid double. Suspicious.',
    ],
    priest: [
        'Strange omens have appeared in the night sky. The faithful are uneasy.',
        'A pilgrim passed through with tales of miracles in the southern temple.',
        'The old scriptures speak of a darkness that returns every century.',
        'I pray for peace, but my heart tells me trials are coming.',
        'The relics in the church have been glowing faintly. A sign, perhaps.',
        'A heretic sect has been spreading its influence in the surrounding villages.',
        'The ancient burial grounds to the east — the dead do not rest easy there.',
    ],
    blacksmith_npc: [
        'I got my hands on some fine ore from the mountains. Rare stuff.',
        'A knight ordered a sword last week. Paid triple for a rush job.',
        'The quality of iron from the mines has been declining lately.',
        'I could forge you something special, if you bring the right materials.',
        'They say dwarven steel never dulls. Wish I knew the secret.',
        'Someone\'s been buying up all the coal. Preparing for something big.',
        'I found strange markings on the ore from the northern mine. Ancient runes.',
    ],
    villager: [
        'Did you hear? They found a body by the river last week.',
        'My neighbor swears he saw lights in the old cemetery.',
        'The baker\'s daughter ran off with a traveling minstrel!',
        'Prices at market have been climbing. Hard times ahead, I reckon.',
        'There\'s talk of raising a militia. The lord must be expecting trouble.',
        'Old Marta claims she found a treasure map in her attic. Nobody believes her.',
        'The fishermen are refusing to go out. Say something lurks beneath the water.',
    ],
    child: [
        'I found a shiny rock by the stream! Want to see?',
        'The other kids say there\'s a monster in the well. I don\'t believe them!',
        'My da says I\'ll be a knight someday! Or maybe a dragon rider!',
        'I saw a HUGE spider in the cellar! This big! *spreads arms*',
        'Do you know any magic? Please please please show me!',
        'I hid treasure behind the old oak tree! Don\'t tell anyone!',
        'There\'s a secret passage behind the church! I saw a man use it!',
    ],
    noble: [
        'The court is abuzz with talk of alliances forming to the west.',
        'I suspect the chancellor is embezzling from the treasury.',
        'Do keep this between us — the lord\'s health is failing.',
        'The neighboring realm has been making rather bold territorial claims.',
        'One hears the most fascinating rumors at court dinners.',
        'A delegation arrived from across the sea last month. Very hush-hush.',
        'The heir apparent has been seen consorting with known rebels.',
    ],
    traveler: [
        'I passed through a village two days\' ride from here — completely abandoned.',
        'The mountain pass to the north is blocked by an avalanche.',
        'I met a group of monks on the road. They spoke of an ancient prophecy.',
        'The taverns in the capital serve the best ale. Trust me on that.',
        'There\'s a bounty out for a notorious bandit chief. Quite a sum.',
        'I came across ruins in the forest. Ancient pillars covered in vines.',
        'A caravan master told me of a shortcut through the marshes. Dangerous, but fast.',
    ],
    beggar: [
        'I wasn\'t always like this. I used to be a soldier, you know.',
        'The rats in the sewers are getting bolder. Bigger, too.',
        'I see everything from down here. The rich don\'t bother watching their tongues.',
        'A kind stranger gave me bread yesterday. Gives you faith in people.',
        'I know where the thieves\' guild meets. That information costs, though.',
        'Last night I saw the tax collector slip into the noble\'s back entrance.',
        'They dump bodies in the river at night. I\'ve seen it. Don\'t ask me more.',
    ],
};

const FAREWELLS = {
    merchant:    ['Safe travels! Come back when you need supplies.', 'Good doing business!', 'May your purse stay heavy!'],
    guard:       ['Move along now.', 'Stay out of trouble.', 'Keep to the main roads after dark.'],
    farmer:      ['Well, back to work! Fields won\'t plow themselves.', 'Take care now!', 'If you need fresh produce, you know where to find me.'],
    priest:      ['Go with the gods\' blessing.', 'May light guide your path.', 'I shall pray for your safe journey.'],
    blacksmith_npc: ['*turns back to forge* Come again!', 'If you need repairs, I\'m your man.', 'Stay sharp out there!'],
    villager:    ['Well, nice chatting! I should be going.', 'Take care, stranger.', 'Hope to see you around!'],
    child:       ['Bye bye! *waves*', 'Come play again sometime!', 'I gotta go before mama finds me!'],
    noble:       ['It was... tolerable speaking with you.', 'Good day to you.', 'I have more pressing matters to attend to.'],
    traveler:    ['May the roads be kind to you!', 'Perhaps our paths will cross again.', 'Safe travels, friend.'],
    beggar:      ['Bless you... bless you...', '*shuffles away*', 'The gods remember kindness.'],
};

const THREAT_RESPONSES = {
    merchant:    ['P-please! I\'m just a humble merchant! Don\'t hurt me!', 'Is that... is that a threat?! Guards! GUARDS!'],
    guard:       ['Oh, you want trouble? I\'ll give you trouble!', '*hand moves to sword hilt* Choose your next words very carefully.'],
    farmer:      ['*backs away* I-I don\'t want any trouble, friend...', 'What?! I\'ve done nothing to you!'],
    priest:      ['Violence is the refuge of the small-minded.', 'I will pray for your soul. You clearly need it.'],
    blacksmith_npc: ['*hefts hammer* I\'d rethink that if I were you.', 'You\'re threatening a man who bends iron for a living?'],
    villager:    ['*stammers* W-what did I do?!', 'Please, I have a family!'],
    child:       ['*lip trembles* I\'m telling my mama!', '*starts crying*'],
    noble:       ['How DARE you! Do you know who I am?!', 'I\'ll have you flogged for your insolence!'],
    traveler:    ['Easy now... I\'m no one\'s enemy.', 'We can settle this like civilized folk, can\'t we?'],
    beggar:      ['*cowers* I have nothing! Nothing!', 'Hit me then. I\'ve nothing left to lose.'],
};

// Successful intimidation — NPC cowers and reveals something
const THREAT_SUCCESS = {
    merchant:    ['F-fine! I\'ll give you a discount, just please don\'t hurt me!', 'Okay okay! I\'ll tell you — the real goods are hidden in the back!'],
    guard:       ['*swallows hard* L-look, I\'ll turn a blind eye this once...', 'Fine! The password for the night watch is "iron gate". Now leave me be!'],
    farmer:      ['I\'ll talk! The bandit camp is in the woods east of here!', 'Please! Take some food, just go! *hands over bread*'],
    priest:      ['*shaking* The vault beneath the altar... there are relics of great power there.', 'I confess! I\'ve been hiding a fugitive in the cellar!'],
    blacksmith_npc: ['*drops hammer* I-I made weapons for bandits. They threatened my family!', 'Take this blade! It\'s my finest! Just leave me alone!'],
    villager:    ['I saw the mayor sneaking out at night! Meeting someone in the forest!', 'I\'ll tell you everything! The grain stores — they\'re half empty. The lord is lying!'],
    child:       ['*sobbing* I\'ll show you where the treasure is! Just don\'t yell!', 'There\'s a secret hole under the old bridge! People hide things there!'],
    noble:       ['*composure breaks* Fine! I\'ll arrange an audience with the lord!', 'You brute! ...the treasury ledgers are falsified. There, satisfied?!'],
    traveler:    ['Alright, alright! I know where a bandit hideout is. I\'ll draw you a map.', 'I have contacts in the capital. I can get you information. Just back off!'],
    beggar:      ['The thieves enter through the brewery cellar every third night!', 'I know where the assassin sleeps! Room 3 at the inn! Please don\'t hurt me!'],
};

const FLATTER_RESPONSES = {
    merchant:    ['Well now, aren\'t you sweet! Here, let me show you my finest wares...', 'Ha! Flattery will get you a discount, friend!'],
    guard:       ['*stands a little taller* Well, I do try to keep informed...', 'Hmph. At least someone appreciates the watch.'],
    farmer:      ['*blushes* Oh, go on! I\'m just a simple farmer...', 'Wise? Me? Well, I suppose I do know a thing or two about the land.'],
    priest:      ['Your words are kind. Wisdom comes from the gods, not from me.', 'How gracious of you. Let me share a blessing in return.'],
    blacksmith_npc: ['*grins* You want the best steel? You\'ve come to the right forge!', 'Well, I won\'t deny I know my craft!'],
    villager:    ['Oh my! *giggles* You\'re too kind, really!', 'Well aren\'t you charming! What do you want to know?'],
    child:       ['*beams* Really?! Nobody ever says that to me!', 'You\'re nice! Want to be friends?'],
    noble:       ['At last, someone with taste and breeding.', '*nods approvingly* You clearly understand quality.'],
    traveler:    ['Ha! You\'re a good sort. Let me buy you a drink sometime.', 'Indeed I am! *chuckles* Here, let me tell you something useful...'],
    beggar:      ['*eyes well up* Nobody\'s spoken kindly to me in... so long.', 'You... you mean that? Truly?'],
};

// Successful charm — NPC opens up with extra info
const FLATTER_SUCCESS = {
    merchant:    ['Since you\'re so charming... I\'ll let you in on a trade secret. The spice caravan arrives on the third day — buy early!', 'You know what, I like you. I\'ll knock 10% off everything. Don\'t tell the others!'],
    guard:       ['Between you and me... the captain is planning a raid on the smuggler\'s cove tomorrow night.', 'You seem trustworthy. The dungeon guard changes shift at midnight. That\'s when security is weakest.'],
    farmer:      ['You\'re such a dear! Here, take some of my best produce. I insist!', 'Since you asked so nicely — there\'s an old cave behind my wheat field. Might have some valuables hidden there.'],
    priest:      ['Your kindness moves me. I shall bestow a minor blessing upon you.', 'Few souls are as pure. Come, let me teach you an ancient prayer of protection.'],
    blacksmith_npc: ['For you? I\'ll add a special edge to your next blade — no extra charge!', 'You\'ve earned my trust. There\'s a rare ore vein in the mountains northwest of here.'],
    villager:    ['Oh, you\'re just wonderful! Here, I baked too many pies — please take one!', 'You\'re so kind! Let me tell you — my cousin in the capital says the king is looking for adventurers!'],
    child:       ['You\'re my best friend now! I\'ll show you my secret hiding spot!', 'Here! I found this shiny thing by the river! You can have it! *hands over trinket*'],
    noble:       ['I must say, your refinement is refreshing. Join me for dinner at the manor sometime.', 'Someone of your caliber deserves to know — there\'s a position opening in the court. I could put in a word.'],
    traveler:    ['A kindred spirit! Let me mark some safe campsites on your map.', 'You\'ve won my trust. I know a hidden path through the mountains. Cuts the journey in half.'],
    beggar:      ['*weeping* Thank you... Here, take this. It\'s all I have. A key to... somewhere. I found it in the gutter.', 'Your kindness gives me strength. I used to serve at the palace. Let me tell you what I know.'],
};

// ── Context-aware time-of-day comments ──────────────────────────────────────

const TIME_COMMENTS = {
    morning:   ['Early start, eh?', 'Fine morning today.', 'The sun is barely up — you\'re keen!', 'Best time of day, this.'],
    afternoon: ['Hot afternoon, isn\'t it?', 'The day wears on.', 'Afternoon\'s the busiest time around here.'],
    evening:   ['Getting dark soon. Best head indoors.', 'Evening already? Time flies.', 'The sunset is beautiful tonight.'],
    night:     ['It\'s late — what brings you out at this hour?', 'Careful wandering at night.', 'Most folk are asleep by now.', 'The night has ears, friend.'],
};

// Weather-aware comments
const WEATHER_COMMENTS = {
    rain:   ['This rain won\'t let up...', 'Miserable weather, isn\'t it?', 'I\'m soaked to the bone!', 'Good for the crops, at least.'],
    snow:   ['This cold goes right through you.', 'Snow\'s piling up fast.', 'I can barely feel my fingers!', 'Beautiful snowfall, but treacherous.'],
    storm:  ['This storm is fierce!', 'We should find shelter!', 'The gods are angry today!', 'Thunder shakes the very walls!'],
    clear:  ['Beautiful clear sky today.', 'Not a cloud in sight!', 'Perfect weather for traveling.'],
};

// ── Quest templates that NPCs can offer ─────────────────────────────────────

const NPC_QUEST_HOOKS = {
    merchant: [
        { text: 'Actually... I have a problem you might help with. A caravan of mine went missing on the northern road. Find it and I\'ll make it worth your while.', type: 'escort_trade_caravan', reward: 'gold' },
        { text: 'I\'ve been trying to get a shipment of rare spices, but the supplier won\'t deal with middlemen. Could you negotiate on my behalf?', type: 'merchant_delivery', reward: 'gold' },
    ],
    guard: [
        { text: 'Look, I\'m not supposed to ask civilians, but... we\'re understaffed. There\'s a bandit camp in the forest that needs clearing out. Interested?', type: 'clear_bandits', reward: 'reputation' },
        { text: 'Between us, I lost a patrol report. If the captain finds out... Could you help me search the tavern? I think I dropped it there.', type: 'fetch_item', reward: 'favor' },
    ],
    farmer: [
        { text: 'Something\'s been attacking my livestock at night. I can\'t afford to lose more animals. Could you investigate? I\'ll pay what I can.', type: 'investigate_threat', reward: 'gold' },
        { text: 'My son went into the old forest three days ago and hasn\'t returned. Please, if you could look for him...', type: 'rescue_person', reward: 'reputation' },
    ],
    priest: [
        { text: 'There is a holy relic that was stolen from our shrine. I believe it was taken to the ruins east of here. Can you retrieve it?', type: 'retrieve_relic', reward: 'blessing' },
        { text: 'A plague of dark spirits haunts the old cemetery. The faithful are too afraid to visit their ancestors\' graves. Will you help?', type: 'clear_undead', reward: 'blessing' },
    ],
    blacksmith_npc: [
        { text: 'I need rare ore from the mountain caves. The regular miners won\'t go — say it\'s too dangerous. I\'ll forge you a masterwork if you bring me some.', type: 'gather_resource', reward: 'equipment' },
        { text: 'A knight\'s sword I forged was stolen. My reputation is at stake! Track down the thief and I\'ll owe you one.', type: 'retrieve_item', reward: 'equipment' },
    ],
    villager: [
        { text: 'My grandmother\'s locket was taken by those awful bandits. It\'s all I have left of her. Could you... could you try to get it back?', type: 'retrieve_item', reward: 'gratitude' },
        { text: 'We need someone to deliver medicine to the old hermit in the hills. It\'s too dangerous for us townsfolk.', type: 'delivery', reward: 'gold' },
    ],
    noble: [
        { text: 'I need a discreet individual for a delicate matter. A rival noble has documents that could... embarrass my family. Retrieve them.', type: 'espionage', reward: 'gold' },
        { text: 'There is a matter of honor that requires attention. A minor lord has insulted my house. I need someone to deliver my challenge.', type: 'delivery', reward: 'reputation' },
    ],
    traveler: [
        { text: 'I discovered the entrance to ancient ruins on my last journey. I lack the courage to explore alone. Join me and we split the findings?', type: 'explore_ruins', reward: 'treasure' },
        { text: 'I know where a bounty target is hiding. Help me bring them in and we\'ll split the reward.', type: 'bounty', reward: 'gold' },
    ],
};

// ── Ask-about-place dialog lines ─────────────────────────────────────────────

const LOCATION_INFO = {
    merchant:    ['The marketplace is the heart of this settlement. You\'ll find everything you need there.', 'The tavern\'s always good for trade gossip. And ale, of course.'],
    guard:       ['The barracks are to the north. The town hall is at the center.', 'Stay to the main paths and you\'ll find what you need.'],
    farmer:      ['The farms are on the outskirts. The granary\'s right by the main road.', 'If you need the church, follow the path through the square.'],
    priest:      ['The church stands at the moral center of this community.', 'Seek the marketplace for worldly needs, the temple for spiritual ones.'],
    blacksmith_npc: ['My forge is one of the best in the area. The marketplace is just down the road.', 'Need armor? Come to me. Need food? The tavern\'s your best bet.'],
    villager:    ['Oh, everything\'s fairly close together here. The tavern\'s the social hub!', 'The well\'s in the center square. Most paths lead to the marketplace.'],
    child:       ['The well is over THERE! And the church is the big building!', 'I know where EVERYTHING is! What are you looking for?'],
    noble:       ['This settlement, while modest, has adequate facilities.', 'The town hall houses the local administration. The marketplace services commerce.'],
    traveler:    ['I\'ve mapped out the local area. The tavern\'s the best place to start.', 'There are old ruins to the east that might interest an adventurer.'],
    beggar:      ['I know every alley and shortcut in this place. What do you need?', 'The best spot to find food is behind the tavern. They throw out leftovers.'],
};

const KINGDOM_INFO = {
    merchant:    ['Trade with {kingdom} has been {quality} lately. Their tariffs are {tariff}.', 'The {kingdom} economy runs on {resource}. Good market for it.'],
    guard:       ['{kingdom}\'s military is {strength}. Their border patrols have been {activity}.', 'I\'ve heard {kingdom} is {stance} toward us. Keep your guard up.'],
    farmer:      ['Farmers in {kingdom} grow {crop}. Their harvests have been {quality}.', 'The soil in {kingdom} is said to be {quality}. Rich lands.'],
    priest:      ['The people of {kingdom} worship {religion}. Their faith is {strength}.', '{kingdom}\'s temples are {quality}. A land of deep spirituality.'],
    noble:       ['{kingdom} is ruled by {ruler}. The court there is {quality}.', 'Politically, {kingdom} is {stance}. Interesting times.'],
    traveler:    ['I\'ve been through {kingdom}. The roads are {quality} and the people {hospitality}.', '{kingdom} has {landmark}. Worth a visit, if you can get there safely.'],
    villager:    ['My cousin lives in {kingdom}. Says it\'s {quality} there.', 'I\'ve never been to {kingdom} myself. Heard it\'s {quality} though.'],
};

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function _pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function _getTimeOfDay() {
    const h = InnerMap.timeOfDay || 8;
    if (h >= 5 && h < 12) return 'morning';
    if (h >= 12 && h < 17) return 'afternoon';
    if (h >= 17 && h < 21) return 'evening';
    return 'night';
}

function _getWeather() {
    if (InnerMap.weather) return InnerMap.weather.type || 'clear';
    return 'clear';
}

/** Get the settlement the player is currently in */
function _getSettlement() {
    if (!_game || !_game.world || !_game.player) return null;
    const tile = _game.world.getTile(_game.player.q, _game.player.r);
    return tile?.settlement || null;
}

/** Get the kingdom the settlement belongs to */
function _getKingdom() {
    const settlement = _getSettlement();
    if (!settlement || !settlement.kingdom || !_game.world) return null;
    return _game.world.kingdoms?.find(k => k.id === settlement.kingdom) || null;
}

/** Check if player has enough of a skill for a check */
function _skillCheck(skillName, difficulty) {
    if (!_game?.player) return false;
    const skillVal = _game.player.skills?.[skillName] || 0;
    const attrBonus = _getAttributeBonus(skillName);
    const total = skillVal + attrBonus;
    // Guaranteed pass if total >= difficulty, otherwise proportional chance
    if (total >= difficulty) return true;
    return Math.random() < (total / difficulty);
}

function _getAttributeBonus(skillName) {
    if (!_game?.player) return 0;
    switch (skillName) {
        case 'diplomacy': return Math.floor((_game.player.charisma || 5) / 3);
        case 'combat': return Math.floor((_game.player.strength || 5) / 3);
        case 'stealth': return Math.floor((_game.player.luck || 5) / 4);
        case 'commerce': return Math.floor((_game.player.intelligence || 5) / 3);
        default: return 0;
    }
}

function _getSkillTotal(skillName) {
    if (!_game?.player) return 0;
    return (_game.player.skills?.[skillName] || 0) + _getAttributeBonus(skillName);
}

function _getPlayerTitle() {
    if (!_game?.player) return '';
    if (_game.player.kingdomTitle) return _game.player.kingdomTitle;
    if (_game.player.title && _game.player.title !== 'Nobody') return _game.player.title;
    return '';
}

function _isPlayerRenowned() {
    if (!_game?.player) return false;
    return (_game.player.renown || 0) >= 20 || !!_getPlayerTitle();
}

// ══════════════════════════════════════════════════════════════════════════════
// GREETING — context-aware with disposition & memory
// ══════════════════════════════════════════════════════════════════════════════

function _getGreeting(npc) {
    const type = npc.type || 'villager';
    const mem = _mem(npc);

    // Check for family reaction first — if player treated a relative well/poorly
    const familyReaction = NpcFamily.getFamilyReactionLine(npc, InnerMap.npcs || []);
    if (familyReaction && Math.random() < 0.6) {
        return familyReaction;
    }

    // Pick pool based on disposition and memory
    let pool;
    if (mem.disposition < 20) {
        pool = HOSTILE_GREETINGS[type] || HOSTILE_GREETINGS.villager;
    } else if (_isPlayerRenowned() && mem.disposition >= 50) {
        pool = RESPECTFUL_GREETINGS[type] || RESPECTFUL_GREETINGS.villager;
    } else if (mem.timesSpoken > 1 && mem.disposition >= 40) {
        pool = RETURNING_GREETINGS[type] || RETURNING_GREETINGS.villager;
    } else {
        pool = GREETINGS[type] || GREETINGS.villager;
    }

    let greeting = _pick(pool);

    // Sometimes add a family mention (20% chance for NPCs with families)
    if (Math.random() < 0.2 && mem.timesSpoken > 0) {
        const familyComment = NpcFamily.getFamilyComment(npc, InnerMap.npcs || []);
        if (familyComment) {
            greeting += ' ' + familyComment;
            return greeting;
        }
    }

    // Occasionally add a time-of-day or weather comment
    const tod = _getTimeOfDay();
    const weather = _getWeather();
    if (Math.random() < 0.4 && TIME_COMMENTS[tod]) {
        greeting += ' ' + _pick(TIME_COMMENTS[tod]);
    } else if (Math.random() < 0.3 && weather !== 'clear' && WEATHER_COMMENTS[weather]) {
        greeting += ' ' + _pick(WEATHER_COMMENTS[weather]);
    }

    return greeting;
}

function _getRumor(type) { return _pick(RUMORS[type] || RUMORS.villager); }
function _getFarewell(type) { return _pick(FAREWELLS[type] || FAREWELLS.villager); }

// ══════════════════════════════════════════════════════════════════════════════
// BUILD & RENDER
// ══════════════════════════════════════════════════════════════════════════════

function _buildConversation(npc) {
    const mem = _mem(npc);
    mem.timesSpoken++;
    mem.playerTitle = _getPlayerTitle();

    _lines = [{
        speaker: npc.name,
        icon: npc.icon,
        text: _getGreeting(npc),
        isNpc: true,
    }];
    _lineIndex = 0;
}

function _render() {
    if (!_overlay) return;
    const box = _overlay.querySelector('.npc-dialog-box');
    if (!box) return;
    const line = _lines[_lineIndex];
    if (!line) return;

    // Update disposition bar
    _updateDispositionBar();

    // Speaker label
    const speakerEl = box.querySelector('.npc-dialog-speaker');
    if (speakerEl) {
        speakerEl.textContent = line.isNpc ? `${line.icon} ${line.speaker}` : '🧑 You';
        speakerEl.style.color = line.isNpc ? 'var(--gold)' : '#4FC3F7';
    }

    // Dialog text with typewriter
    const textEl = box.querySelector('.npc-dialog-text');
    if (textEl) {
        textEl.textContent = '';
        _typewriteComplete = false;
        _typewrite(textEl, line.text, 0);
    }

    // Choices
    _renderChoices(box);
}

function _typewrite(el, text, idx) {
    if (_typewriteTimer) clearTimeout(_typewriteTimer);
    if (idx >= text.length) {
        _typewriteComplete = true;
        return;
    }
    el.textContent += text[idx];
    _typewriteTimer = setTimeout(() => _typewrite(el, text, idx + 1), 18);
}

function _skipTypewrite(el, text) {
    if (_typewriteTimer) clearTimeout(_typewriteTimer);
    _typewriteTimer = null;
    el.textContent = text;
    _typewriteComplete = true;
}

// ══════════════════════════════════════════════════════════════════════════════
// CHOICES — expanded with skill checks, gifts, quests, location info
// ══════════════════════════════════════════════════════════════════════════════

function _renderChoices(box) {
    const choicesEl = box.querySelector('.npc-dialog-choices');
    if (!choicesEl) return;
    choicesEl.innerHTML = '';

    const line = _lines[_lineIndex];
    if (!line || !line.isNpc) return;

    const npcType = _npc.type || 'villager';
    const mem = _mem(_npc);
    const choices = [];

    // ── Ask for rumors (can ask multiple unique ones) ──
    if (mem.rumorsTold < 3) {
        choices.push({
            icon: '💬', label: 'What news do you have?', action: 'ask_rumor',
            tooltip: `Rumors heard: ${mem.rumorsTold}/3`,
        });
    }

    // ── Ask about location ──
    const askedLocation = _lines.some(l => l._action === 'ask_location');
    if (!askedLocation) {
        choices.push({ icon: '🗺️', label: 'Tell me about this place.', action: 'ask_location' });
    }

    // ── Ask about kingdom ──
    const kingdom = _getKingdom();
    const askedKingdom = _lines.some(l => l._action === 'ask_kingdom');
    if (kingdom && !askedKingdom && (npcType === 'noble' || npcType === 'guard' || npcType === 'merchant' || npcType === 'traveler' || npcType === 'priest')) {
        choices.push({
            icon: '👑', label: `What do you know about ${kingdom.name}?`, action: 'ask_kingdom',
        });
    }

    // ── Ask about family (if NPC has family members) ──
    const hasFamily = (_npc.spouseId != null || (_npc.childIds && _npc.childIds.length > 0) ||
        (_npc.parentIds && _npc.parentIds.length > 0) || (_npc.siblingIds && _npc.siblingIds.length > 0));
    const askedFamily = _lines.some(l => l._action === 'ask_family');
    if (hasFamily && !askedFamily) {
        choices.push({
            icon: '👨‍👩‍👧', label: 'Tell me about your family.', action: 'ask_family',
            tooltip: 'Learn about their relatives',
        });
    }

    // ── Ask about someone (gossip about another NPC) ──
    const knownNpcs = NpcFamily.getKnownNpcs(_npc, InnerMap.npcs || []);
    const askedAbout = _lines.some(l => l._action === 'ask_about_npc');
    if (!askedAbout && knownNpcs.length > 0) {
        choices.push({
            icon: '🗣️', label: 'What do you think of the people here?', action: 'ask_about_npc',
            tooltip: `Knows ${knownNpcs.length} people`,
        });
    }

    // ── Trade (merchants, blacksmiths, travelers) ──
    if (npcType === 'merchant' || npcType === 'blacksmith_npc' || npcType === 'traveler') {
        choices.push({ icon: '💰', label: 'Show me your wares.', action: 'trade' });
    }

    // ── Quest hook (once per NPC, disposition >= 40) ──
    if (!mem.questOffered && mem.disposition >= 40 && NPC_QUEST_HOOKS[npcType]) {
        choices.push({
            icon: '📜', label: 'Do you need any help?', action: 'ask_quest',
            tooltip: 'Ask if they have a task for you',
        });
    }

    // ── Give gift ──
    const hasGiftableItems = _game?.player?.gold > 0 || _hasGiftableInventory();
    if (hasGiftableItems && mem.disposition < 95) {
        choices.push({
            icon: '🎁', label: 'I have something for you.', action: 'give_gift',
            tooltip: `Current disposition: ${mem.disposition}`,
        });
    }

    // ── Charm / Flatter [Diplomacy check] ──
    const flattered = _lines.some(l => l._action === 'flatter');
    if (!flattered) {
        const diplomacyTotal = _getSkillTotal('diplomacy');
        const difficulty = 3;
        const chance = Math.min(100, Math.round((diplomacyTotal / difficulty) * 100));
        choices.push({
            icon: '😊',
            label: `[Charm — Diplomacy ${diplomacyTotal}/${difficulty}] You seem wise — tell me more.`,
            action: 'flatter',
            skillTag: chance >= 100 ? 'guaranteed' : chance >= 60 ? 'likely' : 'risky',
            tooltip: `${chance}% chance of success`,
        });
    }

    // ── Intimidate [Combat check] ──
    const threatened = _lines.some(l => l._action === 'threat');
    if (!threatened) {
        const combatTotal = _getSkillTotal('combat');
        const difficulty = npcType === 'guard' || npcType === 'blacksmith_npc' ? 5 : npcType === 'noble' ? 4 : 2;
        const chance = Math.min(100, Math.round((combatTotal / difficulty) * 100));
        choices.push({
            icon: '😠',
            label: `[Intimidate — Combat ${combatTotal}/${difficulty}] Watch your tongue.`,
            action: 'threat',
            skillTag: chance >= 100 ? 'guaranteed' : chance >= 60 ? 'likely' : 'risky',
            tooltip: `${chance}% chance | ⚠ May lower disposition`,
        });
    }

    // ── Persuade [Diplomacy check] — convince NPC to reveal deeper secrets ──
    if (mem.disposition >= 60 && !_lines.some(l => l._action === 'persuade')) {
        const diplomacyTotal = _getSkillTotal('diplomacy');
        const difficulty = 5;
        const chance = Math.min(100, Math.round((diplomacyTotal / difficulty) * 100));
        choices.push({
            icon: '🤝',
            label: `[Persuade — Diplomacy ${diplomacyTotal}/${difficulty}] I need your trust on something important.`,
            action: 'persuade',
            skillTag: chance >= 100 ? 'guaranteed' : chance >= 60 ? 'likely' : 'risky',
            tooltip: `${chance}% chance | Requires Warm+ disposition`,
        });
    }

    // ── Farewell ──
    choices.push({ icon: '👋', label: 'Farewell.', action: 'farewell' });

    // Render choice buttons
    for (const choice of choices) {
        const btn = document.createElement('button');
        btn.className = 'npc-dialog-choice';
        if (choice.skillTag) btn.classList.add(`npc-dialog-skill-${choice.skillTag}`);

        let html = `<span class="npc-dialog-choice-icon">${choice.icon}</span> ${choice.label}`;
        if (choice.skillTag) {
            const tagLabels = { guaranteed: '✓ Sure', likely: '● Likely', risky: '⚠ Risky' };
            html += ` <span class="npc-dialog-skill-tag npc-dialog-skill-tag-${choice.skillTag}">${tagLabels[choice.skillTag]}</span>`;
        }
        btn.innerHTML = html;

        if (choice.tooltip) btn.title = choice.tooltip;
        btn.addEventListener('click', () => _handleChoice(choice.action));
        choicesEl.appendChild(btn);
    }
}

function _hasGiftableInventory() {
    if (!_game?.player?.inventory) return false;
    return Object.values(_game.player.inventory).some(qty => qty > 0);
}

// ══════════════════════════════════════════════════════════════════════════════
// HANDLE CHOICE — expanded with skill checks, gifts, quests
// ══════════════════════════════════════════════════════════════════════════════

function _handleChoice(action) {
    const npcType = _npc.type || 'villager';
    const mem = _mem(_npc);

    // Build player line text
    const labelMap = {
        ask_rumor: 'What news do you have?',
        ask_location: 'Tell me about this place.',
        ask_kingdom: _getKingdom() ? `What do you know about ${_getKingdom().name}?` : 'What do you know about the kingdom?',
        ask_family: 'Tell me about your family.',
        ask_about_npc: 'What do you think of the people here?',
        trade: 'Show me your wares.',
        ask_quest: 'Do you need any help?',
        give_gift: 'I have something for you.',
        flatter: 'You seem wise — tell me more.',
        threat: 'Watch your tongue.',
        persuade: 'I need your trust on something important.',
        farewell: 'Farewell.',
    };

    const playerText = labelMap[action] || action;
    _lines.push({ speaker: 'You', text: playerText, isNpc: false, _action: action });
    _lineIndex = _lines.length - 1;

    // Show player line briefly
    const box = _overlay.querySelector('.npc-dialog-box');
    const choicesEl = box.querySelector('.npc-dialog-choices');
    if (choicesEl) choicesEl.innerHTML = '';

    const speakerEl = box.querySelector('.npc-dialog-speaker');
    const textEl = box.querySelector('.npc-dialog-text');
    if (speakerEl) { speakerEl.textContent = '🧑 You'; speakerEl.style.color = '#4FC3F7'; }
    if (textEl) { _skipTypewrite(textEl, ''); textEl.textContent = playerText; }

    setTimeout(() => {
        let responseText;
        let shouldClose = false;
        let dispositionChange = 0;
        let skillGains = null;

        switch (action) {
            case 'ask_rumor': {
                responseText = _getRumor(npcType);
                mem.rumorsTold++;
                dispositionChange = 2; // Sharing gossip builds minor rapport
                // Slight social need boost
                if (_game?.player?.modifyNeed) _game.player.modifyNeed('social', 3);
                break;
            }

            case 'ask_location': {
                const pool = LOCATION_INFO[npcType] || LOCATION_INFO.villager;
                responseText = _pick(pool);
                // Add settlement-specific info if available
                const settlement = _getSettlement();
                if (settlement) {
                    responseText += ` This is ${settlement.name}, a ${settlement.type || 'settlement'} with about ${settlement.population || '??'} souls.`;
                }
                dispositionChange = 1;
                break;
            }

            case 'ask_kingdom': {
                const kingdom = _getKingdom();
                if (kingdom) {
                    const pool = KINGDOM_INFO[npcType] || KINGDOM_INFO.villager;
                    let template = _pick(pool);
                    // Fill in template
                    template = template
                        .replace(/\{kingdom\}/g, kingdom.name || 'the realm')
                        .replace(/\{ruler\}/g, kingdom.ruler?.name || 'the ruler')
                        .replace(/\{quality\}/g, _pick(['fair', 'decent', 'troubled', 'prosperous', 'uncertain']))
                        .replace(/\{tariff\}/g, _pick(['high', 'moderate', 'low', 'outrageous']))
                        .replace(/\{resource\}/g, _pick(['grain', 'iron', 'timber', 'wool', 'fish']))
                        .replace(/\{strength\}/g, _pick(['formidable', 'modest', 'fearsome', 'growing', 'declining']))
                        .replace(/\{activity\}/g, _pick(['active', 'lax', 'doubled', 'reduced']))
                        .replace(/\{stance\}/g, _pick(['friendly', 'neutral', 'suspicious', 'hostile']))
                        .replace(/\{crop\}/g, _pick(['wheat', 'barley', 'corn', 'grapes']))
                        .replace(/\{religion\}/g, _pick(['the old gods', 'the divine light', 'the earth spirits', 'many faiths']))
                        .replace(/\{hospitality\}/g, _pick(['welcoming', 'wary of strangers', 'generous', 'cold']))
                        .replace(/\{landmark\}/g, _pick(['ancient ruins', 'a grand temple', 'towering mountains', 'vast forests']));
                    responseText = template;
                    // Grant kingdom knowledge
                    if (_game?.player?.learnAboutKingdom) {
                        const categories = npcType === 'noble' ? ['basics', 'ruler', 'diplomacy'] :
                            npcType === 'guard' ? ['basics', 'military'] :
                            npcType === 'merchant' ? ['basics', 'economy'] :
                            npcType === 'priest' ? ['basics', 'religion'] :
                            ['basics'];
                        _game.player.learnAboutKingdom(kingdom.id, categories);
                    }
                    dispositionChange = 2;
                } else {
                    responseText = 'I\'m afraid I don\'t know much about the wider politics.';
                }
                break;
            }

            case 'ask_family': {
                const allNpcs = InnerMap.npcs || [];
                const familyParts = [];

                // Spouse
                if (_npc.spouseId != null) {
                    const spouse = allNpcs.find(n => n.id === _npc.spouseId);
                    if (spouse) {
                        const spouseTitle = spouse.gender === 'female' ? 'wife' : 'husband';
                        const typeName = (InnerMap.NPC_TYPES[spouse.type] || {}).name || spouse.type;
                        familyParts.push(`My ${spouseTitle} ${spouse.fullName || spouse.name} is a ${typeName.toLowerCase()} here.`);
                    }
                }

                // Children
                if (_npc.childIds && _npc.childIds.length > 0) {
                    const childNames = _npc.childIds
                        .map(id => allNpcs.find(n => n.id === id))
                        .filter(Boolean)
                        .map(c => c.name);
                    if (childNames.length === 1) {
                        familyParts.push(`My child ${childNames[0]} keeps me busy!`);
                    } else if (childNames.length > 1) {
                        familyParts.push(`I have ${childNames.length} children: ${childNames.join(' and ')}. They\'re a handful!`);
                    }
                }

                // Parents
                if (_npc.parentIds && _npc.parentIds.length > 0) {
                    const parents = _npc.parentIds
                        .map(id => allNpcs.find(n => n.id === id))
                        .filter(Boolean);
                    if (parents.length > 0) {
                        const parentNames = parents.map(p => p.name).join(' and ');
                        familyParts.push(`My ${parents.length > 1 ? 'parents are' : (parents[0].gender === 'female' ? 'mother is' : 'father is')} ${parentNames}.`);
                    }
                }

                // Siblings
                if (_npc.siblingIds && _npc.siblingIds.length > 0) {
                    const siblings = _npc.siblingIds
                        .map(id => allNpcs.find(n => n.id === id))
                        .filter(Boolean);
                    if (siblings.length > 0) {
                        const sibNames = siblings.map(s => s.name).join(' and ');
                        const sibTitle = siblings.length === 1
                            ? (siblings[0].gender === 'female' ? 'sister' : 'brother')
                            : 'siblings';
                        familyParts.push(`My ${sibTitle} ${sibNames} ${siblings.length === 1 ? 'lives' : 'live'} here too.`);
                    }
                }

                if (familyParts.length > 0) {
                    responseText = familyParts.join(' ');
                    // Add a personal touch
                    if (_npc.lastName) {
                        responseText = `We\'re the ${_npc.lastName} family. ` + responseText;
                    }
                } else {
                    responseText = 'I don\'t have much family to speak of. It\'s just me, I\'m afraid.';
                }
                dispositionChange = 3;
                if (_game?.player?.modifyNeed) _game.player.modifyNeed('social', 5);
                break;
            }

            case 'ask_about_npc': {
                _showAskAboutSubmenu();
                return; // Submenu handles the response
            }

            case 'trade': {
                responseText = 'Let me show you what I have...';
                shouldClose = 'trade';
                break;
            }

            case 'ask_quest': {
                const hooks = NPC_QUEST_HOOKS[npcType];
                if (hooks && hooks.length > 0) {
                    const hook = _pick(hooks);
                    responseText = hook.text;
                    mem.questOffered = true;
                    dispositionChange = 3;
                    // Give the player a notification about a potential quest
                    if (_game?.ui?.showNotification) {
                        setTimeout(() => {
                            _game.ui.showNotification('📜 Quest Lead', `${_npc?.name || 'Someone'} hinted at a job. Keep this in mind for future adventures.`, 'info');
                        }, 2000);
                    }
                } else {
                    responseText = 'I appreciate you asking, but I don\'t need anything right now.';
                }
                break;
            }

            case 'give_gift': {
                _showGiftSubmenu();
                return; // Don't add NPC response yet; submenu handles it
            }

            case 'flatter': {
                const difficulty = 3;
                const success = _skillCheck('diplomacy', difficulty);
                if (success) {
                    const pool = FLATTER_SUCCESS[npcType] || FLATTER_SUCCESS.villager;
                    responseText = _pick(pool);
                    dispositionChange = 10;
                    skillGains = { diplomacy: 1 };
                    if (_game?.player?.modifyNeed) {
                        _game.player.modifyNeed('social', 10);
                        _game.player.modifyNeed('fun', 5);
                    }
                } else {
                    responseText = _pick(FLATTER_RESPONSES[npcType] || FLATTER_RESPONSES.villager);
                    dispositionChange = 3;
                    if (_game?.player?.modifyNeed) {
                        _game.player.modifyNeed('social', 5);
                    }
                }
                _showSkillCheckResult(success, 'Charm');
                break;
            }

            case 'threat': {
                const difficulty = npcType === 'guard' || npcType === 'blacksmith_npc' ? 5 : npcType === 'noble' ? 4 : 2;
                const success = _skillCheck('combat', difficulty);
                if (success) {
                    const pool = THREAT_SUCCESS[npcType] || THREAT_SUCCESS.villager;
                    responseText = _pick(pool);
                    dispositionChange = -15;
                    skillGains = { combat: 1 };
                    // Reveal something useful
                    if (_game?.ui?.showNotification) {
                        setTimeout(() => {
                            _game.ui.showNotification('💪 Intimidation', 'Your threat worked. The information may prove useful.', 'success');
                        }, 1500);
                    }
                } else {
                    responseText = _pick(THREAT_RESPONSES[npcType] || THREAT_RESPONSES.villager);
                    dispositionChange = -10;
                }
                // Karma hit regardless
                if (_game?.player) {
                    _game.player.karma = (_game.player.karma || 0) - 2;
                    if (_game.player.modifyNeed) _game.player.modifyNeed('social', -5);
                }
                mem.threatened = true;
                _showSkillCheckResult(success, 'Intimidate');
                break;
            }

            case 'persuade': {
                const difficulty = 5;
                const success = _skillCheck('diplomacy', difficulty);
                if (success) {
                    // Deep persuasion — reveal settlement/kingdom secret
                    const secrets = [
                        'There\'s a hidden passage beneath the old well. Leads to a cache of valuables.',
                        'The tax collector skims 20% off the top. Everyone knows, no one dares speak.',
                        'A spy from {kingdom} has been seen meeting the innkeeper in secret.',
                        'The local lord has a private army hidden in the hills. Double what\'s officially reported.',
                        'Ancient tunnels connect several buildings underground. The thieves use them freely.',
                        'The priest keeps a forbidden tome in the church vault. Says it contains prophecies.',
                    ];
                    let secret = _pick(secrets);
                    const kingdom = _getKingdom();
                    secret = secret.replace(/\{kingdom\}/g, kingdom?.name || 'a rival realm');
                    responseText = `*leans close and whispers* ${secret}`;
                    dispositionChange = 5;
                    skillGains = { diplomacy: 2 };
                    if (_game?.player?.modifyNeed) {
                        _game.player.modifyNeed('social', 8);
                        _game.player.modifyNeed('fun', 5);
                    }
                } else {
                    responseText = 'I... I\'m sorry, but I can\'t share that. It\'s not safe. Please don\'t ask again.';
                    dispositionChange = -3;
                }
                _showSkillCheckResult(success, 'Persuade');
                break;
            }

            case 'farewell': {
                responseText = _getFarewell(npcType);
                shouldClose = true;
                // Disposition boost for polite goodbye
                dispositionChange = 1;
                break;
            }

            default:
                responseText = 'Hmm...';
        }

        // Apply disposition change
        if (dispositionChange !== 0) {
            mem.disposition = Math.max(0, Math.min(100, mem.disposition + dispositionChange));
            mem.lastAction = action;
            _animateDispositionChange(dispositionChange);

            // Social ripple — family members adjust their opinion of the player
            NpcFamily.applySocialRipple(_npc, dispositionChange, InnerMap.npcs || []);
        }

        // Apply skill gains
        if (skillGains && _game?.player?.skills) {
            for (const [skill, xp] of Object.entries(skillGains)) {
                _game.player.skills[skill] = (_game.player.skills[skill] || 0) + xp;
                if (_game?.ui?.showNotification) {
                    _game.ui.showNotification('📈 Skill Up', `${skill.charAt(0).toUpperCase() + skill.slice(1)} +${xp}`, 'success');
                }
            }
        }

        // Add NPC response
        const npcLine = { speaker: _npc.name, icon: _npc.icon, text: responseText, isNpc: true, _action: action };
        _lines.push(npcLine);
        _lineIndex = _lines.length - 1;
        _render();

        // Auto-close after farewell or trade redirect
        if (shouldClose) {
            setTimeout(() => {
                const game = _game;
                const npc = _npc;
                NpcDialog.close();
                if (shouldClose === 'trade' && game) {
                    if (npc && npc.shopInventory && Object.keys(npc.shopInventory).length > 0) {
                        ActionMenu.showNpcTradeMenu(game, npc);
                    } else {
                        const worldTile = game.world ? game.world.getTile(game.player.q, game.player.r) : null;
                        if (worldTile) ActionMenu.showTradeMenu(game, worldTile);
                    }
                }
            }, 1800);
        }
    }, 500);
}

// ══════════════════════════════════════════════════════════════════════════════
// GIFT SUBMENU
// ══════════════════════════════════════════════════════════════════════════════

function _showGiftSubmenu() {
    const box = _overlay.querySelector('.npc-dialog-box');
    const choicesEl = box.querySelector('.npc-dialog-choices');
    if (!choicesEl) return;
    choicesEl.innerHTML = '';

    const mem = _mem(_npc);

    // Gold gift options
    const goldAmounts = [5, 25, 100];
    const playerGold = _game?.player?.gold || 0;

    for (const amount of goldAmounts) {
        if (playerGold >= amount) {
            const btn = document.createElement('button');
            btn.className = 'npc-dialog-choice npc-dialog-gift';
            btn.innerHTML = `<span class="npc-dialog-choice-icon">🪙</span> Give ${amount} gold`;
            btn.addEventListener('click', () => _giveGoldGift(amount));
            choicesEl.appendChild(btn);
        }
    }

    // Inventory item gifts
    if (_game?.player?.inventory) {
        const items = Object.entries(_game.player.inventory).filter(([, qty]) => qty > 0);
        for (const [itemId, qty] of items.slice(0, 4)) { // Show up to 4 items
            const btn = document.createElement('button');
            btn.className = 'npc-dialog-choice npc-dialog-gift';
            const displayName = itemId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            btn.innerHTML = `<span class="npc-dialog-choice-icon">📦</span> Give ${displayName} (×${qty})`;
            btn.addEventListener('click', () => _giveItemGift(itemId));
            choicesEl.appendChild(btn);
        }
    }

    // Cancel
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'npc-dialog-choice';
    cancelBtn.innerHTML = `<span class="npc-dialog-choice-icon">↩️</span> Never mind.`;
    cancelBtn.addEventListener('click', () => {
        // Re-render normal choices
        _lineIndex = _lines.length - 1;
        // Go back to last NPC line
        for (let i = _lines.length - 1; i >= 0; i--) {
            if (_lines[i].isNpc) { _lineIndex = i; break; }
        }
        _renderChoices(box);
    });
    choicesEl.appendChild(cancelBtn);
}

function _giveGoldGift(amount) {
    if (!_game?.player || _game.player.gold < amount) return;
    _game.player.gold -= amount;

    const mem = _mem(_npc);
    const npcType = _npc.type || 'villager';
    mem.giftsReceived++;

    // Disposition boost scaled by amount
    let boost = amount >= 100 ? 15 : amount >= 25 ? 8 : 4;
    // Beggars appreciate gold more
    if (npcType === 'beggar') boost *= 2;
    // Nobles care less about small amounts
    if (npcType === 'noble' && amount < 25) boost = Math.ceil(boost / 2);

    mem.disposition = Math.min(100, mem.disposition + boost);

    // Karma boost
    if (_game.player) _game.player.karma = (_game.player.karma || 0) + 1;

    // Response
    const responses = {
        merchant: amount >= 25 ? 'Most generous! You\'ll find my prices very favorable now.' : 'Every coin helps. Thank you!',
        guard:    amount >= 25 ? '*pockets gold discreetly* I\'ll make sure the patrols stay clear of your business.' : 'Don\'t try to bribe a guard! ...but I\'ll let it slide this once.',
        farmer:   'This means the world to me and my family. You have a kind heart.',
        priest:   'This contribution will be put to good use. The gods bless your generosity.',
        blacksmith_npc: amount >= 25 ? 'Generous! I\'ll remember this when you need something forged.' : 'Appreciated! I\'ll keep this in mind.',
        villager: '*eyes widen* For me? You\'re too kind!',
        child:    '*gasps* GOLD?! Wait till I show mama!',
        noble:    amount >= 100 ? 'A gesture befitting your character. I shall remember this.' : 'A modest gift, but the intent is noted.',
        traveler: 'Trail coin! This\'ll keep me fed for a week. Thank you, friend.',
        beggar:   '*breaks down crying* Thank you... thank you so much. I can eat tonight!',
    };

    const responseText = responses[npcType] || 'Thank you for your generosity!';

    _lines.push({ speaker: 'You', text: `*gives ${amount} gold*`, isNpc: false, _action: 'give_gift' });
    _lines.push({ speaker: _npc.name, icon: _npc.icon, text: responseText, isNpc: true, _action: 'give_gift' });
    _lineIndex = _lines.length - 1;

    _animateDispositionChange(boost);
    _render();

    if (_game?.player?.modifyNeed) {
        _game.player.modifyNeed('social', 8);
    }
}

function _giveItemGift(itemId) {
    if (!_game?.player?.inventory || !_game.player.inventory[itemId]) return;
    _game.player.inventory[itemId]--;
    if (_game.player.inventory[itemId] <= 0) delete _game.player.inventory[itemId];

    const mem = _mem(_npc);
    const npcType = _npc.type || 'villager';
    mem.giftsReceived++;

    const displayName = itemId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    // Item-specific disposition boosts
    let boost = 5;
    if (itemId === 'bread' || itemId === 'food') boost = npcType === 'beggar' ? 15 : 6;
    if (itemId === 'ale' || itemId === 'wine') boost = npcType === 'traveler' ? 10 : 6;

    mem.disposition = Math.min(100, mem.disposition + boost);
    if (_game.player) _game.player.karma = (_game.player.karma || 0) + 1;

    const responses = {
        beggar:   `*clutches the ${displayName}* You... you\'re saving my life.`,
        merchant: `${displayName}? I can certainly find a use for this. Thank you!`,
        child:    `*eyes go wide* For ME?! Thank you thank you thank you!`,
    };
    const responseText = responses[npcType] || `*accepts the ${displayName}* How thoughtful of you. Thank you.`;

    _lines.push({ speaker: 'You', text: `*gives ${displayName}*`, isNpc: false, _action: 'give_gift' });
    _lines.push({ speaker: _npc.name, icon: _npc.icon, text: responseText, isNpc: true, _action: 'give_gift' });
    _lineIndex = _lines.length - 1;

    _animateDispositionChange(boost);
    _render();

    if (_game?.player?.modifyNeed) _game.player.modifyNeed('social', 5);
}

// ══════════════════════════════════════════════════════════════════════════════
// ASK ABOUT NPC SUBMENU — Sims-like gossip about other townspeople
// ══════════════════════════════════════════════════════════════════════════════

function _showAskAboutSubmenu() {
    const box = _overlay.querySelector('.npc-dialog-box');
    const choicesEl = box.querySelector('.npc-dialog-choices');
    if (!choicesEl) return;
    choicesEl.innerHTML = '';

    const knownNpcs = NpcFamily.getKnownNpcs(_npc, InnerMap.npcs || []);

    // Show each known NPC as a button
    for (const entry of knownNpcs.slice(0, 6)) { // Max 6 options
        const other = entry.npc;
        const bondLabel = entry.familyBond
            ? NpcFamily.getFamilyBondLabel(_npc, other)
            : null;

        const opinionLabel = NpcFamily.getOpinionLabel(entry.score);

        const btn = document.createElement('button');
        btn.className = 'npc-dialog-choice npc-dialog-ask-about';

        let label = other.fullName || other.name;
        if (bondLabel) label += ` (${bondLabel})`;

        btn.innerHTML = `<span class="npc-dialog-choice-icon">${opinionLabel.icon}</span> `
            + `<span class="npc-dialog-ask-name">${label}</span>`
            + `<span class="npc-dialog-ask-opinion" style="color:${opinionLabel.color}">${opinionLabel.label}</span>`;

        btn.title = `${_npc.name}'s opinion: ${opinionLabel.label} (${entry.score})`;

        btn.addEventListener('click', () => {
            const gossip = NpcFamily.getGossipAbout(_npc, other);

            // Family bond gives extra flavor
            let fullResponse = gossip;
            if (entry.familyBond) {
                const familyPrefix = entry.familyBond === 'spouse'
                    ? `That\'s my ${other.gender === 'female' ? 'wife' : 'husband'}! `
                    : entry.familyBond === 'child'
                    ? `That\'s my ${other.gender === 'female' ? 'daughter' : 'son'}. `
                    : entry.familyBond === 'parent'
                    ? `That\'s my ${other.gender === 'female' ? 'mother' : 'father'}. `
                    : entry.familyBond === 'sibling'
                    ? `That\'s my ${other.gender === 'female' ? 'sister' : 'brother'}. `
                    : '';
                fullResponse = familyPrefix + gossip;
            }

            _lines.push({
                speaker: 'You', text: `What can you tell me about ${other.name}?`,
                isNpc: false, _action: 'ask_about_npc',
            });
            _lines.push({
                speaker: _npc.name, icon: _npc.icon, text: fullResponse,
                isNpc: true, _action: 'ask_about_npc',
            });
            _lineIndex = _lines.length - 1;

            // Small disposition boost for showing interest
            const mem = _mem(_npc);
            mem.disposition = Math.min(100, mem.disposition + 2);
            _animateDispositionChange(2);

            // Social need boost
            if (_game?.player?.modifyNeed) _game.player.modifyNeed('social', 4);

            // Apply social ripple
            NpcFamily.applySocialRipple(_npc, 2, InnerMap.npcs || []);

            _render();
        });
        choicesEl.appendChild(btn);
    }

    // Cancel button
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'npc-dialog-choice';
    cancelBtn.innerHTML = `<span class="npc-dialog-choice-icon">↩️</span> Never mind.`;
    cancelBtn.addEventListener('click', () => {
        for (let i = _lines.length - 1; i >= 0; i--) {
            if (_lines[i].isNpc) { _lineIndex = i; break; }
        }
        _renderChoices(box);
    });
    choicesEl.appendChild(cancelBtn);
}

// ══════════════════════════════════════════════════════════════════════════════
// UI FEEDBACK — skill check flash, disposition animation
// ══════════════════════════════════════════════════════════════════════════════

function _showSkillCheckResult(success, skillName) {
    if (!_overlay) return;
    const flash = document.createElement('div');
    flash.className = `npc-dialog-skill-result ${success ? 'npc-dialog-skill-success' : 'npc-dialog-skill-fail'}`;
    flash.textContent = success ? `✓ ${skillName} Success!` : `✗ ${skillName} Failed`;
    const box = _overlay.querySelector('.npc-dialog-box');
    if (box) {
        box.appendChild(flash);
        setTimeout(() => flash.remove(), 2000);
    }
}

function _animateDispositionChange(amount) {
    if (!_overlay) return;
    const bar = _overlay.querySelector('.npc-dialog-disposition-fill');
    const label = _overlay.querySelector('.npc-dialog-disposition-label');
    if (!bar || !label) return;

    const mem = _mem(_npc);
    const disp = _dispositionLabel(mem.disposition);

    // Animate bar
    bar.style.width = `${mem.disposition}%`;
    bar.style.background = disp.color;

    // Update label
    label.textContent = `${disp.icon} ${disp.text}`;
    label.style.color = disp.color;

    // Flash the change amount
    const change = document.createElement('span');
    change.className = 'npc-dialog-disp-change';
    change.textContent = amount > 0 ? `+${amount}` : `${amount}`;
    change.style.color = amount > 0 ? '#66BB6A' : '#EF5350';
    label.parentElement.appendChild(change);
    setTimeout(() => change.remove(), 1500);
}

function _updateDispositionBar() {
    if (!_overlay || !_npc) return;
    const mem = _mem(_npc);
    const disp = _dispositionLabel(mem.disposition);
    const bar = _overlay.querySelector('.npc-dialog-disposition-fill');
    const label = _overlay.querySelector('.npc-dialog-disposition-label');
    if (bar) {
        bar.style.width = `${mem.disposition}%`;
        bar.style.background = disp.color;
    }
    if (label) {
        label.textContent = `${disp.icon} ${disp.text}`;
        label.style.color = disp.color;
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// DOM CREATION — expanded with disposition bar, conversation counter, mood
// ══════════════════════════════════════════════════════════════════════════════

function _createOverlay() {
    const mem = _mem(_npc);
    const disp = _dispositionLabel(mem.disposition);
    const typeName = (InnerMap.NPC_TYPES[_npc.type] || {}).name || _npc.type;

    // Family info for header
    const familyTag = NpcFamily.getFamilyTagline(_npc, InnerMap.npcs || []);
    const displayName = _npc.fullName || _npc.name;

    // Relationship level from combined score
    const playerStatus = _game?.player
        ? NpcFamily.getPlayerNpcStatus(_game.player, _npc)
        : null;
    const relLevel = playerStatus?.level;

    const overlay = document.createElement('div');
    overlay.id = 'npcDialogOverlay';

    overlay.innerHTML = `
        <div class="npc-dialog-backdrop"></div>
        <div class="npc-dialog-box">
            <div class="npc-dialog-header">
                <div class="npc-dialog-portrait">
                    <span class="npc-dialog-portrait-icon">${_npc.icon}</span>
                </div>
                <div class="npc-dialog-header-info">
                    <div class="npc-dialog-name">${displayName}</div>
                    <div class="npc-dialog-title">${typeName}${_npc.age ? `, Age ${_npc.age}` : ''}${_npc.gender ? ` · ${_npc.gender === 'female' ? '♀' : '♂'}` : ''}</div>
                    ${familyTag ? `<div class="npc-dialog-family-tag">${familyTag}</div>` : ''}
                    <div class="npc-dialog-meta">
                        ${relLevel ? `<span class="npc-dialog-rel-badge" style="color:${relLevel.color}" title="Relationship: ${relLevel.label}">${relLevel.icon} ${relLevel.label}</span>` : ''}
                        ${mem.timesSpoken > 1 ? `<span class="npc-dialog-visits" title="Times spoken">🗣️ ×${mem.timesSpoken}</span>` : ''}
                        ${_npc.personalityTraits?.length > 0 ? `<span class="npc-dialog-traits" title="Personality">${_npc.personalityTraits.map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(', ')}</span>` : ''}
                    </div>
                </div>
                <button class="npc-dialog-close" title="End conversation">✕</button>
            </div>
            <div class="npc-dialog-disposition-bar-container">
                <div class="npc-dialog-disposition-track">
                    <div class="npc-dialog-disposition-fill" style="width:${mem.disposition}%;background:${disp.color};"></div>
                </div>
                <div class="npc-dialog-disposition-label" style="color:${disp.color};">${disp.icon} ${disp.text}</div>
            </div>
            <div class="npc-dialog-body">
                <div class="npc-dialog-speaker"></div>
                <div class="npc-dialog-text"></div>
            </div>
            <div class="npc-dialog-choices"></div>
        </div>
    `;

    // Close button
    overlay.querySelector('.npc-dialog-close').addEventListener('click', () => NpcDialog.close());

    // Clicking backdrop closes
    overlay.querySelector('.npc-dialog-backdrop').addEventListener('click', () => NpcDialog.close());

    // Click on dialog body to skip typewriter
    const body = overlay.querySelector('.npc-dialog-body');
    if (body) {
        body.style.cursor = 'pointer';
        body.addEventListener('click', () => {
            if (!_typewriteComplete) {
                const textEl = overlay.querySelector('.npc-dialog-text');
                const line = _lines[_lineIndex];
                if (textEl && line) _skipTypewrite(textEl, line.text);
            }
        });
    }

    // ESC key closes, Space/Enter skips typewriter
    overlay._escHandler = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); NpcDialog.close(); }
        if ((e.key === ' ' || e.key === 'Enter') && !_typewriteComplete) {
            e.preventDefault();
            e.stopPropagation();
            const textEl = overlay.querySelector('.npc-dialog-text');
            const line = _lines[_lineIndex];
            if (textEl && line) _skipTypewrite(textEl, line.text);
        }
    };
    window.addEventListener('keydown', overlay._escHandler, true);

    document.body.appendChild(overlay);
    return overlay;
}

// ══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════════════════════════════════════════

export const NpcDialog = {

    get active() { return _active; },

    /**
     * Open a dialog with an NPC.
     * @param {object} game — Game instance
     * @param {object} npc  — NPC object from InnerMap.npcs
     */
    open(game, npc) {
        if (_active) this.close();

        _game = game;
        _npc = npc;
        _active = true;

        // Freeze this NPC
        npc._dialogFrozen = true;
        npc._preDialogState = npc.state;
        npc.state = 'dialog';
        npc.path = null;
        npc.moveProgress = 0;

        // Make the NPC face the player
        const dq = InnerMap.playerInnerQ - npc.q;
        const dr = InnerMap.playerInnerR - npc.r;
        if (Math.abs(dq) >= Math.abs(dr)) {
            npc.facing = dq >= 0 ? 3 : 1; // RIGHT : LEFT
        } else {
            npc.facing = dr >= 0 ? 2 : 0; // DOWN : UP
        }

        // Build conversation
        _buildConversation(npc);

        // Create DOM
        _overlay = _createOverlay();

        // Initial render
        setTimeout(() => _render(), 50);

        // Social need boost for starting conversation
        if (_game.player?.modifyNeed) {
            _game.player.modifyNeed('social', 5);
        }
    },

    /**
     * Close the current dialog.
     */
    close() {
        if (!_active) return;

        // Unfreeze NPC
        if (_npc) {
            _npc._dialogFrozen = false;
            if (_npc.state === 'dialog') {
                _npc.state = 'idle';
                _npc.idleTimer = 2 + Math.random() * 3;
            }
        }

        // Clean up typewriter
        if (_typewriteTimer) { clearTimeout(_typewriteTimer); _typewriteTimer = null; }

        // Remove DOM
        if (_overlay) {
            if (_overlay._escHandler) window.removeEventListener('keydown', _overlay._escHandler, true);
            _overlay.remove();
            _overlay = null;
        }

        _active = false;
        _game = null;
        _npc = null;
        _lines = [];
        _lineIndex = 0;
        _typewriteComplete = false;
    },
};
