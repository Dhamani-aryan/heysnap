# image-gen Prompting Guide

## Fast Pattern

For most prompts, use this order:

```text
Goal: what the image is for
Scene/subject: what should be shown
Style/medium: photo, UI mockup, diagram, watercolor, product render, etc.
Composition: framing, camera angle, layout, placement
Details: materials, colors, lighting, text, labels, mood
Constraints: what to preserve, avoid, or render exactly
```

Example:

```sh
image-gen "$(cat <<'PROMPT'
Goal: product hero image for a landing page.
Subject: a matte black ceramic coffee mug on a clean white desk.
Style: photorealistic product photography.
Composition: centered mug, 3/4 angle, soft shadow, generous negative space on the left for web copy.
Details: natural morning window light, visible ceramic texture, no hands.
Constraints: no text, no logo, no watermark, no extra objects.
PROMPT
)" --quality medium --size 1536x1024 -o /tmp/generated/mug-hero.png
```

For long prompts, prefer a prompt file:

```sh
image-gen --prompt-file /tmp/prompts/mug-hero.txt \
  --quality medium \
  --size 1536x1024 \
  -o /tmp/generated/mug-hero.png
```

## Choosing CLI Options

Use `--quality low` for drafts, quick variants, and high-volume exploration.
Use `--quality medium` for most polished outputs. Use `--quality high` when the
image has small text, dense labels, diagrams, close-up faces, product labels,
or needs maximum fidelity.

Use `--n` when exploring alternatives:

```sh
image-gen "Four distinct logo concepts for Field & Flour, a local bakery. Clean original marks, simple shapes, warm and timeless, plain background, no watermark." \
  --n 4 \
  --quality medium \
  --out-dir /tmp/generated/logos
```

Use explicit `--size` when the asset has a known destination:

```sh
image-gen "A square app icon for a calm journaling app. Simple symbol, readable at small sizes, no text." \
  --size 1024x1024 \
  -o /tmp/generated/journal-icon.png

image-gen "A pitch-deck slide titled \"Market Opportunity\" with a clean chart and readable labels." \
  --size 1536x864 \
  --quality high \
  -o /tmp/generated/market-slide.png
```

Useful sizes:

- `1024x1024` for square icons and general images.
- `1024x1536` for portrait posters, mobile UI, book covers, and product cards.
- `1536x1024` for landscape hero images and wide scenes.
- `1536x864` for slide-like or 16:9 outputs.
- `2560x1440` for QHD/widescreen outputs when you need more resolution.

## Prompting Fundamentals

Be concrete. Instead of "make it nice", describe the actual visual result:
material, shape, texture, light, camera angle, layout, mood, and intended use.

For photorealism, explicitly say `photorealistic` or `real photograph`. Add
grounding details like natural lighting, real texture, imperfect materials,
subtle shadows, believable scale, and ordinary camera framing.

For layout-sensitive images, name positions:

```text
logo in the top-right
subject centered
empty space on the left
headline at the top
three equal panels
chart below the title
```

For people, describe pose, scale, gaze, and action:

```text
full body visible, feet included
looking down at the open book, not at the camera
hands naturally holding the handlebars
child-sized relative to the table
```

For constraints, say what must not change or appear:

```text
no watermark
no extra text
no logos or trademarks
preserve the original layout
keep the camera angle unchanged
change only the chair fabric
```

## Text Inside Images

Text works best when it is explicit, short, and constrained.

Put exact text in quotes:

```sh
image-gen "$(cat <<'PROMPT'
Create a realistic billboard mockup for a shampoo product.
Billboard text, exact and verbatim:
"Fresh and clean"
Typography: bold sans-serif, high contrast, centered, clean kerning.
Ensure the text appears once and is perfectly legible.
No extra characters, no watermark, no additional slogans.
PROMPT
)" --quality high --size 1024x1536 -o /tmp/generated/billboard.png
```

For uncommon brand names or tricky spellings, spell them out:

```text
Render the brand name exactly as "QORVA". The letters are Q O R V A.
```

Use `--quality high` for small text, dense diagrams, labels, legends, axes,
footnotes, and multi-font layouts.

## Generating New Images

### Photorealistic Scenes

Prompt as if a real photo is being captured:

```sh
image-gen "$(cat <<'PROMPT'
Create a photorealistic candid photograph of an elderly sailor standing on a small fishing boat.
Medium close-up at eye level, natural coastal daylight, subtle film grain.
Weathered skin with visible wrinkles, sun texture, worn jacket fabric, everyday detail.
The image should feel honest and unposed, like a real photograph.
No glamorization, no heavy retouching, no watermark.
PROMPT
)" --quality medium --size 1024x1536 -o /tmp/generated/sailor.png
```

### UI Mockups

Describe the product as if it already exists. Focus on layout, hierarchy,
spacing, typography, and real interface elements.

```sh
image-gen "$(cat <<'PROMPT'
Create a realistic mobile app UI mockup for a local farmers market.
Show a simple header, today's vendors with small photos and categories, a "Today's specials" section, and location/hours.
Design it to be practical and easy to use: white background, subtle natural accent colors, clear typography, minimal decoration.
It should look like a real shipped app, not concept art.
Place the UI mockup in an iPhone frame.
PROMPT
)" --quality medium --size 1024x1536 -o /tmp/generated/farmers-market-ui.png
```

### Infographics, Slides, Charts, and Diagrams

Write prompts like an artifact spec. Include the audience, title, required
labels, numbers, visual hierarchy, and style constraints.

