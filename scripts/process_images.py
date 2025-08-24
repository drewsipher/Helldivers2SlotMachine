#!/usr/bin/env python3
"""
Process Helldivers CSV: download images, resize to fit within 300x300, and write a new CSV
with an added column pointing to the resized image path suitable for web apps.

Folder layout (created as needed):
- assets/images/original/<category>/<type>/<slug>.<ext>
- assets/images/resized/<category>/<type>/<slug>.<ext>

Usage:
  python scripts/process_images.py \
    --input "Helldivers Weapons and Strategems - helldivers_2_loadout.csv" \
    --output "helldivers_2_loadout_with_resized.csv" \
    --max-size 300
"""

from __future__ import annotations

import argparse
import csv
import os
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional, Tuple

import shutil
import requests
from PIL import Image


DEFAULT_MAX_SIZE = 300
HEADERS = {"User-Agent": "Helldivers2SlotMachine/1.0 (+https://example.local)"}


def slugify(value: str) -> str:
    """Create a URL/file-system friendly slug.
    - Lowercase, strip
    - Replace non-alphanumeric with '-'
    - Collapse dashes
    - Trim leading/trailing dashes
    """
    value = (value or "").strip().lower()
    # Replace unicode quotes and special chars first
    value = value.replace("\u201c", '"').replace("\u201d", '"').replace("\u2019", "'")
    # Replace anything not a-z0-9 with -
    value = re.sub(r"[^a-z0-9]+", "-", value)
    value = re.sub(r"-+", "-", value)
    return value.strip("-") or "item"


def ensure_dir(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


def ext_from_content_type(ct: Optional[str]) -> str:
    if not ct:
        return ".png"
    ct = ct.split(";")[0].strip().lower()
    mapping = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "image/svg+xml": ".svg",
    }
    return mapping.get(ct, ".png")


def ext_from_url(url: str) -> str:
    path = re.sub(r"\?.*$", "", url)
    _, ext = os.path.splitext(path)
    if ext and len(ext) <= 5:
        return ext.lower()
    return ""


def download_file(url: str, dest: Path, max_retries: int = 3, timeout: int = 20) -> bool:
    """Download a URL to dest atomically; returns True if file was fetched/exists."""
    if dest.exists() and dest.stat().st_size > 0:
        return True
    tmp = dest.with_suffix(dest.suffix + ".part")
    for attempt in range(1, max_retries + 1):
        try:
            with requests.get(url, stream=True, headers=HEADERS, timeout=timeout) as r:
                r.raise_for_status()
                ensure_dir(dest.parent)
                with open(tmp, "wb") as f:
                    for chunk in r.iter_content(chunk_size=8192):
                        if chunk:
                            f.write(chunk)
            tmp.replace(dest)
            return True
        except Exception as e:
            if tmp.exists():
                try:
                    tmp.unlink()
                except Exception:
                    pass
            if attempt == max_retries:
                print(f"ERROR: Failed to download {url}: {e}", file=sys.stderr)
                return False
            time.sleep(1.5 * attempt)
    return False


def resize_image(src: Path, dest: Path, max_size: int = DEFAULT_MAX_SIZE) -> Tuple[int, int]:
    """Resize image to fit within max_size x max_size, keeping aspect ratio.
    Returns (width, height) of the resized image.
    """
    ensure_dir(dest.parent)
    # Special-case SVG: keep as-is, just copy to destination (vector scales inherently)
    if src.suffix.lower() == ".svg":
        ensure_dir(dest.parent)
        shutil.copyfile(src, dest)
        return (0, 0)

    with Image.open(src) as im:
        # Preserve transparency for PNG/WebP
        format_lower = (im.format or "").lower()
        has_alpha = im.mode in ("RGBA", "LA") or ("transparency" in im.info)

        # Convert paletted images to RGBA to preserve transparency upon resize
        if im.mode == "P":
            im = im.convert("RGBA" if has_alpha else "RGB")
        elif im.mode not in ("RGB", "RGBA"):
            # Convert other modes to a sane default
            im = im.convert("RGBA" if has_alpha else "RGB")

        im.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
        save_kwargs = {}

        ext = dest.suffix.lower()
        if ext in (".jpg", ".jpeg"):
            # JPEG has no alpha; if image has alpha, flatten onto white
            if im.mode == "RGBA":
                bg = Image.new("RGB", im.size, (255, 255, 255))
                bg.paste(im, mask=im.split()[3])
                im = bg
            save_kwargs.update({"quality": 90, "optimize": True, "progressive": True})
        elif ext == ".png":
            save_kwargs.update({"optimize": True})
        elif ext == ".webp":
            save_kwargs.update({"quality": 90})

        im.save(dest, **save_kwargs)
        return im.size


