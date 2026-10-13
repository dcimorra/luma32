# People, scenes and directing

Read before writing the cast, story scripts, cutscenes or minigames.

## People and scenes


- **Characters:** a doll spec (skin, hair + `hairStyle`, top, shirt, tie, bottom, shoes,
  `coat`, `dress`, `glasses`, and the other options listed at the top of
  `engine/doll.js`); the engine generates 4 directions × 3 walking frames, 3 running
  frames (above speed 1.5) and poses (`sit`, `kneel`, `lie`, `sleep`, `reach`, `cheer`,
  `blink`), and everyone blinks when
  standing still. An outfit change is another doll; `api.dress(id)` changes the player's.
- **Animals are dolls too:** `{ creature: 'dog' | 'cat' | 'bird' | 'bee', fur, markings }`
  (`legs: 'short'` for a corgi; the options at the top of `engine/creature.js`). They walk,
  run, follow (`party`), take routes and sit/lie/sleep like anyone; a bird or a bee gets
  `mode: 'fly'` on its actor. Never a static prop sprite for an animal that moves.
- **Portraits are alive.** Every portrait and stage figure uses the `state` it is given:
  the mouth opens on `state.mouth` while the line types and the eyes shut on
  `state.blink`, and the face changes with `mood` (at least neutral, smile, sad, angry,
  surprised for named characters). A still face that talks reads as a cut-out.
- **Decisions:** `api.choose(name, value)` records them in order in the save; anything
  later reads `api.get('choice.<name>')`.
- **Scenes (minigames):** only where `feel.md` "Minigames are spice" allows, marked ◆ on
  the beat list with why the map can't do it. Call `this.done(result)`; `opaque = false` to see the map
  under; `aboveFade = true` to stay visible over a fade. Draw with `engine/font.js` and
  `ui.frame`. Show the controls on screen (`◀ ▶ elegir · A tomar`). Failing restarts the
  attempt or lets the story go on — never a soft-lock. If a scene is a skill test the
  story doesn't hinge on, offer to skip it after a failure.
- **Music:** songs in the tracker notation (README "Music"), written with the method of
  `music.md` — a map of moods first, then each song from its motif; ambiences and effects
  in `sound.js` with the engine's `tone`/`burst`.

## Directing a cutscene

A cutscene is directed, not read: people move while they talk, the camera goes where
the attention is, silences are timed.

- **Place them before the first line.** Every conversation starts with its people
  together: within two cells, in the same room, facing. Whoever isn't there walks in
  first — from a door or the edge, `walkTo(x, y, { timeout: 4000, place: true })` — and
  then speaks. A conversation the player starts by pressing A on someone already has
  them together; one a trigger or `enter` starts needs the staging written. Never a line
  answered from another room or the other end of the house. Phone and chat messages are
  not conversations on the map: the other person is not an actor there, and the scene
  shows the phone (a sound, the player taking it out, `reach`). The engine walks someone
  over when a line answers a person far away, and warns if it can't; treat the warning as
  a staging bug, not as the engine's job.
- **People react while others talk.** Whoever isn't speaking still has a body: an
  `emote` at what was just said, a `gesture`, turning away, a step back. In a group, the
  one being talked about looks at the speaker.
- Turn `direct: true` on in the game (README "Scripts"): every line turns its speaker to
  whom they answer and that one back, and a speaker off screen or under the box gets the
  camera, which comes home when the script ends. Then direct on top of it: someone
  steps closer before the line that matters, walks off mid-sentence, reacts (`emote`),
  turns away. Two people standing still exchanging ten boxes is a radio play.
- **Bodies act.** People sit at the table, kneel by the wounded, lie in the infirmary bed,
  sleep, hand something over (`reach`), raise their arms in joy or surrender (`cheer`):
  `setPose`. `lie`/`sleep` on the floor lies across (head to the left); on a bed drawn
  upright (a prop taller than wide) the engine tucks them in along it by itself: head on
  the pillow near the top, the body under the bed's covers, whatever cell of the bed they
  stand on. Never a horizontal body across an upright bed: draw the bed upright and let
  the engine do it, and look at the screenshot. They nod, shake their head, hop with joy, shiver with cold or fear, bow
  (`gesture`). Two people hug: face each other, `reach`, and `nudge` them a few pixels
  together. A moment the book describes with a body is shown with one.
- **Lines carry their delivery**: `{p}` before the word that hurts, `{shake}` on a
  shout or fear, `{wave}` on something dreamy or drunk, `{c=accent}` on a name or a
  clue the player must remember (README "Scripts"). Sparingly: one effect in a line,
  not one in every line.
- **Frame the big moments**: `api.letterbox(true)` at the start of a set piece and off
  when control returns; a special place change with an `iris` or a `wipe`
  (`transition` on the warp, or `game.transition` for the whole game's style).
- **Feelings without words**: emotion bubbles over a head — `api.emote(id, 'heart')`,
  `'anger'`, `'sweat'`, `'note'`, `'idea'`, `'sad'`, `'shock'`, `'dots'` (an awkward
  silence), `'zzz'`, or `'!'` / `'?'`. A reaction in a bubble often says more than a line.
- **Jumps are staged, not played**: `a.jump()` on the spot (joy, a scare), `a.jump(dir,
  { n })` over a fence, a gap, a stream — crouch, arc, landing dust. No button makes the
  player jump: a jump is something a scene shows, never a way through the map.
- **Hits are felt**: `api.shake` also vibrates the phone; `api.rumble(ms)` for a blow, a
  door slammed, a dragon landing.
- **Show what happens, don't only say it** (README "Visual effects"). Someone who
  appears by magic comes out of an effect (`api.appear(def, { fx: 'shadow' })`) and goes
  into one (`api.vanish`); a blow lands with `api.tintActor(id, '#ff3030')` and a `burst`;
  a wall breaks in `shards`, a spell is `magic` and a `ring`, a kiss gets `hearts`, a
  memory or a dream `api.wave`, the moment that matters `api.zoom(2, { at })` (and back to
  1 before control returns). Fire and chimneys smoke with the map's `fx` emitters, not
  with code in `enter`. Pair each effect with its sound (`sound` in the options). One
  effect per beat: it punctuates, it doesn't decorate every line.
- Move several at once with `api.together`; cut silence with `api.wait`.
- Walk people in a scene with `walkTo(x, y, { timeout, place: true })` (`pitfalls.md`).
- Change the music for the moment, or add a layer to the one playing (`layer` channels,
  `api.musicLayer`), and give the impact a `shake` or `flash`.
- **Short lines, real voices.** One or two boxes per turn, then the other speaks or
  something happens. Each named character sounds like themselves (vocabulary, rhythm,
  what they won't say); background people sound like the place. Subtext over
  explanation; a joke now and then, even in a dark story.
