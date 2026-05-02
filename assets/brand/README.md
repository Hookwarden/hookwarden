# hookwarden brand assets

A hook fused with a warden's helmet. The mark is a single shape that reads as both an `S` and a fishing hook, with a Spartan helmet top — strength, vigilance, protection.

## Files

```
assets/brand/
├── source/
│   └── hookwarden-brand-system.png   ← original brand sheet (3K-style master)
├── marks/
│   ├── hookwarden-mark.svg           ← canonical vector mark (uses currentColor)
│   └── hookwarden-icon.svg           ← 512×512 icon: gradient bg + mark (favicon/app icon source)
├── icons/
│   ├── favicon.ico                   ← multi-res 16/32/48
│   ├── favicon-16.png                ← dark mark on transparent
│   ├── favicon-32.png
│   ├── favicon-48.png
│   ├── apple-touch-icon.png          ← 180×180, off-white mark on bg, full-bleed
│   ├── android-chrome-192.png
│   ├── android-chrome-512.png
│   └── android-chrome-maskable-512.png
└── social/
    ├── readme-banner.svg / .png      ← 1280×320 README header
    └── og-image.svg                  ← 1200×630 Open Graph image
```

This is the **canonical brand**. The private SaaS repo
(`AdelinaLipsa/webhook-security`) mirrors only what its surface needs
(favicons + manifest in `packages/web/public/`, plus its own
marketing-specific OG image). When the brand here changes, the SaaS
repo's mirror needs a manual re-sync (commands in its
`assets/brand/README.md`).

## The mark

`marks/hookwarden-mark.svg` is the canonical vector. It uses `fill="currentColor"`
so any consumer can apply any color via CSS:

```html
<img src="/assets/brand/marks/hookwarden-mark.svg" alt="hookwarden" />
```

```css
/* anywhere it's inlined */
.brand        { color: #E5E7EB; }   /* on dark surface */
.brand-on-light { color: #0B0F14; } /* on light surface */
```

To render a recolored raster from CLI:

```bash
sed 's/currentColor/#E5E7EB/g' marks/hookwarden-mark.svg | rsvg-convert -h 512 - -o mark-512.png
```

## Colors

| Role              | Hex       | Notes                                                                 |
|-------------------|-----------|-----------------------------------------------------------------------|
| Background        | `#0B0F14` | Dark base for full-bleed surfaces (~Tailwind slate-950, violet tilt)  |
| Text / mark       | `#E5E7EB` | Primary text + mark color on dark surfaces (Tailwind gray-200)        |
| Accent            | `#6366F1` | Indigo accent — used sparingly (Tailwind indigo-500)                  |
| Surface highlight | `#1E293B` | Steel-blue surface tier for cards / hover states (Tailwind slate-800) |
| Navy (legacy)     | `#1A2633` | Original mark color; preserved for reference, not primary             |

The brand is **technical + distinctive**: a near-black background with a
faint blue tilt, soft off-white text, and a single indigo accent that
shows up on dev-tool moments (the `$` prompt glyph in command lines,
focus rings, key states). Use the accent sparingly — if everything is
indigo, nothing is.

### Tailwind hint

If you're styling in Tailwind, the closest tokens are
`bg-slate-950 / text-gray-200 / accent-indigo-500 / surface-slate-800`.

## Typography

| Use            | Font        | Weight | Notes                              |
|----------------|-------------|--------|------------------------------------|
| Display / wordmark | Geist Sans  | 700    | tight letter-spacing (-3 to -4)    |
| Body / tagline | Geist Sans  | 400    |                                    |
| Code / mono / eyebrow | Geist Mono  | 500    | for terminal commands and labels   |

[Geist](https://vercel.com/font) is Vercel's open-source typeface (SIL OFL 1.1),
designed specifically for developer tools — picked here because it pairs with
the mark's precise, Swiss-influenced aesthetic and reads as serious tech without
being the ubiquitous Inter.

### Re-rendering the social SVGs

The social SVGs reference `Geist` and `Geist Mono` by name. To re-render them
locally after edits, install the fonts so fontconfig can find them:

```bash
brew install --cask font-geist font-geist-mono
fc-cache -f

rsvg-convert -w 1280 -h 320 assets/brand/social/readme-banner.svg -o assets/brand/social/readme-banner.png
```

If you don't have Geist installed, the SVG will render with a fallback font and
the layout will drift. The PNGs in this repo are the authoritative output.

## Regenerating favicons

Favicons are derived from `marks/hookwarden-mark.svg`. To regenerate the full
set after a mark change, run:

```bash
BG="#0B0F14"; MARK="#E5E7EB"; SVG=assets/brand/marks/hookwarden-mark.svg

render() {  # size, bg, fill, out
  local pad=$(( $1 * 70 / 100 ))
  sed "s/currentColor/$3/g" "$SVG" | rsvg-convert -h $pad -o /tmp/_m.png
  if [ "$2" = "none" ]; then
    magick /tmp/_m.png -background none -gravity center -extent ${1}x${1} "$4"
  else
    magick -size ${1}x${1} "xc:$2" /tmp/_m.png -gravity center -composite "$4"
  fi
}

# Favicons: dark mark on transparent so they read on light browser tabs.
render 16  none "$BG"   assets/brand/icons/favicon-16.png
render 32  none "$BG"   assets/brand/icons/favicon-32.png
render 48  none "$BG"   assets/brand/icons/favicon-48.png
# Full-bleed: brand bg + soft off-white mark.
render 180 "$BG" "$MARK" assets/brand/icons/apple-touch-icon.png
render 192 "$BG" "$MARK" assets/brand/icons/android-chrome-192.png
render 512 "$BG" "$MARK" assets/brand/icons/android-chrome-512.png

magick assets/brand/icons/favicon-16.png \
       assets/brand/icons/favicon-32.png \
       assets/brand/icons/favicon-48.png \
       assets/brand/icons/favicon.ico
```

## Provenance

The mark started as a raster brand sheet (`source/hookwarden-brand-system.png`),
generated as a one-off design exploration. It was traced to vector with
`potrace 1.16` from a 1-bit threshold of the trimmed primary mark, then
post-processed to use `fill="currentColor"` and a clean integer transform.

If the mark is ever redrawn cleanly in vector (Figma, Illustrator), replace
`marks/hookwarden-mark.svg` and re-run the regeneration commands above.

## License

The mark and brand assets in this directory are © hookwarden. Geist is licensed
under SIL OFL 1.1.
