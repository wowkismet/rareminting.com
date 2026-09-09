import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { api, imageUrl } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import { colour, radius, rupees, space, type } from '../theme.ts';

interface BasketItem {
  listingId: string;
  title: string;
  serialDigits: string | null;
  priceInr: number | null;
  imageUrl: string | null;
  sellerName: string;
  available: boolean;
}

interface Basket {
  items: BasketItem[];
  count: number;
  totalInr?: number;
}

/**
 * The basket, and one payment for all of it.
 *
 * Nothing here is reserved. A note stays on the market until checkout takes it
 * off, so an item can go between filling the basket and paying — the line says
 * so rather than failing quietly at the till, and checkout tells you which one
 * if it happens.
 */
export default function Cart() {
  const router = useRouter();
  const { user, loading: sessionLoading } = useSession();

  const [basket, setBasket] = useState<Basket | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await api<Basket>('/v1/cart');
    if (result.ok) setBasket(result.data);
    else setMessage(result.message);
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

  const remove = useCallback(
    async (listingId: string) => {
      await api(`/v1/cart/${listingId}`, { method: 'DELETE' });
      await load();
    },
    [load],
  );

  const checkout = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    const result = await api<{ group: { id: string; totalInr: number; sellers: number } }>(
      '/v1/cart/checkout',
      { method: 'POST' },
    );
    setBusy(false);

    if (!result.ok) {
      // No address on file is not something the buyer can fix by reading a
      // message on this screen, so send them to the form instead. Everything
      // else — nearly always "somebody else bought one of these" — is named
      // by the API, and that is the whole value of the message.
      if (result.message.toLowerCase().includes('delivery address')) {
        router.push('/address');
        return;
      }
      setMessage(result.message);
      await load();
      return;
    }
    // Payment itself is on the website for now; the order is placed and the
    // notes are reserved, so nothing is lost by finishing there.
    router.push('/');
    setMessage(null);
  }, [load, router]);

  if (loading || sessionLoading) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={colour.accentDeep} />
      </View>
    );
  }

  const items = basket?.items ?? [];
  const buyable = items.filter((i) => i.available);
  const sellers = new Set(buyable.map((i) => i.sellerName)).size;
  const total = basket?.totalInr ?? 0;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {message !== null && (
        <View style={styles.alert} accessibilityRole="alert">
          <Text style={styles.alertText}>{message} Nothing has been charged.</Text>
        </View>
      )}

      {items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Your cart is empty</Text>
          <Text style={styles.emptyBody}>
            Search a date that means something to you, and add the notes that carry it.
          </Text>
          <Pressable style={styles.buttonGreen} onPress={() => router.push('/')}>
            <Text style={styles.buttonGreenText}>Find a date</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {items.map((item) => {
            const image = imageUrl(item.imageUrl);
            return (
              <View key={item.listingId} style={styles.line}>
                {image === null ? (
                  <View style={[styles.thumb, styles.thumbEmpty]} />
                ) : (
                  <Image source={{ uri: image }} style={styles.thumb} resizeMode="cover" />
                )}

                <View style={styles.lineBody}>
                  <Text style={styles.lineTitle} numberOfLines={1}>
                    {item.serialDigits ?? item.title}
                  </Text>
                  <Text style={styles.lineSeller}>{item.sellerName}</Text>
                  {!item.available && (
                    <Text style={styles.unavailable}>No longer available — remove to continue</Text>
                  )}
                </View>

                <View style={styles.lineEnd}>
                  <Text style={styles.linePrice}>
                    {item.priceInr === null ? '—' : rupees(item.priceInr)}
                  </Text>
                  <Pressable onPress={() => void remove(item.listingId)} hitSlop={8}>
                    <Text style={styles.remove}>Remove</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}

          <View style={styles.summary}>
            <Text style={styles.label}>ONE PAYMENT</Text>
            <Text style={styles.total}>{rupees(total)}</Text>
            <Text style={styles.summaryMeta}>
              {buyable.length} item{buyable.length === 1 ? '' : 's'}
              {sellers > 1 ? ` from ${sellers} sellers` : ''}
            </Text>

            <Pressable
              onPress={checkout}
              disabled={buyable.length === 0 || busy}
              style={[
                styles.buttonGreen,
                styles.checkout,
                (buyable.length === 0 || busy) && styles.buttonOff,
              ]}
            >
              {busy ? (
                <ActivityIndicator color={colour.cream} />
              ) : (
                <Text style={styles.buttonGreenText}>Checkout</Text>
              )}
            </Pressable>

            <Text style={styles.assurance}>
              You pay once, however many sellers are in the basket. Each note is dispatched
              separately, and your money is held until it reaches you and the inspection window
              closes. Nothing is reserved until you check out.
            </Text>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  page: { padding: space.lg, gap: space.md, paddingBottom: space.xxxl },

  alert: {
    padding: space.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colour.ember,
    backgroundColor: '#fbeae4',
  },
  alertText: { color: colour.slate, fontSize: type.size.body, lineHeight: 20 },

  empty: { alignItems: 'center', gap: space.md, paddingVertical: space.xxxl },
  emptyTitle: { fontSize: type.size.title, color: colour.slate },
  emptyBody: {
    fontSize: type.size.body,
    color: colour.slateDim,
    textAlign: 'center',
    lineHeight: 20,
  },

  line: {
    flexDirection: 'row',
    gap: space.md,
    backgroundColor: colour.sandRaised,
    borderWidth: 1,
    borderColor: colour.sandLine,
    borderRadius: radius.sm,
    padding: space.md,
  },
  thumb: { width: 64, height: 40, borderRadius: radius.sm },
  thumbEmpty: { borderWidth: 1, borderStyle: 'dashed', borderColor: colour.sandLine },
  lineBody: { flex: 1, gap: 2 },
  lineTitle: {
    fontFamily: type.mono,
    fontSize: type.size.body,
    letterSpacing: type.tracking.serial,
    color: colour.slate,
  },
  lineSeller: { fontSize: type.size.small, color: colour.slateDim },
  unavailable: { fontSize: type.size.small, color: colour.ember },
  lineEnd: { alignItems: 'flex-end', gap: space.xs },
  linePrice: { fontSize: type.size.body, color: colour.slate },
  remove: { fontSize: type.size.small, color: colour.slateDim },

  summary: {
    marginTop: space.md,
    padding: space.lg,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colour.sandLine,
    backgroundColor: colour.sandRaised,
    gap: space.xs,
  },
  label: {
    fontFamily: type.mono,
    fontSize: type.size.micro,
    letterSpacing: type.tracking.eyebrow,
    color: colour.slateDim,
  },
  total: { fontSize: type.size.hero, color: colour.slate },
  summaryMeta: { fontSize: type.size.small, color: colour.slateDim },

  checkout: { marginTop: space.md },
  buttonGreen: {
    backgroundColor: colour.primary,
    borderRadius: radius.pill,
    paddingVertical: space.lg,
    paddingHorizontal: space.xl,
    alignItems: 'center',
  },
  buttonGreenText: { color: colour.cream, fontSize: type.size.body, fontWeight: '600' },
  buttonOff: { opacity: 0.4 },

  assurance: {
    marginTop: space.md,
    fontSize: type.size.small,
    lineHeight: 19,
    color: colour.slateDim,
  },
});
