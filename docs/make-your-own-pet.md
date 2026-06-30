# Make your own pet

Relay's status pet is a little companion in the corner of the workspace that
reacts to what the agent is doing — **idle**, **working**, **needs input**,
**done**, **error**. It's just a **sprite sheet** (one PNG image holding a grid of
frames), so you can generate your own with an AI pixel-art tool and drop it in.

## 1. Generate a sprite sheet

Any tool that exports a PNG sprite sheet works. Good ones (they handle keeping the
character consistent across frames, which is the hard part):

- **[PixelLab](https://www.pixellab.ai/)** — prompt or skeleton-based animations; runs in the browser or as an Aseprite plugin.
- **[Musely](https://musely.ai/tools/pixel-art-character-generator)** — quick idle + walk cycles, transparent PNG output.
- **[SpriteGen](https://spritegen.ai/)**, **[Ludo](https://ludo.ai/features/sprite-generator)** — describe a character + action, get a sheet.

Aim for:

- A **transparent background** (so the pet floats over the UI).
- **Equal-size frames** laid out in a clean grid (e.g. 48×48 or 64×64).
- A few frames for each mood. The easiest layout is **one mood per row**:

  | Row | Mood         | Suggested frames |
  | --- | ------------ | ---------------- |
  | 1   | `idle`       | gentle bob / blink |
  | 2   | `working`    | busy loop (the longest one) |
  | 3   | `needsInput` | looking up / a "!" |
  | 4   | `done`       | happy hop |
  | 5   | `error`      | shake / dizzy |

You don't need all five — only `idle` is required; the rest fall back to it.

## 2. Import it into Relay

1. Open **Settings → Appearance** and make sure **Status pet** is on.
2. Click **Import a pet** → **Choose a sprite sheet (PNG)**.
3. Set the **frame width/height** to your frame size. The preview updates live —
   tweak until exactly **one clean frame** shows. The grid (columns × rows) and
   total frame count are computed for you.
4. Set **FPS** (8 is a good default).
5. Map each mood to a **frame range** (first → last frame, counting left-to-right,
   top-to-bottom starting at 0). The **Auto-map rows** button fills this in for the
   one-mood-per-row layout above — then fine-tune if needed.
6. Use the mood buttons under the preview to check each animation, then **Save pet**.

Your pet is saved on your machine (under Relay's user-data folder) and appears in
the picker. Select it to make it your companion; built-in pets can't be removed,
but your own can.

## How frames are numbered

Frames are indexed **row-major**: `index = row × columns + column`, starting at 0.
For a 6-column sheet, row 0 is frames `0–5`, row 1 is `6–11`, and so on. A mood's
range is inclusive — `[6, 11]` plays frames 6 through 11 on a loop.

## The manifest (advanced)

Under the hood each pet is a folder with `sheet.png` + `manifest.json`:

```json
{
  "name": "Sprocket",
  "frameWidth": 48,
  "frameHeight": 48,
  "columns": 6,
  "fps": 8,
  "states": {
    "idle": [0, 5],
    "working": [6, 11],
    "needsInput": [12, 17],
    "done": [18, 23],
    "error": [24, 29]
  }
}
```

The built-in **Sprocket** pet is generated from `scripts/generate-builtin-pet.mjs`
(pure Node, no dependencies) — a handy reference if you'd rather make a sheet in
code than with an AI tool.
