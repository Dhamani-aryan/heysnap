# DOCX Design Guidelines

Use this reference before creating or restyling documents where visual quality matters. The goal is a professional Word document that reads well in Word, Google Docs, PDF export, and print.

## Design Workflow

1. Identify the document type and audience before choosing styles.
2. Pick a recipe below; adjust only when the user's brand/template requires it.
3. Define document styles first: Normal, Title, Subtitle, Heading1-3, table styles, captions, headers, and footers.
4. Build content using real Word structures: heading styles, real lists, tables, fields/TOC, tab stops, paragraph borders.
5. Validate the DOCX, then visually inspect a PDF/image preview for page balance, table fit, spacing, and header/footer alignment.

## Core Principles

### White Space

- Use white space as a layout tool, not leftover space.
- Business documents usually look best with 1 inch margins.
- Dense internal documents can use 0.75 inch margins, but avoid going below that unless the user requires it.
- Formal academic, thesis, and premium proposal layouts can use 1.15-1.25 inch margins.
- Body line spacing should usually be 1.12-1.2. Use 1.5 or double spacing only for academic/legal requirements.
- Body paragraphs need either first-line indentation or paragraph spacing, not both by default.

Practical defaults:

| Use case | Margins | Body size | Line spacing | Body spacing |
|---|---:|---:|---:|---:|
| Business report | 1 in | 11 pt | 1.15 | 6-8 pt after |
| Executive brief | 0.75-0.9 in | 10.5-11 pt | 1.12 | 6 pt after |
| Academic paper | 1 in | 12 pt | required style | per style guide |
| Letter/memo | 1 in | 11-12 pt | 1.12-1.15 | 6 pt after |

### Hierarchy

Hierarchy must be visible at a glance. Use size, weight, spacing, and a restrained accent color.

Recommended scale for business documents:

| Element | Size | Weight | Spacing |
|---|---:|---|---|
| Title | 22-28 pt | bold | 12-18 pt after |
| H1 | 18-22 pt | bold | 18-24 pt before, 6-10 pt after |
| H2 | 14-16 pt | bold | 14-18 pt before, 4-8 pt after |
| H3 | 12.5-14 pt | bold | 10-14 pt before, 3-6 pt after |
| Body | 10.5-12 pt | regular | 0-8 pt after |

Rules:

- Do not make H1/H2/H3 differ by only 1 pt; the hierarchy will look muddy.
- Do not make every heading huge; reserve large type for titles and major sections.
- Heading styles must include outline levels so TOC/navigation work.
- Use more spacing before a heading than after it, so the heading visually belongs to the content below.

### Typography

Use reliable system fonts unless the user provides a brand font.

Safe font sets:

| Document type | Headings | Body |
|---|---|---|
| Modern business | Aptos, Arial, Calibri | Aptos, Arial, Calibri |
| Conservative business | Arial | Arial |
| Legal/academic | Times New Roman | Times New Roman |
| Screen-readable report | Georgia | Arial or Verdana |
| Technical/spec document | Arial | Arial, plus Consolas for code |

Rules:

- Keep body text dark gray or black: `222222`, `2D2D2D`, `333333`, or `000000`.
- Avoid using more than two font families.
- Use all caps sparingly; if used for labels, add letter spacing only if the library supports it reliably.
- For code or fixed-width samples, use Consolas or Courier New and a subtle light-gray shading.

### Color

Color should clarify structure, not decorate the page.

Recommended palettes:

| Tone | Accent | Secondary | Body |
|---|---|---|---|
| Corporate navy | `1F3864` | `D9EAF7` | `333333` |
| Professional teal | `0F766E` | `DDF3F0` | `2D2D2D` |
| Executive charcoal | `404040` | `EDEDED` | `222222` |
| Academic neutral | `000000` | `F2F2F2` | `000000` |

Rules:

- Use one accent color for headings, rules, table headers, or callouts.
- Avoid saturated full-cell backgrounds except small labels or table headers.
- Use light fills (`F2F2F2`, `EAF3F8`, `E8F4F2`) with dark text.
- Do not use color as the only way to convey meaning.

### Alignment and Grid

