import { StyleSheet, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';

export const TILE_ROW_HEIGHT = 123;
export const GRID_VERTICAL_PADDING = 24;
const GRID_HORIZONTAL_PADDING = 8;

export type FilePalette = {
  background: string;
  directoryText: string;
  directoryPressed: string;
  emptyInlineText: string;
  errorText: string;
  inputBackground: string;
  inputBorder: string;
  inputPlaceholder: string;
  itemLabelText: string;
  itemPressed: string;
  navBackground: string;
  navIcon: string;
  navOutline: string;
  navShadow: string;
  stateText: string;
};

export const filePalettes = {
  light: {
    background: '#ffffff',
    directoryText: 'rgba(0, 0, 0, 0.78)',
    directoryPressed: 'rgba(0, 0, 0, 0.045)',
    emptyInlineText: 'rgba(0, 0, 0, 0.34)',
    errorText: '#c13e3e',
    inputBackground: '#f6f6f6',
    inputBorder: 'rgba(0, 0, 0, 0.12)',
    inputPlaceholder: 'rgba(0, 0, 0, 0.36)',
    itemLabelText: 'rgba(0, 0, 0, 0.82)',
    itemPressed: 'rgba(0, 0, 0, 0.04)',
    navBackground: '#f9f9f9',
    navIcon: 'rgba(0, 0, 0, 0.5)',
    navOutline: 'rgba(0, 0, 0, 0.035)',
    navShadow: 'rgba(0, 0, 0, 0.08)',
    stateText: 'rgba(0, 0, 0, 0.46)',
  },
  dark: {
    background: '#000000',
    directoryText: 'rgba(255, 255, 255, 0.82)',
    directoryPressed: 'rgba(255, 255, 255, 0.08)',
    emptyInlineText: 'rgba(255, 255, 255, 0.32)',
    errorText: '#ff8a8a',
    inputBackground: '#171717',
    inputBorder: 'rgba(255, 255, 255, 0.16)',
    inputPlaceholder: 'rgba(255, 255, 255, 0.36)',
    itemLabelText: 'rgba(255, 255, 255, 0.82)',
    itemPressed: 'rgba(255, 255, 255, 0.07)',
    navBackground: '#1a1a1a',
    navIcon: '#a3a3a3',
    navOutline: 'rgba(255, 255, 255, 0.06)',
    navShadow: 'rgba(0, 0, 0, 0.08)',
    stateText: 'rgba(255, 255, 255, 0.46)',
  },
} as const satisfies Record<'light' | 'dark', FilePalette>;

export type FileStyles = {
  content: ViewStyle;
  directoryTab: ViewStyle;
  directoryTabPressed: ViewStyle;
  directoryTitle: TextStyle;
  emptyContent: ViewStyle;
  emptyInlineText: TextStyle;
  fileIcon: ImageStyle;
  finderItem: ViewStyle;
  finderItemCell: ViewStyle;
  finderItemHost: ViewStyle;
  finderItemIcon: ViewStyle;
  finderItemLabel: ViewStyle;
  finderItemLabelText: TextStyle;
  finderItemPressed: ViewStyle;
  folderIcon: ImageStyle;
  headerMenuButton: ViewStyle;
  headerMenuHost: ViewStyle;
  headerMenuIcon: TextStyle;
  navPill: ViewStyle;
  nameSheetActions: ViewStyle;
  nameSheetBackdrop: ViewStyle;
  nameSheetButton: ViewStyle;
  nameSheetButtonDisabled: ViewStyle;
  nameSheetButtonPressed: ViewStyle;
  nameSheetButtonText: TextStyle;
  nameSheetCard: ViewStyle;
  nameSheetHandle: ViewStyle;
  nameSheetHandleBar: ViewStyle;
  nameSheetHintRow: ViewStyle;
  nameSheetHintText: TextStyle;
  nameSheetInput: TextStyle;
  nameSheetPanel: ViewStyle;
  nameSheetPrimaryButton: ViewStyle;
  nameSheetPrimaryButtonText: TextStyle;
  nameSheetSecondaryButton: ViewStyle;
  nameSheetStickyContainer: ViewStyle;
  nameSheetTitle: TextStyle;
  safeArea: ViewStyle;
  shell: ViewStyle;
  state: ViewStyle;
  stateText: TextStyle;
  tiles: ViewStyle;
  toolbar: ViewStyle;
  toolbarButton: ViewStyle;
  toolbarButtonDisabled: ViewStyle;
  toolbarButtonPressed: ViewStyle;
  toolbarInner: ViewStyle;
};

export const createFileStyles = (palette: FilePalette, columnCount: number, viewportWidth: number) => {
  const tileWidth = Math.max(0, (viewportWidth - GRID_HORIZONTAL_PADDING) / columnCount);

  return StyleSheet.create<FileStyles>({
    shell: {
      flex: 1,
      backgroundColor: palette.background,
    },
    safeArea: {
      backgroundColor: 'transparent',
    },
    toolbar: {
      height: 64,
      alignItems: 'flex-start',
      justifyContent: 'flex-start',
      paddingTop: 8,
      paddingHorizontal: 8,
      backgroundColor: 'transparent',
    },
    toolbarInner: {
      width: '100%',
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    toolbarButton: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    toolbarButtonPressed: {
      opacity: 0.72,
    },
    toolbarButtonDisabled: {
      opacity: 0.25,
    },
    navPill: {
      width: 80,
      height: 40,
      flexShrink: 0,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      borderRadius: 999,
      backgroundColor: palette.navBackground,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.navOutline,
      shadowColor: palette.navShadow,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 1,
      shadowRadius: 16,
      elevation: 3,
    },
    directoryTab: {
      minWidth: 0,
      flex: 1,
      alignItems: 'flex-start',
      justifyContent: 'center',
      overflow: 'hidden',
      borderRadius: 6,
      paddingVertical: 4,
      paddingHorizontal: 8,
    },
    directoryTabPressed: {
      backgroundColor: palette.directoryPressed,
    },
    directoryTitle: {
      maxWidth: '100%',
      minWidth: 0,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: 600,
      letterSpacing: 0,
    },
    headerMenuHost: {
      width: 46,
      height: 40,
      flexShrink: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerMenuButton: {
      width: 46,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 999,
      backgroundColor: palette.navBackground,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.navOutline,
      shadowColor: palette.navShadow,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 1,
      shadowRadius: 16,
      elevation: 3,
    },
    headerMenuIcon: {
      color: palette.navIcon,
    },
    nameSheetBackdrop: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    nameSheetStickyContainer: {
      width: '100%',
      paddingHorizontal: 12,
    },
    nameSheetCard: {
      borderRadius: 18,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.18,
      shadowRadius: 24,
      elevation: 12,
    },
    nameSheetHandle: {
      width: '100%',
      alignItems: 'center',
      paddingTop: 8,
      paddingBottom: 4,
    },
    nameSheetHandleBar: {
      width: 36,
      height: 4,
      borderRadius: 2,
      opacity: 0.6,
    },
    nameSheetPanel: {
      width: '100%',
      paddingTop: 6,
      paddingRight: 20,
      paddingBottom: 20,
      paddingLeft: 20,
    },
    nameSheetTitle: {
      fontSize: 18,
      lineHeight: 24,
      fontWeight: 700,
      letterSpacing: 0,
      marginBottom: 14,
    },
    nameSheetInput: {
      height: 46,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 10,
      paddingHorizontal: 14,
      fontSize: 16,
      lineHeight: 20,
      fontWeight: 500,
      letterSpacing: 0,
    },
    nameSheetHintRow: {
      minHeight: 28,
      justifyContent: 'center',
    },
    nameSheetHintText: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: 500,
      letterSpacing: 0,
    },
    nameSheetActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 10,
    },
    nameSheetButton: {
      minWidth: 96,
      height: 42,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 999,
      paddingHorizontal: 18,
    },
    nameSheetSecondaryButton: {
      backgroundColor: palette.navBackground,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.navOutline,
    },
    nameSheetPrimaryButton: {
      backgroundColor: '#0a84ff',
    },
    nameSheetButtonPressed: {
      opacity: 0.74,
    },
    nameSheetButtonDisabled: {
      opacity: 0.44,
    },
    nameSheetButtonText: {
      fontSize: 15,
      lineHeight: 20,
      fontWeight: 700,
      letterSpacing: 0,
    },
    nameSheetPrimaryButtonText: {
      color: '#ffffff',
      fontSize: 15,
      lineHeight: 20,
      fontWeight: 700,
      letterSpacing: 0,
    },
    content: {
      flex: 1,
      backgroundColor: palette.background,
    },
    tiles: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignContent: 'flex-start',
      paddingTop: 12,
      paddingRight: 4,
      paddingBottom: 12,
      paddingLeft: 4,
      backgroundColor: palette.background,
    },
    finderItem: {
      width: tileWidth,
      alignItems: 'center',
      gap: 6,
      borderRadius: 8,
      paddingTop: 12,
      paddingRight: 8,
      paddingBottom: 8,
      paddingLeft: 8,
    },
    finderItemCell: {
      width: tileWidth,
      height: TILE_ROW_HEIGHT,
      alignItems: 'center',
      justifyContent: 'flex-start',
    },
    finderItemHost: {
      width: tileWidth,
      height: TILE_ROW_HEIGHT,
    },
    finderItemPressed: {
      backgroundColor: palette.itemPressed,
    },
    finderItemIcon: {
      width: 100,
      maxWidth: 100,
      height: 78,
      flexShrink: 0,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 8,
    },
    folderIcon: {
      width: 87.4,
      height: 76,
    },
    fileIcon: {
      width: 57,
      height: 76,
    },
    finderItemLabel: {
      maxWidth: 102,
      overflow: 'hidden',
      borderRadius: 999,
      paddingVertical: 2,
      paddingHorizontal: 8,
    },
    finderItemLabelText: {
      fontSize: 12,
      lineHeight: 15,
      fontWeight: 500,
      letterSpacing: 0,
    },
    state: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 48,
      paddingHorizontal: 24,
      backgroundColor: palette.background,
    },
    stateText: {
      maxWidth: 384,
      textAlign: 'center',
      fontSize: 14,
      lineHeight: 20,
      fontWeight: 500,
    },
    emptyContent: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      backgroundColor: palette.background,
    },
    emptyInlineText: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: 500,
      letterSpacing: 0,
      textAlign: 'center',
    },
  });
};
