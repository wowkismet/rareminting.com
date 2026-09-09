import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ListingCard } from '../components/ListingCard.tsx';
import { api, type Listing } from '../lib/api.ts';
import { useSession } from '../lib/session.tsx';
import { colour, radius, space, type } from '../theme.ts';

/**
 * The floor.
 *
 * Two columns, shuffled on the server so every listing gets a turn rather than
 * the newest six holding the top of the list forever. Pull to refresh gives a
 * different set, which on this marketplace is a feature rather than a
 * side effect — no two notes are the same, so there is always something new
 * to see.
 */
export default function Home() {
  const router = useRouter();
  const { user, loading: sessionLoading } = useSession();

  const [listings, setListings] = useState<Listing[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await api<{ listings: Listing[]; total?: number }>(
      '/v1/listings?limit=40&sort=random',
      { auth: false },
    );
    if (result.ok) {
      setListings(result.data.listings);
      setTotal(result.data.total ?? result.data.listings.length);
      setError(null);
    } else {
      setError(result.message);
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading || sessionLoading) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={colour.accentDeep} />
      </View>
    );
  }

  return (
    <FlatList
      data={listings}
      keyExtractor={(l) => l.id}
      numColumns={2}
      columnWrapperStyle={styles.row}
      contentContainerStyle={styles.list}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
          tintColor={colour.accentDeep}
        />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.eyebrow}>THE FLOOR</Text>
          <Text style={styles.title}>Notes for sale</Text>
          <Text style={styles.lead}>
            {total} on sale now, in a different order each time you look. Every serial is read for
            the dates its digits can spell.
          </Text>

          {error !== null && (
            <View style={styles.error}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {user === null && (
            <Pressable style={styles.cta} onPress={() => router.push('/sign-in')}>
              <Text style={styles.ctaText}>Sign in to buy or save</Text>
            </Pressable>
          )}
        </View>
      }
      ListEmptyComponent={
        error === null ? (
          <Text style={styles.empty}>Nothing for sale yet.</Text>
        ) : null
      }
      renderItem={({ item }) => (
        <ListingCard listing={item} onPress={() => router.push(`/listing/${item.id}`)} />
      )}
    />
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: space.lg, gap: space.md },
  row: { gap: space.md },
  header: { marginBottom: space.lg, gap: space.xs },
  eyebrow: {
    fontFamily: type.mono,
    fontSize: type.size.micro,
    letterSpacing: type.tracking.eyebrow,
    color: colour.accentDeep,
  },
  title: { fontSize: type.size.display, color: colour.slate },
  lead: { fontSize: type.size.body, color: colour.slateDim, lineHeight: 20 },
  error: {
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colour.ember,
    backgroundColor: '#fbeae4',
  },
  errorText: { color: colour.slate, fontSize: type.size.body },
  cta: {
    marginTop: space.md,
    alignSelf: 'flex-start',
    backgroundColor: colour.primary,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderRadius: radius.pill,
  },
  ctaText: { color: colour.cream, fontSize: type.size.body },
  empty: { textAlign: 'center', color: colour.slateDim, marginTop: space.xxl },
});
