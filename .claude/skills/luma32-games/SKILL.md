---
name: luma32-games
description: How to build a game (a "cartridge") for the LUMA 32 engine — the GBA-style browser console — where a story happens: maps to walk, people to talk to, scenes, minigames, music. Use when asked to create a new game, port a story into the engine, add maps, characters, minigames, songs or story scenes to a cartridge, or test a game in the browser.
---

# Building LUMA 32 cartridges

LUMA 32 is a handheld that only exists in the browser: a 240×160 screen at 60 Hz, a
d-pad, A, B, START and SELECT drawn on the page. A game is a **cartridge**: a folder under
`public/games/<id>/` that the console lists on its shelf. Static site, plain ES modules,
**no build step and no image or audio files**: art is painted in code, music is text.

**Read `README.md` first** — it is the reference for the manifest, map format, tile and
prop definitions, the full `StoryApi`, hooks and the music notation. This skill is the
*how*. **This file is the index: read it whole; read the others when the task needs
them** (and hand a helper only the ones its piece needs). Everything needed is here and
in `templates/`; **don't study other cartridges to copy them** — each game is built from
these rules, not from another game.

| Read | When |
| --- | --- |
| `classics.md` | before the beat list and the world contract: what the best GBA games did, and the bar a game here is held to |
| `length.md` | before the beat list and the pitch: how long a game lasts (90–120 min for a whole story), and where that time comes from |
| `genres.md` | before the beat list: what the engine offers for the genre, what makes it good |
| `feel.md` | before the beat list and before the play-through: what the player notices, and craft (the verb, set pieces, rhythm) |
| `adapting.md` | the game retells a book or another work: the bible, fidelity, the fidelity review |
| `world.md` | drawing maps, doors, the world map; water, sky, cliffs and the abilities that cross them; writing a world contract |
| `life.md` | putting people on maps; scenes that bring people in or take them away |
| `story.md` | the cast, story scripts, cutscenes and how to direct them, minigames |
| `art.md` | painting anything: palette, tiles, props, dolls, the contact sheet |
| `music.md` | composing songs, effects, ambiences |
| `pitfalls.md` | before scripting; when something hangs, flashes or goes black |
| `testing.md` | testing: screenshots, dev mode, engine warnings, the bench, the audit and the fresh-eyes review (one round each) |

## What the engine gives and what the cartridge decides


The engine gives the screen, the controls, maps, people walking them, dialogue and
choices, saving (position + flags), fades, music and hooks. **How the story unfolds is
the cartridge's own design**: the engine has no notion of chapters, acts, quests or
episodes, and this skill doesn't impose one. A story is *something that happens* on
the maps, carried forward by flags. Decide per game how to structure it in code.

What every story needs, whatever its shape:

- **A thread.** The story moves forward in one line: the player always knows the next
  thing, and where it is — `api.objective(key, at)`, with the person, cell or map it
  means, so the guide arrow points there and the engine checks it can be reached
  (`feel.md`, "The player never has to open START"). The START menu shows the objective on its own; SELECT
  does nothing unless the cartridge defines `onSelect` — define it (the templates show
  the objective there). Progress is flags, so the whole state of the story can be read
  from the save. A single progress flag or counter that grows as the story advances is
  usually the clearest way to keep it linear. **Number its stages with gaps** (10, 20,
  30…): a beat added later fits between two others; renumbering breaks every save that
  players already have.
- **The world reacts to it.** People appear, move and say different things as it
  advances (`actors[].when`, talk functions that read flags); doors open
  (`api.setTile`); light and music change (`grade`, `music`).
- **It is walked, not read.** Beats happen where the player goes: stepping on a trigger,
  pressing A on a spot or a person, arriving on a map (`enter`). Cutscenes move actors,
  pan the camera and talk; then control returns.
- **It survives a reload.** A save is position + flags only. Everything on screen must be
  rebuildable from flags in `enter` and `when`. Guard every one-time scene with a flag;
  `api.persist()` whenever control returns after a scene.

What the engine offers for each genre, and what makes each one good, is `genres.md`.
Companions who follow the player (`party`), getting about — swimming, diving to a map
below, flying, climbing, ice and currents, as abilities the story grants (`world.md`,
"Getting about") —, the guide to the objective, people who chat
among themselves, use the place at their route stops, look up and greet (`chat`, route
stops, `look`, `greet`, `api.bark`), people who walk over to answer in a conversation,
people who live on the maps (wandering, routes, passers-by, positions remembered, walking
in and out as the story moves: `api.refresh`), props that come and go (`when`), light,
weather, footsteps, places that ring and sound, autotiled edges, poses and gestures,
emotion bubbles, visual effects (bursts, appearing and vanishing, zoom), living portraits, text effects, cinema bars, transitions, far layers,
reflections, vibration, the journal, collections, the credits, autosave, the
settings menu, vehicles (carriages, boats, cars) with companions riding along, the
clock of day and night, the minimap and missions are the engine's too (README; vehicles
and the clock in `world.md`, "Vehicles, the clock and the street"): use them before writing your own. A
cartridge that writes its own version of one of these (its own followers, its own
markers) gets none of the engine's checks and comes back with the bugs they prevent.

