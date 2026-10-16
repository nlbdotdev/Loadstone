# Brand system

**Loadstone** is the product spelling. **Your next playthrough, ready.** is the primary line. The identity combines a dark mineral palette, warm copper and a compact carved **L**. Use clear typography and generous spacing; let the mark carry the theme.

## The mark

`public/brand/mark.svg` is the single editable geometry source. The three faces describe one solid shape, with an open counter and a restrained edge highlight. Keep its proportions, negative space and colors together. Do not add extra compass points, bevel filters, outlines or tiny ornaments.

Use the freestanding mark on dark surfaces. The app tile adds a charcoal rounded square and a fine edge; its SVG, 512px PNG and seven-size Windows ICO are generated from the mark. The 16/24/32/48/64/128/256px ICO frames are rendered individually for native use.

```powershell
pnpm assets:icon
pnpm assets:steam
```

The generators use the locked Electron renderer in a hidden window. The desktop component and handbook import the same vector. Never redraw the mark separately in CSS or a second polygon script.

## Palette

| Role | Color | Use |
| --- | --- | --- |
| Basalt | `#1B2227` | App tile, navigation and dark brand fields |
| Copper | `#D9AD87` | Primary mark face and dark-surface accent |
| Cut edge | `#A97652` | Restrained shadow face |
| Light edge | `#F0CFAD` | Small highlighted face |
| Paper | `#F7F5F0` | Handbook reading surface |
| Ink | `#263036` | Text on paper |

Copper used for the mark is not automatically suitable for small text on a light background. The handbook uses darker accent text for contrast, visible keyboard focus and underlined prose links.

## Typography and tone

Use the system UI family, led by Segoe UI on Windows. The wordmark uses normal title case, a medium/semibold weight and tight but readable spacing. Body copy should be calm, concrete and direct. Avoid all-caps slogans, exaggerated tracking and claims that turn development targets into finished support.

## Asset review

Inspect the icon at actual small sizes on light and dark backgrounds, in the app header and in a staged executable. Check Steam crop previews before submission. Store artwork remains draft until its review; a generated capsule is not evidence of a playable setup. Existing screenshots and recordings retain their capture version and should not be silently relabeled after a visual refresh.

Source licensing and artwork/trademark scope are described in [artwork provenance](../../docs/artwork.md) and [COPYRIGHT](../../COPYRIGHT). This visual refinement does not change those terms.
