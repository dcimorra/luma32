# The team: who does what, splitting the work, rounds, feedback

Read when you are the author of a cartridge (in a commission or on your own). Helpers
don't need this file: their contract says what they own and deliver.

## Who plays and who audits

One rule, everywhere in this skill:

- **The audit** (`tools/audit.mjs`, `testing.md`) is the **auditor**'s. **The full
  play-through** — from "Nueva partida" to the end, with real keys, timing every chapter
  (`length.md`) — and the fidelity review are the **reviewer**'s. The author can't see
  their own game.
- **The author** builds, fixes, and checks **each fixed point** — that point only, with a
  screenshot of it. The author never plays the game through and never judges it.
- **Helpers** test their own piece lightly (`testing.md`, "Test proportionately") and say
  what they could not verify.

## In a commission, and on your own

**In a commission** the house starts every member of the team, each with its own
conversation, and they speak by mail (`public/games/<id>/mail/<to>.<from>.md`). **No agent
launches sub-agents** (the Task or Agent tool): the house stops a turn that does. The
analyst, the auditor and the reviewer are asked by mail (`mail/analyst.author.md`,
`mail/auditor.author.md`, `mail/reviewer.author.md`); the house starts them with the note
as their brief and tells the author when they deliver. The plan a person approves is
`BIBLE.md` and `CONTRACT.md` (`SKILL.md`, steps 1–2); to improve a game, `IMPROVE.md`
(`improving.md`).

**On your own** (a Claude Code session, no house, no mail) the roles stay the same and so
do the rules of one round: the author starts the analyst, the auditor and the reviewer as
sub-agents (the Agent tool, agent types `luma-analyst`, `luma-auditor`, `luma-reviewer`;
the cover with `luma-cover-artist`), with the brief a mail would carry as the prompt:
the cartridge, the commit and the scope. If sub-agents aren't available, the author runs
the audit, then plays the whole game as the reviewer would (`.claude/agents/luma-reviewer.md`
is the method), in a separate pass after building, and says so in the report.

## Splitting the work, and spending

A game is big; spending is the constraint. The story is written by **one** author —
you, or a single agent — start to end, so it reads as one story with one voice and one
thread. Only work that stands alone and has a written contract goes to a helper:

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

**`CONTRACT.md`** is what the helpers work from: the plan of `SKILL.md` step 2 and the
shared direction (the palette, the music's map of moods) at the top, then one section per
helper with exactly these headings: `## world`, `## cast`, `## music`, `## scenes`,
`## cover`, each `none` when the game doesn't need that helper.

Rules that keep it affordable:

1. **Write the contract before anyone starts**: file ownership (each helper owns its
   files outright and edits nothing else), ids and their prefixes, what it hands back.
   The helpers start in parallel once a person approves it; write the story while they
   work, or after.
2. **Give each helper only what it needs**: its part of the bible, not all of it; the
   skill's index plus the files of its piece (a map painter: `world.md`, `art.md`,
   `life.md`) and the README sections it uses, not the whole repo. Every helper re-reads
   everything it is pointed at.
3. **Use the cheaper model for mechanical work** (painting maps, cast specs, sound) and
   the strongest one for the story and anything that needs judgement.
4. **Few helpers.** Three or four parallel helpers is plenty; more multiplies the reading
   and the testing, not the quality.
5. **Work that can be cut keeps itself safe**: write files early (a skeleton that runs,
   then fill it in), so an interrupted helper can be resumed from disk.
6. Engine needs reported by helpers are fixed once, by the author, in the engine.
7. Don't test while helpers are still editing files: half-written modules fail and look
   like story bugs.
8. **The author looks at every map a helper hands back** (one screenshot each, `&hd=1`)
   before wiring the story to it. "Every point is reachable" is not "it looks like a GBA
   town": empty fields of noisy ground, props in water and generic trees where a
   landmark should be come back from helpers as "done". Send it back with what's wrong.
   The first map back is the key art of a commission: if its look is off, the rest is.
9. **Contracts name the story's needs, not just the ids**: for each point the story uses,
   say what the player must see there ("a giant pine, the tallest in the forest", "the
   heart tree with its red-eyed face"), so the map draws a landmark, not a coordinate.

## Asking the auditor and the reviewer: one round each

Each answers with one report. **A round closes with everything in it**: a report that
covers the whole scope, with nothing deferred, no questions back and no "ask me again for
the rest". Rounds became loops when an author mailed the auditor "can you check whether
the well answers now?" and the reviewer "which of the two endings reads better?"; each
wrote back a question, the author answered, and five mails later nothing had been fixed.
So:

- **The note names the cartridge, the commit and the scope, and nothing to decide.** For
  the auditor: every jump, or a range after a fix. For the reviewer: round 1 the whole
  game; a later round the defects of the last review (by number) and the files changed
  since, with what was changed in a line each. Not "is this fixed?" about one point — the
  author checks a fixed point themselves — and never "what would you do here", "which of
  these two", "is the story good": the auditor has no opinion and the reviewer gives
  theirs in the scores, once.
- **What the author doesn't ask them to fix.** Neither edits the game. A report that says
  "the player never got control back" means the cartridge lacks a `dev.win` exit or a
  jump's `timeout`, not that the auditor should play the minigame; "no jump for chapter 4"
  means the author adds it, not that the reviewer should find the chapter another way.
  Anything the note asks that is not theirs, they answer in one line of the report and go
  on with the whole scope.
- **They never wait.** A browser that won't boot, a locale that won't parse, a jump that
  hangs, a chapter they can't get past: it goes in the report as a blocker with what they
  saw, they get past it with the next jump, and the report still covers the rest.
- **The author answers a report by fixing, not by writing back.** Every line of it is
  fixed or answered under "Left" in the author's own report (why it stays), and the next
  note to them, if any, lists what changed. A note that argues with a defect instead of
  fixing or listing it is the start of a loop.
- **Rounds.** The audit is asked after integrating and after each batch of fixes, over
  the jumps the fixes touch, until the tool finds nothing. The review is asked once for
  the whole game, and again only while a review has a blocker or a major defect, after
  they are fixed: a later round re-plays those points and the chapters their files feed,
  and carries the rest. Minors are fixed and checked by the author, with no new round.
  **The house sets how many rounds of each there are** and refuses one past the limit, so
  batch every fix before asking; on your own, stop after a second review the same way.
  What is left after the last round is fixed by the author or listed under "Left", by
  severity.

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
  Before adding it, search the skill for it: a rule that already exists is changed where
  it is, not written a second time elsewhere. The skill learns from every game, not only
  the one that got the note.
