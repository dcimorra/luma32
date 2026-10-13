# The world: maps, doors, the world map

Read before drawing tiles, props and maps, or before writing a world contract for a
helper. Art itself is `art.md`; who lives on the maps is `life.md`.

## The world


- **Map first, then script.** Draw the ground as ASCII rows. The view is 3/4 from above:
  a horizontal wall is a row of wall-top over a row of wall-face; a darker "shadow" floor
  row under walls sells the depth. Props are anchored at their **bottom-left** cell and
  y-sorted with actors; `foot` sets which cells block.
- **Open worlds:** join maps edge to edge with `connections` (mirror them on both maps)
  so the world feels continuous; keep warps for doors and interiors. Maps can be as big
  as needed. Build the game's rules on `canEnter`, `onStep`, `onBump`, `update`, `grade`.
- **One world, one story on it.** Places are defined once; the story adds its people
  and scripts to them as it goes. Don't fork a map per moment of the story; gate what's
  on it with flags.
- **Write the world down** for whoever scripts the story: map ids, sizes, doors, and the
  coordinates of the spots that matter (a seat, a counter, a stage), ideally also
  exported as data so the story code reads them instead of copying numbers.
- **Painter** (`engine/gfx.js`): `fill rect px hline vline box dither noise line
  ellipse pix stamp` and a seeded `rand`. Vary repeated ground (variants by position,
  flowers, cracks) so it doesn't look tiled.

## The world map


A Town Map like the GBA Pokémon games: a full-screen view of the whole world that shows
**where the player is**, the **name of that place** and **where the current objective
leads**.

- **When to ask.** If the game has several places the player travels between —
  monster-collecting RPG, open world, action adventure with regions or dungeons — ask
  whoever commissioned it whether it gets a world map, recommending **yes**. If they
  say yes, it is a **requirement**: on the beat list, built with the world, and part of
  the play-through. A visual novel, a single location or a game made of scenes doesn't
  need one: don't ask.
- **What it shows.** A painted overview of the region (not a shrunk copy of the tiles):
  routes, towns, interiors grouped under the town they belong to. A blinking marker on
  the player's place (`api.map`, and `api.player.x/y` for big maps), its name from the
  locale, and a second marker on the objective's destination. The d-pad moves a cursor
  between places and shows each one's name; B closes it. Places not yet visited are
  hidden or greyed.
- **Data, not drawings.** One table in the world data: each map id → its place on the
  overview (a rect or point) and its name key; each objective key → the map id (and
  optionally the spot) it points to. The map reads that table, `api.map`, the objective
  and the flags — so it is right after a reload with nothing extra saved. When a new
  objective is set, its entry goes in the table in the same change.
- **How it opens.** A scene (`api.play`, `opaque = true`) opened from SELECT (`onSelect`)
  and/or from a START menu entry or an item ("Mapa"). Its texts live in the locale like
  everything else.
- **Test it** with a screenshot from at least two places and two objectives, and once
  after a reload.


## Heights and Mode 7: places with depth

A place that goes up — a hill fort, terraces, a tower, a palace on its steps, a raised
road over a market — gets `heights` (README "Heights"): the engine raises the cells,
draws their faces and hides whoever walks behind them. Don't paint a wall face as a row
of tiles on a map with heights: the face is the raised tile's `side`.

- **Levels are routes.** Stairs (`ramp`) are the only way up; `drop: true` makes edges a
  one-way way down — a shortcut back, never the only way to a goal the player must leave
  again. Put what the player is after on top and the stairs round the back, and the
  climb becomes the walk.
- **A face per material.** Give every raised ground tile a `side` (rock with strata for a
  cliff, brick for a wall, planks for a stage); stairs draw steps. The engine's default
  face is for a quick sketch.
- **The air is a scene.** A flight, a dragon ride, crossing the sea, the first sight of a
  city: `api.flyover` shows the current map from the air in Mode 7 in one line. A game
  of its own up there (steering, a race) is a cartridge scene on `engine/mode7.js`.

## Getting about: water, sky, cliffs


The engine swims, dives, flies and climbs (README "Getting about"): paint the place, give
the tile its `medium`, and let the story grant the ability. Never write a `canEnter` for
water or a flying sprite of your own.

- **Who can, and why, is the story.** An ability arrives in a beat the player sees — the
  friend who teaches them to swim, the dragon that lets them ride, the gloves found in the
  ruin — with `api.grant('swim')` in that scene and a line that says what it opens. It
  goes on the beat list like a ★: what the player could not do before, and the first
  place where they now can.
- **The door before the key** (`classics.md`). The sea, the chasm, the cliff are on the
  map from the start, painted to read as "not yet": the player walks up to the shore,
  bumps, and remembers it. When the ability comes, the next place uses it in several
  ways, and old places open (an island seen from the first beach, a ledge with a chest).
  An `onBump` line on the medium the first time ("El agua está helada, no puedo nadar
  tan lejos") tells the player it's a door, not a wall.
- **Paint the medium so it reads.** Water animates and has edges against the shore;
  deep water is visibly darker and its outline is where you can dive; a chasm is dark
  with a lit rim; a climbable cliff has holds (a plain rock wall stays solid, no
  `medium`); ice shines; a current shows its direction, animated. A fence or a hedge a
  flyer crosses is `low` and is drawn lower than a head. Give water tiles `step: 'water'`
  and, if the ripples should not be white, `foam`.
- **Diving is two maps with the same cells.** The map below has the size of the one
  above, and its open seabed lies under the deep water: wherever the player goes down
  they land on floor, wherever they can come up there is deep water above. Paint it as
  its own place (sand, rocks, kelp, what was lost there), with a blue `grade`, `fx` of
  `bubbles`, its own music, and something worth the dive. `breath` only when air is part
  of the challenge, and then with deep water to come up to within reach.
- **Mode-bound people.** A gull or a bat `mode: 'fly'`, a swimmer or a fish
  `mode: 'swim'` (keeps to the water), someone who rows across with `can: ['swim']` on a
  route: the world shows those abilities before the player has them.
- **Companions come along.** They share the player's abilities and go into the water
  and the air with them; a map where they shouldn't follow says `party: false`.
- **Held flight** (`api.setMode('player', 'fly')`) is for a ride or a spell that lasts
  a stretch of story: keep it in a flag and set it again in `enter`, because a held mode
  isn't saved; land with `api.setMode('player', null)` over ground.
- **Check it** with the guide and the audit, which use the same rules: before the
  grant no objective may lie across the water (the engine warns it can't be reached),
  after it the new places must be reachable. A dev jump just before and just after each
  grant, and each medium walked into with real keys, with and without the ability.
