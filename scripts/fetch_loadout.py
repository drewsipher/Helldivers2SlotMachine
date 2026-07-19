#!/usr/bin/env python3
"""
Fetch the current Helldivers 2 loadout item list from the community wiki
(helldivers.wiki.gg) and write the base CSV consumed by process_images.py.

Sources (all via the wiki's public MediaWiki/Cargo API):
- Cargo table `Weapons`  -> Primary / Secondary / Grenade rows
- Cargo table `Stratagems` -> player-selectable stratagems
- Category:Boosters + pageimages -> boosters

Output columns match the historical sheet export:
  Category,Type,Subtype,Has Backpack,Name,Source,Image Link

The site's strict mode relies on two conventions kept here:
- "Has Backpack" is True for anything occupying the backpack slot
  (from the wiki's Backpack trait).
- Support weapons with the wiki's Expendable trait get Subtype
  "Expendable" (strict mode allows them alongside another support weapon).

Usage:
  python scripts/fetch_loadout.py --output helldivers_2_loadout.csv
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path
from typing import Dict, Iterable, List, Optional

import requests

API = "https://helldivers.wiki.gg/api.php"
HEADERS = {
    "User-Agent": "Helldivers2SlotMachine/1.0 (github.com/drewsipher/Helldivers2SlotMachine)"
}

# weapon_category -> site Type value
WEAPON_CATEGORIES = {
    "Primary Weapons": "Primary",
    "Secondary Weapons": "Secondary",
    "Throwables": "Grenade",
}

# stratagem_type values that are player loadout picks (excludes mission/ship
# stratagems like Hellbomb, Resupply, SEAF Artillery)
LOADOUT_STRATAGEM_TYPES = {
    "Support Weapon",
    "Backpack",
    "Orbital",
    "Eagle",
    "Sentry",
    "Emplacement",
    "Vehicle",
}


def api_get(params: Dict[str, str]) -> dict:
    params = {"format": "json", **params}
    resp = requests.get(API, params=params, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    if "error" in data:
        raise RuntimeError(f"Wiki API error: {data['error']}")
    return data


def cargo_query(table: str, fields: str, where: Optional[str] = None) -> List[Dict[str, str]]:
    """Fetch all rows of a Cargo table (paginated)."""
    rows: List[Dict[str, str]] = []
    offset = 0
    while True:
        params = {
            "action": "cargoquery",
            "tables": table,
            "fields": fields,
            "limit": "500",
            "offset": str(offset),
        }
        if where:
            params["where"] = where
        batch = [r["title"] for r in api_get(params).get("cargoquery", [])]
        rows.extend(batch)
        if len(batch) < 500:
            return rows
        offset += 500


def clean_wikitext(value: str) -> str:
    """Turn e.g. '[[Dust Devils Premium Warbond|Dust Devils]] <small>...</small>'
    into 'Dust Devils'."""
    value = value or ""
    value = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]+)\]\]", r"\1", value)
    value = re.sub(r"<[^>]+>[^<]*</[^>]+>", " ", value)
    value = re.sub(r"<[^>]+>", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def resolve_image_urls(filenames: List[str]) -> Dict[str, str]:
    """Resolve wiki file names to their real URLs via batched imageinfo calls.
    Follows file redirects (Cargo sometimes stores a redirect's name)."""
    urls: Dict[str, str] = {}
    unique = sorted({f.strip() for f in filenames if f and f.strip()})
    for batch in chunked(unique, 50):
        data = api_get({
            "action": "query",
            "titles": "|".join(f"File:{name}" for name in batch),
            "prop": "imageinfo",
            "iiprop": "url",
            "redirects": "1",
        })
        query = data["query"]
        # Map our requested name through title normalization and redirects.
        renames: Dict[str, str] = {}
        for step in ("normalized", "redirects"):
            for m in query.get(step, []):
                renames[m["from"]] = m["to"]
        by_title = {
            page["title"]: page["imageinfo"][0]["url"]
            for page in query.get("pages", {}).values()
            if page.get("imageinfo")
        }
        for name in batch:
            title = f"File:{name}"
            while title in renames:
                title = renames[title]
            url = by_title.get(title, "")
            if url:
                urls[name] = re.sub(r"\?.*$", "", url)  # strip cache-buster
            else:
                print(f"WARNING: could not resolve image '{name}'", file=sys.stderr)
    return urls


DESIGNATOR_RE = re.compile(r"^[A-Za-z]{0,4}[/-]?[A-Za-z]{0,4}-?\d[\w/-]*$")


def family_name(name: str) -> str:
    """Group key for stratagems: strip leading model designators so variants
    land in the same slot-machine bucket, e.g. 'MG-43 Machine Gun' ->
    'Machine Gun', 'EXO-45 Patriot Exosuit' -> 'Patriot Exosuit'.
    Names without designators (Eagle/Orbital/...) are kept whole."""
    tokens = name.split()
    while len(tokens) > 1 and DESIGNATOR_RE.match(tokens[0]):
        tokens = tokens[1:]
    return " ".join(tokens) or name


def fetch_weapons() -> List[Dict[str, str]]:
    raw = cargo_query("Weapons", "title,image,weapon_category,weapon_type,source")
    rows = []
    for r in raw:
        wtype = WEAPON_CATEGORIES.get(r.get("weapon category", ""))
        name = (r.get("title") or "").strip()
        if not wtype or not name:
            continue
        rows.append({
            "Category": "Weapon",
            "Name": name,
            "Type": wtype,
            "Subtype": clean_wikitext(r.get("weapon type", "")),
            "Has Backpack": "False",
            "Source": clean_wikitext(r.get("source", "")),
            "Image Link": "",
            "_image_file": (r.get("image") or "").strip(),
        })
    return rows


def fetch_stratagems() -> List[Dict[str, str]]:
    raw = cargo_query("Stratagems", "title,image,stratagem_type,source,traits")
    rows = []
    for r in raw:
        stype = (r.get("stratagem type") or "").strip()
        name = (r.get("title") or "").strip()
        if stype not in LOADOUT_STRATAGEM_TYPES or not name:
            continue
        traits = clean_wikitext(r.get("traits", ""))
        rows.append({
            "Category": "Strategem",  # spelling matches the site's CSV filter
            "Name": name,
            "Type": stype,
            # Strict mode groups all Expendable support weapons together.
            "Subtype": "Expendable" if "Expendable" in traits else family_name(name),
            "Has Backpack": "True" if "Backpack" in traits else "False",
            "Source": clean_wikitext(r.get("source", "")),
            "Image Link": "",
            "_image_file": (r.get("image") or "").strip(),
        })
    return rows


def chunked(seq: List[str], n: int) -> Iterable[List[str]]:
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def fetch_boosters() -> List[Dict[str, str]]:
    data = api_get({
        "action": "query",
        "list": "categorymembers",
        "cmtitle": "Category:Boosters",
        "cmtype": "page",
        "cmlimit": "500",
    })
    titles = [
        m["title"] for m in data["query"]["categorymembers"]
        if m.get("ns") == 0 and m["title"] != "Boosters"
    ]

    images: Dict[str, str] = {}
    for batch in chunked(sorted(titles), 50):
        data = api_get({
            "action": "query",
            "titles": "|".join(batch),
            "prop": "pageimages",
            "piprop": "original",
        })
        for page in data["query"]["pages"].values():
            src = page.get("original", {}).get("source", "")
            images[page["title"]] = re.sub(r"\?.*$", "", src)  # strip cache-buster

    rows = []
    for title in titles:
        url = images.get(title, "")
        if not url:
            print(f"WARNING: no image found for booster '{title}'", file=sys.stderr)
        rows.append({
            "Category": "Booster",
            "Name": title,
            "Type": "Booster",
            "Subtype": "",
            "Has Backpack": "False",
            "Source": "",
            "Image Link": url,
        })
    return rows


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Fetch loadout data from helldivers.wiki.gg")
    parser.add_argument("--output", "-o", type=str, default="helldivers_2_loadout.csv")
    args = parser.parse_args(argv)

    rows = fetch_weapons() + fetch_stratagems() + fetch_boosters()

    # Resolve wiki image filenames (weapons/stratagems) to real URLs.
    urls = resolve_image_urls([r.get("_image_file", "") for r in rows])
    for r in rows:
        fname = r.pop("_image_file", "")
        if fname and not r["Image Link"]:
            r["Image Link"] = urls.get(fname, "")

    # The Cargo tables occasionally contain duplicate rows; keep the first.
    seen = set()
    unique = []
    for r in rows:
        key = (r["Category"], r["Name"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(r)

    # Deterministic order for stable diffs.
    unique.sort(key=lambda r: (r["Category"], r["Type"], r["Name"]))

    counts = {}
    for r in unique:
        counts[r["Category"]] = counts.get(r["Category"], 0) + 1
    missing = sum(1 for r in unique if not r["Image Link"])
    if len(unique) < 100:
        print(f"ERROR: only {len(unique)} rows fetched — refusing to write "
              f"(wiki data looks incomplete)", file=sys.stderr)
        return 1

    out = Path(args.output)
    with out.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["Category", "Type", "Subtype", "Has Backpack",
                        "Name", "Source", "Image Link"],
        )
        writer.writeheader()
        writer.writerows(unique)

    print(f"Wrote {len(unique)} rows to {out} ({counts}, {missing} without image)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
