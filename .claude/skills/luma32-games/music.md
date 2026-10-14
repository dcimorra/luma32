# Music: original, memorable, GBA-grade

Read this before writing any song. The bar is the GBA soundtracks people still hum —
Pokémon Ruby/Sapphire/Emerald and FireRed/LeafGreen (Go Ichinose, Junichi Masuda),
The Minish Cap, Golden Sun (Motoi Sakuraba), Mother 3 (Shogo Sakai), Final Fantasy
Tactics Advance (Hitoshi Sakimoto), Castlevania: Aria of Sorrow (Michiru Yamane),
Advance Wars, Mario & Luigi: Superstar Saga (Yoko Shimomura). They had four PSG voices
and a few sample channels; the engine here has the same palette (pulses, triangle, noise
drums, a few soft voices). What made them good was writing, not hardware.

## Why songs come out generic (don't do this)

These are what a generated soundtrack sounds like; each is a reject:

- **Melody = arpeggiated chords.** A lead that walks the chord tones on the beat
  (D F# A F# D A…) is an accompaniment, not a tune. Nobody hums an arpeggio.
- **The same progression everywhere**: I–V–vi–IV, I–vi–IV–V, in major, 8 bars, A then B.
- **One accompaniment kit for every song**: the same bass figures, the same arp shapes,
  the same drum loop changing only the tempo. Songs built by one helper that fills
  bass/arp/pad/drums from a chord list all sound like one song. A shared helper may
  convert notation; **it must not decide the accompaniment**.
- **Quarter and half notes only, every phrase starting on beat 1**, no rests: the
  rhythm has no identity.
- **Drums from bar 1 to the end** in every song, including the calm ones.
- **Every place in a major key at 100–140 bpm**: the town, the route and the lab feel
  the same.

## The method (one song)

1. **Brief in one line** written as a comment above the song: place/moment, what the
   player should feel, and a **musical idea that belongs to this game only** (an
   instrument, a rhythm, a scale, a gesture). "Lake: still, a little eerie — Lydian over
   a pedal, a bell motif that rises a tritone and never resolves." If the line could
   describe a song from any game, rewrite it.
2. **Character before notes** — choose deliberately, and differently per song:
   - *Mode*: major, natural minor, Dorian (hopeful-melancholic: routes, journeys),
     Lydian (wonder, magic, legendary places), Mixolydian (folk, heroic, rustic towns),
     Phrygian (menace, deserts, villains), harmonic minor (drama, a boss).
   - *Metre*: 4/4 is not the default: 3/4 or 6/8 for towns, homes and lullabies
     (3/4: bars of 12 steps with `steps: 4`; 6/8: `steps: 3`), a 7 or a 5 for something strange.
   - *Tempo* from the place's pace: interiors 70–95, towns 90–115, routes 120–150,
     battles 150–180.
3. **The motif (the hook), 1–2 bars.** Write it first, alone, before any chord. It needs:
   - a **distinctive rhythm** (a dotted figure, a syncopation, a pickup, a held note
     after quick ones) — clap it: it should be recognisable without pitches;
   - a **contour with one leap** (a 4th, 5th, 6th or octave) and then stepwise motion
     back, mostly **steps** otherwise;
   - **non-chord tones**: passing notes, suspensions (the 4th resolving to the 3rd),
     appoggiaturas on strong beats. That is what makes a tune sound written.
   - Test: sing it after one listen. If it's forgettable, write another — this is the
     step to spend effort on.
4. **The phrase: question and answer.** 4 bars ending open (on the 2nd or 5th degree,
   half cadence), 4 bars ending closed (tonic). The answer **reuses the motif's rhythm**
   with different pitches — repetition with variation is what makes music memorable.
   Sequence the motif (repeat it a step higher), invert it, augment it.
5. **Harmony under the melody**, chosen for the melody, not before it. Use what the GBA
   composers used to sound like themselves:
   - borrowed chords (iv and ♭VI in major: the "nostalgic" Pokémon town colour; ♭VII
     for an adventurous lift);
   - secondary dominants (V/V, V/vi) to push into the next phrase;
   - pedal points (bass holds while chords change above) for calm and for tension;
   - a **modulation for the B section** (up a whole step, or to the relative key) or a
     chromatic mediant (C → E, C → A♭) for wonder;
   - harmonic rhythm that changes: two chords per bar where it builds, one per two bars
     where it rests.
6. **Song form**: intro (1–2 bars, a fragment of the motif) → A (8) → A′ (8, varied
   ending) → B (8, contrast: other register, other rhythm, other key or mode) → back to
   A via a turnaround bar. `loop` points to A, not to the intro. Long-play places
   (routes, towns) 45–90 s before repeating; jingles 2–6 s, `once: true`.
7. **Arrangement: each voice has its own job and its own rhythm.**
   - *Lead*: `pulse25` or `pulse12` for a bright lead, `pulse50` for a hollow, clarinet-
     like one, `tri` or `sine` for flute; vibrato on long notes; `gate` < 0.8 for
     staccato, 1 for legato.
   - *Counter-melody* (the GBA signature, Minish Cap and Golden Sun do it everywhere): a
     second line that moves when the lead holds and holds when the lead moves, often a
     3rd or 6th below or in contrary motion. Not the lead transposed an octave.
   - *Fake echo*: the lead duplicated on another channel, 1–3 steps later, `vol` 0.3–0.4,
     and/or `echo` on the channel. This is how GBA tracks got their space.
   - *Bass*: a line, not roots on the beat: passing tones between chord roots, the 5th
     below, octave jumps on the off-beat; syncopated in fast songs, long notes in slow
     ones.
   - *Harmony fill*: fast arpeggios (`steps: 4`, 16ths) are a GBA trademark, but in
     **one** song per mood (battles, chases), not as the default bed. Elsewhere: held
     `pad`, broken chords in a rhythm of their own, or nothing.
   - *Drums*: a pattern written for this song, with a fill on the last bar of each
     phrase. Calm places get no drums, or a shaker (`h`) and a soft kick. The B section
     may drop them; their return is an event.
   - *Accents*: `!` after a note or drum (`C5!`, `k!`) is +3.5 dB, `?` is −5 dB (ghost
     notes, an echo voice). For the hook's strong beat and a hi-hat's lilt, not every note.
   - *Breath and wind*: `inst: 'noise'` plays a band of noise at the note's pitch (`q`,
     higher is more whistled; `lp` to darken) — a draught, a hiss under a slow song.
   - Customise instruments per channel (`wave`, `lp`, `attack`, `decay`, `detune`,
     `vibrato`) so each song has its own timbre.
   - **Real instruments** (README "Real instruments") are the default: every song is
     heard on an orchestra. Pick the instruments that are the game's world (a harp and
     strings for a fae court, a harpsichord and violin for a ballroom, a koto for a
     shrine, an electric piano and synth strings for a city at night) in
     `orchestra: { ... }`, and per voice with `real`: the default mapping fits no world
     in particular. Write the parts for the instrument
     heard: a flute breathes (phrases with rests), strings hold, a piano and a harp ring
     and fade (no long held notes on them), a pizzicato or a marimba are short. A game
     that wants the console's chiptune says `orchestra: false`; it is a choice of the
     world, like the palette, and is said in the mood map.
