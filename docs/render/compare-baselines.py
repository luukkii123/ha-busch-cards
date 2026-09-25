#!/usr/bin/env python3
"""Compare reviewed UI snapshots with Playwright output from the pinned image."""

import argparse
from pathlib import Path

from PIL import Image, ImageChops


def compare(expected: Path, actual: Path) -> tuple[float, str]:
    with Image.open(expected) as old, Image.open(actual) as new:
        if old.size != new.size:
            return 1.0, f"size {old.size} -> {new.size}"
        diff = ImageChops.difference(old.convert("RGB"), new.convert("RGB"))
        changed = sum(1 for pixel in diff.get_flattened_data() if max(pixel) > 16)
        fraction = changed / (old.width * old.height)
        return fraction, f"{changed}/{old.width * old.height} pixels"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("baseline", type=Path)
    parser.add_argument("actual", type=Path, nargs="+")
    parser.add_argument("--max-changed", type=float, default=0.005)
    args = parser.parse_args()
    actual = {
        path.name: path
        for directory in args.actual
        for path in directory.glob("*.png")
    }
    failed = []
    for expected in sorted(args.baseline.rglob("*.png")):
        path = actual.get(expected.name)
        if path is None:
            failed.append(f"{expected.name}: missing")
            continue
        fraction, detail = compare(expected, path)
        if fraction > args.max_changed:
            failed.append(f"{expected.name}: {fraction:.2%}, {detail}")
    if failed:
        print("\n".join(failed))
        return 1
    print(f"{len(list(args.baseline.rglob('*.png')))} baselines match")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
