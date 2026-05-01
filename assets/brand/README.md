# hookwarden brand assets

A hook fused with a warden's helmet. The mark is a single shape that reads as both an `S` and a fishing hook, with a Spartan helmet top — strength, vigilance, protection.

## Files

```
assets/brand/
├── source/
│   └── hookwarden-brand-system.png   ← original brand sheet (3K-style master)
├── marks/
│   └── hookwarden-mark.svg           ← canonical vector mark (uses currentColor)
├── icons/
│   ├── favicon.ico                   ← multi-res 16/32/48
│   ├── favicon-16.png                ← navy on transparent
│   ├── favicon-32.png
│   ├── favicon-48.png
│   ├── apple-touch-icon.png          ← 180×180, white-on-navy, full-bleed
│   ├── android-chrome-192.png
│   ├── android-chrome-512.png
│   └── android-chrome-maskable-512.png
└── social/
    ├── og-image.svg / .png           ← 1200×630 Open Graph card
    └── readme-banner.svg / .png      ← 1280×320 README header
```

The `packages/web/public/` directory holds copies of the favicons + manifest +
OG image so the Astro site picks them up at deploy time. Source-of-truth is
this directory.

## The mark

`marks/hookwarden-mark.svg` is the canonical vector. It uses `fill="currentColor"`
so any consumer can apply any color via CSS:

```html
<img src="/assets/brand/marks/hookwarden-mark.svg" alt="hookwarden" />
```

```css
/* anywhere it's inlined */
.brand { color: #1A2633; }   /* navy */
.brand-on-dark { color: #FFFFFF; }
```

To render a recolored raster from CLI:

```bash
sed 's/currentColor/#1A2633/g' marks/hookwarden-mark.svg | rsvg-convert -h 512 - -o mark-navy-512.png
```

## Colors

| Role             | Hex       | Notes                                          |
|------------------|-----------|------------------------------------------------|
| Black (primary)  | `#000000` | Background for full-bleed surfaces             |
| White (mark)     | `#FFFFFF` | Mark color on dark surfaces                    |
| Navy (legacy)    | `#1A2633` | Original mark color; kept available, not primary |

The brand runs on **black + white**. Navy is preserved as a kept-around accent
but every full-bleed surface (icons, social cards, app manifest) uses black.

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

rsvg-convert -w 1200 -h 630 assets/brand/social/og-image.svg     -o assets/brand/social/og-image.png
rsvg-convert -w 1280 -h 320 assets/brand/social/readme-banner.svg -o assets/brand/social/readme-banner.png
```

If you don't have Geist installed, the SVG will render with a fallback font and
the layout will drift. The PNGs in this repo are the authoritative output.

## Regenerating favicons

Favicons are derived from `marks/hookwarden-mark.svg`. To regenerate the full
set after a mark change, run:

```bash
BLACK="#000000"; NAVY="#1A2633"; SVG=assets/brand/marks/hookwarden-mark.svg

render() {  # size, bg, fill, out
  local pad=$(( $1 * 70 / 100 ))
  sed "s/currentColor/$3/g" "$SVG" | rsvg-convert -h $pad -o /tmp/_m.png
  if [ "$2" = "none" ]; then
    magick /tmp/_m.png -background none -gravity center -extent ${1}x${1} "$4"
  else
    magick -size ${1}x${1} "xc:$2" /tmp/_m.png -gravity center -composite "$4"
  fi
}

render 16  none    "$NAVY"  assets/brand/icons/favicon-16.png
render 32  none    "$NAVY"  assets/brand/icons/favicon-32.png
render 48  none    "$NAVY"  assets/brand/icons/favicon-48.png
render 180 "$BLACK" white   assets/brand/icons/apple-touch-icon.png
render 192 "$BLACK" white   assets/brand/icons/android-chrome-192.png
render 512 "$BLACK" white   assets/brand/icons/android-chrome-512.png

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
