/**
 * The operating entity behind the Rare Minting brand.
 *
 * One source of truth. These values appear on the site footer, on the About
 * page, on commission invoices, on the Certificate of Authenticity and in the
 * payment gateway's records — and they must be identical in all of them. Held
 * here so an invoice and a page footer cannot drift apart.
 *
 * The registration numbers are checked by the test suite (a GSTIN carries a
 * checksum digit), so a typo introduced later fails the build rather than
 * reaching a public page.
 */

export interface Company {
  /** Registered legal name, exactly as incorporated. */
  readonly legalName: string;
  /** The consumer-facing brand this entity trades as. */
  readonly brand: string;
  readonly cin: string;
  /**
   * Null until the entity is GST-registered.
   *
   * Nullable on purpose. A GSTIN belongs to one company, and carrying a
   * previous operator's number across to a new one would put somebody else's
   * tax identity on our invoices. Showing nothing is recoverable; showing the
   * wrong number is not.
   */
  readonly gstin: string | null;
  /** PAN, derived from characters 3–12 of the GSTIN. Null while that is. */
  readonly pan: string | null;
  readonly address: {
    readonly line1: string;
    /** The locality line, where there is one. Null rather than invented. */
    readonly line2: string | null;
    readonly city: string;
    readonly state: string;
    readonly postalCode: string;
    readonly countryCode: string;
  };
  /**
   * Grievance officer, required of an intermediary under the IT Rules and
   * expected by the Consumer Protection (E-Commerce) Rules.
   * Null until appointed — the site must not invent one.
   */
  readonly grievanceOfficer: {
    readonly name: string;
    readonly email: string;
    readonly phone?: string;
  } | null;
  readonly supportEmail: string | null;
}

export const COMPANY: Company = {
  legalName: 'Lenvon Industries Private Limited',
  brand: 'Rare Minting',
  cin: 'U46498MH2025PTC463514',
  // Not yet supplied for this entity. The previous operator's GSTIN and PAN
  // were deliberately not carried over: they identify a different company.
  // Every page that shows these omits the line while they are null.
  gstin: null,
  pan: null,
  address: {
    line1: 'Office No. S 8, Pinnacle Business Park',
    line2: null,
    city: 'Mumbai',
    state: 'Maharashtra',
    postalCode: '400093',
    countryCode: 'IN',
  },
  grievanceOfficer: {
    name: 'Raghunandan',
    // A mailbox that works today. rareminting.com has no MX records yet, so
    // an address on our own domain would bounce — and a grievance channel
    // nobody can reach is worse than an unbranded one that works.
    email: 'raremintings@gmail.com',
  },
  // The same mailbox. Until now this was null and the contact page said a
  // support address was "being set up", which was true but left a visitor
  // with no way to write in at all.
  supportEmail: 'raremintings@gmail.com',
};

/** Single-line address, for a footer or an invoice header. */
export function formattedAddress(company: Company = COMPANY): string {
  const { line1, line2, city, state, postalCode } = company.address;
  // Joined rather than interpolated, so a missing locality line does not leave
  // a stray comma in the middle of the address.
  return [line1, line2, city, `${state} ${postalCode}`]
    .filter((part): part is string => part !== null && part !== '')
    .join(', ');
}

/**
 * The registration numbers, as a line, omitting any not yet held.
 *
 * Returns null when there are none to show, so a caller renders nothing at all
 * rather than a label with an empty value after it.
 */
export function registrationLine(company: Company = COMPANY): string | null {
  const parts = [`CIN ${company.cin}`];
  if (company.gstin !== null) parts.push(`GSTIN ${company.gstin}`);
  return parts.length === 0 ? null : parts.join(' · ');
}

/** "Rare Minting is a brand of Lenvon Industries Private Limited." */
export function brandAttribution(company: Company = COMPANY): string {
  return `${company.brand} is a brand of ${company.legalName}.`;
}
