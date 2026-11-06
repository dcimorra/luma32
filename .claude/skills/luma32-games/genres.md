# Genres: what the engine offers and what makes each one good

Read the part for the game's genre before writing the beat list. Look at what the engine
already offers (README) before writing it yourself; what's left is the cartridge's, on
the hooks and as scenes.

Moments the console has no mechanic for (a song, a match, a puzzle, a card game, a chase,
a flight) are **scenes**: `{ update(e), draw(ctx, e) }` pushed with `api.play(scene)`,
resolving with a result the story reads (`story.md`).

## The shape of each genre

Chapters, beat lists and minutes of reading are the shape of a **story** game. Other
genres are measured by their own unit, and the plan, the dev jumps, the length and the
review use that unit wherever the other files say "chapter". The commissioner can always
set another shape; this is the default when nobody says.

| Genre | Unit | A first play, by default | Reading at most | The played core of each unit |
| --- | --- | --- | --- | --- |
| Story adventure, visual novel, graphic adventure | chapter | 90–120 min (`length.md`) | half | a played stretch of 5+ min |
| Open world | a story on the world | 90–120 min per story | half | the world's freedom on the thread |
| Action adventure | dungeon (and the overworld stretch that leads to it) | 2–4 h, 4–8 dungeons | a fifth | the dungeon itself: 15–30 min of rooms, one item, one boss |
| RPG with battles | area (a town, the way out of it, its dungeon or boss) | 3–6 h, 5–10 areas | a third | the way through the area: fights, a shop, a secret |
| Puzzle or arcade | level (or a world of levels) | as many levels as there are ideas, each idea taught, twisted, combined | a tenth | the level |

- **The beat list becomes the unit list**: each unit with what it adds (the item, the
  idea, the enemy), what it tests, and its minutes, measured as `length.md` says.
- **"Done" is the unit's too**: a dev jump per unit start and per boss or set piece; the
  newcomer test at each unit start; the reviewer reports time per unit.
- **Reading over its ceiling** is a game that is read where it should be played, the same
  defect as in `length.md`, by the genre's measure.

## Story adventure (walk, talk, live the story)

The most common game here: a story told by walking its places and talking to its
people, with scenes for its big moments.

- **Engine:** maps, people with `talk`, `route` and `crowd`, spots, `direct: true`,
  portraits with moods, `log: true`, `skip: true`, cards, the "A" hint.
- **What makes it good:** the thread always clear (`feel.md`), the places alive
  (`life.md`), the cutscenes directed (`story.md`), and a verb of its own beyond walking
  and reading, used every chapter (`feel.md`, "Craft"). Every place has things to
  examine that tell the world. If it retells a book, fidelity is the bar
  (`adapting.md`).
- **Trap:** a chain of "go to X, talk to Y". Each beat should change something the
  player can see — a door, a person's mood, the light, who is on the street.
- **Second trap:** a minigame per chapter to make up for it. The hands-on part of a story
  adventure is on the map — choices in conversation, finding, carrying, following,
  hiding — and minigames are the rare moment the map can't stage (`feel.md`).

## Open world / sandbox (a city or a region to roam, the stories on it)

**How to recognise it.** The brief says "mundo abierto", "sandbox", names GTA or a game
like it, wants no loading screens, a society that goes on without the player (routines,
events, rumours), activities outside the story, and often several stories or a whole
saga in one world. It is usually written for a 3D engine: a third of it is technique
(LOD, streaming, carga progresiva) that is the engine's here, not the cartridge's. Read
it as a story adventure on a big living world, and **ask the questions below before the
plan** (`SKILL.md`, step 0), in one note, each with a recommendation.

