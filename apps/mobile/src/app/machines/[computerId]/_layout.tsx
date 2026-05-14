import { Redirect, useLocalSearchParams } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useColorScheme } from 'react-native';

import { MobileMachineWorkspaceProvider } from '@/components/mobile-machine-workspace-provider';
import { Colors } from '@/constants/theme';

export default function MachineLayout() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];
  const params = useLocalSearchParams<{ computerId?: string | string[] }>();
  const computerIdParam = params.computerId;
  const computerId = Array.isArray(computerIdParam) ? computerIdParam[0] : computerIdParam;

  if (computerId === undefined || computerId.length === 0) {
    return <Redirect href="/machines" />;
  }

  return (
    <MobileMachineWorkspaceProvider computerId={computerId}>
      <NativeTabs
        backgroundColor={colors.background}
        indicatorColor={colors.backgroundElement}
        labelStyle={{ selected: { color: colors.text } }}>
        <NativeTabs.Trigger name="index">
          <NativeTabs.Trigger.Label>Files</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf="folder" md="folder" />
        </NativeTabs.Trigger>

        <NativeTabs.Trigger name="agent">
          <NativeTabs.Trigger.Label>Agent</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf="bubble.left.and.bubble.right" md="chat" />
        </NativeTabs.Trigger>
      </NativeTabs>
    </MobileMachineWorkspaceProvider>
  );
}
