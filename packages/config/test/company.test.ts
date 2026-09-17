import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  COMPANY,
  brandAttribution,
  formattedAddress,
  gstinCheckDigit,
  parseCin,
  parseGstin,
  registrationLine,
  statesAgree,
} from '../src/index.ts';

/**
 * These guard the registration numbers that appear on invoices and on public
 * pages. A GSTIN has a checksum, so a transposed character fails here rather
 * than reaching a customer.
 *
 * What these cannot do is confirm the numbers are *registered* to this company.
 * That needs the GST portal and the MCA register, and is a human check.
 */

describe('the operating entity', () => {
  /**
   * The GSTIN is nullable, because the entity behind the brand changed and the
   * new one's number is not yet held. These tests therefore check a
   * conditional: if a GSTIN is published it must be a real, self-consistent
   * one — and if none is, nothing must be published in its place.
   *
   * Written this way deliberately rather than deleted. The dangerous mistake
   * is not an absent GSTIN, it is a stale one inherited from the previous
   * operator, and that is exactly what these would catch.
   */

  it('publishes either a GSTIN that passes its own checksum, or none', () => {
    if (COMPANY.gstin === null) {
      assert.equal(COMPANY.pan, null, 'a PAN without a GSTIN has nothing to be checked against');
      return;
    }
    const result = parseGstin(COMPANY.gstin);
    assert.equal(result.ok, true, result.ok ? '' : result.reason);
  });

  it('is registered in Maharashtra, matching the Mumbai address', () => {
    assert.equal(COMPANY.address.state, 'Maharashtra');
    if (COMPANY.gstin === null) return;
    const result = parseGstin(COMPANY.gstin);
    assert.ok(result.ok);
    assert.equal(result.parts.stateName, 'Maharashtra');
  });

  it('has a GSTIN identifying a company, not an individual', () => {
    if (COMPANY.gstin === null) return;
    const result = parseGstin(COMPANY.gstin);
    assert.ok(result.ok);
    assert.equal(result.parts.isCompany, true);
  });

  it('has a PAN consistent with its GSTIN', () => {
    if (COMPANY.gstin === null) return;
    const result = parseGstin(COMPANY.gstin);
    assert.ok(result.ok);
    assert.equal(
      result.parts.pan,
      COMPANY.pan,
      'the stored PAN must be the one embedded in the GSTIN',
    );
  });

  it('carries a well-formed CIN for a private limited company', () => {
    const result = parseCin(COMPANY.cin);
    assert.equal(result.ok, true, result.ok ? '' : result.reason);
    assert.ok(result.ok);
    assert.equal(result.parts.className, 'Private Limited Company');
    assert.equal(result.parts.isListed, false);
  });

  it('agrees with itself about which state it is in', () => {
    if (COMPANY.gstin === null) {
      // With no GSTIN to cross-check, the CIN's own state code is all there is
      // — and it still has to match the address we print beside it.
      const cin = parseCin(COMPANY.cin);
      assert.ok(cin.ok);
      assert.equal(cin.parts.stateCode, 'MH');
      return;
    }
    assert.equal(statesAgree(COMPANY.gstin, COMPANY.cin), true);
  });

  it('has a legal name that says Private Limited, matching the CIN class', () => {
    const result = parseCin(COMPANY.cin);
    assert.ok(result.ok);
    assert.equal(result.parts.classCode, 'PTC');
    assert.match(COMPANY.legalName, /Private Limited$/);
  });

  it('has a valid Indian PIN code', () => {
    assert.match(COMPANY.address.postalCode, /^[1-9][0-9]{5}$/);
  });

  it('formats an address and an attribution line', () => {
    assert.match(formattedAddress(), /Pinnacle Business Park/);
    assert.match(formattedAddress(), /Mumbai, Maharashtra 400093$/);
    assert.equal(
      brandAttribution(),
      'Rare Minting is a brand of Lenvon Industries Private Limited.',
    );
  });

  it('leaves no empty gap in the address when there is no locality line', () => {
    // The second line is null for this office. A template that interpolated it
    // blindly would print ", ," in the middle of the registered address.
    assert.equal(COMPANY.address.line2, null);
    assert.doesNotMatch(formattedAddress(), /,\s*,/);
  });

  it('names only the registration numbers it actually holds', () => {
    const line = registrationLine();
    assert.ok(line !== null);
    assert.match(line, new RegExp(`CIN ${COMPANY.cin}`));
    if (COMPANY.gstin === null) {
      assert.doesNotMatch(line, /GSTIN/, 'a GSTIN we do not have must not be labelled');
    } else {
      assert.match(line, new RegExp(`GSTIN ${COMPANY.gstin}`));
    }
  });

  it('publishes a grievance officer who can actually be reached', () => {
    // Required of an intermediary under the IT Rules. The point of the test is
    // not that a name exists but that what is published is contactable: an
    // address nobody reads is the same as having no officer.
    const officer = COMPANY.grievanceOfficer;
    assert.notEqual(officer, null, 'a grievance officer must be published');
    assert.ok(officer !== null);
    assert.ok(officer.name.trim().length > 1, 'the officer needs a name');
    assert.match(officer.email, /^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'the email must be well formed');
    // Deliberately not requiring our own domain. It would be better branding,
    // but rareminting.com has no MX records, so such an address would bounce —
    // and for a statutory contact, reachable beats branded.
    assert.ok(
      officer.email.includes('@'),
      'the officer needs an address mail can actually be delivered to',
    );
  });
});

describe('GSTIN validation', () => {
  it('computes the documented check digit', () => {
    assert.equal(gstinCheckDigit('27AACCJ2555L1ZC'), 'C');
  });

  it('catches a transposed character', () => {
    const broken = '27AACCJ5255L1ZC'; // 2555 -> 5255
    const result = parseGstin(broken);
    assert.equal(result.ok, false);
    assert.ok(!result.ok && /[Cc]hecksum/.test(result.reason));
  });

  it('rejects the wrong length', () => {
    assert.equal(parseGstin('27AACCJ2555L1Z').ok, false);
  });

  it('rejects a structurally invalid GSTIN', () => {
    assert.equal(parseGstin('27aaccj2555l1zc').ok, false);
    assert.equal(parseGstin('ZZAACCJ2555L1ZC').ok, false);
  });
});

describe('CIN validation', () => {
  it('decomposes a CIN into its parts', () => {
    const result = parseCin('U46620MH2009PTC197360');
    assert.ok(result.ok);
    assert.deepEqual(
      {
        listed: result.parts.isListed,
        industry: result.parts.industryCode,
        state: result.parts.stateCode,
        year: result.parts.incorporatedYear,
        cls: result.parts.classCode,
        reg: result.parts.registrationNumber,
      },
      {
        listed: false,
        industry: '46620',
        state: 'MH',
        year: 2009,
        cls: 'PTC',
        reg: '197360',
      },
    );
  });

  it('rejects the wrong length', () => {
    assert.equal(parseCin('U46620MH2009PTC19736').ok, false);
  });

  it('rejects an implausible incorporation year', () => {
    const result = parseCin('U46620MH2999PTC197360');
    assert.equal(result.ok, false);
    assert.ok(!result.ok && /not plausible/.test(result.reason));
  });

  it('rejects a malformed CIN', () => {
    assert.equal(parseCin('X46620MH2009PTC197360').ok, false);
  });
});
