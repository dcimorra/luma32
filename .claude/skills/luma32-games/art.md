# Art direction: the GBA standard, step by step

Read this before painting any tile, prop or character, and run its checks before calling
art done. It is written from what the best-selling GBA games did on the same 240×160
screen — Pokémon Ruby/Sapphire/Emerald and FireRed/LeafGreen, Zelda: The Minish Cap,
Golden Sun, Mother 3, Fire Emblem, Advance Wars, Mario & Luigi: Superstar Saga, Castlevania:
Aria of Sorrow, Harvest Moon: Friends of Mineral Town — and from the mistakes the
GBA era is remembered for. Every rule has a check; "looks fine to me" is not one.

## 1. The rules the hardware imposed (keep them: they are why it looks like a GBA)

- **15 colours per object.** A GBA tile or sprite used one 16-colour palette (one slot is
  transparent). A tile, a prop or a character with more than 15 colours is not GBA art,
  it's a downscaled illustration. `tools/sheet.mjs` counts them.
- **15-bit colour.** Pick colours with `snap()` in mind: no subtle 1-step gradients, no
  near-duplicates (two greens 4 units apart are one green and a mistake).
- **A world palette of ~32–48 colours** shared by everything in that place, written in
  `art/palette.js`. Each material is a **ramp** of 3–4 tones (`Lo`, base, `Hi`, sometimes
  `Hi2`), never a single colour with `shade()` applied at random.
- **Integer pixels.** Everything is drawn at 1×, on whole pixels, at one scale. Never
  scale a sprite up or down (mixels: two pixel sizes on one screen is the most visible
  amateur mark of the era — the GBA ports that stretched SNES art are the example).

## 2. Light, value and colour — decide once per world, write it in `palette.js`

1. **One light source, top-left.** Highlights on top and left edges, shadows on bottom and
   right, cast shadows fall down-right or straight down. Every tile, prop and character
   obeys the same light. Check it: a contact sheet where one rock is lit from the right
   is a bug.
2. **Hue-shift the ramps.** Shadows go cooler and more saturated (green → blue-green,
   skin → rose-brown, yellow → orange), highlights warmer and lighter (green → yellow-green).
   A ramp made only by mixing with black and white is the "muddy" look; it is the main
   difference between Golden Sun's forests and a flat game's.
3. **Value separates layers, not hue.** The three layers of every GBA overworld:
   - **Ground**: low contrast, medium value, desaturated. It is a backdrop: in Pokémon
     the grass tile uses 3–4 close greens. The ground must never be the busiest thing.
   - **Props and walls**: medium contrast, their own outline (dark tone of their own ramp).
   - **Characters and what you press A on**: the highest contrast and the darkest
     outline on screen, a saturated signature colour. A character must read against
     every ground of the game.
   Check: convert a screenshot to greyscale (or squint). Characters, doors and spots must
   still pop out; if the grass is as contrasted as the player, the ground is too loud.
4. **The original GBA screen had no backlight.** Its games were painted bright and
   high-contrast; the ones that weren't (Castlevania: Circle of the Moon) are remembered
   as unplayably dark. Night and caves are done with `grade` over a bright palette, and
   the player and the exits stay readable. No scene's average value below ~30%.
5. **Saturation is a budget.** The world is mid-saturated; the few fully saturated
   colours mark what matters (the player's cap, a door, a flower patch that is a spot,
   the item). Write in `palette.js` which colours those are.

## 3. Outlines (selective outlining, "selout")

- **Characters**: a dark outline around the silhouette, the darkest colour on screen but
  **tinted** (navy, deep brown, plum), never `#000`/`#141614`. Inner lines (arm against
  torso, hair against face) are the **shadow tone of the material**, not the outline
  colour: a sleeve against a jacket is separated by the jacket's `Lo`.
- **Props**: outline = the darkest tone of the prop's own ramp (a tree's outline is a
  very dark green, a rock's a dark slate). On the lit side (top-left) the outline may
  lighten or break; on the shadow side it stays dark.
- **Ground tiles: no outlines.** A grass, path or sand tile with a dark border is the grid
  you see in the reported screenshots. Transitions (grass → path, shore) are drawn with
  an irregular edge in a middle tone, not a line.

## 4. Ground tiles — no grid, no wallpaper

