# Testing (screenshots are the proof)


```bash
(cd tools && npm install)   # once: playwright-core, pinned in tools/package.json
cd public && setsid nohup python3 -m http.server 8765 --bind 127.0.0.1 >/tmp/luma-http.log 2>&1 </dev/null &
node tools/shot.mjs "http://127.0.0.1:8765/?game=<id>" /tmp/out script.json
```

- **Many commands on one open page** (walking a stretch, advancing dialogue, checking
  state between moves): `tools/drive.mjs`, not a browser server of your own.
  ```bash
  node tools/drive.mjs start <game>-<role> "http://127.0.0.1:8765/?game=<id>&dev=1"
  node tools/drive.mjs <game>-<role> '[{"key":"ArrowUp","times":3},{"eval":"…"},{"screen":"/tmp/x.png"}]'
  node tools/drive.mjs stop <game>-<role>     # always, when you are done
  ```
  Same steps as `shot.mjs`, plus `{ "goto": url }` and `{ "reload": true }`; console
  errors and `[luma]` warnings come back with each command. It closes itself after 10
  minutes without a command, but stop it yourself: an open browser is memory the whole
  machine pays for.
- **Play long stretches at `&turbo=4`** in the URL: the game runs four times sooner and
  plays the same — everything counts ticks, `save.time` too, and drive/shot divide every
  `wait`, `hold` and `gap` by the turbo, so a script means the same game time at any speed.
  Screenshots and timings read the same; only the wall clock is shorter.
- **To get through a stretch, `tools/play.mjs`, not an autoplayer of your own.** On a
  drive.mjs browser it plays with real keys: walks the engine's path to the objective (or
  through the warps to its map), faces it and presses A, reads every box, picks choices,
  and prints every line, objective and `[luma]` warning, with `save.time`:
  ```bash
  node tools/play.mjs <game>-<role> --jump 12 --secs 100 --choice 1,0 --stopobj obj.c4_
  ```
  `--target <actorId>` walks to someone instead; `STUCK` and `!!` lines are where a player
  would be lost too — look there by hand. Writing and debugging a harness of your own is
  what used to eat the first half hour of every review round.
- **Every browser you open, you close.** `shot.mjs` and `sheet.mjs` close theirs (and
  give up after 5 minutes if a script hangs). Never write a script of your own that
  launches Chromium and stays up; if you need something drive.mjs lacks, ask for it in
  your report.
- `script.json`: `{ "wait": ms }`, `{ "key": "KeyZ", "hold", "times", "gap" }`,
  `{ "point": "[data-btn=a]" | "#dpad", "dx", "dy", "hold" }` (the on-screen controls),
  `{ "screen": "name" }` (just the 240×160), `{ "shot": "name" }`, `{ "eval": "js" }`.
- Keys: arrows, Z = A, X = B, Enter = START, Shift = SELECT.
- Boot timing: with `?game=` the logo still plays, then the title intro; **wait ~5.5 s
  before pressing Enter** or every later step is off by one.
- `window.luma.engine` is the running console: `luma.engine.scenes` is the stack; the
  World is the scene with `.api` — set flags, teleport or `api.warp(...)` to reach a
  stretch of the story fast. A cartridge may read a URL parameter of its own in
  `newGame` to start at a given point of its story while it is being built.
- `VP=390x844 TOUCH=1 DPR=2` emulates an upright phone; `VP=844x390` one on its side.
- Console errors print to stdout. `node --check` every JS file; validate locale JSON.
- **Art without playing**: `node tools/sheet.mjs http://127.0.0.1:8765 <id> /tmp/<id>-sheet.png`
  draws every ground tile 3×3, every prop and every doll (12 frames + silhouette) on one
  PNG and prints colour counts and ground edges that stand out (`art.md` § 8). One
  sheet replaces dozens of map screenshots while painting.
- `tools/shot.mjs` loads `playwright-core` from `tools/node_modules` and the Chromium
  that version expects from `~/.cache/ms-playwright` (missing: `npx playwright-core
  install chromium` in `tools/`); override with `PLAYWRIGHT=` / `CHROME=`.
