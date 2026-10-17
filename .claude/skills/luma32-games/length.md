# Length: how long a game lasts, and where the time comes from

Read before the beat list and the pitch, with `feel.md`. A game retelling a whole book,
film or season is commissioned at **90 to 120 minutes of a first play**, by someone who
doesn't know the answers, and more if the work is long. A shorter game is a decision the
commissioner states, never the default.

## The lesson that wrote this file

"Una corte de rosas y espinas" retells a 400-page novel. Its first play took 51 minutes,
and `tools/length.mjs` says its catalogues hold 51 minutes of reading. The game was the
book read aloud with walks in between: thirty beats, about a minute and a half each, almost
none of it played. There was no lack of story. What it lacked was play: the time a game
lasts comes from what the player **does**, not from what they read.

## The budget

| | Minutes of a first play | What it is |
| --- | --- | --- |
| Reading | at most half: 45–60 | every box, cutscene and examine line read once (`tools/length.mjs`) |
| The thread, played | 35–50 | the verb on the map: finding, asking around, following, hiding, choosing, carrying, the few ◆ minigames |
| Off the thread | 10–20 | side quests in the journal, the collection, a secret per region, people with something new to say |

- **The thread alone, without anything optional, lasts at least 75 minutes.** What's
  optional adds to that; it doesn't make up for a short thread.
- **6 to 8 chapters of 12 to 18 minutes**, each one with **a played stretch of at least 5
  minutes**: a goal on a map and the freedom to reach it in more than one step and more
  than one order (three people to ask, four things to find, a guard's round to slip past,
  a house to search). That stretch is the chapter's core, not a corridor between scenes.
- **No more than about three minutes of only reading in a row** (`feel.md`, "Craft").
  A chapter that is twelve minutes of text and three of walking is the failure above.
- A longer work (a long novel, a whole season, a saga's volume) scales the same way: more
  chapters of the same shape, never longer cutscenes. Several volumes in one open world
  are one volume per commission, each a whole thread of this length (`genres.md`, "Open
  world").

## Where the time comes from in a story

- **The time the book skips is the game's best ground.** "Weeks went by at the manor" is
  one line in the book and one beat in a lazy beat list. In the game it is days to live:
  a morning routine, an errand for someone, a place that opens a little more each day,
  someone who warms up to you. The book's montages and "days passed" are where the player
  plays.
- **What the book narrates as action is played on the map.** A hunt is tracking prints
  through the snow, choosing where to wait, keeping downwind; a search is pressing A on a
  room; an escape is a route past people with their own paths. Not a cutscene, and not a
  ◆ minigame unless the map truly can't stage it (`feel.md`).
- **Information is earned, not handed over.** What one character would tell in a speech,
  the player gathers from three people, a letter and a place; each piece is one beat of
  play and the scene that puts it together lands harder.
- **Every region gives two or three side quests** (`api.quest`) out of its people and
  places: small stories of their own, each with a reward or a line that matters, and one
  secret seen before it is reached (`classics.md`).
- **The verb grows.** Each chapter uses it in a new way, then combined with what came
  before (`classics.md`, "Teach before you test"); that alone is minutes of play that
  feel like progress.
- **Places come back changed.** A place visited again after an event, with new people,
  light and lines, is new content at half the price of a new map, and it shows the story
  moved.

## What is not length

None of these make a game longer; they make it slower, and players notice:

- slower walking, longer empty walks, the same path back and forth with nothing new on it;
- more boxes per line, the same thing said twice, cutscenes stretched with pauses;
- repeating the same task, grinding, a minigame played again to pad a chapter;
- hiding the next step, a vague objective, failure that sends the player far back;
- a bigger map, more streets, more people on them: an open world with nothing new to do
  is distance, not length (`genres.md`, "Open world").

If a chapter is short, give it more to **do** (a played stretch, a side quest, a place
that comes back), not more to read or farther to walk.

## On paper first

- **The beat list gives each beat its minutes**: reading (its words ÷ 230) and play (what
  the player does and how long that takes someone who doesn't know the answer). Each
  chapter's sum, and the game's, go on the beat list.
- **The pitch states the length** (`SKILL.md`, step 2): the total, the minutes per
  chapter, and what the played stretch of each chapter is. If the sum is under the
  target, the beat list grows in play before anything is built.
- **A helper's contract names the played stretches**, so the world has room for them:
  the people to ask, the things to find, the round to slip past, each with its place.

## Measured, not guessed

- `node tools/length.mjs <id>` gives the words of the catalogues and their minutes of
  reading. **More than half of the target is the sign of a game that is read, not
  played**; cut text or add play.
- The reviewer's play-through with real keys (`testing.md`, `team.md`) writes down
  `save.time` at every chapter card and reports the time per chapter, the reading and
  the played minutes, and flags any chapter without its played stretch. Someone who
  knows the answers plays faster than a newcomer: what they measure, plus the reading
  they skipped, is the floor of a first play, not the estimate.
- A game short of its budget is not done. It goes back to the beat list, not to padding.