8. **Dynamics without volume automation**: thin the texture (drop the counter-melody,
   the drums) for the second A or the B, add a voice for the climax. A loop that never
   changes density becomes wallpaper in 30 seconds.

## The soundtrack (the whole game)

- **One main theme** (the title) whose motif returns transformed: slow on piano/bell for a
  sad moment, in minor for the villain's place, fast for the final battle, as a fanfare
  for the ending. FireRed's route themes and Mother 3's motifs are built this way.
  Leitmotifs: the rival's theme returns every time the rival appears, varied.
- **A motif for every main character and every main place**, listed with the mood map
  (below): four to eight notes that are theirs. It returns, transformed, at their key
  moments — slow and in minor when they fall, as a fanfare when they win, as a
  fragment in another song's counter-melody when they're mentioned or remembered. The
  player should feel who matters before anyone says so.
- **Layers for tension, not new songs**: a place's song can carry a `layer` channel
  (drums, a low pulse, strings) that a scene switches on with `api.musicLayer` when a
  chase starts or a threat appears, and off when it passes; `unless: 'name'` switches one
  off (a night version without drums; a lead swapped at a cut-in: `lead: { unless:
  'cutin' }`, `lead2: { layer: 'cutin' }`). Switching song for every change of mood breaks
  the place's identity. A map's `music` may be a function of the api (the town at war).
- **Jingles over the song**: `api.music('j_item', { over: true })` plays it over the
  place's music, ducked, and the music comes back by itself. To replace the music and
  come back after: `await api.music('victory'); api.music(place)` — no timers.
- **Tempo changes**: a pattern can carry its own `bpm` (a ritardando into the last
  phrase, a dance that speeds up); no faking it with longer steps.
- **Effects that build their own nodes** connect them to `dest` (the second argument
  also has `tone`, `burst`, `ctx`, `now`), so mute and the room apply; `burst` plays any
  length.
- **A map of moods before writing**: list every song with its mode, tempo, metre and
  lead instrument in a table at the top of `music.js`. No two neighbouring places (a
  town and its route, a route and its cave) share key, mode **and** tempo.
- **Jingles** (item, healed, level up, save, victory): 1–4 bars, built from the main
  motif where possible, ending on a held tonic.
- **Silence and ambience** are part of the score: a dramatic scene may start with only
  the ambience; a song may enter on the beat that matters.

## Originality and adaptations

- Never reproduce a melody, bassline or riff from an existing work — including the
  games named above, and the songs of the work being adapted. Their *techniques* are the
  model, never their notes. If a beat calls for a known song, name it in dialogue and
  compose something new in its spirit.
- Self-check against plagiarism: if the first two bars of the hook could be mistaken for a
  famous theme (the Pokémon centre, Zelda's overworld, a pop chorus), change the rhythm
  and the first interval.

## Checklist before a song is done

- [ ] Brief line with the game-specific idea, mode, tempo, metre.
- [ ] Motif sung back after one listen; it has a rhythm of its own and non-chord tones.
- [ ] Question/answer phrases; the answer varies the motif.
- [ ] At least one harmonic colour beyond diatonic triads (borrowed chord, secondary
      dominant, pedal, modulation).
- [ ] Counter-melody or fake echo; bass is a line.
- [ ] Texture changes between sections.
- [ ] Loop seam: play the last bar into the loop point twice — no jump in register,
      no double downbeat, no missing note.
- [ ] Not sharing key + mode + tempo with its neighbours on the map of moods.

## Listening test

Songs can't be screenshot. Render them: `node tools/render-song.mjs <game> <song>
/tmp/<song>.wav` (`--chiptune`, `--layers name`, `--sfx` for an effect, `--list`) writes a
WAV and prints the level of every second — a silent stretch, a song much louder than the
others, a loop seam. Then have whoever commissioned the game listen to the title, one town,
one route and the battle theme before the rest is written. Ask for that listen explicitly: a
soundtrack nobody heard is not done.
