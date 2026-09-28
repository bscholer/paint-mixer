# Paint Mixer

A small PWA that tells you how many drops of each paint you own to mix a target color.

- Pick the target from a photo (tap or drag), a hex code, or the system color picker.
- Keep a list of your paints. It starts with 16 DecoArt Americana colors. Edit, add, turn off, or calibrate each one.
- Get up to three recipes: the closest match, the one with the fewest drops, and one that uses different paints.
- Save recipes. Paints and recipes live in SQLite on the server, so every device sees the same list.

## How the mix is predicted

Each paint's color becomes a Kubelka-Munk absorption/scattering ratio for each linear-RGB channel.
Ratios mix linearly by drop count. The solver tries every one-, two-, and three-paint recipe up to
the drop limit and ranks them by CIEDE2000 difference from the target.
Recipes are always in lowest terms (2:1, not 4:2). Use the ×2/×3/×5 buttons for a larger batch.

The default hex values are estimates. For better predictions, paint a swatch of each paint, let it
dry, photograph it in daylight, and use the eyedropper button on the Paints tab.

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
| GET    | `/healthz`          |                                                        |