## Non-negotiables


0. **The engine stays abstract.** `public/engine/` knows no game: no mechanics, no
   story, no names. A rule of play (encounters, inventory, combat, day/night, seasons) is
   written in the cartridge on the hooks (README "Hooks for the cartridge's rules"). Ways
   of getting about (swimming, diving, flying, climbing, ice, currents, ledges) are the
   engine's: tiles with a `medium`, abilities with `api.grant` (README "Getting about") —
   never a cartridge's own `canEnter` for water or its own flying sprite. Behaviour every game needs (people's routes, passers-by, light,
   weather, the A hint, directed conversations) belongs in the engine as an option any
   game can turn on, rather than copied into each cartridge. Change the engine only for
   something any game could use, keep it backwards compatible, and check every cartridge on the shelf still boots and plays —
   and the engine's own test cartridge, `tools/lab/` (README "Testing by eye").
1. **Every game has a title screen with "PULSA START".** The console owns it
   (`engine/console.js` `TitleScreen`); the cartridge only supplies `title.draw` (art),
   `title.music`, and positions. Never bypass it.
2. **Playable 100% on a phone.** Only the eight buttons exist, plus X, Y and Z when the
   game declares them (`buttons: ['x', 'y', 'z']` in game.js; README "Scripts"): three more
   buttons under A and B, for a game that needs them, never for what A, B or START can
   do. No typing, no tap targets
   inside the screen, no hover. Anything that would need a keyboard becomes a d-pad
   picker (choose fragments in order instead of typing a word).
3. **Text a player reads never lives in code.** Spanish strings go in the cartridge's
   `locales/es/*.json`, code passes keys (`api.say('ana', 'market.ana_1')`). Array values
   become one box per entry. Code, identifiers, comments and docs are English. Speaker
   names live under the top-level `"speakers"` key of a locale file; their colour and
   voice pitch under `theme.ui.speakers`.
4. **It must look good, by a written standard.** All art follows **`art.md`** (palette
   ramps, light, outlines, seamless ground, characters with distinct silhouettes, the
   GBA-era mistakes to avoid) and passes its checks with `tools/sheet.mjs`. All music
   follows **`music.md`** (a motif before any chord, a game-specific idea per song, no
   shared accompaniment kit). Read the one you need before painting or composing; whoever
   paints or composes for you gets it in their contract.
5. **A story from someone else's work is retold faithfully, in our own words.** The
   player who loved the book must recognise it scene by scene: that is the immersion.
   Faithful in everything that happens — the same events in the same order, no invented
   scenes, no merged characters, the same relationships and secrets (who knows what,
   and when), each character's voice (how they talk, their tone, their habits of
   speech). Every conversation that matters in the book has its scene in the game, with
   the same people, saying the same things in substance. Never in the book's words:
   the text is someone else's work, and authenticity comes from what happens and how it
   sounds, not from copied sentences. Never reproduce song lyrics or melodies either —
   name the song, compose original music for the moment. See `adapting.md`.
6. **Adult stories are rated, not softened.** If the story has romance, desire or sex
   (or the work it retells does), keep it: the tension, the consent, the night together
   and what it changes between the characters are part of the plot, written with weight.
   Mark the cartridge `meta: { ..., rating: 18 }` — the shelf stamps "+18" on its label.
   The explicit moment itself is a cut to black or an ellipsis, not a graphic description.

## Building a cartridge, in order


0. **Ask about the world map** when the genre calls for it (`world.md`):
   before anything else, as a question to whoever commissioned the game. Don't decide it
   alone and don't skip it silently.
1. **The story first, on paper.** A beat list in order: where each beat happens, who is
   there, what the player does, what it changes, **the line that tells the player what
   comes next, and the objective with its place** — plus the game's verb, the ★ set
   pieces, the ◆ minigames with why the map can't do each one (`feel.md`, "Minigames
   are spice") and the rhythm (`feel.md`, "Craft"), the genre's needs (`genres.md`), and
   per chapter the door it shows before its key, what it teaches before it tests, and
   the one idea each new place adds (`classics.md`). **Each beat gets its minutes**, of
   reading and of play, and each chapter its played stretch (`length.md`): a whole story
   is 90–120 minutes of a first play, and at most half of it reading.
   If it adapts something, first the analyst (asked by mail; its instructions are
   `.claude/agents/luma-analyst.md`) writes `SOURCE.md` (every chapter, character and
   subplot), then the bible from it, then the beat list from the bible (`adapting.md`) —
   never from memory.