@dataclass
class Paths:
    assets_root: Path
    originals_dir: Path
    resized_dir: Path


def build_paths(assets_root: Path) -> Paths:
    originals = assets_root / "original"
    resized = assets_root / "resized"
    return Paths(assets_root=assets_root, originals_dir=originals, resized_dir=resized)


def compute_file_paths(paths: Paths, row: Dict[str, str], url: str) -> Tuple[Path, Path, str]:
    """Compute original and resized file paths and the web-friendly relative path to resized."""
    category = slugify(row.get("Category", "misc"))
    type_ = slugify(row.get("Type", "misc"))
    name = slugify(row.get("Name", "item"))

    ext = ext_from_url(url)
    # Default to .png when extension unknown
    if not ext:
        ext = ".png"

    rel = Path("resized") / category / type_ / f"{name}{ext}"
    orig_rel = Path("original") / category / type_ / f"{name}{ext}"

    original_path = paths.assets_root / orig_rel
    resized_path = paths.assets_root / rel

    # Return web path using POSIX separators
    web_rel = Path("assets") / "images" / rel
    return original_path, resized_path, web_rel.as_posix()


def process_csv(input_csv: Path, output_csv: Path, assets_root: Path, max_size: int) -> None:
    paths = build_paths(assets_root)
    ensure_dir(paths.originals_dir)
    ensure_dir(paths.resized_dir)

    with input_csv.open(newline="", encoding="utf-8") as f_in:
        reader = csv.DictReader(f_in)
        fieldnames = list(reader.fieldnames or [])
        new_col = "Resized Image Path"
        if new_col not in fieldnames:
            fieldnames.append(new_col)

        rows_out = []
        for row in reader:
            # Clean whitespace in expected columns
            for k in ("Category", "Name", "Type", "Subtype", "Source", "Image Link"):
                if k in row and row[k] is not None:
                    row[k] = row[k].strip()

            url = row.get("Image Link") or row.get("Image", "")
            if not url:
                row[new_col] = ""
                rows_out.append(row)
                continue

            # Compute paths and download
            original_path, resized_path, web_rel = compute_file_paths(paths, row, url)

            # Determine extension using content-type if URL lacks one
            ext = original_path.suffix
            if ext in ("", ".png"):
                try:
                    head = requests.head(url, headers=HEADERS, allow_redirects=True, timeout=10)
                    ct_ext = ext_from_content_type(head.headers.get("Content-Type"))
                    if ext == "" and ct_ext:
                        original_path = original_path.with_suffix(ct_ext)
                        resized_path = resized_path.with_suffix(ct_ext)
                        web_rel = Path(web_rel).with_suffix(ct_ext).as_posix()
                except Exception:
                    pass

            ok = download_file(url, original_path)
            if not ok:
                row[new_col] = ""
                rows_out.append(row)
                continue

            try:
                resize_image(original_path, resized_path, max_size=max_size)
                row[new_col] = web_rel
            except Exception as e:
                print(f"ERROR: Failed to process {original_path}: {e}", file=sys.stderr)
                row[new_col] = ""

            rows_out.append(row)

    with output_csv.open("w", newline="", encoding="utf-8") as f_out:
        writer = csv.DictWriter(f_out, fieldnames=fieldnames)
        writer.writeheader()
        for r in rows_out:
            writer.writerow(r)

    print(f"Wrote updated CSV: {output_csv}")


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Download and resize images from CSV")
    parser.add_argument("--input", "-i", type=str, default="Helldivers Weapons and Strategems - helldivers_2_loadout.csv",
                        help="Path to input CSV")
    parser.add_argument("--output", "-o", type=str, default="helldivers_2_loadout_with_resized.csv",
                        help="Path to output CSV with added column")
    parser.add_argument("--assets-dir", type=str, default=os.path.join("assets", "images"),
                        help="Root folder to store images (default: assets/images)")
    parser.add_argument("--max-size", type=int, default=DEFAULT_MAX_SIZE,
                        help="Max width/height for resized images (default: 300)")

    args = parser.parse_args(argv)

    input_csv = Path(args.input)
    output_csv = Path(args.output)
    assets_root = Path(args.assets_dir)

    if not input_csv.exists():
        print(f"Input CSV not found: {input_csv}", file=sys.stderr)
        return 2

    try:
        process_csv(input_csv, output_csv, assets_root, args.max_size)
    except KeyboardInterrupt:
        print("Aborted", file=sys.stderr)
        return 130
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
