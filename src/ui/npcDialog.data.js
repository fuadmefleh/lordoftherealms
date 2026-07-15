// NPC dialog data tables — extracted from npcDialog.js (pure data, no behaviour).

export const GREETINGS = {
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

export const RETURNING_GREETINGS = {
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

export const RESPECTFUL_GREETINGS = {
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

export const HOSTILE_GREETINGS = {
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

export const RUMORS = {
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

export const FAREWELLS = {
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

export const THREAT_RESPONSES = {
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

export const THREAT_SUCCESS = {
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

export const FLATTER_RESPONSES = {
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

export const FLATTER_SUCCESS = {
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

export const TIME_COMMENTS = {
    morning:   ['Early start, eh?', 'Fine morning today.', 'The sun is barely up — you\'re keen!', 'Best time of day, this.'],
    afternoon: ['Hot afternoon, isn\'t it?', 'The day wears on.', 'Afternoon\'s the busiest time around here.'],
    evening:   ['Getting dark soon. Best head indoors.', 'Evening already? Time flies.', 'The sunset is beautiful tonight.'],
    night:     ['It\'s late — what brings you out at this hour?', 'Careful wandering at night.', 'Most folk are asleep by now.', 'The night has ears, friend.'],
};

export const WEATHER_COMMENTS = {
    rain:   ['This rain won\'t let up...', 'Miserable weather, isn\'t it?', 'I\'m soaked to the bone!', 'Good for the crops, at least.'],
    snow:   ['This cold goes right through you.', 'Snow\'s piling up fast.', 'I can barely feel my fingers!', 'Beautiful snowfall, but treacherous.'],
    storm:  ['This storm is fierce!', 'We should find shelter!', 'The gods are angry today!', 'Thunder shakes the very walls!'],
    clear:  ['Beautiful clear sky today.', 'Not a cloud in sight!', 'Perfect weather for traveling.'],
};

export const NPC_QUEST_HOOKS = {
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

export const LOCATION_INFO = {
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

export const KINGDOM_INFO = {
    merchant:    ['Trade with {kingdom} has been {quality} lately. Their tariffs are {tariff}.', 'The {kingdom} economy runs on {resource}. Good market for it.'],
    guard:       ['{kingdom}\'s military is {strength}. Their border patrols have been {activity}.', 'I\'ve heard {kingdom} is {stance} toward us. Keep your guard up.'],
    farmer:      ['Farmers in {kingdom} grow {crop}. Their harvests have been {quality}.', 'The soil in {kingdom} is said to be {quality}. Rich lands.'],
    priest:      ['The people of {kingdom} worship {religion}. Their faith is {strength}.', '{kingdom}\'s temples are {quality}. A land of deep spirituality.'],
    noble:       ['{kingdom} is ruled by {ruler}. The court there is {quality}.', 'Politically, {kingdom} is {stance}. Interesting times.'],
    traveler:    ['I\'ve been through {kingdom}. The roads are {quality} and the people {hospitality}.', '{kingdom} has {landmark}. Worth a visit, if you can get there safely.'],
    villager:    ['My cousin lives in {kingdom}. Says it\'s {quality} there.', 'I\'ve never been to {kingdom} myself. Heard it\'s {quality} though.'],
};
