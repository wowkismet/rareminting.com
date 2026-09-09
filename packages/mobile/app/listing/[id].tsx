import { useCallback, useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { api, imageUrl, type Listing } from '../../lib/api.ts';
import { useSession } from '../../lib/session.tsx';
import { colour, dayFirst, radius, rupees, space, type } from '../../theme.ts';

interface DateReading {
  iso: string | null;
  day: number;
  month: number;
  isPartial: boolean;
  era: string | null;
  confidence: number;
}

interface Detail extends Listing {
  description?: string | null;
  dates?: DateReading[];
  sellerName?: string;
}

const ERA: Record<string, string> = { modern: 'Modern', heritage: 'Heritage' };

/**
 * One note.
 *
 * The readings are the point of the page, so they get room. Each is shown
 * day-first, because the whole premise is that the number on the note *is* the
 * date — 190609 reading as 19-06-2009 makes that visible in a way
 * 2009-06-19 does not.
 */
export default function ListingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useSession();

  const [listing, setListing] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'cart' | 'buy' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const result = await api<{ listing: Detail }>(`/v1/listings/${id}`, { auth: false });
      if (result.ok) setListing(result.data.listing);
      else setMessage(result.message);
      setLoading(false);
    })();
  }, [id]);

  const addToCart = useCallback(async () => {
    if (user === null) {
      router.push('/sign-in');
      return;
    }
    setBusy('cart');
    setMessage(null);
    const result = await api('/v1/cart', { method: 'POST', body: { listingId: id } });
    setBusy(null);
    if (result.ok) router.push('/cart');
    else setMessage(result.message);
  }, [id, user, router]);

  const buyNow = useCallback(async () => {
    if (user === null) {
      router.push('/sign-in');
      return;
    }
    setBusy('buy');
    setMessage(null);
    // Straight to an order, the same route the website's Buy now uses.
    const result = await api<{ order: { id: string } }>(`/v1/listings/${id}/order`, {
      method: 'POST',
    });
    setBusy(null);
    if (result.ok) router.push('/cart');
    else setMessage(result.message);
  }, [id, user, router]);

  if (loading) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={colour.accentDeep} />
      </View>
    );
  }

  if (listing === null) {
    return (
      <View style={styles.centre}>
        <Text style={styles.error}>{message ?? 'That note is no longer listed.'}</Text>
      </View>
    );
  }

  const note = listing.note;
  const image = imageUrl(listing.imageUrl);
  const buyable = listing.state === 'minted';
  const isAuction = listing.saleMode === 'auction';

  return (
    <ScrollView contentContainerStyle={styles.page}>
      {image === null ? (
        <View style={[styles.image, styles.imageEmpty]}>
          <Text style={styles.imageEmptyText}>No photograph yet</Text>
        </View>
      ) : (
        <Image source={{ uri: image }} style={styles.image} resizeMode="cover" />
      )}

      <View style={styles.plate}>
        <Text style={styles.plateLabel}>SERIAL NUMBER</Text>
        {note === undefined ? (
          <Text style={styles.plateTitle}>{listing.title}</Text>
        ) : (
          <Text style={styles.plateSerial}>
            {note.prefix !== null && (
              <Text style={styles.platePrefix}>
                {note.prefix}
                {note.isStar ? <Text style={styles.star}>*</Text> : null}{' '}
              </Text>
            )}
            {note.serialDigits}
          </Text>
        )}
        {note !== undefined && (
          <Text style={styles.plateSub}>
            ₹{note.denomination} · {note.series}
          </Text>
        )}
      </View>

      <View style={styles.facts}>
        <View>
          <Text style={styles.label}>PRICE</Text>
          <Text style={styles.price}>
            {listing.priceInr === null ? '—' : rupees(listing.priceInr)}
          </Text>
        </View>
        <View>
          <Text style={styles.label}>CONDITION</Text>
          <Text style={styles.fact}>{listing.grade ?? 'ungraded'}</Text>
        </View>
      </View>

      {listing.dates !== undefined && listing.dates.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>What this serial reads as</Text>
          {listing.dates.map((d, i) => (
            <View key={`${d.iso ?? 'partial'}-${i}`} style={styles.reading}>
              <Text style={styles.readingDate}>
                {d.isPartial || d.iso === null
                  ? `${String(d.day).padStart(2, '0')}-${String(d.month).padStart(2, '0')} (no year)`
                  : dayFirst(d.iso)}
              </Text>
              <Text style={styles.readingMeta}>
                {d.era !== null ? `${ERA[d.era] ?? d.era} · ` : ''}
                {Math.round(d.confidence * 100)}%
              </Text>
            </View>
          ))}
        </View>
      )}

      {listing.description != null && listing.description !== '' && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>From the seller</Text>
          <Text style={styles.body}>{listing.description}</Text>
        </View>
      )}

      {message !== null && (
        <View style={styles.alert} accessibilityRole="alert">
          <Text style={styles.alertText}>{message}</Text>
        </View>
      )}

      {!buyable ? (
        <Text style={styles.gone}>
          {listing.state === 'struck' ? 'Sold' : 'Not currently available'}
        </Text>
      ) : isAuction ? (
        <Text style={styles.gone}>
          This one is an auction. Bidding is on the website for now.
        </Text>
      ) : (
        <View style={styles.actions}>
          <Pressable
            onPress={addToCart}
            disabled={busy !== null}
            style={[styles.buttonGold, busy !== null && styles.buttonOff]}
          >
            {busy === 'cart' ? (
              <ActivityIndicator color={colour.ink} />
            ) : (
              <Text style={styles.buttonGoldText}>Add to cart</Text>
            )}
          </Pressable>
          <Pressable
            onPress={buyNow}
            disabled={busy !== null}
            style={[styles.buttonGreen, busy !== null && styles.buttonOff]}
          >
            {busy === 'buy' ? (
              <ActivityIndicator color={colour.cream} />
            ) : (
              <Text style={styles.buttonGreenText}>Buy now</Text>
            )}
          </Pressable>
        </View>
      )}

      <Text style={styles.assurance}>
        Your payment is held until the note reaches you and the inspection window closes. The
        seller is paid after delivery, not before.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  error: { color: colour.slateDim, textAlign: 'center' },
  page: { padding: space.lg, gap: space.lg, paddingBottom: space.xxxl },
  image: { width: '100%', aspectRatio: 2, borderRadius: radius.sm },
  imageEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colour.sandLine,
  },
  imageEmptyText: { color: colour.slateDim, fontSize: type.size.small },

  plate: {
    backgroundColor: colour.primary,
    borderRadius: radius.sm,
    padding: space.lg,
    gap: space.xs,
  },
  plateLabel: {
    fontFamily: type.mono,
    fontSize: type.size.micro,
    letterSpacing: type.tracking.eyebrow,
    color: colour.accent,
  },
  plateSerial: {
    fontFamily: type.mono,
    fontSize: type.size.display,
    letterSpacing: type.tracking.serial,
    color: colour.cream,
  },
  platePrefix: { color: colour.creamDim },
  star: { color: colour.ember },
  plateTitle: { fontSize: type.size.title, color: colour.cream },
  plateSub: { fontSize: type.size.small, color: colour.creamDim },

  facts: { flexDirection: 'row', gap: space.xxl },
  label: {
    fontFamily: type.mono,
    fontSize: type.size.micro,
    letterSpacing: type.tracking.eyebrow,
    color: colour.slateDim,
  },
  price: { fontSize: type.size.display, color: colour.slate },
  fact: { fontSize: type.size.lead, color: colour.slate, marginTop: space.xs },

  section: { gap: space.sm },
  sectionTitle: { fontSize: type.size.title, color: colour.slate },
  body: { fontSize: type.size.body, lineHeight: 21, color: colour.slate },

  reading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    backgroundColor: colour.sandRaised,
    borderWidth: 1,
    borderColor: colour.sandLine,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
  },
  readingDate: {
    fontFamily: type.mono,
    fontSize: type.size.body,
    letterSpacing: type.tracking.serial,
    color: colour.slate,
  },
  readingMeta: { fontSize: type.size.small, color: colour.slateDim },

  alert: {
    padding: space.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colour.ember,
    backgroundColor: '#fbeae4',
  },
  alertText: { color: colour.slate, fontSize: type.size.body },

  gone: {
    fontFamily: type.mono,
    fontSize: type.size.small,
    letterSpacing: type.tracking.eyebrow,
    color: colour.slateDim,
    textAlign: 'center',
    paddingVertical: space.lg,
  },

  actions: { flexDirection: 'row', gap: space.md },
  buttonGold: {
    flex: 1,
    backgroundColor: colour.accent,
    borderRadius: radius.pill,
    paddingVertical: space.lg,
    alignItems: 'center',
  },
  buttonGoldText: { color: colour.ink, fontSize: type.size.body, fontWeight: '600' },
  buttonGreen: {
    flex: 1,
    backgroundColor: colour.primary,
    borderRadius: radius.pill,
    paddingVertical: space.lg,
    alignItems: 'center',
  },
  buttonGreenText: { color: colour.cream, fontSize: type.size.body, fontWeight: '600' },
  buttonOff: { opacity: 0.5 },

  assurance: { fontSize: type.size.small, lineHeight: 19, color: colour.slateDim },
});
