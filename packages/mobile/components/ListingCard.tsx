import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { colour, radius, rupees, space, type } from '../theme.ts';
import { imageUrl, type Listing } from '../lib/api.ts';

/**
 * A note, as a card.
 *
 * The serial keeps its letter-spacing at every size. It is a number people
 * read digit by digit, looking for their own date inside it, and tightening it
 * is what makes six digits misread as five.
 */
export function ListingCard({
  listing,
  onPress,
}: {
  listing: Listing;
  onPress(): void;
}) {
  const note = listing.note;
  const image = imageUrl(listing.imageUrl);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${note?.serialDigits ?? listing.title}, ${
        listing.priceInr === null ? 'no price' : rupees(listing.priceInr)
      }`}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      {image === null ? (
        <View style={[styles.image, styles.imageEmpty]}>
          <Text style={styles.imageEmptyText}>No photograph yet</Text>
        </View>
      ) : (
        <Image source={{ uri: image }} style={styles.image} resizeMode="cover" />
      )}

      <View style={styles.body}>
        <Text style={styles.chip}>
          {listing.saleMode === 'auction' ? 'AUCTION' : 'FIXED PRICE'}
        </Text>

        {note === undefined ? (
          <Text style={styles.title} numberOfLines={2}>
            {listing.title}
          </Text>
        ) : (
          <Text style={styles.serial} numberOfLines={1}>
            {note.prefix !== null && (
              <Text style={styles.prefix}>
                {note.prefix}
                {note.isStar ? <Text style={styles.star}>*</Text> : null}{' '}
              </Text>
            )}
            {note.serialDigits}
          </Text>
        )}

        <View style={styles.foot}>
          <Text style={styles.price}>
            {listing.priceInr === null ? '—' : rupees(listing.priceInr)}
          </Text>
          <Text style={styles.grade}>
            {note !== undefined ? `₹${note.denomination} · ` : ''}
            {listing.grade ?? 'ungraded'}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colour.sandRaised,
    borderWidth: 1,
    borderColor: colour.sandLine,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  pressed: { opacity: 0.85 },
  image: { width: '100%', aspectRatio: 2 },
  imageEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colour.sandLine,
  },
  imageEmptyText: { color: colour.slateDim, fontSize: type.size.micro },
  body: { padding: space.md, gap: space.sm },
  chip: {
    fontFamily: type.mono,
    fontSize: type.size.micro,
    letterSpacing: type.tracking.eyebrow,
    color: colour.slateDim,
  },
  title: { fontSize: type.size.body, color: colour.slate },
  serial: {
    fontFamily: type.mono,
    fontSize: type.size.body,
    letterSpacing: type.tracking.serial,
    color: colour.slate,
  },
  prefix: { color: colour.slateDim },
  star: { color: colour.ember },
  foot: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  price: { fontSize: type.size.lead, color: colour.slate },
  grade: { fontSize: type.size.micro, color: colour.slateDim },
});
