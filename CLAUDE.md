# CLAUDE.md

LUMA 32: a browser console (`public/engine/`) and the tools to make games for it. No build
step, no dependencies. README.md is the engine's reference; read the section you need.

- **Making or changing a game**: use the `luma32-games` skill (`.claude/skills/luma32-games/`)
  and its agents (`.claude/agents/`). Games live in `public/games/<id>/`, each its own
  repository; `tools/add-game.mjs` adds one from GitHub, a zip or a folder.
- **Running it**: `node server/serve.mjs` (http://localhost:8765/). Testing in a real
  browser: the skill's `testing.md`.
- **The engine knows no game**: nothing specific to one cartridge goes into `engine/`.
- Code, comments and identifiers in English; anything a player reads goes in a catalogue
  (`public/locales/es.json`, a cartridge's `locales/`), never in code.
