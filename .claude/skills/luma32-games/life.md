# A world that lives, and people who stay

Read before putting people on a map, and before any scene that brings someone in or
takes them away. The engine side is README "Life on a map".

## A world that lives

A map with the right tiles and nobody on it reads as a demo. What makes a game feel alive
is people **going about their lives**: not long dialogues, movement. This is part of the
world, built for every map like its props, not something added at the end.

- **Fill every map the story doesn't need empty.** As a floor: a town square or market
  6–12 people, a street or a road 3–6, a working interior (inn, shop, hall, classroom)
  2–5 besides whoever the story puts there, a home 1–2. A place that is empty is empty
  on purpose (the night, an evacuation, a ruin), and the story says why.
- **A mix of what they do**, all of it data on the map:
  - Some stand at what they do — behind a counter, at a forge, on guard; two people
    chatting face each other (`turnBack: true`: they answer and go back to their talk).
  - Some potter about their spot: `move: 'wander'`, `radius` 1–3, homes chosen so the
    radius never covers a door, a narrow passage or a spot.
  - Some walk a round: `route: { path, back, pause }` — the guard on the wall, the
    waiter between tables and the bar, the farmer between field and barn. Routes plan
    around the player and wait when blocked.
  - **On every outdoor map and every big interior, someone comes and goes**: `crowd`
    entries, passers-by who appear off screen or at a door, walk a path that makes
    sense (the road, the aisle, the door to the counter) and leave off screen or through
    another door. The first and last cells must be an edge out of view or a door (a
    warp or the cell beside one), or they wait there until the player looks away.
- **They fit the place and the moment.** Dolls that belong there (sailors at the port,
  cadets in the yard), each a different silhouette (`art.md`). Who is around changes with
  the story and the hour: a crowd before the festival, an empty street after the attack,
  the night watch instead of the market. Decide it with `when` on actors and crowd
  entries (or `crowd` / `route` as functions of the api), like anyone else.
- **Everyone answers A**, background people and passers-by too: one short line each, in
  the place's block of the locale, and a second one when the story has moved on (read a
  flag). No long talk needed — a line that tells you something about the place or the
  moment.
- **They never get in the way.** No wander radius, route or crowd path crosses a door, a
  one-cell passage, a spot or the cell a cutscene needs. All of it holds still while a
  script runs.
- **Check it moving**: two screenshots a few seconds apart on each map show who walks;
  if nothing changed between them, the map is dead. `?dev=1` draws routes and ids.

## People with each other and with the place

Walking alone isn't living. A commissioner asked for "more interaction between the
characters, and with the place": people who talk among themselves, use what is around
them, and notice the player. All of it is data on the actor (README "Life on a map"),
not scripts:

- **They use the place.** A route stops where something is done, and does it: `[x, y, {
  face: 'up', pose: 'reach', pause: 2500 }]` — the waiter reaches over the bar, the
  shopkeeper turns to the shelf, the old man sits on the bench (`pose: 'sit'` on the
  bench's cell), the gardener kneels at the flower bed. A route between two points with
  nothing done at either end is a person pacing.
- **They talk among themselves.** Two people standing together get a `chat` with two or
  four short lines of the place's block ("¿Has visto qué frío?" / "Ni los patos salen."),
  or emotions (`note`, `dots`, `heart`, or any bubble of `story.md`) when words would be too much. Their lines change
  with the story like their `talk`.
- **They notice the player.** A shopkeeper `look`s up when you come near and `greet`s
  you once a visit; a guard turns to watch; someone bumped into turns round, and may say
  so (`bump`). Not everyone: a few per map, the ones whose job is people.
- **They make way, in the game's own words.** Anyone the player walks into for a moment
  steps aside and says a line over their head (README, "Making way" under the life of a map). The console has a
  plain list of its own ("Disculpa, estaba en medio."), but it is only a fallback: **every
  game gives its own**, as a list in its catalogue (five or six lines, one is picked at
  random) named on the game: `makeWay: 'life.make_way'`. They are said by the people of
  this world, in its era and manner: a footman in Regency London begs milord's pardon,
  a market woman grumbles but moves, a soldier steps aside without a word but a `'sweat'`.
  A map whose people speak otherwise (a court, a port, a ship's crew) gives its own list
  on the map, and someone with a manner of their own on the person. Whoever must bar the
  way — the guard at the gate, the butler who won't let you upstairs yet — gets
  `makeWay: false`, or they would step aside and open the story's lock by themselves.
- **A remark in passing**: `api.bark` from the story for what doesn't need to stop the
  player — a friend calling "¡Por aquí!" from the door the objective points to, a
  neighbour's comment as you cross the stairs.
- **As a floor**: every map with people has at least one pair who chat or one person who
  does something at a route stop, and the people whose job is the player (shopkeepers,
  guards, receptionists) look up when you come.

## Companions

Someone who goes with the player (a partner, a dog, a friend for a chapter) is the
engine's `game.party`, never the cartridge's own follower code: the engine places them
behind the player on every arrival and reload, walks them in the player's steps, lets
the player walk through them, and makes them answer A. A cartridge that wrote its own
followers came back with a partner who couldn't be talked to, a dog nobody could pet and
a partner standing at the door after a reload.

- Who is in the party is a function of the story's flags (`when`), so a reload agrees.
- Where the story gives them a role on a map (they wait at the bar, they sit at the
  table), declare them in that map's `actors` with a `when` for that stretch: the map's
  declaration wins, they stay there, and they rejoin when the player leaves.
- In a cutscene they are actors like anyone (`api.actor('nieves')`): walk them, turn
  them, give them lines; the party picks them up again when control returns.

## People stay where they are

Leaving a map and coming back, or reloading, must find **the same people** for that
point of the story. "I went into the house, came out and they were gone" is the most
visible bug a player finds, and it never throws an error.

- **Who is on a map is data on that map.** Every person the player can meet there is in
  the map's `actors`, with a `when` that covers **the whole stretch of the story** they
  should be there — from the beat that brings them to the beat that takes them away. Not
  spawned only inside `enter` at one exact step (`if (at(api, 130)) spawn(...)`), not
  only inside a cutscene: those vanish on the next visit. The engine warns (`[luma]`)
  when the player leaves a map where someone stands only by `api.spawn`. When their
  `when` turns true or false while the player is there, `await api.refresh()` walks them
  in or out (`refresh: true` on the map does it by itself).
- **A cutscene ends in a state the map's data already describes.** If a scene brings
  someone in or moves them, it advances the flag their `when` reads, and their declared
  position is where the scene leaves them (or where they would naturally go back to).
  If a scene walks someone off towards another place, they are in that place from that
  flag on, not in limbo.
- **The engine remembers positions within a session**: back on a map, its people stand
  where they were (a route carries on from its leg). A reload starts them from the
  data, so the data must be a good place for each of them.
- **Same faces every visit.** Background people have fixed ids, dolls and homes in the
  data. Nothing about who is there is random per visit; randomness only in *what they
  do* while you watch (where a wanderer steps, when a passer-by comes).
- **The in-and-out test.** For every map and every stretch of the story that has people
  on it: note who is where, leave by a door or an edge, come straight back, compare;
  then save, reload, compare again. Someone missing, duplicated or teleported is a bug.
  An autoplayer can run this check by comparing `world.actors` ids before and after.