What Pokémon and Minish Cap do and the defects that betray a tiled ground:

1. **Every edge wraps.** Column 15 must continue into column 0 and row 15 into row 0.
   No border row or column lighter or darker than the rest (the sheet flags it: "edge
   stands out"). That is legitimate on a shore, a wall or a ledge; on plain grass, path,
   sand, floor or tall grass it is a bug.
2. **Details never on the same spot in every copy.** A tuft at (4,6) in every tile is a
   lattice of tufts. Keep the base tile almost plain (3 tones, sparse, low-contrast
   texture) and put detail in **variants** (2–4 per ground) spread with a position hash,
   plus a few **hand-placed detail tiles** (flowers, a stone, a crack) near paths,
   doors and landmarks — where a person would actually wear or plant the ground.
3. **No straight lines along the tile.** A row of blades all ending at y=15, a hline
   across the bottom: repeated, they draw ruled paper. Vary heights and stagger.
4. **Tall grass/undergrowth** (`top` layers): the top covers only the lower half of the
   cell (legs), its upper edge is a jagged silhouette of blades of different heights,
   never a flat band; blades sway in 2 frames.
5. **Noise is not texture.** `p.noise()` over a whole tile at high density gives TV
   static. Use it at ≤ 0.08 with the two tones adjacent to the base; draw shapes
   (tufts, pebbles, plank seams) for anything that should read.
6. **Edges between grounds are autotiles.** Water against land, path against grass,
   carpet against floor: give the tile `auto: true` (or a group name shared by its
   variants) and paint its border from the neighbour mask (`draw(p, frame, mask)`,
   `p.edge(mask, { color, width })` for a rim, or your own shapes per side and corner,
   `EDGE` bits in `engine/gfx.js`). A shore with straight square corners drawn by
   hand, or none, is the clearest sign of an amateur map.
7. **Check**: the contact sheet shows every ground tile 3×3. Then a screenshot of the
   biggest open field of the game: if you can count the tiles, redo the tile.

## 5. Props and the world

- **Trees are the frame of a GBA map.** Pokémon's forests are rows of round canopies that
  overlap (each row hides the trunks of the row behind, staggered by half a tree), with
  an outlined lower edge and trunks only on the front row. A canopy has 3–4 leaf tones
  in clusters (not a smooth ellipse with noise), light top-left, a dark core lower right.
- **A drop shadow under every standing thing**: an ellipse in the ground's shadow tone
  (not translucent black) offset down-right, 1–2 px tall. Without it, props float.
- **Buildings**: roof with a lit ridge and a dark eave line casting a 1–2 px shadow on the
  facade; windows with a reflection pixel; the door darker than everything around it so
  it reads as an opening; a doormat or step in front.
- **Height reads from the 3/4 view**: tops (lit, seen from above) over faces (darker,
  seen from the front). Every wall, cliff, ledge, counter and table has both.
- **Landmarks are unique art.** What the story points to (`feel.md`):
  bigger, different silhouette, a colour that appears nowhere else on that map.
- **Animate the world lightly**: water (2–4 frames, slow, the highlights move, not the
  whole tile), flowers and tall grass (2 frames), a chimney's smoke, a sign never.
  GBA games cycled palettes for this; a rate of 20–40 frames per step, never faster.

## 6. Characters

The bar is Pokémon FireRed/Emerald and Minish Cap: 16×24/16×32 chibis, head ~half the
height, readable at 1× from across the screen.

1. **Silhouette first.** Fill each character black (`tools/sheet.mjs` prints the
   silhouette next to the frames). The named characters of a game must be told apart by
   silhouette alone: hairstyle, hat, coat, dress, height. If two named characters have
   the same black shape, change one — hairStyle, `hat`, `coat`, `dress`, `beard`, `ears`, `mask`, `earShape`,
   `build`, `horns`, `wings`, `hold`, `crown`, `pack`.
   Background people may share silhouettes; the protagonist, the rival and the mentor
   never.
2. **A signature colour per main character**, saturated, on a large area (cap, jacket,
   hair), not shared with anyone else on screen; the rest of their outfit muted.
3. **Clothes are ramps too**: every doll colour (`top`, `bottom`, `hair`, `hatColor`) is
   chosen from the world palette's mid-tone so the engine's shade is the ramp's `Lo`.
   Avoid pure black clothing (it eats the outline and the shading: use a navy or a dark
   brown) and pure white (use a warm off-white; the highlight is the only white).
4. **Skin** in two tones with a warm shadow; eyes 2 px tall, dark, never pure black when
   the outline isn't.
5. **Contrast against the ground**: a character in green on grass, or beige on sand,
   disappears. Check each main character on each main ground in one screenshot.
6. **Outline**: pass `outline` to the doll spec with a tinted dark of the world
   (`ink`), so characters share the world's dark instead of the engine's default.
   The engine already does the rest of § 3 and § 2 for dolls: selective inner lines in
   each material's own dark, a warm lit edge top-left on hair, hats, tops and coats,
   hue-shifted shadows, and a one-pixel bob on step frames. Don't fight it with
   colours that are already very dark or very light: pick mid-tones.
7. **Height is silhouette too**: `height: 'short'` for children and small people (two
   pixels shorter, same head), `'tall'` for the tall ones (16×26), `build: 'stout'` for
   the broad. Combine it with hairStyle, `hat`, `coat`, `dress` to
   give every named character a shape of its own.
8. **Use the engine's options before inventing a stand-in** (all in the header of
   `engine/doll.js`): period dress is `dress: 'long' | 'wide'`, `hairStyle: 'updo' | 'wig'
   | 'ringlets' | 'crown'`, `hat: 'bonnet' 'bicorne' 'mobcap' 'turban' 'plume' 'toque'
   'shades' 'hood'`; royalty `crown: '#colour'`; fae and demons `horns`, `earShape`,
   `wings` (`wingsOpen`, and the `fly` pose spreads them); a prop in the hand is `hold`
   (`cane book fan phone briefcase tray umbrella glass gavel folder flag`); `belly: true`
   for a pregnancy; a horse is `creature: 'horse'`. A `beanie` for a plume, a `top` hat
   for a crown, a dog for a horse are what this list replaces. Each layer adds colours:
   watch the count `sheet.mjs` prints.

