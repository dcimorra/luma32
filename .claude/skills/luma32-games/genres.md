# Genres: what the engine offers and what makes each one good

Read the part for the game's genre before writing the beat list. Look at what the engine
already offers (README) before writing it yourself; what's left is the cartridge's, on
the hooks and as scenes.

Moments the console has no mechanic for (a song, a match, a puzzle, a card game, a chase,
a flight) are **scenes**: `{ update(e), draw(ctx, e) }` pushed with `api.play(scene)`,
resolving with a result the story reads (`story.md`).

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
  `api.overlaps`) for enemies, projectiles and blocks, `hud`, `actionA` to free A.
- **Cartridge:** combat, health, items, enemy behaviour, dungeons' puzzles. The items
  that open the world — flippers, a feather, a climbing glove — are the engine's
  abilities (`api.grant('swim')`); ice floors and currents are dungeon puzzles for free.
- **What makes it good:** controls that feel tight (knockback, invulnerability frames,
  a hit flash), enemies with one readable pattern each, a dungeon built around the item
  found in it, a boss that tests that item. Death returns to a nearby point, never to
  the title.
