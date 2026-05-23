# Image Generation Skill

Generates or edits images for the current project (for example website assets, game assets, UI mockups, product mockups, wireframes, logo design, photorealistic images, or infographics) using the globally available image-gen cli.

Don't treat this as an AI image tool. It is very versatile and can give very realistic images and perfect very accurate edits as well.
Avoid using this tool when the editing can directly be done through code.

# image-gen CLI

The core contract is:

```sh
image-gen <prompt> [options]
```

It returns the generated image path or paths on `stdout`, one path per line.

```sh
image_path="$(image-gen "A clean product photo of a matte black coffee mug" -o /tmp/generated/mug.png)"
```

## Common Commands

Generate one image from a text prompt:

```sh
image-gen "A polished product photo of a matte black coffee mug on a white desk" \
  -o /tmp/generated/mug.png
```

Generate to an automatically named file in the current directory:

```sh
image-gen "A minimal app icon for a calendar app"
```

Generate multiple images:

```sh
image-gen "Calm finance app logo concepts, premium and simple" \
  --n 3 \
  --out-dir logos
```

Use one reference image:

```sh
image-gen "Restyle this screenshot as a polished SaaS dashboard" \
  --image /tmp/inputs/screenshot.png \
  -o /tmp/generated/dashboard.png
```

Use multiple reference images:

```sh
image-gen "Create a gift basket containing the items from these references" \
  --image lotion.png \
  --image candle.png \
  --image soap.png \
  --image ribbon.png \
  -o basket.png
```

Edit an image with a mask:

```sh
image-gen "Replace the masked area with a small indoor pool" \
  --image /tmp/inputs/room.png \
  --mask /tmp/inputs/mask.png \
  -o /tmp/generated/room-edit.png
```

Read a long prompt from a file:

```sh
image-gen --prompt-file prompt.txt -o result.png
```

Show the installed version:

```sh
image-gen --version
image-gen -V
```

Request JPEG output:

```sh
image-gen "A fast-loading article hero image of a modern workspace" \
  --format jpeg \
  --compression 65 \
  -o hero.jpg
```

## Options

```text
-o, --output <path>          Output file for one image
    --out-dir <dir>          Output directory, required when --n > 1
-i, --image <path>           Reference/input image, repeatable up to 16 times
    --mask <path>            Mask image for editing the first input image
    --size <size>            auto or WIDTHxHEIGHT, default: auto
    --quality <quality>      auto | low | medium | high, default: auto
    --format <format>        png | jpeg, default: output extension or png
    --compression <0-100>    jpeg only
    --n <count>              Number of images, 1-10, default: 1
    --moderation <value>     auto | low, default: auto
    --prompt-file <path>     Read prompt from file
-h, --help                   Show help
-V, --version                Show version
```

## Behavior

If no `--image` is passed, `image-gen` creates a new image from the text prompt.

If one or more `--image` flags are passed, `image-gen` sends an edit/reference
image request. The prompt should describe the desired output, not just the input.

If `--mask` is passed, the mask applies to the first `--image`. The mask and
first image should have the same dimensions. Use a PNG mask with an alpha
channel.

If `--output` is omitted, files are named like:

```text
image-20260509-101112Z-01.png
```

`--output` accepts either a relative path or a full absolute path. Parent
directories are created automatically:

```sh
image-gen "A small pixel-art save icon" -o icons/save.png
image-gen "A small pixel-art save icon" -o /tmp/generated/icons/save.png
```

If `--n` is greater than `1`, use `--out-dir` instead of `--output`.

## Size

`--size` defaults to `auto`.

You can also pass explicit dimensions:

```sh
image-gen "A cinematic landscape poster" --size 1536x1024 -o poster.png
image-gen "A square app icon" --size 1024x1024 -o icon.png
image-gen "A portrait poster" --size 1024x1536 -o portrait.png
```

Explicit sizes must follow GPT Image 2 constraints:

- Width and height must be multiples of `16`.
- Maximum edge length is `3840px`.
- Long edge to short edge ratio must not exceed `3:1`.
- Total pixels must be between `655360` and `8294400`.

## Quality

`--quality` defaults to `auto`.

Use `low` for fast drafts, `medium` for balanced output, and `high` for final
assets:

```sh
image-gen "A rough thumbnail concept for a travel app" --quality low -o draft.png
image-gen "A final polished app-store hero graphic" --quality high -o final.png
```

## Format And Compression

Supported formats:

- `png`
- `jpeg`

If `--format` is omitted and `--output` has a known extension, the extension is
used. For example, `-o hero.jpg` requests JPEG.

`--compression` is only valid with `jpeg`:

```sh
image-gen "A blog cover image" --format jpeg --compression 70 -o cover.jpg
```

## Moderation

`--moderation` controls GPT Image moderation strictness:

- `auto`: default filtering
- `low`: less restrictive filtering

```sh
image-gen "A dramatic editorial fashion image" --moderation auto -o fashion.png
```

## Limits

- Prompt length: up to `32000` characters.
- Reference images: up to `16` `--image` flags.
- Output count: `--n` supports `1` through `10`.
- Input image files: `50MB` or smaller.
- Transparent backgrounds are not exposed because this CLI is scoped to
  `gpt-image-2` only.
- The model is fixed to `gpt-image-2`; there is no `--model` flag.

## Script Usage

If need to write scripts to generate images, use `stdout` for paths:

```sh
result="$(image-gen "A small pixel-art save icon" -o save-icon.png)"
echo "Generated: $result"
```

Multiple outputs:

```sh
image-gen "Four onboarding illustrations for a productivity app" \
  --n 4 \
  --out-dir onboarding \
  > generated-images.txt
```

Then read each path:

```sh
while read -r path; do
  echo "Generated $path"
done < generated-images.txt
```

## Reference map
- `references/prompting.md`: Prompting guides to get the best results.