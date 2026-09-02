import { WebWorkbook, type WebWorkbookProps } from "./internal/WebWorkbook";

/**
 * Props for {@link HeySnapXlsxViewer}. Re-export of {@link WebWorkbookProps} —
 * the contract is identical so consumers porting from the reference renderer
 * don't have to relearn anything.
 */
export interface HeySnapXlsxViewerProps extends WebWorkbookProps {}

/**
 * Read-only XLSX viewer rendered from a parsed workbook JSON (e.g. the output
 * of an OpenXml parser). Layers a glide-data-grid surface, a HugeIcons
 * toolbar, a formula bar, and a bottom sheet strip — same Geist Sans font
 * stack, same grid theme, same chart palette as the reference component.
 *
 * @example
 * ```tsx
 * import { HeySnapXlsxViewer } from "./components/viewers/HeySnapXlsxViewer";
 *
 * <HeySnapXlsxViewer workbook={parsedWorkbook} title="Q4-results.xlsx" />
 * ```
 */
export function HeySnapXlsxViewer(props: HeySnapXlsxViewerProps) {
  return <WebWorkbook {...props} />;
}
