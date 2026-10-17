# What the best GBA games did, and the bar it sets

Read before the beat list and the world contract, with `feel.md`. The best-selling games
of the console (Pokémon Ruby/Sapphire, FireRed/LeafGreen and Emerald; the Super Mario
Advance series; Zelda: A Link to the Past and The Minish Cap)
and the story games people still remember (Phoenix Wright, Golden Sun, Mother 3, Harvest
Moon: Friends of Mineral Town, Hamtaro: Ham-Ham Heartbreak, Broken Sword) sold because of
a handful of things that can be written down and checked. Each rule below says what it
was, what it means here, and what the engine already gives for it. **A game here is
commissioned to that standard: the one a player would compare it to.**

## The world is the guide (Pokémon, Zelda, Mario)

- **See the door before the key.** The player meets the locked thing first — the tree
  that can be cut, the river that needs Surf, the cracked wall, the guard who won't let
  you pass, the friend who won't talk to you yet — and only later gets what opens it, and
  remembers where it was. Every chapter shows at least one door it doesn't open yet, and
  a later chapter opens it. Rule of play on the hooks (`canEnter`, `onBump`), state in
  flags, the door drawn so it reads as closed. Water, a chasm, a cliff are doors too: a
  `medium` the player sees long before the story grants the ability (`world.md`).
- **Teach before you test.** A new thing (a verb, a rule, a kind of puzzle) appears first
  where failing costs nothing and the answer is in view, then once with a twist, then
  combined with what came before. Never the first use of anything in a set piece.
- **Each place adds one idea.** A town, a route, a dungeon: one new thing each (a person
  with a new kind of request, a new obstacle, a new use of the verb), then mixed with the
  old ones. A place with nothing new is a corridor; cut it or give it one.
- **Nobody gets lost.** Paths, landmarks and people lead the eye: the road bends toward
  the next town, the gym is the biggest building, someone stands at the exit saying
  where it goes. The objective and the guide (`feel.md`) are the safety net under that,
  not a replacement.
- **A home base in every place.** Pokémon's Centre is always there and always the same:
  a safe, warm room where the story pauses (save, heal, someone who knows you). Every
  game here has its equivalent per region: the inn, the flat, the bar — always lit, with
  its own short theme.

## Every screen has something (Pokémon routes, Mario levels)

- **Routes with intent.** Each screen of an outdoor map holds at least one thing besides
  ground: a person doing something, something to examine, a hidden spot, a view (`life.md`,
  "Reward curiosity" in `feel.md`). Walking 20 cells of empty grass is the most common way
  a map here reads as unfinished.
- **Secrets that pay.** One per region, off the path but visible from it (an item behind
  a fence, a cave mouth across the water), so the player plans to come back. A collection
  with a count (`collections`, the journal) — Pokédex, big coins, heart pieces.
- **People who notice you.** Pokémon's trainers see you and walk up (`sight`); shopkeepers
  greet; townsfolk comment on what you just did. The world reacts to the story within
  one beat: after the big event, three people mention it.

## It feels good in the hands (Mario, Zelda)

- **Instant response.** A press does something on the next frame, with a sound. Walking,
  running (B) with its own animation and a puff of dust, bumping with a thud, doors with
  their sound and transition — the engine gives all of it; never slow it down with a
  script on every step (README "Hooks for the cartridge's rules").
- **Failing is cheap and readable.** You see why you failed and you are trying again in
  two seconds, near where you were. Never back to a title or a long replay.
- **Each dungeon is built around its thing (Zelda).** When a chapter gives the player a
  new ability or item, the next place is built to use it in five different ways, and its
  climax tests it.

## Story games: the verb is in the conversation (Phoenix Wright, Hamtaro, Golden Sun)

The best story games of the console made talking *playable*, without minigames:

- **Investigate, then confront (Phoenix Wright).** First gather: examine places, talk to
  people, collect facts (flags; a list of evidence the player can open with `api.list`).
  Then a confrontation where the player must present the right fact at the right line
  (`api.ask` with the evidence as options): right answer, the story moves with a punch
  (a `card`-style shout, `flash`, `shake`, the music cuts); wrong answer, a gentle
  penalty and another try. Fair: every answer was seen before.
- **Words you learn and use (Hamtaro).** The verb can be something collected from people
  — a phrase, a gesture, a piece of gossip, a recipe — and used with other people. Each
  new one reopens conversations all over the world (talk functions read it).
- **A power used on people and places (Golden Sun).** Read a mind, move an object, light
  a lamp, calm an animal: one ability applied on the map, to things and people, with its
  own animation and sound. Townsfolk's hidden thoughts are some of the best writing in
  those games.
- **A on what is in front, with an indicator (Broken Sword on GBA).** No cursor hunting:
  the thing that matters shows the "A" when faced (the engine's hint), and examining
  twice gives a second line.

## People with lives (Harvest Moon, Mother 3)

- **Schedules.** Who is where depends on the hour or the story's step: the baker at the
  oven in the morning, at the bar at night (`route` / `when` as functions of the api).
  The player learns the town by its rhythm.
- **Relationships that move.** Characters remember what the player did for them, and
  their lines and greetings change (flags per person). A small gift, a returned favour, a
  wrong word, said back to the player chapters later.
- **The town changes with the story (Mother 3).** The same map, transformed: the market
  empty after the storm, new faces after the wedding, a closed shop reopened. One map,
  gated by flags (`world.md`) — players feel time pass in places they know.
- **Two states of one world (A Link to the Past).** When the story allows it, a second
  version of a place (night, the past, a dream, after the fire) that the player moves
  between, where a change in one shows in the other.

## How it looks and sounds

- **Readable at 240×160.** Saturated palettes with clear value contrast, characters with
  unmistakable silhouettes, the important thing brighter than its surroundings
  (`art.md`). Pokémon's towns each have a palette; Mario's sprites read from across a
  room.
- **Everything moves a little.** Water, flowers, flags, torches, smoke, people
  (`frames`, `weather`, `life.md`). A still screen for more than a second outside a
  dialogue reads as a frozen game.
- **Depth.** Far layers that scroll slower (`parallax`), reflections, light at night
  (`dark`, `light`), levels you climb (`heights`), and the world from the air in Mode 7
  (`api.flyover`).
- **Moments with punch.** The battle swirl, Phoenix's "¡Protesto!", the level clear: a
  big beat gets a transition, a freeze, a flash, its sound and its music sting.
- **A theme per place, a motif per person** (`music.md`); a jingle for every success.

## The bar (checked before a game is handed over)

What "as good as the games it would be compared to" means here, in things a reviewer can
check. Each is in `done.md` or the reviewer's rubric:

- [ ] Every chapter shows a door it doesn't open yet, and the game opens each later.
- [ ] Every new verb or rule is taught safely before it is tested; none debuts in a ★.
- [ ] Every place adds one idea; no outdoor screen is empty ground.
- [ ] One secret per region, visible from the path; a collection with a count.
- [ ] People react to the story within a beat; a few look up, greet, chat, have a schedule.
- [ ] Each region has a home base: lit, safe, its own theme.
- [ ] The story's verb is played on the map and in conversation; minigames within budget.
- [ ] Every big moment has punch: transition, flash or shake, sound, music.
- [ ] Nothing on screen is still for long outside dialogue.
