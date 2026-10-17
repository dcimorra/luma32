# Improving or repairing a cartridge that exists

Read when the cartridge is already built and people play it: a commission to improve it
(the plan is `IMPROVE.md`), a repair of something a player reported, or a round of
feedback. Everything else in the skill still holds; this file is what changes when the
game is not new.

## First, how it stands today

- **Read before changing**: the cartridge's `README.md`, `BIBLE.md`, its old
  `CONTRACT.md` (how it was built, not the plan now), `reports/` (and `reports/archive/`
  for earlier work), `reports/feedback.md`, and `git log` in the cartridge.
- **Measure it, don't remember it**: the audit and a fresh-eyes review of the whole game
  as it is today (`team.md`), and `tools/length.mjs`. What falls short of the skill and of
  the commission, with map and cell, is the list the plan is made from.
- **An adaptation without `SOURCE.md`** gets one first (the analyst, `adapting.md`); then
  the subplots and remembered moments missing without a written cut are part of what is
  wrong today.

## The plan: `IMPROVE.md`

What is wrong today at the top, with where; then one section per helper that has work
(`## world`, `## cast`, `## music`, `## scenes`, `## cover`, or `none`), as a contract
(`team.md`, "Splitting the work"). Each section says what changes and what stays: keep
what works. A person approves it before anything is changed.

**A new story on a world that exists** (the next volume of a saga built as one open
world, `genres.md`, "Open world") is an improvement: `IMPROVE.md` adds the story with its
own progress counter, the places it opens (built as shells before, or new), its people and
their schedules, and says what of the world the earlier stories keep.

## Saves keep loading

Players have saves in the middle of the story. A change that breaks them loses their game.

- **Never renumber the progress flag** or rename a flag a save may hold. A new beat goes
  in a gap between two stages (`SKILL.md`, "A thread"); that's what the gaps are for.
- **A beat that moves or a map that is redrawn** must still rebuild from the old flags:
  `enter` and `when` read what a save from before the change has. If the state really
  changed shape, migrate it once in `enter` (or `newGame`'s continue path) from the old
  flags to the new ones, guarded by a flag of its own.
- **Ids stay**: maps, actors, warps and spots a save or a flag refers to keep their ids.
  A map's cells can change, but a save holds a position: a cell that was floor and is now
  a wall or a prop strands whoever saved there, so keep the cells where a player can
  stand and save (arrivals, the cells by doors) free, or move them in `enter`.
- **Test with an old save**: a dev jump that sets the flags as the old version left them,
  in the middle of each chapter the change touches, then play on from it.

## A repair

A repair is one defect a player found: reproduce it (a dev jump, a screenshot), fix the
cause, look for the same kind across the game (`team.md`, "Feedback"), check the fixed
point and the audit over the jumps it touches. Read only what the defect needs; not the
whole skill, not the bible.
