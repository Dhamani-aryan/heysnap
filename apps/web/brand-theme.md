# HeySnap Brand Theme

This document is the source of truth for the current HeySnap brand theme: logo, color system, typography, spacing/layout, visual assets, motion, and loading states.

## Logo

HeySnap uses four approved logo variants.

### Dark Theme Logos

Use on dark backgrounds such as `#070707` and `#0F0F10`.

| Variant | Color | Assets |
| --- | --- | --- |
| Primary blue | `#408CFF` | `logo/408CFF/plain.png`, `logo/408CFF/animated.gif` |
| Monochrome | `#F7F7F7` | `logo/F7F7F7/plain.png`, `logo/F7F7F7/animated.gif` |

### Light Theme Logos

Use on light backgrounds such as `#FCFCFD` and `#FFFFFF`.

| Variant | Color | Assets |
| --- | --- | --- |
| Primary blue | `#2563EB` | `logo/2563EB/plain.png`, `logo/2563EB/animated.gif` |
| Monochrome | `#0F0F0F` | `logo/0F0F0F/plain.png`, `logo/0F0F0F/animated.gif` |

### Logo Usage

- Keep logos transparent.
- Preserve original proportions.
- Use the correct variant for the background theme.
- Minimum clear space: 25% of the logo width on all sides.
- Minimum width: 32px for small UI, 40px for navigation, 64px+ for marketing/social.
- Use `plain.png` for static UI and documents.
- Use `animated.gif` for loading, splash, onboarding, and short branded moments.
- Do not stretch, rotate, recolor, crop, add effects, or place on untested low-contrast backgrounds.

## Color System

### Dark Theme

| Role | Color |
| --- | --- |
| Sidebar / landing background | `#070707` |
| Dashboard main background | `#0F0F10` |
| Sidebar active background | `#1D1D1F` |
| Sidebar hover background | `#141415` |
| Sidebar active text/icon | `#FFFFFF` |
| Sidebar inactive text/icon | `#919293` |
| Main heading text | `#FFFFFF` |
| Subheading text | `#949496` |
| Card background | `#171718` |
| Card text | `#FFFFFF` |
| Placeholder text | `#5A5B5D` |
| Primary action | `#408CFF` |
| Primary action hover | `#4A93FF` |
| Secondary button background | `#232325` |
| Secondary button hover | `#262628` |
| Disabled button background | `#2A2A2C` |
| Ghost/focus/link | `#8AA7D6` |
| Border/divider | `#1F2021` |
| Input background | `#171718` |
| Input text | `#E4E4E7` |
| Dialog/popover/toast background | `#1B1B1C` |
| Tooltip background | `#171718` |
| Success icon background | `#27A644` |
| Failure icon background | `#E5484D` |

### Light Theme

| Role | Color |
| --- | --- |
| Sidebar background | `#F3F3F4` |
| Dashboard / landing background | `#FCFCFD` |
| Sidebar active background | `#E5E5E6` |
| Sidebar hover background | `#EBEBEC` |
| Sidebar active text/icon | `#1B1B1B` |
| Sidebar inactive text/icon | `#5A5A5C` |
| Main heading text | `#1B1B1B` |
| Subheading text | `#5D5D5F` |
| Card background | `#FFFFFF` |
| Card text | `#1B1B1B` |
| Placeholder text | `#A0A1A2` |
| Primary action | `#2563EB` |
| Primary action hover | `#1D5FEF` |
| Secondary button background | `#FFFFFF` |
| Secondary button hover | `#F6F6F7` |
| Disabled button background | `#F1F1F2` |
| Ghost/focus/link | `#6F7EC2` |
| Border/divider | `#E8E8E8` |
| Input background | `#FFFFFF` |
| Input text | `#1B1B1B` |
| Dialog/popover/toast/tooltip background | `#FFFFFF` |
| Success icon background | `#27A644` |
| Failure icon background | `#E5484D` |

## Typography

HeySnap uses **Geist Sans** for product UI, dashboard, landing pages, buttons, forms, navigation, and marketing copy. **Geist Mono** may be used for code, technical IDs, keyboard shortcuts, token names, and developer-facing labels.

Fallback stack:

