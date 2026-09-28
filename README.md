# Paint Mixer

A small PWA that tells you how many drops of each paint you own to mix a target color.

- Pick the target from a photo (tap or drag), a hex code, or the system color picker.
- Keep a list of your paints. It starts with 16 DecoArt Americana colors. Edit, add, turn off, or calibrate each one.
- Get up to three recipes: the closest match, the one with the fewest drops, and one that uses different paints.
- Save recipes. Paints and recipes live in SQLite on the server, so every device sees the same list.

## How the mix is predicted

Each paint's color becomes a Kubelka-Munk absorption/scattering ratio for each linear-RGB channel.
Ratios mix linearly by weight. A drop's weight is its count times the paint's strength.
The solver tries every one-, two-, and three-paint recipe up to the drop limit and ranks them by
CIEDE2000 difference from the target. Recipes are always in lowest terms (2:1, not 4:2).
Use the ×2/×3/×5 buttons for a larger batch.

Strength matters a lot. A drop of lamp black changes a mix much more than a drop of a pastel
that has a lot of white in it. Chart colors do not tell you this, so calibrate your paints:

1. Paint a patch of your white.
2. For each paint, paint a patch of the pure paint.
3. Next to it, paint a patch of 1 drop of that paint mixed with 5 drops of white.
4. Let the patches dry, and take one photo in daylight.
5. On the Paints tab, tap **Calibrate from photo** and tap each patch when the app asks.

The app uses the white patch to remove the color cast of the light. Then it measures the color of
each paint and fits its strength from the mixed patch.

Each calibration is stored on the server: the photo, the position of every tap, and the sampled
colors. When the mixing model changes, tap **Recompute from saved photo** on the Paints tab to fit
the paints again from the stored taps. You do not need to paint or tap again.

## Run

Needs Node 24 or later. There are no dependencies.

```sh
npm start          # http://localhost:8080, data in ./data
npm test
docker run -p 8080:8080 -v paint-mixer:/data ghcr.io/bscholer/paint-mixer:latest
```

| Variable   | Default  | Use                        |
|------------|----------|----------------------------|
| `PORT`     | `8080`   | HTTP port                  |
| `DATA_DIR` | `./data` | Folder for the SQLite file |

The app has no login of its own. Put it behind an auth proxy (for example, Cloudflare Access).

## API

| Method | Path                | Body                                                   |
|--------|---------------------|--------------------------------------------------------|
| GET    | `/api/paints`       |                                                        |
| PUT    | `/api/paints`       | `[{id, name, hex, enabled}]` (replaces the whole list) |
| GET    | `/api/recipes`      |                                                        |
| POST   | `/api/recipes`      | `{name, targetHex, mixHex, deltaE, drops: [{name, hex, count}]}` |
| DELETE | `/api/recipes/:id`  |                                                        |
| GET    | `/api/calibrations` | (newest first, without photos)                         |
| POST   | `/api/calibrations` | `{whiteId, whiteDrops, samples: [{paintId, kind, hex, x, y, radius}], photo}` |
| GET    | `/api/calibrations/:id/photo` |                                              |
| GET    | `/healthz`          |                                                        |