- **Engine:** maps of any size with only the screen drawn, joined edge to edge with
  `connections` so a city is crossed with no fade (README "Open worlds"); interiors as
  maps behind a door, the warp's short transition the only "load", the hour, the flags
  and everyone's place kept across it; the clock (day and night, kept in the save);
  people's `route` and a map's `crowd` as functions of the api, so a schedule by hour
  and by story; `refresh` so a place changes while the player is in it; streets with
  traffic and people on the pavement (`population`, lanes or a street graph) with bodies
  of other times (`carriage`, `cart`, `boat`) and the cartridge's own; the minimap and
  the whole-map screen it adds to START; markers and missions (README "Missions");
  `api.setTile` / `addProp` with `keep` for a world that remembers; `api.dress` for
  outfits and for a protagonist who changes; the guide arrow across maps; positions
  remembered within a session. It was measured with a whole real city (README "Streets
  as a graph", "A city from OpenStreetMap"): 1,110 × 1,198 cells load in a second and a
  frame costs under 3 ms.
- **What to tell the commissioner about the console**, because the brief assumes
  another one: the screen is 240 × 160 with 16-pixel cells, a "32-bit" look in the GBA
  sense; one map holds about 1.3 million cells in some 95 MB and the engine does not load
  by sectors, so a world bigger than that is **several large maps joined by their edges**
  (a district each), which the player never notices; a ballroom "enorme" is fifteen cells
  across on screen; the modern 3D look is still a prototype on a map that size, to be
  measured on a phone before it is promised. The technical paragraphs of the brief are
  met by the engine or not at all: say which, and don't spend the plan on them.
- **Cartridge:** the rules of the world as counters and flags on the hooks (README "Hooks
  for the cartridge's rules"): relationships, reputation, money, etiquette, what the
  hour allows. Each one the player can read somewhere (a line, a look, a door) and each
  one changes something playable; two or three that matter beat ten that don't. The
  activities (a dance, a race, a card table) are played stretches on the map first and
  scenes only when the map can't stage them (`feel.md`). Dynamic events are actors and
  props with `when` on the hour and the flags, and `crowd` entries that come and go.
- **The thread still rules.** An open world is where the story happens, not instead of
  one: the objective is always set and reachable (`SKILL.md`, "A thread"), each chapter
  has its played stretch and the world's freedom *is* that stretch (three people to ask
  across town, a ball to get into, a letter to deliver before dusk). Each story on the
  world is a whole game's thread, 90–120 minutes (`length.md`); the world adds what is
  off the thread, it never makes up for a short one. A big map with nothing new on it is
  distance, not length.
- **Several stories in one world (a saga, a series).** One world, built once with room
  for every story — every district, estate and interior any of them needs, at least as
  a shell with its doors — and the stories on it in the order they share, each with its
  own progress counter numbered with gaps. **One story per commission:** the first builds
  the whole world and the first story to the shelf; each next story is an improvement
  commission on the same cartridge (`improving.md`), so the players' saves keep loading
  and the world they know grows. A commission for all of them at once is the plan the
  author cannot write and the review that never empties. For an adaptation the analyst
  writes `SOURCE.md` for the volume being built and, once, a **saga sheet**: the timeline
  across volumes, who is where and with whom in each, what each needs of the world — so
  the world and the counters have room from the first day (`adapting.md`).
- **The questions**, with a recommendation each (the plan is approved from the answers;
  `world.md`, "The world map", is one of them):
  1. **Who the player is.** One character throughout, the protagonist of each story in
     turn (`api.dress` changes the doll; which one when a story has two), or a character
     of their own living among the stories? Each answer is a different game; an
     adaptation's fidelity favours the protagonists.
  2. **The scope of this commission.** Which stories now, which later; recommend the
     world and the first story, the rest phased as above. The length of each
     (`length.md`), stated.
  3. **The places, named.** Every district, house, park, hall, shop and estate the
     stories need, and which exist as a shell for later; whether the world gets a world
     map (recommend yes) besides the minimap.
  4. **The street.** Does time pass (the clock, how fast, where it is paused), do people
     keep a schedule by hour, what vehicles of the period drive the streets and how
     dense, does the player ride or drive one.
  5. **The rules.** Which systems count (relationships, reputation, etiquette, money,
     rumours) and what each changes in play; which the player sees as a number and
     which only as the world's reaction.
  6. **What is optional.** Which activities, side missions and markers exist, which
     events are missed if not attended and what that costs; all of it beside the
     thread, never required to find it.
  7. **The source and the shelf**, for an adaptation: the book or its screen version
     when both exist, and which edition; which group (saga) on the shelf it joins;
     whether other cartridges of the same work exist there and what, if anything, is
     shared with them (a look may be, a story never).
  8. **Rating and cover:** `rating: 18` when the stories carry it (`SKILL.md`,
     non-negotiable 6); the cover to imitate.
- **Trap:** building the brief's engine. The cartridge writes none of the streaming, the
  traffic, the followers or the markers (`SKILL.md`, "What the engine gives"); it writes
  the story, the places and the rules.
- **Second trap:** a world without a thread, "the player will find things to do". A
  sandbox here is judged on its thread like any story game, and the fresh-eyes review
  plays it from "Nueva partida" to the end of the story built (`team.md`).
- **Third trap:** one commission for a saga. See above: one story per commission, the
  world first.

## Graphic adventure (puzzles, items, examining)

The GBA's best were Phoenix Wright (investigate, then confront with the right evidence),
Hamtaro: Ham-Ham Heartbreak (words learned from people and used on people) and Broken
Sword (A on what is in front, examine twice): `classics.md`, "Story games".

- **Engine:** spots and `examine`, `api.list` for the inventory, `api.ask` for
  dialogue trees, flags for what's been found.
- **Cartridge:** the inventory (flags or a list in the save's flags), using an item on a
  spot or a person (an "Usar…" option in the spot's script), combining items.
- **What makes it good:** fair puzzles — every solution is hinted in the world before
  it's needed (a line, a picture, a person); no moon logic. Examining anything gives a
  line, and a second look gives another. A conversation tree that reveals, doesn't
  repeat. **No dead ends:** a needed item can't be lost or missed for good; if the player
  is stuck, someone nearby offers a nudge after a while.

## Visual novel

- **Engine:** `api.stage` (full-screen backdrop with `figures`), `portraits` with moods,
  `log: true` (backlog), `skip: true` (hold B to skip read lines), choices with
  `api.choose` recorded in order.
- **What makes it good:** choices that matter and are remembered (later lines read
  `choice.*`), backdrops and figures that change with the moment, music carrying the
  emotion, the text paced in short boxes. Branches converge visibly or end differently;
  say which at the start if there are several endings.

## Monster-collecting RPG

- **Engine:** scrolling `api.list` (bags, parties, shops), `bar` / `panel` / `textBox`
  for battle and status screens, actors with `sight` (trainers who see you and walk up),
  `ledge` tiles, tile `top` layers (tall grass), several save slots, `connections` for
  routes joined edge to edge, the world map (`world.md`).
- **Cartridge:** battles, parties, encounters, type charts — scenes and hooks
  (`onStep` for tall grass). Surf, Dive, Fly-over and climbing are the engine's
  abilities on `medium` tiles, granted by the story (`world.md`, "Getting about").
- **What makes it good:** a readable battle screen, a difficulty curve with gyms or
  bosses as gates, routes with trainers placed so the player can choose to fight, towns
  with life, a healing place in each town.

## Action adventure (Zelda style)

- **Engine:** `movement: 'free'` with a hitbox, entities (`api.addEntity`, `api.move`,
  `api.overlaps`, `api.seek`, `api.shoot`, `api.damage`) for enemies, projectiles and
  blocks, `hud`, `actionA` to free A, X Y Z for items (`buttons`); `api.hop()` for a jump in
  play (over a gap, a stream, a low fence: where it lands is the game's); a camera by
  rooms or screens (`camera: { rooms }`, sliding from one to the next); maps joined by
  their edges for the overworld.
- **Kits** (`templates/kits/`, to copy and make the game's own): `sword.js` (a blade,
  hearts, knockback, a moment of safety after a hit, foes that wander and chase) and
  `inventory.js` (items in the flags, a bag, an item on a button).
- **Cartridge:** combat, health, items, enemy behaviour, dungeons' puzzles. The items
  that open the world — flippers, a feather, a climbing glove — are the engine's
  abilities (`api.grant('swim')`); ice floors and currents are dungeon puzzles for free.
- **What makes it good:** controls that feel tight (knockback, invulnerability frames,
  a hit flash), enemies with one readable pattern each, a dungeon built around the item
  found in it, a boss that tests that item. Death returns to a nearby point, never to
  the title.

## RPG with battles (turns, or time gauges)

- **Engine:** exploring, companions (`party`), dialogue and the stage, `api.list` for
  menus, shops and the bag, `bar` / `panel` / `textBox`, several save slots, `onStep`
  for encounters, transitions of the game's own for the way into a battle
  (`game.transitions`), Mode 7 for a world map, a flight or a ship.
- **Kits** (`templates/kits/`): `battle.js`, battles with time gauges (each acts when
  their bar fills; the clock waits while the player chooses), attack, skills that cost
  points, items, fleeing, and `encounter()` for random battles on a step; `inventory.js`.
  The formulas, the screen and what foes do are the game's: change them, or write
  another kind of battle (turn order, a grid of tactics, cards).
- **Cartridge:** the party's growth (experience, levels, equipment), the bestiary, the
  shops, the story.
- **What makes it good:** a battle that asks a choice every turn (a weakness, a cost, a
  risk), not A held down; encounters that don't wear the player out (a rate that drops in
  places already cleared, or foes seen on the map); growth the player feels within an
  area; a boss that tests what the area taught; a place to heal and save before it.
- **Trap:** a battle screen built before the world: one fight that plays well comes
  first, then the area around it.

## Puzzle or arcade

- **Engine:** a scene of the game's own (`api.play`), or the map itself with `movement:
  'free'`, entities and the hooks (`canEnter`, `onStep`, `onBump`); ice and currents;
  the save for the levels reached.
- **What makes it good:** each idea taught alone, then twisted, then combined; a level
  that fails fast and restarts at once; the next level one press away.
- **Trap:** a story wrapped round it that the player has to read to reach the next level.