```css
font-family: "Geist", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

Selected direction: **Option B, balanced**. The type should feel clean, minimal, modern, slightly compact, and not overly bold.

| Role | Size | Line Height | Weight | Letter Spacing | Usage |
| --- | ---: | ---: | ---: | ---: | --- |
| Hero | 52px | 58px | 560 | -0.06em | Landing-page hero headlines |
| Page title | 32px | 38px | 560 | -0.045em | Dashboard/page-level headings |
| Section title | 22px | 30px | 550 | -0.035em | Section headings |
| Card title | 16px | 24px | 550 | -0.02em | Card and panel titles |
| Body | 15px | 24px | 400 | 0 | Normal paragraph and dashboard copy |
| Small | 13px | 20px | 400 | 0 | Helper text, descriptions, secondary labels |
| Caption | 12px | 16px | 400 | 0 | Metadata, timestamps, compact labels |
| Button | 13px | 18px | 520 | 0 | Button text |
| Navigation | 13px | 18px | 450 | 0 | Sidebar and menu items |
| Input | 14px | 22px | 400 | 0 | Text inside fields |

Mobile adjustments:

- Hero: 40px / 44px
- Page title: 28px / 34px
- Section title: 20px / 28px
- Body/small/caption stay the same.

## Spacing and Layout

Selected direction: **Option C, spacious**. The layout should feel clean, calm, premium, minimal, and spacious while still working for dashboard productivity.

Use a **4px base unit** with an **8px visual rhythm**.

| Token | Value | Usage |
| --- | ---: | --- |
| `space.2xs` | 4px | Tiny icon/text adjustments |
| `space.xs` | 8px | Icon-text gaps, tight internal gaps |
| `space.sm` | 12px | Small component gaps |
| `space.md` | 16px | Standard internal padding |
| `space.lg` | 20px | Larger component padding |
| `space.xl` | 24px | Card padding, section element gaps |
| `space.2xl` | 32px | Page/content padding, group gaps |
| `space.3xl` | 40px | Spacious page padding, section spacing |
| `space.4xl` | 48px | Large section gaps |
| `space.5xl` | 64px | Landing section spacing |
| `space.6xl` | 80px | Large marketing spacing |
| `space.7xl` | 96px | Hero/major section spacing |

### Layout Values

| Role | Value |
| --- | ---: |
| Sidebar width | 236px |
| Sidebar padding | 14px-18px |
| Main dashboard padding | 40px |
| Mobile page padding | 18px-24px |
| Dashboard card grid gap | 16px |
| Section gap | 32px-48px |
| Settings panel outer padding | 40px |
| Settings row minimum height | 76px |
| Settings row padding | 18px 20px |

### Radius

| Token | Value | Usage |
| --- | ---: | --- |
| `radius.xs` | 6px | Tiny controls, compact badges |
| `radius.sm` | 8px | Sidebar nav items, small controls |
| `radius.md` | 10px | Buttons, select pills |
| `radius.lg` | 12px | Inputs, compact cards |
| `radius.xl` | 14px | Dashboard cards |
| `radius.2xl` | 18px | Large cards, app shells, dialogs |
| `radius.pill` | 999px | Pills, badges, toggles |

## Visual Assets

### Icons

HeySnap uses **HugeIcons** as the default icon source.

| Rule | Decision |
| --- | --- |
| Style | Consistent outline/rounded style |
| Default size | 18px or 20px |
| Larger feature size | 24px |
| Stroke feel | Light, clean, consistent, around 1.5-2px visually |
| Color behavior | Icons inherit text color by default |
| Primary emphasis | Use theme primary blue only for key actions or selected emphasis |

Avoid mixing icon libraries, filled/duotone/sharp styles, unclear icon-only actions, and excessive primary-blue icons.

### Motion

Motion should be restrained, fast, purposeful, and polished. Use it for feedback, spatial clarity, state changes, and preventing jarring changes, not decoration.

| Principle | Rule |
| --- | --- |
| Frequent actions | Reduce or remove animation |
| Keyboard actions | No animation |
| UI duration | Usually under 300ms |
| Button press | 100-160ms |
| Tooltip/popover | 125-200ms |
| Dropdown/select | 150-250ms |
| Modal/drawer | 200-500ms |
| Properties | Prefer transform and opacity |
| Accessibility | Respect reduced-motion settings |

Motion easing:

```css
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
```

Buttons and pressable elements should use subtle press feedback:

```css
.button {
  transition: transform 160ms var(--ease-out);
}

.button:active {
  transform: scale(0.97);
}
```

Popover/dropdown motion should start from `scale(0.95)` or `scale(0.96)`, never `scale(0)`, and should animate from the trigger/origin where possible.

### Loading States

HeySnap uses simple **shadcn-style skeletons** for normal loading states.

Reference: https://ui.shadcn.com/docs/components/radix/skeleton

| Context | Loading Treatment |
| --- | --- |
| Dashboard cards | Skeleton blocks matching card layout |
| Lists/tables | Row skeletons |
| Text/content areas | Line skeletons |
| Buttons | Button-level loading state |
| Full-page brand/splash moments | Animated logo may be used sparingly |

Skeleton colors:

| Theme | Base | Highlight |
| --- | --- | --- |
| Dark | `#232325` | `#2A2A2C` |
| Light | `#E8E8E8` | `#F1F1F2` |

Skeleton animation should be subtle, low contrast, about 1.2s-1.6s, and disabled/reduced for `prefers-reduced-motion`.
