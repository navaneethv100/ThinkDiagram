#!/usr/bin/env python3
from pathlib import Path
import sys

from PIL import Image


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}


def watermark_image(image_path: Path, logo: Image.Image) -> None:
    with Image.open(image_path) as source:
        original_format = source.format
        base = source.convert("RGBA")
        width, height = base.size

        target_logo_width = max(96, min(240, int(width * 0.18)))
        logo_height = max(1, int(target_logo_width * logo.height / logo.width))
        mark = logo.resize((target_logo_width, logo_height), Image.Resampling.LANCZOS)

        alpha = mark.getchannel("A").point(lambda value: int(value * 0.82))
        mark.putalpha(alpha)

        padding = max(18, int(min(width, height) * 0.035))
        x = max(padding, width - mark.width - padding)
        y = max(padding, height - mark.height - padding)
        clear_padding = max(4, int(mark.height * 0.2))
        clear_box = (
            max(0, x - clear_padding),
            max(0, y - clear_padding),
            min(width, x + mark.width + clear_padding),
            min(height, y + mark.height + clear_padding),
        )
        base.paste((255, 255, 255, 255), clear_box)
        base.alpha_composite(mark, (x, y))

        if image_path.suffix.lower() in {".jpg", ".jpeg"}:
            base = base.convert("RGB")

        save_kwargs = {}
        if original_format:
            save_kwargs["format"] = original_format
        if image_path.suffix.lower() in {".jpg", ".jpeg"}:
            save_kwargs["quality"] = 95
        base.save(image_path, **save_kwargs)


def main() -> int:
    if len(sys.argv) < 3:
        print("Usage: add_watermark.py LOGO IMAGE_OR_DIR [...]", file=sys.stderr)
        return 2

    logo_path = Path(sys.argv[1]).resolve()
    targets = [Path(arg).resolve() for arg in sys.argv[2:]]

    with Image.open(logo_path) as logo_source:
        logo = logo_source.convert("RGBA")

    image_paths: list[Path] = []
    for target in targets:
        if target.is_dir():
            image_paths.extend(
                path for path in target.rglob("*")
                if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
            )
        elif target.is_file() and target.suffix.lower() in IMAGE_EXTENSIONS:
            image_paths.append(target)

    image_paths = sorted(set(image_paths))
    for image_path in image_paths:
        if image_path.resolve() == logo_path:
            continue
        watermark_image(image_path, logo)

    print(f"Watermarked {len([p for p in image_paths if p.resolve() != logo_path])} images")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
