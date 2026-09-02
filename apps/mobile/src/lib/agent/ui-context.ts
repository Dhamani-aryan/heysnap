import type { AgentUiContext } from './types';

export type MobileAgentUiContextSurface = 'filesystem' | 'browser' | 'agent';

export function buildMobileAgentUiContext({
  browserConnected,
  openFilePath,
  sourceSurface,
}: {
  readonly browserConnected: boolean;
  readonly openFilePath: string | null;
  readonly sourceSurface: MobileAgentUiContextSurface;
}): AgentUiContext {
  const focusEverything = sourceSurface === 'agent';

  return {
    openFiles: [
      ...(openFilePath === null
        ? []
        : [
            {
              path: openFilePath,
              isFocused: focusEverything || sourceSurface === 'filesystem',
            },
          ]),
      ...(browserConnected
        ? [
            {
              path: 'chrome',
              isFocused: focusEverything || sourceSurface === 'browser',
            },
          ]
        : []),
    ],
  };
}