2. **Show it before building it.** Write `reports/pitch.md`: the game in a few lines
   (what it's about, who the player is, the verb, the ★ set pieces, how it ends), its
   genre, structure, the places and the main cast, and its **length**: the total, the
   minutes per chapter and the played stretch of each (`length.md`). Then paint **one key-art
   screen**: a real map of a central place, to the standard of `art.md`, with two or
   three of the cast on it in their poses, under its light and weather, with a line of
   dialogue on screen — and screenshot it (it needs just enough of steps 3 and 4: the
   skeleton and the palette). Send both to whoever commissioned the game
   and **stop until they approve**; their changes go in before anything else is built.
   Changing the tone or the look here costs minutes; once the world is built, it costs
   the game.
3. **The skeleton.** Copy `templates/` into `public/games/<id>/`: `game.js` (or
   `open-world.js` renamed to `game.js`, for maps joined edge to edge and rule hooks),
   `art/palette.js` and `locales/es/common.json` (the shape of a locale file: `meta.*`
   for the shelf, `speakers.*`, then one block per place or topic). Replace `<id>`, then
   `git init` the folder: each cartridge is its own repository. It boots with
   `?game=<id>` before it is on the shelf; add `{ "id": "<id>" }` to
   `public/games/index.json` only when it is playable. Give it `dev.jumps` from the
   start (`testing.md`).
4. **Look.** `art/palette.js` following `art.md` § 2 (ramps, light, the saturated budget); `theme.shell` recolours the plastic of the handheld and
   `theme.ui` the windows; `title.draw` and `cover(ctx, x, y, w, h, frame)` (the 58×56
   shelf label). They are the first thing a player sees.
5. **The world.** Tiles, props and maps for every place the story needs (`world.md`), then
   the contact sheet (`art.md` § 8) clean before any map is wired to the story.
6. **The cast.** One doll spec per character and outfit — and the background people each
   map needs, with their routes and passers-by (`life.md`); silhouettes checked on the
   sheet.
7. **The story, start to end**, on the world. Then the scenes it calls for, then music.
8. **Audit.** `tools/audit.mjs` at every dev jump until it reports nothing
   (`testing.md`), and "Nueva partida" boots. In a team the **auditor** runs it, asked by
   mail (`mail/auditor.author.md`); the author neither audits nor plays the game through.
9. **The fresh-eyes review**: the reviewer plays it from "Nueva partida" to the end with
   real keys, reloads mid-way, runs the newcomer test at every chapter start, the
   in-and-out test and every spot; the author fixes and checks each fixed point only (`testing.md`) and, for an adaptation, the fidelity review
   (`adapting.md`), with their fixes. Only then on the shelf.

A cartridge's files are its own business; a common split is `art/`, `world/` (tiles,
maps), `cast.js`, `music.js`, `sound.js`, `scenes/`, the story code, `locales/es/`.

7. **It is made and judged in the modern look, from above and from the ground.** The
   house plays its games in 3D (README "The modern look", `?hd=1`): every screenshot that
   judges art, a map or a scene is taken with `&hd=1`, and the classic look is assumed to
   follow. The player may also see any map from behind (third person, `&fp=3`) or from
   the eyes (`&fp=1`), so every map is built for the three views (`art.md` § 6b,
   `world.md` "Seen from the ground"): walls as a top row over face rows that read as
   faces, roofs that read from above, beds and tables seen from above with a `foot` as
   tall as their `size` (they lie down), buildings as boxes, everything else a prop that
   stands; a `sky` and a `skirt` where an edge is in view, `clock: false` indoors.
   `node tools/sweep-hd.mjs <url> <id>` draws every map on contact sheets from above;
   `node tools/bench.mjs <url> <id>` draws every dev jump from above, from the eyes and
   from behind with the errors under each picture (testing.md). The cast is drawn with
   `relief` and the marks of each life (`art.md` § 6.9): from behind, a flat doll is a
   cut-out.

## Done means

A cartridge goes on the shelf, or a chapter is handed over, only when all of this holds:

- [ ] The pitch and the key-art screen were approved before the world was built.
- [ ] Played from "Nueva partida" to the end with real keys, and reloaded mid-way — by
      the reviewer, not the author.
