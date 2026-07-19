## Automated updates (CI)

The GitHub Actions workflow `.github/workflows/update-loadout.yml` refreshes the
loadout data weekly (and on manual dispatch via the Actions tab). It:

1. Runs `scripts/fetch_loadout.py`, which pulls the current weapon, stratagem,
   and booster lists (with image URLs) from the [community wiki](https://helldivers.wiki.gg)
   Cargo/MediaWiki API and writes `helldivers_2_loadout.csv`.
2. Runs `scripts/process_images.py` to download new images, resize them, prune
   images for removed/renamed items, and write `helldivers_2_loadout_with_resized.csv`.
3. Commits and pushes only if something changed — which redeploys the GitHub
   Pages site automatically.

## Data pipeline

`scripts/fetch_loadout.py` produces the base CSV with columns
`Category,Type,Subtype,Has Backpack,Name,Source,Image Link`:

- Weapons come from the wiki's `Weapons` Cargo table (Primary/Secondary/Throwables).
- Stratagems come from the `Stratagems` Cargo table, filtered to player-selectable
  types; `Subtype` is a derived "family" name (model designators stripped) used by
  the site to avoid rolling near-identical stratagems on multiple reels.
- `Has Backpack` and the `Expendable` subtype (used by the site's strict mode)
  come from the wiki's stratagem traits.
- Boosters come from `Category:Boosters` page listings + page images.

`scripts/process_images.py` then:

- Downloads each image from the `Image Link` column (skips ones already present).
- Stores originals under `assets/images/original/<category>/<type>/<slug>.<ext>`.
- Resizes to fit within 300x300 and stores under `assets/images/resized/<category>/<type>/<slug>.<ext>`.
- Writes `helldivers_2_loadout_with_resized.csv` with a `Resized Image Path` column containing a web-friendly path like `assets/images/resized/...`.
- With `--prune`, deletes image files no longer referenced by the CSV.

### Run locally

```bash
pip install -r requirements.txt
python scripts/fetch_loadout.py --output helldivers_2_loadout.csv
python scripts/process_images.py \
  --input helldivers_2_loadout.csv \
  --output helldivers_2_loadout_with_resized.csv \
  --max-size 300 --prune
```

Outputs:
- `assets/images/` with `original/` and `resized/` subfolders, organized by category and type.
- `helldivers_2_loadout_with_resized.csv` with the additional `Resized Image Path` column.

Notes:
- The script retries downloads on transient failures.
- Unknown extensions default to `.png`; content-type is probed via HTTP HEAD when possible.
- Transparent images keep transparency for PNG/WebP; JPEGs are flattened on white.

## Website

Static files for the slot machines live under:

- `index.html`
- `assets/site/css/styles.css`
- `assets/site/js/{app.js,csv.js,slot.js}`
- `assets/site/sfx/` (optional mp3s; WebAudio beeps are used as a fallback)

Open `index.html` directly or host a static server. Example:

```bash
python -m http.server 8080
# Then open http://localhost:8080
```

The site reads `helldivers_2_loadout_with_resized.csv` at the repo root to populate the slot reels using the resized image paths.
