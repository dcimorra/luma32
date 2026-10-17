# Testing (screenshots are the proof)

```bash
(cd tools && npm install)   # once: playwright-core, pinned in tools/package.json
cd public && setsid nohup python3 -m http.server 8765 --bind 127.0.0.1 >/tmp/luma-http.log 2>&1 </dev/null &
node tools/shot.mjs "http://127.0.0.1:8765/?game=<id>" /tmp/out script.json
```

- **Test in the modern look: add `&hd=1` to every URL** (README "The modern look"). The
  house's games are played and judged in 3D; classic is assumed to follow. To look over
  every map of a cartridge at once: `node tools/sweep-hd.mjs http://127.0.0.1:8765 <id>`
  (contact sheets and a census of what each map uses, in `/tmp/luma-sweep`). To look at
  every dev jump from above, from the eyes and from behind, with the errors and warnings
  under each picture: `node tools/bench.mjs http://127.0.0.1:8765 <id>` (`/tmp/luma-bench`;
  after a change to the engine, run it on the lab, `tools/lab`, whose jumps are its bench).
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
  would be lost too — look there by hand. It crosses maps by warps (only those whose
  `when` is open) and `connections` (walking off the shared edge). Writing and debugging a harness of your own is
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
  stretch of the story fast; `dev.jumps` (below) is how a cartridge offers those points.
- `VP=390x844 TOUCH=1 DPR=2` emulates an upright phone; `VP=844x390` one on its side.
- Console errors print to stdout. `node --check` every JS file; validate locale JSON.
- **Art without playing**: `node tools/sheet.mjs http://127.0.0.1:8765 <id> /tmp/<id>-sheet.png`
  draws every ground tile 3×3, every prop and every doll (12 frames + silhouette) on one
  PNG and prints colour counts and ground edges that stand out (`art.md` § 8). One
  sheet replaces dozens of map screenshots while painting. On a big cartridge: `--only
  dolls` (or `tiles`, `props`) and `--match <id part>`; a tall sheet comes in pages
  (`-2.png`…); if it hangs it says what it was drawing.
- `tools/shot.mjs` loads `playwright-core` from `tools/node_modules` and the Chromium
  that version expects from `~/.cache/ms-playwright` (missing: `npx playwright-core
  install chromium` in `tools/`); override with `PLAYWRIGHT=` / `CHROME=`. In a Claude
  Code cloud container the Chromium is preinstalled under `/opt/pw-browsers` and may be
  another version than the pinned one: `CHROME=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux*/chrome | head -1)`
  before any tool (never `playwright install` there).
- **The audit, at every jump: `node tools/audit.mjs "http://127.0.0.1:8765/?game=<id>"`.**
  It is the **auditor**'s (`.claude/agents/luma-auditor.md`), asked with the cartridge,
  the commit and the scope — nothing else — and answered with one report (`team.md`, "Who
  plays and who audits" and "Asking the auditor and the reviewer").
  It starts a new game, runs every dev jump (pressing A through its scenes), and after
  each one lists, from where the player really stands: an objective without a place or
  out of reach, a place where nothing answers, a spot no cell touches, a spot on open
  floor, someone inside a prop or a wall or on another person, a warp into a wall, a
  missing text, every `[luma]` warning and console error. `--follow [secs]` also plays
  each jump on into its next beat (with play.mjs): a `follow:` line is where to look by
  hand. A jump with a long set piece gets `timeout: <secs>` in `dev.jumps` (45 by
  default). It costs one browser for a
  few minutes; it is asked after integrating and after every batch of fixes. **A
  cartridge is not handed over with problems in it.** It needs `dev.jumps` that leave
  the game where a player would be (flags, objective with its place, map, cell): one per
  chapter start and per ★ set piece at least, and one for every objective a beat sets
  is better. The audit sets the flag `dev.win`, and every minigame must end at once as
  won when it reads it under `?dev=1` (`api.is('dev.win')`, the result a win gives the
  story): one flag for all, never one of each game's own (`done.md`). A minigame that
  doesn't shows as "never got control back", and is a defect. The minigames themselves are
  still played by hand, once each.
- **The length, measured** (`length.md`): `node tools/length.mjs <id>` for the minutes of
  reading; on the reviewer's play-through with real keys, `save.time` at every chapter card. A
  chapter short of its minutes, or without its played stretch, goes back to the beat list.
- **The newcomer test, at every chapter start.** Turn the guide off (START → Opciones →
  Guía) and don't open START: play the first minute with real keys from the card. If
  what the game shows and says doesn't tell you where to go and what to do, the beat
  is wrong — fix the scene's last line, the objective text and the visual cue
  (`feel.md`), not the guide. Then turn the guide on and check it points right.
- **Why play.mjs and the audit, not an autoplayer.** A script that teleports and calls
  `talk` and `run` directly proves the story *runs*, not that it *plays*: it can't see a
  hidden spot, a door off the grid, a person A can't reach, a mute person or a missing
  hint — a game whose autoplayer passed had four blockers of exactly that kind (the old
  one is archived in `tools/shelved/autopilot/`). `tools/play.mjs` plays with real keys
  and `tools/audit.mjs` checks from the player's real position; use those.
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
  the place, an objective without a place or out of reach (README "Warnings the engine prints"). `tools/shot.mjs`
  prints them. **A finished cartridge prints none over a full play-through**; every one
  is fixed in the cartridge, not silenced.
- **A fresh pair of eyes before calling it done.** The author can't see their own game.
  The **reviewer** (`.claude/agents/luma-reviewer.md`) is asked with the cartridge, the
  commit and the scope — never a question to answer, never one point to confirm — and
  how, how often and who starts it is `team.md` ("In a commission, and on your own",
  "Asking the auditor and the reviewer"). It plays with real keys, from above and from
  behind (`&fp=3` at every chapter start), scores nine axes 1–5 (next step, life,
  persistence, direction, writing, look, sound, the verb, and fidelity for adaptations),
  and writes `reports/review-<date>.md` with every defect by map and cell, in one round
  that covers the whole scope. It never edits the game. The author fixes what it finds
  and checks each fixed point, that point only.
- **Test proportionately.** While building, screenshot the new thing only: a map once
  per season/light, a scene's start and end, a cutscene's key frame. The full
  play-through at the end is the reviewer's. Screenshots are the most expensive part of building a game:
  don't re-shoot what hasn't changed, and drive long stretches with `eval` (flags,
  warps) rather than by walking.

