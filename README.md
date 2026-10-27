# Infinity Castle

A fan piece after Demon Slayer. Nakime's biwa sounds in the Ubuyashiki house and the floor opens. You fall
into Mugen-jō, Muzan's fortress, and you see it all through your own eyes. Below you is an endless shaft of
rooms, stairs, bridges and lanterns. At every note of the biwa, rooms slide, turn over and change places, and
shoji slam open and shut.

- `public/` is the static site: `index.html`, `main.js` (three.js 0.170 from jsDelivr, no build step) and `js/`.

## Run locally

```
python -m http.server 8795 --directory public
```

Open http://127.0.0.1:8795 and click **Fall**. The first visit takes a few seconds ("Building rooms", then
"Lighting the lamps"): the castle is built and lit in workers, then the shaders compile.

## Controls

| Input | Action |
|---|---|
| Mouse | Look around |
| Scroll, `↑` / `↓` | Fall slower or faster |
| `Space`, click | Strike the biwa: the castle refolds |
| `C` | Free camera on/off (cinematic shots otherwise) |
| `H`, `Esc` | Hide or show the HUD |
| Phone | Drag to look, tap to strike |

The biwa also sounds on its own every 7 to 12 seconds. Every other segment of the shaft has a room built
right across the fall: its roof hatch opens as you come down on it, time slows while you fall through it,
and the tatami in its floor slide apart under you.

## URL parameters

- `?auto`: skip the veil (no sound).
- `?y=-400`: start already falling, at that height (the Ubuyashiki room is at `y = 30`).
- `?still`: no falling and no cinematic shots; with `&pitch=-1.2&yaw=0.5` to aim the camera.
- `?hold`: stay in the Ubuyashiki room (the biwa does not sound).
- `?free`: start with the free camera.
- `?fixed`: turn off adaptive resolution. `?dpr=1` sets the starting pixel ratio, `?hq` allows up to 2.
- `?timescale=0.2`: slow motion, for watching a refold.

## How it works

- `js/kit.js`: the castle kit. Every piece (façades of veranda and room, pavilions, a corridor, stairs,
  bridges, lantern lines, a bare frame of posts and ties, pagodas, an open hall, the trap room and the
  Ubuyashiki room) is built from boxes, lathes and curved hip roofs in its own frame. Each piece is lit once
  in a bake: ambient occlusion from rays against the piece's own boxes, and light from its own lanterns,
  andon and shoji, shadowed by the large boxes. The result goes into the vertices. Far-away twins (`F1~`)
  have coarse grids and plain lamps. No three.js is used here, so `js/bake.worker.js` runs the bake on
  several cores.
- `js/shade.js`: one `MeshStandardMaterial` for the whole castle. A material id per vertex selects a
  procedural surface: oiled timber, polished boards, vermilion lacquer worn to black, shoji paper lit from
  behind with a kumiko lattice, tatami with cloth borders, round roof tiles, gilded tile ends, plaster, gold-leaf
  fusuma (clouds, seigaiha waves, ink pines or wisteria) with round pulls, paper lanterns, brass and black
  lacquer. The baked light and occlusion come in per vertex. The fog is the colour of the void: warm below,
  where the lamps are, and cold dark across and above. The file also holds the void, the reflection map, the
  far lamps and the dust.
- `js/castle.js`: the endless shaft, built 72 m at a time around a wandering line of fall. It has a wall of
  façades (some upside down, some on their side), pieces across the void kept clear of the fall, and far
  pieces in the haze. Every piece is an instance. Each frame, only the pieces in view are packed into their
  `InstancedMesh`, nearest first, and the far ones go into their lighter twin. The biwa slides and turns
  rooms with an overshooting ease and opens or shuts their shoji (door vertices slide in the vertex shader).
  Six real point lights follow the fall, borrowed from the nearest lanterns. The file also holds the debris
  (shoji, fusuma, tatami, planks and lanterns) tumbling alongside.
- `js/post.js`: bloom, a radial smear towards the point you fall towards, the shock ring and chromatic
  fringe of a biwa note, ACES, a split-tone grade, vignette and grain.
- `js/sound.js`: everything is made live with the Web Audio API. The biwa is plucked strings with a buzzing
  sawari bridge (Karplus–Strong with a one-sided clip in the loop), with a pitch drop on the attack and
  sometimes a bend. The file also has the wind of the fall, a low drone, shoji running in their grooves, and
  rooms grinding into place.

On a laptop with two GPUs, set the browser to "High performance" in Windows graphics settings. The castle
runs on integrated graphics too: adaptive resolution lowers the pixel ratio until it holds frame rate.

## Publish on Cloudflare Pages

The site is static: no build step, and the output is the `public/` folder. In **Workers & Pages** →
**Create** → **Pages** → **Connect to Git**, set the framework preset to **None**, leave the build command
empty, and set the build output directory to `public`. Or deploy from this folder without Git:
`npx wrangler pages deploy public --project-name infinity-castle`.
