## Image processing pipeline

This repo includes a small script to process the CSV, download images, and generate resized images suitable for the web. It also appends a new column to the CSV with the path to the resized image.

### What it does

- Reads `Helldivers Weapons and Strategems - helldivers_2_loadout.csv`.
- Downloads each image from the `Image Link` column.
- Stores originals under `assets/images/original/<category>/<type>/<slug>.<ext>`.
- Resizes to fit within 300x300 and stores under `assets/images/resized/<category>/<type>/<slug>.<ext>`.
- Writes `helldivers_2_loadout_with_resized.csv` with a `Resized Image Path` column containing a web-friendly path like `assets/images/resized/...`.

### Setup

1. Create and activate a Python 3.10+ environment.
2. Install deps:

   ```bash
   pip install -r requirements.txt
   ```

### Run

```bash
python scripts/process_images.py \
  --input "Helldivers Weapons and Strategems - helldivers_2_loadout.csv" \
  --output "helldivers_2_loadout_with_resized.csv" \
  --max-size 300
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
