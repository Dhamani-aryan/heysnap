import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  TouchableWithoutFeedback,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Fonts, Spacing } from '@/constants/theme';
import { useResolvedTheme } from '@/hooks/use-resolved-theme';

type SuccessPhase = 'idle' | 'welcome' | 'tagline' | 'exiting';

type MobileLoginScreenProps = {
  error: string | null;
  isSubmitting: boolean;
  onSuccessComplete: () => void;
  onSubmit: (input: { email: string; password: string }) => Promise<boolean>;
};

const TAGLINE_PHASE_DELAY_MS = 1700;
const EXIT_PHASE_DELAY_MS = 5000;
const EXIT_DURATION_MS = 900;
const PANEL_DURATION_MS = 850;
const INVALID_FEEDBACK_DURATION_MS = 2200;
const SMOOTH_EASING = Easing.bezier(0.22, 1, 0.36, 1);

const lightLogo = require('../../assets/images/heysnap-light-logo.gif');
const darkLogo = require('../../assets/images/heysnap-dark-logo.gif');

export function MobileLoginScreen({
  error,
  isSubmitting,
  onSuccessComplete,
  onSubmit,
}: MobileLoginScreenProps) {
  const resolvedTheme = useResolvedTheme();
  const palette = themePalettes[resolvedTheme];
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isInvalidFeedbackVisible, setIsInvalidFeedbackVisible] = useState(false);
  const [successPhase, setSuccessPhase] = useState<SuccessPhase>('idle');
  const isSuccessAnimating = successPhase !== 'idle';
  const shellOpacity = useRef(new Animated.Value(1)).current;
  const panelTranslateY = useRef(new Animated.Value(-48)).current;
  const brandScale = useRef(new Animated.Value(1)).current;
  const fieldsOpacity = useRef(new Animated.Value(1)).current;
  const fieldsTranslateY = useRef(new Animated.Value(0)).current;
  const invalidShake = useRef(new Animated.Value(0)).current;
  const invalidFeedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wordmarkOpacity = useRef(new Animated.Value(1)).current;
  const wordmarkTranslateY = useRef(new Animated.Value(0)).current;
  const successCopy =
    successPhase === 'tagline' || successPhase === 'exiting'
      ? 'Get your work done in a snap!'
      : 'Welcome to Snap!';
  const logoSource = resolvedTheme === 'dark' ? darkLogo : lightLogo;

  const invalidTranslateX = invalidShake.interpolate({
    inputRange: [0, 0.25, 0.5, 0.75, 1],
    outputRange: [0, -5, 5, -3, 0],
  });

  const showInvalidFeedback = useCallback(() => {
    if (invalidFeedbackTimeoutRef.current !== null) {
      clearTimeout(invalidFeedbackTimeoutRef.current);
    }
    setIsInvalidFeedbackVisible(true);
    invalidShake.setValue(0);
    Animated.timing(invalidShake, {
      toValue: 1,
      duration: 220,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    }).start();

    invalidFeedbackTimeoutRef.current = setTimeout(() => {
      setIsInvalidFeedbackVisible(false);
      invalidFeedbackTimeoutRef.current = null;
    }, INVALID_FEEDBACK_DURATION_MS);
  }, [invalidShake]);

  useEffect(() => {
    if (error === null) {
      setIsInvalidFeedbackVisible(false);
      return;
    }

    showInvalidFeedback();
  }, [error, showInvalidFeedback]);

  useEffect(() => {
    return () => {
      if (invalidFeedbackTimeoutRef.current !== null) {
        clearTimeout(invalidFeedbackTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isSuccessAnimating) {
      return;
    }

    Animated.parallel([
      Animated.timing(panelTranslateY, {
        toValue: 0,
        duration: PANEL_DURATION_MS,
        easing: SMOOTH_EASING,
        useNativeDriver: true,
      }),
      Animated.spring(brandScale, {
        toValue: 1.08,
        stiffness: 140,
        damping: 22,
        mass: 1,
        useNativeDriver: true,
      }),
      Animated.timing(fieldsOpacity, {
        toValue: 0,
        duration: 280,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(fieldsTranslateY, {
        toValue: 14,
        duration: 280,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();

    const taglineTimeout = setTimeout(() => {
      setSuccessPhase('tagline');
    }, TAGLINE_PHASE_DELAY_MS);
    const exitTimeout = setTimeout(() => {
      setSuccessPhase('exiting');
      Animated.timing(shellOpacity, {
        toValue: 0,
        duration: EXIT_DURATION_MS,
        easing: SMOOTH_EASING,
        useNativeDriver: true,
      }).start();
    }, EXIT_PHASE_DELAY_MS);
    const completeTimeout = setTimeout(() => {
      onSuccessComplete();
    }, EXIT_PHASE_DELAY_MS + EXIT_DURATION_MS);

    return () => {
      clearTimeout(taglineTimeout);
      clearTimeout(exitTimeout);
      clearTimeout(completeTimeout);
    };
  }, [
    brandScale,
    fieldsOpacity,
    fieldsTranslateY,
    isSuccessAnimating,
    onSuccessComplete,
    panelTranslateY,
    shellOpacity,
  ]);

  useEffect(() => {
    if (!isSuccessAnimating) {
      return;
    }

    wordmarkOpacity.setValue(0);
    wordmarkTranslateY.setValue(12);
    Animated.parallel([
      Animated.spring(wordmarkOpacity, {
        toValue: 1,
        stiffness: 200,
        damping: 26,
        mass: 0.85,
        useNativeDriver: true,
      }),
      Animated.spring(wordmarkTranslateY, {
        toValue: 0,
        stiffness: 200,
        damping: 26,
        mass: 0.85,
        useNativeDriver: true,
      }),
    ]).start();
  }, [isSuccessAnimating, successCopy, wordmarkOpacity, wordmarkTranslateY]);

  const handleSubmit = useCallback(() => {
    if (isSuccessAnimating || isSubmitting) {
      return;
    }

    if (email.trim().length === 0 || password.length === 0) {
      showInvalidFeedback();
      return;
    }

    void onSubmit({ email: email.trim(), password }).then((didSucceed) => {
      if (didSucceed) {
        setIsInvalidFeedbackVisible(false);
        setSuccessPhase('welcome');
      }
    });
  }, [email, isSubmitting, isSuccessAnimating, onSubmit, password, showInvalidFeedback]);

  const styles = useMemo(() => createStyles(palette), [palette]);

  return (
    <Animated.View style={[styles.shell, { opacity: shellOpacity }]}>
      <TouchableWithoutFeedback accessible={false} onPress={Keyboard.dismiss}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? -36 : 0}
          style={styles.keyboard}>
          <ThemedView style={[styles.container, { backgroundColor: palette.background }]}>
            <SafeAreaView style={styles.safeArea}>
              <Animated.View
                style={[
                  styles.panel,
                  {
                    transform: [{ translateY: panelTranslateY }],
                  },
                ]}>
                <Animated.View style={[styles.brand, { transform: [{ scale: brandScale }] }]}>
                  <Animated.Image
                    accessibilityIgnoresInvertColors
                    resizeMode="contain"
                    source={logoSource}
                    style={styles.logo}
                  />
                  <Animated.View
                    style={[
                      styles.wordmark,
                      {
                        opacity: wordmarkOpacity,
                        transform: [{ translateY: wordmarkTranslateY }],
                      },
                    ]}>
                    <ThemedText style={[styles.wordmarkText, { color: palette.text }]}>
                      {successCopy}
                    </ThemedText>
                  </Animated.View>
                </Animated.View>

                <Animated.View
                  pointerEvents={isSuccessAnimating ? 'none' : 'auto'}
                  style={[
                    styles.fields,
                    {
                      opacity: fieldsOpacity,
                      transform: [{ translateY: fieldsTranslateY }],
                    },
                  ]}>
                  <Animated.View style={{ transform: [{ translateX: invalidTranslateX }] }}>
                    <ThemedText style={[styles.label, { color: palette.muted }]}>Email</ThemedText>
                    <TextInput
                      autoCapitalize="none"
                      autoComplete="email"
                      autoCorrect={false}
                      editable={!isSuccessAnimating}
                      inputMode="email"
                      keyboardType="email-address"
                      onChangeText={setEmail}
                      returnKeyType="next"
                      style={[
                        styles.input,
                        {
                          borderColor: isInvalidFeedbackVisible ? palette.invalidBorder : palette.border,
                        },
                      ]}
                      textContentType="emailAddress"
                      value={email}
                    />
                  </Animated.View>

                  <Animated.View style={{ transform: [{ translateX: invalidTranslateX }] }}>
                    <ThemedText style={[styles.label, { color: palette.muted }]}>Password</ThemedText>
                    <TextInput
                      autoCapitalize="none"
                      autoComplete="current-password"
                      editable={!isSuccessAnimating}
                      onChangeText={setPassword}
                      onSubmitEditing={handleSubmit}
                      returnKeyType="go"
                      secureTextEntry
                      style={[
                        styles.input,
                        {
                          borderColor: isInvalidFeedbackVisible ? palette.invalidBorder : palette.border,
                        },
                      ]}
                      textContentType="password"
                      value={password}
                    />
                  </Animated.View>

                  <Pressable
                    accessibilityRole="button"
                    disabled={isSubmitting || isSuccessAnimating}
                    onPress={handleSubmit}
                    style={({ pressed }) => [
                      styles.button,
                      (isSubmitting || isSuccessAnimating) && styles.buttonDisabled,
                      pressed && !isSubmitting && !isSuccessAnimating ? styles.buttonPressed : null,
                    ]}>
                    <ThemedText style={[styles.buttonText, { color: palette.buttonText }]}>
                      {isSubmitting ? 'Signing in...' : 'Sign in'}
                    </ThemedText>
                  </Pressable>
                </Animated.View>
              </Animated.View>
            </SafeAreaView>
          </ThemedView>
        </KeyboardAvoidingView>
      </TouchableWithoutFeedback>
    </Animated.View>
  );
}

const themePalettes = {
  light: {
    background: '#fcfcfd',
    surface: '#fcfcfd',
    border: '#e5e5e5',
    text: '#1b1b1b',
    inputText: '#1b1b1b',
    muted: '#5d5d5f',
    accent: '#111111',
    buttonText: '#ffffff',
    invalidBorder: '#e5484d',
  },
  dark: {
    background: '#0f0f10',
    surface: '#0f0f10',
    border: '#242428',
    text: '#ffffff',
    inputText: '#e4e4e7',
    muted: '#949496',
    accent: '#f5f5f5',
    buttonText: '#0f0f11',
    invalidBorder: '#e5484d',
  },
} as const;

const createStyles = (palette: (typeof themePalettes)[keyof typeof themePalettes]) =>
  StyleSheet.create({
    shell: {
      flex: 1,
      backgroundColor: palette.background,
    },
    keyboard: {
      flex: 1,
    },
    container: {
      flex: 1,
    },
    safeArea: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: Spacing.four,
      paddingBottom: Spacing.six,
    },
    panel: {
      width: '100%',
      maxWidth: 380,
      gap: 28,
    },
    brand: {
      alignItems: 'center',
      gap: 20,
      marginBottom: 40,
    },
    logo: {
      width: 78,
      height: 78,
    },
    wordmark: {
      minHeight: 34,
      alignItems: 'center',
      justifyContent: 'center',
    },
    wordmarkText: {
      fontFamily: Fonts.sans,
      fontSize: 32,
      fontWeight: '400',
      lineHeight: 34,
      textAlign: 'center',
    },
    fields: {
      gap: 28,
    },
    label: {
      marginBottom: Spacing.two,
      fontFamily: Fonts.sans,
      fontSize: 13,
      fontWeight: '600',
    },
    input: {
      height: 42,
      borderWidth: 1,
      borderRadius: 999,
      backgroundColor: palette.surface,
      color: palette.inputText,
      fontFamily: Fonts.sans,
      fontSize: 15,
      fontWeight: '400',
      paddingHorizontal: 18,
    },
    button: {
      height: 42,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 999,
      backgroundColor: palette.accent,
      paddingHorizontal: 14,
    },
    buttonDisabled: {
      opacity: 0.55,
    },
    buttonPressed: {
      opacity: 0.86,
    },
    buttonText: {
      fontFamily: Fonts.sans,
      fontSize: 16,
      fontWeight: '400',
      lineHeight: 20,
    },
  });
