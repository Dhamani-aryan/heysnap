import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

type Props = {
  children: ReactNode;
  label?: string;
};

type State = {
  error: Error | null;
  info: ErrorInfo | null;
};

export class DebugErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[DebugErrorBoundary]', this.props.label ?? '', error, info.componentStack);
    this.setState({ error, info });
  }

  render(): ReactNode {
    if (this.state.error === null) {
      return this.props.children;
    }

    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Crash in {this.props.label ?? 'screen'}</Text>
        <Text style={styles.label}>Message</Text>
        <Text style={styles.body}>{this.state.error.message}</Text>
        <Text style={styles.label}>Name</Text>
        <Text style={styles.body}>{this.state.error.name}</Text>
        <Text style={styles.label}>Stack</Text>
        <Text style={styles.body}>{this.state.error.stack ?? '(no stack)'}</Text>
        {this.state.info ? (
          <View>
            <Text style={styles.label}>Component stack</Text>
            <Text style={styles.body}>{this.state.info.componentStack ?? ''}</Text>
          </View>
        ) : null}
      </ScrollView>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1b0a0a' },
  content: { padding: 16, paddingTop: 64 },
  title: { color: '#ff6b6b', fontSize: 18, fontWeight: '700', marginBottom: 12 },
  label: { color: '#ffd166', fontSize: 12, fontWeight: '600', marginTop: 12 },
  body: { color: '#ffffff', fontSize: 12, fontFamily: 'Courier', marginTop: 4 },
});
