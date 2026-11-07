#!/usr/bin/env python3
"""Scan rendered paper/mark-scheme pages for stray-ink anomalies.

Flags the defect class that survives text extraction: small isolated ink blobs
(leaked source digits, punctuation, mask remnants) that sit alone in whitespace,
and near-blank content pages. Every flagged region is reported with coordinates
for manual review.

Usage: qa-page-anomaly-scan.py <report-dir> [--ms-dir <dir-with-ms-pngs>]
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

DARK = 140
MIN_BLOB_H, MAX_BLOB_H = 8, 45
MIN_BLOB_W, MAX_BLOB_W = 3, 60
MIN_BLOB_PX = 12
MIN_DENSITY = 0.28          # glyph-like fill; hollow tick boxes are ~0.15
ISO_X, ISO_Y = 40, 16       # isolation radii in px
NEAR_BLANK_INK = 0.0025     # fraction of interior pixels inked
NEAR_BLANK_SPAN = 0.45      # inked-row span; a page of answer rules spans ~70%+


def scan_page(png_path: Path, skip_isolated: bool = False) -> list[dict]:
    a = np.asarray(Image.open(png_path).convert("L"))
    dark = a < DARK
    h, w = dark.shape
    findings: list[dict] = []

    # Near-blank: ink in the interior region (exclude generated footer band),
    # but only when the ink is vertically concentrated — full pages of answer
    # rules are legitimately low-ink but span most of the page height.
    top_i, bot_i = int(h * 0.06), int(h * 0.90)
    interior = dark[top_i:bot_i, int(w * 0.08): int(w * 0.92)]
    ink_frac = interior.mean()
    if ink_frac < NEAR_BLANK_INK:
        inked_rows = np.where(interior.any(axis=1))[0]
        span = (inked_rows.max() - inked_rows.min()) / interior.shape[0] if len(inked_rows) else 0
        if span < NEAR_BLANK_SPAN:
            findings.append({"kind": "near-blank", "ink": round(float(ink_frac), 5),
                             "span": round(float(span), 2)})

    if skip_isolated:
        return findings

    # Row-band profile: total inked width per row.
    row_has = dark.any(axis=1)
    # Vertical runs of sparse rows — candidates for lone glyphs.
    y = 0
    while y < h:
        if not row_has[y]:
            y += 1
            continue
        y0 = y
        while y < h and row_has[y]:
            y += 1
        y1 = y  # exclusive
        band = dark[y0:y1]
        xs = np.where(band.any(axis=0))[0]
        if len(xs) == 0:
            continue
        band_h = y1 - y0
        band_w = xs.max() - xs.min() + 1
        band_px = int(band.sum())
        if not (MIN_BLOB_H <= band_h <= MAX_BLOB_H and band_w <= MAX_BLOB_W and band_px >= MIN_BLOB_PX):
            continue
        density = band_px / (band_h * band_w)
        if density < MIN_DENSITY:
            continue
        x0, x1 = int(xs.min()), int(xs.max())
        # Isolation: no ink within ISO_Y vertically or ISO_X horizontally.
        top_ok = y0 - ISO_Y < 0 or not dark[max(0, y0 - ISO_Y):y0, max(0, x0 - ISO_X):min(w, x1 + ISO_X)].any()
        bot_ok = y1 + ISO_Y >= h or not dark[y1:min(h, y1 + ISO_Y), max(0, x0 - ISO_X):min(w, x1 + ISO_X)].any()
        left_ok = x0 - ISO_X < 0 or not dark[y0:y1, max(0, x0 - ISO_X):x0].any()
        right_ok = x1 + ISO_X >= w or not dark[y0:y1, x1 + 1:min(w, x1 + ISO_X)].any()
        if not (top_ok and bot_ok and left_ok and right_ok):
            continue
        # Skip the generated footer zone (page number is centred at bottom).
        if y0 > h * 0.92 and abs((x0 + x1) / 2 - w / 2) < w * 0.18:
            continue
        findings.append({
            "kind": "isolated-ink",
            "x": [x0, x1], "y": [y0, y1],
            "px": band_px, "density": round(density, 2),
        })
    return findings


def main() -> int:
    args = sys.argv[1:]
    root = Path(args[0])
    results: dict[str, dict] = {}
    total_pages = 0
    for png in sorted(root.rglob("page-*.png")):
        # Covers (page-01) are generated text only — no raster fragments can leak.
        findings = scan_page(png, skip_isolated=png.name == "page-01.png")
        total_pages += 1
        if findings:
            results[str(png.relative_to(root))] = findings
    # Optional mark-scheme png trees.
    for extra in args[1:]:
        mroot = Path(extra)
        for png in sorted(mroot.rglob("*.png")):
            findings = scan_page(png, skip_isolated=png.stem.endswith("-1") or png.stem.endswith("-01"))
            total_pages += 1
            if findings:
                results[str(png)] = findings
    out = {"pagesScanned": total_pages, "flagged": len(results), "findings": results}
    print(json.dumps(out, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
