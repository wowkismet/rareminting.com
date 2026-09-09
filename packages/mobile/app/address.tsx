import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { api } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import { colour, radius, space, type } from '../theme.ts';

interface Address {
  id: string;
  recipientName: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  phone: string | null;
  isDefault: boolean;
}

/**
 * Where the parcel goes.
 *
 * Nothing can be bought without one — the API refuses a checkout with no
 * address rather than taking money and leaving support to chase the buyer
 * afterwards — so this screen has to exist on the phone as well as the web.
 *
 * The validation the server does is not repeated here beyond marking the
 * required fields. A PIN code is checked in one place, and the message that
 * comes back is the one shown; two copies of the same rule drift apart, and
 * the copy on the phone is the one that ships late.
 */
export default function AddressScreen() {
  const router = useRouter();
  const { user, loading: sessionLoading } = useSession();

  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [form, setForm] = useState({
    recipientName: '',
    line1: '',
    line2: '',
    city: '',
    state: '',
    postalCode: '',
    phone: '',
  });

  const load = useCallback(async () => {
    const result = await api<{ addresses: Address[] }>('/v1/addresses');
    if (result.ok) setAddresses(result.data.addresses);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (sessionLoading) return;
    if (user === null) {
      router.replace('/sign-in');
      return;
    }
    void load();
  }, [user, sessionLoading, load, router]);

  const save = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    const result = await api<{ address: Address }>('/v1/addresses', {
      method: 'POST',
      body: form,
    });
    setBusy(false);

    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setForm({
      recipientName: '',
      line1: '',
      line2: '',
      city: '',
      state: '',
      postalCode: '',
      phone: '',
    });
    await load();
  }, [form, load]);

  const makeDefault = useCallback(
    async (id: string) => {
      await api(`/v1/addresses/${id}`, { method: 'PATCH', body: { isDefault: true } });
      await load();
    },
    [load],
  );

  if (loading || sessionLoading) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={colour.accentDeep} />
      </View>
    );
  }

  const field = (
    key: keyof typeof form,
    label: string,
    extra: { keyboardType?: 'number-pad' | 'phone-pad'; autoComplete?: string } = {},
  ) => (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={form[key]}
        onChangeText={(v) => setForm((f) => ({ ...f, [key]: v }))}
        style={styles.input}
        placeholderTextColor={colour.slateDim}
        {...extra}
      />
    </View>
  );

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.heading}>Delivery addresses</Text>

      {addresses.length === 0 ? (
        <Text style={styles.note}>
          You need one before you can buy. It is what the parcel is labelled with, and what the
          bill is made out to.
        </Text>
      ) : (
        addresses.map((a) => (
          <View key={a.id} style={[styles.card, a.isDefault && styles.cardDefault]}>
            <Text style={styles.name}>{a.recipientName}</Text>
            <Text style={styles.body}>
              {a.line1}
              {a.line2 !== null && a.line2 !== '' ? `, ${a.line2}` : ''}
              {'\n'}
              {a.city}, {a.state} {a.postalCode}
              {a.phone !== null ? `\n${a.phone}` : ''}
            </Text>
            {a.isDefault ? (
              <Text style={styles.badge}>Default</Text>
            ) : (
              <Pressable onPress={() => void makeDefault(a.id)}>
                <Text style={styles.link}>Make this my default</Text>
              </Pressable>
            )}
          </View>
        ))
      )}

      <Text style={styles.subheading}>Add an address</Text>

      {message !== null && <Text style={styles.error}>{message}</Text>}

      {field('recipientName', 'Full name', { autoComplete: 'name' })}
      {field('phone', 'Mobile number', { keyboardType: 'phone-pad' })}
      {field('line1', 'Flat, building, street')}
      {field('line2', 'Area, landmark (optional)')}
      {field('city', 'City')}
      {field('state', 'State')}
      {field('postalCode', 'PIN code', { keyboardType: 'number-pad' })}

      <Pressable
        onPress={() => void save()}
        disabled={busy}
        style={[styles.button, busy && styles.buttonBusy]}
      >
        <Text style={styles.buttonText}>{busy ? 'Saving…' : 'Save address'}</Text>
      </Pressable>

      {addresses.length > 0 && (
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>Back to your cart</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.lg, gap: space.md, backgroundColor: colour.sand },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colour.sand },
  heading: { fontSize: type.size.display, color: colour.slate },
  subheading: { fontSize: type.size.title, color: colour.slate, marginTop: space.md },
  note: { fontSize: type.size.body, color: colour.slateDim, lineHeight: 20 },
  card: {
    borderWidth: 1,
    borderColor: colour.sandLine,
    borderRadius: radius.sm,
    padding: space.md,
    gap: 4,
    backgroundColor: colour.sandRaised,
  },
  cardDefault: { borderColor: colour.accentDeep },
  name: { fontSize: type.size.body, color: colour.slate, fontWeight: '600' as const },
  body: { fontSize: type.size.body, color: colour.slateDim, lineHeight: 20 },
  badge: {
    fontFamily: type.mono,
    fontSize: type.size.micro,
    color: colour.accentDeep,
    textTransform: 'uppercase',
    letterSpacing: type.tracking.eyebrow,
    marginTop: 4,
  },
  link: { fontSize: type.size.body, color: colour.accentDeep, marginTop: 4 },
  field: { gap: 4 },
  label: {
    fontFamily: type.mono,
    fontSize: type.size.micro,
    color: colour.slateDim,
    textTransform: 'uppercase' as const,
    letterSpacing: type.tracking.eyebrow,
  },
  input: {
    borderWidth: 1,
    borderColor: colour.sandLine,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    color: colour.slate,
    backgroundColor: colour.sandRaised,
  },
  error: {
    fontSize: type.size.body,
    color: colour.ember,
    borderWidth: 1,
    borderColor: colour.ember,
    borderRadius: radius.sm,
    padding: space.sm,
  },
  button: {
    backgroundColor: colour.primary,
    borderRadius: 999,
    paddingVertical: space.md,
    alignItems: 'center',
    marginTop: space.sm,
  },
  buttonBusy: { opacity: 0.6 },
  buttonText: { fontSize: type.size.body, color: colour.cream, fontWeight: '600' as const },
});