- Keep left edges aligned. Titles may be centered, but body sections should usually align left.
- Use tab stops for same-line left/right text in headers, footers, signatures, and dates.
- Do not use empty tables as layout dividers; use paragraph borders.
- Do not add blank paragraphs for vertical spacing; use paragraph spacing before/after.
- Use section properties for page/column changes, not manual spacing.

## Document Recipes

### Modern Corporate Report

Use for proposals, strategy reports, operational reports, and client deliverables.

- Page: Letter or A4, 1 inch margins.
- Font: Arial or Aptos.
- Body: 11 pt, `333333`, 1.15 line spacing, 6 pt after.
- H1: 20 pt bold, `1F3864`, 20 pt before, 8 pt after.
- H2: 15 pt bold, `1F3864`, 14 pt before, 6 pt after.
- Tables: full content width, light blue/gray header fill, subtle borders, 4-6 pt cell padding.
- Header/footer: small, quiet, gray; page numbers in footer.

### Executive Brief

Use for short decision documents, board updates, one-to-three page summaries.

- Page: 0.75-0.9 inch margins to fit more content.
- Font: Arial/Aptos.
- Body: 10.5-11 pt, 1.12 line spacing.
- Use compact H1/H2 spacing.
- Use callout tables or shaded paragraphs sparingly for key decisions, risks, and recommendations.
- Keep the first page dense but not crowded; avoid large cover-title treatment.

### Academic / Formal Paper

Use when the user asks for APA/MLA/Chicago/thesis-like documents.

- Follow the requested style guide over visual preference.
- Default body: Times New Roman 12 pt unless a style guide says otherwise.
- Use real heading styles and outline levels.
- Keep colors minimal or black-only.
- Use captions and consistent table formatting.
- Do not create decorative covers unless requested.

### Legal / Contract

Use for contracts, policies, terms, affidavits, and formal review documents.

- Font: Times New Roman or Arial, 11-12 pt.
- Margins: 1 inch.
- Body: justified or left aligned depending on source/template.
- Numbering: use real multilevel numbering; never fake clause numbers in plain text unless preserving a source.
- Edits to existing legal documents should use tracked changes unless the user asks for a clean copy.
- Avoid color except redlines/comments and template-provided styles.

### Letter / Memo

Use for formal letters, internal memos, notices, and cover letters.

- Page: 1 inch margins.
- Font: Arial, Aptos, Calibri, or Times New Roman depending on tone.
- Body: 11-12 pt.
- Use tab stops for date/reference alignment where useful.
- Keep headers/footers subtle.
- For letterhead, align logo/contact details precisely and avoid large decorative bands unless provided by brand.

## Tables

Good tables are readable before they are decorative.

Rules:

- Use fixed DXA widths. Table width must equal the sum of column widths.
- Set both table `columnWidths` and each cell width.
- Add cell padding. Default: 80-120 DXA top/bottom and 120-180 DXA left/right.
- Repeat header rows for multi-page tables when supported.
- Use subtle borders: `CCCCCC`, `D9D9D9`, or similar.
- Use light header shading, not dark fills.
- Align text left, numbers right or decimal-aligned, percentages consistently.
- Keep table captions close to the table.

Avoid:

- Percentage widths for Google Docs compatibility-sensitive documents.
- Full-page tables with no breathing room.
- Heavy black borders on every cell unless the source/template requires it.
- Tables as fake layout boxes or horizontal rules.

## Images and Figures

- Size images to fit the content width while preserving aspect ratio.
- Use alt text when inserting images.
- Avoid tiny unreadable charts; if the chart matters, make it wide enough.
- Keep captions immediately below figures.
- Do not let images overflow margins or collide with headers/footers.

## Visual QA Checklist

Before delivering important documents:

- The title, H1, H2, H3, and body hierarchy is clear at 50% zoom.
- Pages are not walls of text; margins and paragraph spacing create breathing room.
- Tables fit within margins and have readable padding.
- Headers and footers align consistently and do not crowd body text.
- TOC entries appear when expected.
- Lists use real numbering/bullets and restart/continue correctly.
- Images preserve aspect ratio and have alt text.
- Colors are restrained and readable in grayscale.
- PDF/image preview matches the intended layout.
