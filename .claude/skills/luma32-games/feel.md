# What the player feels, and craft

Read before writing the beat list (the craft is planned there, not added at the end),
and again before the play-through: this is what the person who commissioned the game
notices first.

## What the player feels (the difference between "it works" and "it's good")


A chapter that finishes is not a chapter that plays well. These are what a player
notices first; each one came from a real play of a finished cartridge.

- **Every beat opens with context.** Never drop the player on a map and let go. When a
  chapter, act or scene starts: who am I, where, what just happened, what I want now —
  in a few lines of narration or a short exchange with someone present — and then the
  objective. Freedom stays, but the first step is always obvious.
- **The player never has to open START to know what to do.** The commissioner of a
  finished game "always had to look up what to do, because the game didn't make it
  clear". That is the most expensive defect there is: it makes every other beat feel
  broken. The next step reaches the player three ways, all three every time:
  1. **The scene says it**, in the world: the last line before control returns is
     someone saying what and where ("Te espero en la barra", "Las cajas están en la
     bodega, al fondo"), or the player's own thought. Never a beat that ends on a line
     that says nothing about what comes next.
  2. **The objective names a place the player can see or reach**, with the way: "the
     giant pine east of the clearing", "Jon and Robb have stopped at the bridge, to the
     right along the road" — never an abstraction ("Explore", "See the flat").
  3. **The objective has a place in code**: `api.objective(key, at)` with the person,
     the cell or the map (README "The objective and the guide"). The guide arrow points
     there and the engine checks it can be reached. An objective without a place is a
     `[luma]` warning; `at: false` only when there really is no one place.
  If a beat waits at an edge of the map or off screen, give it a visual cue too: a
  person standing there, a landmark, a path leading to it. If the player would have to
  guess, it's a bug.
- **A beat that needs several things says how many, and which are left.** "Mira las tres
  habitaciones" shows "1 de 3" as each is done, and the objective's place moves to the
  next one left. The commissioner could not finish "see the flat" because it advanced
  only by pressing A on piles of boxes and nothing said so.
- **Going somewhere is done by arriving; doing something is done with A.** "Go to the
  kitchen" completes on a trigger at the kitchen's door, not on A at a cell in it. A is
  for doing something with someone or something the objective names. Never make the
  player guess which cell answers: the guide points at it and it looks like what it is.
- **What you press A on must look like what it is.** A spot sits on a prop that is
  unmistakable (bigger, different, lit, alone) — never on a plain cell or on one tree among
  identical trees. The audit warns about a spot on open floor.
- **A answers when you touch the thing, not one cell away.** The engine looks at **one
  cell: the one right in front of the player** (two only across a `counter` prop). So the
  spot's rect is **the object's own cells** — every cell of its `foot`, and every drawn
  cell of it the player can stand next to — never the cell where the player stands, and
  never a rect pushed out from a "stand here" point. A world that writes stand points
  (`bed: at(2, 4, 'left')`) is fine for placing people; the spot is still built from the
  object's cells. If a prop is drawn taller or wider than its `foot`, either widen the
  `foot` to what looks solid or include those cells in the spot — otherwise the player
  walks into the drawing and A says nothing. Check every spot by walking into the object
  from each side the player can reach until it bumps: the "A" hint must show over the
  player, and A must answer at once. One cell back, neither. The engine warns
  (`[luma]`) when A is pressed on a spot from one cell too far or from inside it.
- **People talk face to face.** Before the first line of any conversation, everyone in it
  stands together: within two cells, in the same room, turned to each other. Someone who
  must join walks in (from a door or the edge) before speaking; a scene never has a line
  answered from the other end of the house, from another room, or from a person the
  player can't see. A call is a call: the other one is not on the map, and the scene
  shows the phone. The engine walks a free person over when a line answers someone far
  away and warns when it can't (`direct: true`, README "Directed conversations") — that is
  a safety net; a `[luma] … answers … from N cells away` means the scene was staged wrong.
- **Everyone talks.** Every person on a map answers A: named characters with a line that
  fits the moment (read the chapter's flags), background people with their own line.
  A person who ignores A reads as broken. The engine warns about every person without
  `talk` when the map loads; walk up to each one anyway.
- **Nobody pops in or out.** People enter and leave walking, from or to an edge of the
  screen or a door, never appearing or vanishing on the spot. Spawn them off screen (test
  it against the camera, `api.world.cam`) or at a door and walk them in; walk them out
  before despawning — off screen, or turned to a door and gone through it (`crowd` does
  all this for passers-by). The engine warns when someone appears or vanishes in view.
  The only exceptions are cuts (a fade to black, a card, a dream) and the story's own
  magic: someone who really appears out of nowhere does it with `api.appear` /
  `api.vanish` and an effect, never with a bare `spawn`.
- **Doors fit the grid.** A door, gate or passage is exactly one or more whole cells the
  player walks through in a straight line: the opening in the wall-top row and in the
  wall-face row line up, the warp sits on that cell, and the arrival cell on the other
  side is in front of the door, facing away from it. Check each door by walking through
  it both ways, not by reading the warp.
- **Walking pace.** Keep the player's `baseSpeed` at 1 on foot (B doubles it). The
  engine switches to the running animation above 1.5, so a faster base looks like
  scurrying. A faster pace (a horse, a world map) goes on that map only and is reset on
  every other map — a hook that sets it once leaks into the next map. Running has its own
  frames in every doll (stride, in the air, stride) and kicks up dust; give `dust: false`
  to tiles where it would be wrong (water, carpet, snow has its own colour:
  `dust: '#ffffff'`).

## Craft: what separates a great game from a correct one


"What the player feels" makes a game that never feels broken. These make one people remember.
Each goes on paper in the beat list (step 1) before any code, because they can't be
added at the end.

- **A verb, not just walking and reading.** Decide what the player *does* in this game
  besides walking and pressing A on people: fly, duel, sneak, investigate, bargain,
  cook, chase. Every chapter uses it and it grows harder or richer as the story goes. As
  a measure: never more than about three minutes of only reading before the player does
  something with their hands, and at most half of the game's length is reading
  (`length.md`). **The verb is played on the map, with the world's people
  and things** — choosing what to say, finding, following someone through a crowd,
  hiding behind a stall, carrying something across the house, putting things in their
  place — not by leaving the map for a separate screen.
- **Minigames are spice, not the meal.** A minigame (a scene with its own screen and
  rules) is for the one moment of a stretch that the map can't stage and the player's
  hands must feel: the dance, the chase, the duel. It is not how chapters are made:
  - At most **one every two chapters** on average, and never two in a row without a
    stretch of walking and talking between them. A game made of one minigame per
    chapter reads as a minigame collection with a story in between.
  - **Never a minigame for what the map already does.** Cleaning a room is walking to
    each mess and pressing A, with the mess gone after; decorating is carrying each thing
    to its place; a conversation is a conversation (choices with `api.ask`), not a
    meter on a separate screen.
  - Each one is short (under about 90 s), explains its controls on screen, and after a
    failure offers to skip it unless the story hinges on it.
  - A ★ set piece is staged on the map with everything the console has, not handed to a
    minigame.
  The beat list marks every minigame (◆) with why the map can't do it; the reviewer
  counts them.
- **Set pieces.** Each act has one moment staged with everything the console has: a map
  or scene made only for it, the camera panning to what matters, its own music or a
  silence, `shake` / `flash` on the impact, people reacting (`emote`). Mark them ★ on
  the beat list; they get the most care and the most testing.
- **Rhythm.** Alternate: tension and calm, inside and outside, talk and action, day and
  night. Two beats of the same kind in a row is a dip; three is where players put it down.
- **Cutscenes are directed, not read, and lines are short with real voices**
  (`story.md`, "Directing a cutscene").
- **Reward curiosity.** What a player finds off the thread is the texture of the world:
  an `examine` line on every prop that stands out (a shelf, a statue, a window), lines
  that change with the story, a side conversation, one secret per region (a hidden
  spot, an optional scene, an item). None of it blocks the thread. Side stories are
  quests in the journal (`api.quest`), things to find are a collection
  (`collections`, `api.collect`) with a count the player can see in the journal and in
  the credits; a reward or a line that acknowledges finding them all.
- **Every action has feedback.** A sound and a visual for every press that does
  something: doors, pick-ups, choices, hits. The world moves on its own: animated tiles
  (water, torches, flags — `frames`), something in the air (`weather`), light that
  follows the hour and the mood (`grade`; at night `dark`, with lamps, torches and
  windows that carry `light`), footsteps that sound like the ground (`step` on tiles),
  places that sound like places (`reverb` in halls and caves; `sounds` at a fountain,
  a river, a forge, louder as you near them), and the people of `life.md`.
- **Respect the player's time.** The engine autosaves when the player has control on
  arriving at a new map (`autosave: false` only for a game where that would cheat it)
  and greets a "Continuar" with the objective; so every map arrival must be a safe
  point — nothing half-done that a reload can't rebuild from flags (`pitfalls.md`).
- **Depth on screen.** Outdoors with sky or sea at the edge, a far layer behind
  (`parallax`: mountains, clouds, the sea) moving slower than the ground; still water
  that reflects whoever stands at its edge (`reflect`); a transition with character for
  the game (`transition`).
- **The ending lands.** The last beat gets a set piece, a song of its own and the
  credits (`api.credits`, over a backdrop of the game's own art: who made what, then
  what the player found and the time played). The final save leaves the
  player somewhere to walk after the end, or says clearly that it is over.

