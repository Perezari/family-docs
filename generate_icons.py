"""
Generate iOS-style PWA icons for Family Documents.
Produces icon-180.png, icon-192.png, icon-512.png, icon-maskable-512.png, splash.png
in the icons/ folder relative to this script.
"""
from PIL import Image, ImageDraw, ImageFilter
import os
import math

OUT_DIR = os.path.join(os.path.dirname(__file__), "icons")
os.makedirs(OUT_DIR, exist_ok=True)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def make_icon(size, mask=False):
    """
    Render a high-quality icon at the given square size.
    - Diagonal gradient (teal -> blue) — Apple-style
    - Soft inner highlight
    - Centered "document" glyph
    - 22% rounded corner radius (matches iOS app icons) unless `mask=True`
      in which case full bleed (the OS will mask).
    """
    SCALE = 4  # supersample for crisp anti-aliasing
    s = size * SCALE
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # --- Background gradient ---
    top = (90, 200, 250)        # iOS systemTeal
    bottom = (0, 122, 255)      # iOS systemBlue
    grad = Image.new("RGBA", (s, s))
    gd = ImageDraw.Draw(grad)
    for y in range(s):
        c = lerp(top, bottom, y / s)
        gd.line([(0, y), (s, y)], fill=(*c, 255))

    # --- Rounded square mask (or full square for maskable) ---
    if mask:
        # Maskable: render full bleed (no rounding) — Android safe zone is center 80%
        bg = grad
    else:
        radius = int(s * 0.225)  # iOS app icon radius
        rounded = Image.new("L", (s, s), 0)
        rd = ImageDraw.Draw(rounded)
        rd.rounded_rectangle((0, 0, s, s), radius=radius, fill=255)
        bg = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        bg.paste(grad, (0, 0), rounded)

    img = bg

    # --- Subtle top highlight ---
    highlight = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    hd = ImageDraw.Draw(highlight)
    for y in range(int(s * 0.5)):
        a = int(40 * (1 - y / (s * 0.5)))
        hd.line([(0, y), (s, y)], fill=(255, 255, 255, a))
    img = Image.alpha_composite(img, highlight)

    # --- Document glyph ---
    glyph = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glyph)
    # Document body
    doc_w = int(s * 0.46)
    doc_h = int(s * 0.58)
    # Center it but shift very slightly up so feels balanced with shadow
    doc_x = (s - doc_w) // 2
    doc_y = (s - doc_h) // 2 - int(s * 0.01)
    fold = int(doc_w * 0.30)  # corner fold size
    r = int(doc_w * 0.08)     # document corner radius
    # Draw soft drop shadow first
    shadow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle((doc_x, doc_y + int(s*0.012),
                          doc_x + doc_w, doc_y + doc_h + int(s*0.012)),
                         radius=r, fill=(0, 0, 0, 70))
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=int(s*0.012)))
    img = Image.alpha_composite(img, shadow)

    # White document with folded corner
    # We construct a polygon for outline minus a triangle in the top-right
    # then re-add the fold as a slightly darker triangle.
    poly = [
        (doc_x + r, doc_y),
        (doc_x + doc_w - fold, doc_y),
        (doc_x + doc_w, doc_y + fold),
        (doc_x + doc_w, doc_y + doc_h - r),
        (doc_x + doc_w - r, doc_y + doc_h),
        (doc_x + r, doc_y + doc_h),
        (doc_x, doc_y + doc_h - r),
        (doc_x, doc_y + r),
    ]
    gdraw.polygon(poly, fill=(255, 255, 255, 255))
    # Round the corners by drawing arcs/circles
    for cx, cy in [
        (doc_x + r, doc_y + r),
        (doc_x + doc_w - r, doc_y + doc_h - r),
        (doc_x + r, doc_y + doc_h - r),
    ]:
        gdraw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(255, 255, 255, 255))

    # Folded corner (darker shade)
    fold_poly = [
        (doc_x + doc_w - fold, doc_y),
        (doc_x + doc_w, doc_y + fold),
        (doc_x + doc_w - fold, doc_y + fold),
    ]
    gdraw.polygon(fold_poly, fill=(220, 232, 245, 255))
    # Crease line accent
    gdraw.line([(doc_x + doc_w - fold, doc_y),
                (doc_x + doc_w - fold, doc_y + fold),
                (doc_x + doc_w, doc_y + fold)],
               fill=(180, 200, 220, 255), width=max(2, int(s * 0.005)))

    # Text lines on document
    line_x = doc_x + int(doc_w * 0.18)
    line_w_full = int(doc_w * 0.64)
    line_thickness = max(3, int(s * 0.012))
    line_radius = line_thickness // 2
    line_gap = int(doc_h * 0.13)
    first_y = doc_y + int(doc_h * 0.42)
    line_widths = [line_w_full, int(line_w_full * 0.78), line_w_full,
                   int(line_w_full * 0.55)]
    line_alphas = [255, 200, 175, 140]
    for i, (lw, la) in enumerate(zip(line_widths, line_alphas)):
        ly = first_y + i * line_gap
        gdraw.rounded_rectangle(
            (line_x, ly, line_x + lw, ly + line_thickness),
            radius=line_radius, fill=(0, 122, 255, la)
        )

    img = Image.alpha_composite(img, glyph)

    # Downsample
    img = img.resize((size, size), Image.LANCZOS)
    return img


def make_splash(width=1170, height=2532):
    """A simple splash image at the largest common iPhone resolution."""
    img = Image.new("RGB", (width, height), (242, 242, 247))
    # Centered icon
    icon_size = 220
    icon = make_icon(icon_size)
    px = (width - icon_size) // 2
    py = (height - icon_size) // 2 - 80
    img.paste(icon, (px, py), icon)
    return img


def main():
    print("Generating icons in", OUT_DIR)

    # Standard PWA icons
    for size in (180, 192, 512):
        icon = make_icon(size)
        path = os.path.join(OUT_DIR, f"icon-{size}.png")
        icon.save(path, "PNG", optimize=True)
        print(" ", path)

    # Maskable icon (full bleed, larger glyph safe zone)
    mask_icon = make_icon(512, mask=True)
    mp = os.path.join(OUT_DIR, "icon-maskable-512.png")
    mask_icon.save(mp, "PNG", optimize=True)
    print(" ", mp)

    # iOS splash
    splash = make_splash()
    sp = os.path.join(OUT_DIR, "splash.png")
    splash.save(sp, "PNG", optimize=True)
    print(" ", sp)

    print("Done.")


if __name__ == "__main__":
    main()
