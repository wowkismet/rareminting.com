import { useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useSession } from '../lib/session.tsx';
import { colour, radius, space, type } from '../theme.ts';

/**
 * Sign in, or open an account.
 *
 * One screen for both, because the fields are identical and a separate
 * register screen is one more thing to get to. The API tells us which failed
 * and why; nothing here guesses.
 */
export default function SignIn() {
  const router = useRouter();
  const { signIn, register } = useSession();

  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const message = await (mode === 'in' ? signIn : register)(email.trim(), password);
    setBusy(false);
    if (message === null) router.back();
    else setError(message);
  };

  const valid = email.includes('@') && password.length >= 8;

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Text style={styles.eyebrow}>RARE MINTING</Text>
        <Text style={styles.title}>
          {mode === 'in' ? 'Welcome back' : 'Open an account'}
        </Text>
        <Text style={styles.lead}>
          {mode === 'in'
            ? 'Sign in to buy, bid and keep a collection.'
            : 'You need an account to buy, bid or save a note for later.'}
        </Text>

        <View style={styles.field}>
          <Text style={styles.label}>EMAIL</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            inputMode="email"
            style={styles.input}
            placeholderTextColor={colour.slateDim}
            placeholder="you@example.com"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>PASSWORD</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            style={styles.input}
            placeholderTextColor={colour.slateDim}
            placeholder={mode === 'in' ? 'Your password' : 'At least eight characters'}
          />
          {mode === 'up' && (
            <Text style={styles.hint}>
              Length matters more than symbols. A few unrelated words beats one clever word.
            </Text>
          )}
        </View>

        {error !== null && (
          <View style={styles.error} accessibilityRole="alert">
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Pressable
          onPress={submit}
          disabled={!valid || busy}
          style={[styles.button, (!valid || busy) && styles.buttonOff]}
        >
          {busy ? (
            <ActivityIndicator color={colour.cream} />
          ) : (
            <Text style={styles.buttonText}>
              {mode === 'in' ? 'Sign in' : 'Create account'}
            </Text>
          )}
        </Pressable>

        <Pressable
          onPress={() => {
            setMode(mode === 'in' ? 'up' : 'in');
            setError(null);
          }}
          style={styles.switch}
        >
          <Text style={styles.switchText}>
            {mode === 'in' ? 'No account yet? Open one' : 'Already have an account? Sign in'}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  page: { padding: space.xl, gap: space.lg },
  eyebrow: {
    fontFamily: type.mono,
    fontSize: type.size.micro,
    letterSpacing: type.tracking.eyebrow,
    color: colour.accentDeep,
  },
  title: { fontSize: type.size.display, color: colour.slate },
  lead: { fontSize: type.size.body, color: colour.slateDim, lineHeight: 20 },
  field: { gap: space.xs },
  label: {
    fontFamily: type.mono,
    fontSize: type.size.micro,
    letterSpacing: type.tracking.eyebrow,
    color: colour.slateDim,
  },
  input: {
    borderWidth: 1,
    borderColor: colour.sandLine,
    backgroundColor: colour.sandRaised,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    fontSize: type.size.lead,
    color: colour.slate,
  },
  hint: { fontSize: type.size.small, color: colour.slateDim, lineHeight: 18 },
  error: {
    padding: space.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colour.ember,
    backgroundColor: '#fbeae4',
  },
  errorText: { color: colour.slate, fontSize: type.size.body },
  button: {
    backgroundColor: colour.primary,
    borderRadius: radius.pill,
    paddingVertical: space.lg,
    alignItems: 'center',
  },
  buttonOff: { opacity: 0.4 },
  buttonText: { color: colour.cream, fontSize: type.size.lead },
  switch: { alignItems: 'center', paddingVertical: space.sm },
  switchText: { color: colour.accentDeep, fontSize: type.size.body },
});