```sh
image-gen "$(cat <<'PROMPT'
Create one pitch-deck slide titled "Market Opportunity".
Canvas: 16:9 landscape slide, clean white background, modern sans-serif typography.
Include:
- TAM/SAM/SOM concentric-circle diagram in muted blues and grays
- TAM: $42B
- SAM: $8.7B
- SOM: $340M
- A clean bar chart showing growth from 2021 to 2026
- Footnote: "Internal analysis"
Make text highly readable with polished spacing and clear data hierarchy.
Avoid clip art, stock photography, decorative clutter, and generic gradients.
PROMPT
)" --quality high --size 1536x864 -o /tmp/generated/market-opportunity.png
```

## Editing With Reference Images

Passing `--image` switches the CLI to edit/reference mode:

```sh
image-gen "Restyle this screenshot as a polished SaaS dashboard. Preserve the original information hierarchy and layout." \
  --image /tmp/inputs/screenshot.png \
  --quality medium \
  -o /tmp/generated/dashboard.png
```

For edits, be surgical:

```text
Change only X.
Preserve A, B, C.
Do not change D, E, F.
Keep everything else the same.
```

### Object or Interior Swaps

```sh
image-gen "$(cat <<'PROMPT'
Replace only the white dining chairs with natural wood chairs.
Preserve the camera angle, room lighting, floor shadows, wall color, table, and surrounding objects.
Keep every other aspect of the image unchanged.
Make the new chairs photorealistic with believable contact shadows and wood texture.
PROMPT
)" --image /tmp/inputs/kitchen.jpeg --quality medium --size 1536x1024 -o /tmp/generated/kitchen-wood-chairs.png
```

### Product Cleanup

```sh
image-gen "$(cat <<'PROMPT'
Extract the product from the input image and place it on a plain white opaque background.
Output: centered product, crisp silhouette, no halos or fringing.
Preserve product geometry and label legibility exactly.
Add only light polishing and a subtle realistic contact shadow.
Do not restyle the product.
PROMPT
)" --image /tmp/inputs/shampoo.png --quality medium -o /tmp/generated/shampoo-clean.png
```

If you need transparency, generate the clean opaque product image first, then
run a separate background-removal step. This CLI does not expose transparent
background generation.

### Masks

Use `--mask` when only a region should change:

```sh
image-gen "Replace the masked wall area with matte sage-green paint. Preserve furniture, lighting, shadows, camera angle, and all unmasked regions exactly." \
  --image /tmp/inputs/room.png \
  --mask /tmp/inputs/wall-mask.png \
  --quality medium \
  -o /tmp/generated/room-sage-wall.png
```

The mask applies to the first `--image`.

## Multi-Image Referencing

Use multiple `--image` flags when you need style transfer, product compositing,
try-on, or combining elements. In the prompt, refer to images by order:

```sh
image-gen "$(cat <<'PROMPT'
Image 1 is the room photo. Image 2 is the chair product photo.
Place the chair from Image 2 into the dining area of Image 1.
Match the lighting, perspective, scale, floor contact shadows, and color temperature.
Preserve Image 1's room layout, camera angle, background, table, windows, and wall color.
Do not add extra furniture, text, logos, or watermarks.
PROMPT
)" \
  --image /tmp/inputs/room.png \
  --image /tmp/inputs/chair.png \
  --quality medium \
  -o /tmp/generated/room-with-chair.png
```

For style transfer:

```sh
image-gen "Apply the visual style of Image 2 to the subject in Image 1. Preserve the subject pose, silhouette, and main composition. Use Image 2 only for palette, brushwork, texture, and lighting style." \
  --image /tmp/inputs/subject.png \
  --image /tmp/inputs/style-reference.png \
  --quality medium \
  -o /tmp/generated/styled-subject.png
```

## Character and Series Consistency

For a reusable character, first generate a character anchor. Then pass that
anchor as a reference image for future scenes.

```sh
image-gen "$(cat <<'PROMPT'
Create a children's book illustration introducing a main character.
Character: a kind young forest guide wearing a simple green hooded tunic, soft brown boots, and a small belt pouch.
Style: hand-painted watercolor look, soft outlines, warm earthy colors, whimsical and friendly.
Constraints: original character, no text, no watermark, plain forest background, full body visible.
PROMPT
)" --quality medium --size 1024x1536 -o /tmp/generated/forest-guide-anchor.png
```

Continue the series:

```sh
image-gen "$(cat <<'PROMPT'
Continue the children's book story using the same character from Image 1.
Scene: the same forest guide gently helping a frightened squirrel out of a fallen tree after a winter storm.
Character consistency: same green hooded tunic, same facial features, same proportions, same color palette, same warm personality.
Style consistency: same watercolor look, soft outlines, warm earthy colors.
No text, no watermark.
PROMPT
)" --image /tmp/generated/forest-guide-anchor.png --quality medium --size 1024x1536 -o /tmp/generated/forest-guide-page-2.png
```

## Iteration Strategy

Start simple, inspect the image, then make one change at a time. Good follow-up
edits look like this:

```sh
image-gen "Keep the same composition, subject, outfit, and background. Make only the lighting warmer and softer. Do not add text or new objects." \
  --image /tmp/generated/draft.png \
  --quality medium \
  -o /tmp/generated/draft-warmer.png
```

If the model drifts, repeat the preservation constraints in the next prompt.
Do not assume it will remember every critical detail unless you restate it.

## Quick Checklist

Before running `image-gen`, check:

- Did I say what the image is for?
- Did I describe the subject, setting, style, and composition?
- Did I specify exact text in quotes if text matters?
- Did I list what must be preserved for edits?
- Did I list what must not appear?
- Did I choose `--quality high` for small text, dense diagrams, labels, or final assets?
- Did I use `--image` order clearly when passing multiple references?
- Did I choose an output path that the next agent/tool can use?