- **The audit, at every jump: `node tools/audit.mjs "http://127.0.0.1:8765/?game=<id>"`.**
  In a team it is the **auditor**'s (`.claude/agents/luma-auditor.md`), asked by mail
  (`mail/auditor.author.md`) with the scope; the author never runs it.
  It starts a new game, runs every dev jump (pressing A through its scenes), and after
  each one lists, from where the player really stands: an objective without a place or
  out of reach, a place where nothing answers, a spot no cell touches, a spot on open
  floor, someone inside a prop or a wall or on another person, a warp into a wall, a
  missing text, every `[luma]` warning and console error. It costs one browser for a
  few minutes; run it after every block of work and before every hand-over. **A
  cartridge is not handed over with problems in it.** It needs `dev.jumps` that leave
  the game where a player would be (flags, objective with its place, map, cell): one per
  chapter start and per ★ set piece at least, and one for every objective a beat sets
  is better. The audit sets the flag `dev.win`, and every minigame must end at once as
  won when it reads it under `?dev=1` (`api.is('dev.win')`, the result a win gives the
  story): one flag for all, never one of each game's own ("Done means"). A minigame that
  doesn't shows as "never got control back", and is a defect. The minigames themselves are
  still played by hand, once each.
- **The length, measured** (`length.md`): `node tools/length.mjs <id>` for the minutes of
  reading; on the play-through with real keys, `save.time` at every chapter card. A
  chapter short of its minutes, or without its played stretch, goes back to the beat list.
- **The newcomer test, at every chapter start.** Turn the guide off (START → Opciones →
  Guía) and don't open START: play the first minute with real keys from the card. If
  what the game shows and says doesn't tell you where to go and what to do, the beat
  is wrong — fix the scene's last line, the objective text and the visual cue
  (`feel.md`), not the guide. Then turn the guide on and check it points right.
- **For long stories, an autoplayer.** A script that starts each chapter, presses A on
  every line, wins every minigame and runs the chapter's own triggers, spots and talks
  until it's marked done catches the scripts that crash or hang, across dozens of
  chapters, in the background. It proves the story *runs*, not that it *plays*: it
  teleports and calls `talk` and `run` directly, so it can't see a hidden spot, a door
  off the grid, a person A can't reach, a mute person or a missing hint — a game whose
  autoplayer passed had four blockers of exactly that kind. `tools/audit.mjs` checks
  those from the player's real position; neither replaces the other. After it passes, play the start of every chapter by hand with real keys
  (from its card to its first objective) against `feel.md`.
- **Dev mode.** `?dev=1` draws the grid, blocking cells, spots, triggers, warps, routes
  and ids over the map (F2 toggles it) and F3 opens a jump menu: give the cartridge
  `dev: { jumps: [...] }` with one entry per chapter or set piece (set its flags, warp
  there) from the first day. It is the cheapest way to look at a spot's rect or to
  reach the middle of the story (README "Dev mode").
- **The engine's warnings.** The world prints `[luma] <game> · <map>: …` in the console
  for what plays wrong without throwing: someone appearing or vanishing in view, a spot
  under the player's feet or one cell beyond the thing they bump into, a person who
  doesn't answer A, someone who is on a map only because a script spawned them and won't
  be there next visit (passers-by are spawned with `transient: true`), a missing text
  key, a scene pushed under a black fade, two people answering each other from across
  the place, an objective without a place or out of reach (README "Warnings"). `tools/shot.mjs`
  prints them. **A finished cartridge prints none over a full play-through**; every one
  is fixed in the cartridge, not silenced.
- **A fresh pair of eyes before calling it done.** The author can't see their own game.
  The **reviewer** does it, a member of the team with its own conversation and the
  instructions of `.claude/agents/luma-reviewer.md`: ask it by mail
  (`mail/reviewer.author.md`) with the scope (whole game, some chapters, the ★ set
  pieces), and the house starts it and tells you when it delivers. Never as a sub-agent:
  no agent launches sub-agents, and the house stops a turn that does. It plays
  with real keys, scores nine axes 1–5 (next step, life, persistence, direction,
  writing, look, sound, the verb, and fidelity for adaptations), and writes
  `reports/review-<date>.md` with every defect by map and cell. It never edits the
  game. Fix what it finds and check each fixed point (that point only: the author never
  plays the game through nor reviews it). Ask it again, by mail, only while a review has
  a blocker or a major defect, and three rounds at most; minors are fixed or listed under
  "Left" in the author's report.
- Don't run tests while helpers are still editing files: half-written modules fail and
  look like story bugs.
- **Test proportionately.** While building, screenshot the new thing only: a map once
  per season/light, a scene's start and end, a cutscene's key frame. The full
  play-through at the end is the reviewer's. Screenshots are the most expensive part of building a game:
  don't re-shoot what hasn't changed, and drive long stretches with `eval` (flags,
  warps) rather than by walking.

