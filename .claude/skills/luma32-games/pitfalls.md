# Things that bit us

Each of these cost a real cartridge time. Read before scripting a story; check against
it when something hangs, flashes or goes black.

- **Fades.** A fade (`engine.fx.fade`) persists across scenes. Cards are `aboveFade`;
  your own full-screen scenes are not unless you say so — a scene pushed after a
  fade-out is black. If the screen is black when it shouldn't be, someone left the fade
  at 1. A scene ending can flash the map under it for one frame: black the screen in its
  last frame or fade before `done`.
- **Scripts that hang.** A walk resolves `false` when its actor leaves the map (a warp,
  a despawn) instead of waiting forever, and `walkTo` gives up after 1.5 s without
  progress — but the script then carries on with the actor somewhere else. Walk, then
  warp; and read the result when it matters.
- **Every arrival is saved.** The engine autosaves once the player has control on a new
  map. A scene that warps somewhere and hands control back with the story half-moved
  (a flag set, the next one not yet) leaves a save that reloads into that half. Move the
  story's flags before the warp, or finish the beat before giving control back.
- **`enter` runs on every arrival and on continue.** Re-entering a map or reloading must
  never replay a scene or duplicate a character.
- **Actors are chosen on arrival.** If the story changes who should be on the current
  map mid-visit, set the flags and `await api.refresh()` (or `refresh: true` on the map):
  the engine walks in whoever the map's `actors` now want, with their `talk`, and walks
  out whoever they don't. Don't spawn the map's own people by hand, and don't warp to the
  same map to reload it.
- **A cutscene walk lands where the scene needs it.** In a scene, walk with
  `walkTo(x, y, { timeout: 4000, place: true })`: if one blocked cell (a table, the
  player) stops them, they stand there anyway and the scene goes on.
- **Background behaviour**: routes and passers-by are the engine's (`route`, `crowd`,
  `life.md`); only what goes beyond them goes in the map's `update(api, e, control)`.
  Light that depends on flags or time in `grade` and `dark`.
- **Swapping things at runtime:** a prop that depends on the story is a map prop with
  `when` (same `id` for its two states: the wardrobe shut and open), plus `api.refresh()`
  when it changes mid-visit. For a one-off, `api.addProp(p)` (same id replaces it in
  place) / `api.removeProp(id)`, `api.setTile(x, y, id)` for ground — not saved: redo it
  in `enter` from flags. An `examine` that changes with the story is a function
  `(api, thing) => key`, on the kind or on one prop entry.
- **Dialogue covers the bottom 50 px.** Stage conversations where the speakers are not
  under the box, or use `{ top: true }` (the name tag hangs under the box).
- **Long card subtitles wrap**; keep them to two lines.
- **Sitting** is `pose: 'sit'` on the actor (or `setPose('sit')`) on the chair's cell, with
  the chair drawn as a prop behind; a chair-front prop in front only if the chair has
  arms. Walking stands them up, so set the pose again after moving someone.


## What a finished game still came back with

A cartridge whose author's autoplayer ran clean from start to end came back from its
first review with four blockers and a "next step" score of 1. Each is a kind of mistake,
not a one-off; look for the kind across the whole game.

- **A beat that hangs on a press nothing can receive.** A partner who followed the player
  (non-solid) held the chapter's `talk`; a counter's spot sat where A never looked. The
  autoplayer called the `talk` directly, so it passed. Rule: a beat advances by pressing
  A only on what the objective points at (`api.objective(key, at)`), and
  `tools/audit.mjs` must report that place reachable and answering at every jump.
- **A text key the locale doesn't have.** A person from an earlier chapter was still on
  the map with a `talk` that read a key that didn't exist; the player saw `pili.talk`.
  Rule: every person's `when` ends where their chapter ends; the engine now warns on any
  missing key.
- **A scene under a fade.** The credits played for 40 seconds behind a black screen.
  Rule: `fadeIn` before pushing a scene, or give it `aboveFade`; the engine warns. The
  credits draw above the fade; fade in (or end) after them — control on a black screen
  is warned and faded in by the engine, but that is a fix, not a staging.
- **The player placed on a prop.** A chapter started with the player standing on the
  sofa the objective asked him to lie on. Rule: start points are free floor cells in
  front of things; the audit reports anyone inside a prop or a wall.
- **Two lines that contradict each other.** Where the dog was during the birth differed
  between two chapters. Rule: facts the story repeats (who is where, who knows what) live
  once in the bible and each chapter is checked against it, not against memory.
- **The objective that only the code knew how to finish.** "See the flat" advanced on A
  over three piles of boxes and said nothing. Rule: `feel.md` — say how many and which
  are left, and complete "go somewhere" by arriving.
- **Two people in one cell.** A dog declared non-solid stood on its owner's cell; the
  engine now moves anyone set on an occupied cell to the nearest free one and warns
  (`[luma] … was set on …'s cell`), and nobody walks into anyone. Give everyone their own
  cell in the data; companions are `game.party`.
- **A dev jump that sets flags but not the objective.** It hid the real objective while
  testing. Rule: a jump sets the state a player would have there, objective and place
  included — the audit checks it.


## The person behind the desk

Not a bug: it was scripted that way, in more than one cartridge. A clerk, a receptionist,
a shopkeeper stands behind a desk; the chapter's beat ("hand over your things", "check
in") is a spot on the **desk** and the objective points at the **desk**. The player sees
a person, walks up to the desk, and A gives them the furniture — or, from the middle, the
person's idle line while the beat waits on the desk's corners. Loki's processing room
(the clothes desk) shipped like this.

- **What the player does with a person is the person's `talk`.** The beat lives in the
  `talk` of whoever is behind the desk, branching on the story's step (the step's line
  when it is due, a short idle line otherwise); the objective points at them
  (`api.objective(key, 'clerk')`) and its text names them, not the furniture
  ("Entrega tus cosas al empleado", not "…en el mostrador").
- **The desk is a `counter: true` prop.** Then A on the desk reaches the person behind it
  (the engine looks two cells across a counter, people first) and the "A" hint shows over
  them. A desk without `counter` is a wall between the player and whoever sits there.
- **A spot on the desk is for the desk only** — the stamp, the bell, the ledger — and only
  when nobody stands behind it, or when the thing is the point and the person isn't.
- The audit warns when an objective points at a thing and someone with a `talk` stands
  next to it facing it (`… stands behind it: if the beat is theirs …`).