## 7. Errors the GBA era is remembered for — don't repeat them

| Mistake | How it shows | Rule |
| --- | --- | --- |
| Too dark (no backlight) | Circle of the Moon, early ports | §2.4, test on a phone outdoors-bright |
| Mixels / scaled art | Stretched SNES ports, sprite zooms | §1 integer pixels, one scale |
| Pillow shading | Shade follows the outline inward, object looks puffy | Shade from the light, not from the edge |
| Banding | Ramp tones in parallel stair-steps that echo the outline | Vary run lengths, merge the bands |
| Jaggies | Lines with uneven steps (1-2-1-3) | Steps in regular ratios 1:1, 1:2, 1:3 |
| Orphan pixels / noise | A lone pixel of a third colour, "dirty" sprites | Every pixel belongs to a shape |
| Tile grid / wallpaper | Visible squares or repeated motif across a field | §4 |
| Busy ground | Characters lost on textured floors | §2.3 |
| Same silhouette cast | Everyone the same doll with other colours | §6.1 |
| Inconsistent light | One prop lit from the other side | §2.1 |
| Pure black outlines everywhere | Flat, "colouring book" look | §3 |

## 8. The art pass, in order (reproducible)

1. **Palette** in `art/palette.js`: ramps of 3–4 hue-shifted tones per material, the
   tinted `ink`, the saturated budget and why, written at the top.
2. **Ground**: base tiles (plain), variants, detail tiles. Contact sheet: no flagged
   plain-ground edge, no visible lattice at 3×3, ≤ 15 colours each.
3. **Props**: lit top-left, own-ramp outline, drop shadow, ≤ 15 colours.
4. **Cast**: specs with `outline`, signature colours, silhouettes all different for named
   characters.
5. **One screenshot per map** with the main characters standing on it: greyscale/squint
   test (§2.3), the biggest field (§4.6), the landmark of each beat.
6. **Fix and re-run the sheet**, then only re-shoot what changed.

```bash
node tools/sheet.mjs http://127.0.0.1:8765 <id> /tmp/<id>-sheet.png   # prints the report
```

The report lists every tile, prop and doll with its colour count, flags "over 15" and
ground tiles whose edges stand out. Open the PNG and look at it — the report catches
counts and seams, not taste.
