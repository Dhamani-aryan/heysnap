export { HeySnapCodeViewer } from "./HeySnapCodeViewer";
export type { HeySnapCodeViewerProps } from "./HeySnapCodeViewer";
export type { HeySnapCodeSrc } from "./useResolvedCodeSource";

// Custom Monaco themes registered automatically by the viewer. Re-exported
// so consumers can pass the ids straight to the `theme` prop without
// hard-coding the strings on the call site.
export {
  defineHeysnapThemes,
  HEYSNAP_LIGHT_ID,
  HEYSNAP_DARK_ID,
} from "./heysnapMonacoThemes";