- [ ] No `[luma]` warning in the console over that play (`testing.md`), and
      `tools/audit.mjs` reports no problem at any dev jump; there is a jump per chapter
      start and per ★ set piece.
- [ ] Every objective has a place (`api.objective(key, at)`) and the guide points right;
      the newcomer test passes at every chapter start: the scene's last line and the
      objective say what and where without START.
- [ ] Every conversation happens face to face: nobody answers from another room or the
      far end of a place; calls are staged as calls.
- [ ] Minigames within the budget of `feel.md` (about one every two chapters, never two
      in a row, none for what the map can do), each ◆ on the beat list with its reason.
- [ ] Every minigame lets a test through: under `?dev=1`, with the flag `dev.win` set
      (`api.is('dev.win')`), it ends at once as won, with the result the story expects
      from a win. That one flag for every minigame of every game, no flag of its own
      (`testing.md`).
- [ ] Every map with people has people doing something with each other or the place
      (`life.md`, "People with each other"); companions are the engine's `party`.
- [ ] Every map with people passes the in-and-out test (`life.md`); every outdoor map
      and big interior has someone coming and going.
- [ ] Every person answers A; every spot answers from touching distance and shows the
      "A" hint (`feel.md`).
- [ ] Every beat opens with context and the next step is findable (`feel.md`).
- [ ] The verb is used every chapter; every ★ set piece is staged (`feel.md`, "Craft").
- [ ] The length holds (`length.md`): the thread alone is 75+ minutes of a first play
      (90–120 with what's optional, for a whole story, unless the commission says
      otherwise), `tools/length.mjs` gives at most half of that as reading, and every
      chapter has its played stretch of 5+ minutes.
- [ ] Every map reads well in the modern look from above and from the ground
      (`tools/sweep-hd.mjs`, `tools/bench.mjs` over every dev jump with nothing under any
      picture, and the review is played with `&hd=1` and looks from behind at every
      chapter start): walls stand with faces that read, roofs lie, what is drawn from
      above lies down, nothing floats, the sky and the skirt are there where an edge shows.
- [ ] Every named character has `relief` and the marks of their life, within 18 colours
      (`art.md` § 6.9), and reads from behind as from above.
- [ ] Art passes `art.md` § 8; every song follows `music.md`; every portrait talks and
      blinks (`story.md`).
- [ ] The fresh-eyes review scores 4+ on every axis it can score, with no blocker and no
      major defect; minor ones are fixed or listed under "Left" in the author's report.
      An axis the commissioner accepted lower (a length kept by decision) or one the
      reviewer cannot test (sound, headless) doesn't count, and the report says so. For
      an adaptation, the fidelity review lists only documented cuts. One round closes
      everything in its scope ("Asking the auditor and the reviewer"); a second is asked
      only for the blockers and majors the first found, after they are fixed, and never
      a third.
- [ ] The bar of `classics.md` holds, item by item.
- [ ] Every note in `reports/feedback.md` is fixed or answered (below).

## Asking the auditor and the reviewer: one round each

The auditor and the reviewer are asked by mail (`mail/auditor.author.md`,
`mail/reviewer.author.md`) and each answers with one report. **A round closes with
everything in it**: a report that covers the whole scope, with nothing deferred, no
questions back and no "ask me again for the rest". Rounds became loops when the author
asked them for what they cannot do, and they asked back instead of closing. So:

- **The note names the cartridge, the commit and the scope, and nothing to decide.** For
  the auditor: every jump, or a range after a fix. For the reviewer: round 1 the whole
  game; a later round the defects of the last review (by number) and the files changed
  since, with what was changed in a line each. Not "is this fixed?" about one point — the
  author checks a fixed point themselves, with a screenshot of that point — and never
  "what would you do here", "which of these two", "is the story good": the auditor has no
  opinion and the reviewer gives theirs in the scores, once.
- **What the author doesn't ask them to fix.** Neither edits the game. A report that says
  "the player never got control back" means the cartridge lacks a `dev.win` exit or a
  jump's `timeout`, not that the auditor should play the minigame; "no jump for chapter 4"
  means the author adds it, not that the reviewer should find the chapter another way.
  Anything the note asks that is not theirs, they answer in one line of the report (what
  their run can say about it, or that it is not theirs) and go on with the whole scope.
- **They never wait.** A browser that won't boot, a locale that won't parse, a jump that
  hangs, a chapter they can't get past: it goes in the report as a blocker with what they
  saw, they get past it with the next jump, and the report still covers the rest. The
  round ends with the report, in one turn of theirs; a second turn exists only if the house
  asks for one.
