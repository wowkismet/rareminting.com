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
  readonly gstin: string;
  /** PAN, derived from characters 3–12 of the GSTIN. */
  readonly pan: string;
  readonly address: {
    readonly line1: string;
    readonly line2: string;
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
  legalName: 'Lexoraa Luxury Private Limited',
  brand: 'Rare Minting',
  cin: 'U46620MH2009PTC197360',
  gstin: '27AACCJ2555L1ZC',
  pan: 'AACCJ2555L',
  address: {
    line1: 'Office No. 1028, IJMIMA Complex',
    line2: 'Mind Space, Malad West',
    city: 'Mumbai',
    state: 'Maharashtra',
    postalCode: '400064',
    countryCode: 'IN',
  },
  grievanceOfficer: {
    name: 'Raghunandan',
    // A mailbox that works today. rareminting.com has no MX records yet, so
    // an address on our own domain would bounce — and a grievance channel
    // nobody can reach is worse than an unbranded one that works.
    email: 'rareminting@gmail.com',
  },
  supportEmail: null,
};

/** Single-line address, for a footer or an invoice header. */
export function formattedAddress(company: Company = COMPANY): string {
  const { line1, line2, city, state, postalCode } = company.address;
  return `${line1}, ${line2}, ${city}, ${state} ${postalCode}`;
}

/** "Rare Minting is a brand of Lexoraa Luxury Private Limited." */
export function brandAttribution(company: Company = COMPANY): string {
  return `${company.brand} is a brand of ${company.legalName}.`;
}