- **The author answers a report by fixing, not by writing back.** Every line of it is
  fixed or answered under "Left" in the author's own report (why it stays), and the next
  note to them, if any, lists what changed. A note that argues with a defect instead of
  fixing or listing it is the start of a loop.
- **Rounds.** The audit is asked after integrating and after each batch of fixes, each
  time over the jumps the fixes touch; it reports what the tool finds, so it ends when the
  tool finds nothing. The review is asked once for the whole game, and once more only for
  the blockers and majors it found, after they are fixed: that second round re-plays those
  points and the chapters their files feed, carries the rest, and is the last. Minors are
  fixed by the author and checked by the author.

## Feedback from whoever plays it

The person who commissioned the game plays it and says what's wrong. That is the most
valuable input there is, and it is lost if it only lives in a chat.

- **Write every note down** in the cartridge's `reports/feedback.md`, dated, in their
  words, with its status (open / fixed / answered) and what was done. Fix all of them
  before handing the game back, and look for the same defect elsewhere in the game:
  a note about one map is usually true of others.
- **A note that would hold for any game becomes a rule here.** Ask: would another
  cartridge make the same mistake? If so, add the rule to the file of this skill where
  it belongs (`feel.md`, `life.md`, `story.md`…), with what to check, in the same piece
  of work — and, if the engine could catch it, a `[luma]` warning or an engine option.
  The skill learns from every game, not only the one that got the note.

## Splitting the work, and spending


A game is big; spending is the constraint. The story is written by **one** author —
you, or a single agent — start to end, so it reads as one story with one voice and one
thread. **No agent launches sub-agents** (the Task or Agent tool): every member of the
team — the helpers, the analyst, the reviewer — is started by whoever runs the team (on
luma32.com, a commission), each with its own conversation, and they speak by mail
(`mail/<to>.<from>.md`). The analyst and the reviewer work when the author asks them by
mail. Only work that stands alone and has a written contract goes to a helper:

- **World:** tiles, props and maps of a set of places (outdoors / interiors), with the
  door coordinates and, for every thing the player presses A on, **the object's cells**
  (not where to stand). Also each map's life: the homes of its background people and
  the routes its passers-by walk (`life.md`).
- **Cast and sound:** doll specs, songs, effects, ambiences. Painters get `art.md`,
  composers `music.md`, whole: they are the contract for quality.
- **Scenes:** each ◆ minigame of the beat list with its options and result, documented —
  only those; a helper doesn't propose more.
- **Cover:** the title screen and the 58×56 shelf label, after the cover of the book or
  the poster of the work the game retells (`.claude/agents/luma-cover-artist.md`). Its
  section of the contract names the edition, or the look wanted.

Rules that keep it affordable:

1. **Write the contract before anyone starts**: file ownership (each helper owns its
   files outright and edits nothing else), ids and their prefixes, what it hands back.
   The house starts the helpers in parallel once a person approves it; write the story
   while they work, or after.
2. **Give each helper only what it needs**: its part of the bible, not all of it; this
   index plus the skill files of its piece (a map painter: `world.md`, `art.md`,
   `life.md`) and the README sections it uses, not the whole repo. Every helper re-reads
   everything it is pointed at.
3. **Use the cheaper model for mechanical work** (painting maps, cast specs, sound) and
   the strongest one for the story and anything that needs judgement.
4. **Few helpers.** Three or four parallel helpers is plenty; more multiplies the reading
   and the testing, not the quality.
5. **Helpers test their own piece lightly** (`testing.md`, "Test proportionately") and report what
   they could not verify; the full play-through is done once, at the end, by the author.
6. **Work that can be cut keeps itself safe**: write files early (a skeleton that runs,
   then fill it in), so an interrupted helper can be resumed from disk.
7. Engine needs reported by helpers are fixed once, by the author, in the engine.
8. **The author looks at every map a helper hands back** (one screenshot each) before
   wiring the story to it. "Every point is reachable" is not "it looks like a GBA
   town": empty fields of noisy ground, props in water and generic trees where a
   landmark should be come back from helpers as "done". Send it back with what's wrong.
9. **Contracts name the story's needs, not just the ids**: for each point the story uses,
   say what the player must see there ("a giant pine, the tallest in the forest", "the
   heart tree with its red-eyed face"), so the map draws a landmark, not a coordinate.

## Deploy


It's a static site served from `public/`: saved files are live (the edge may cache up to
an hour). Nothing to build or restart. Each cartridge folder is its own git repository (commit there, not in the site's);
`public/games/index.json` (the shelf) belongs to the site's repository.
