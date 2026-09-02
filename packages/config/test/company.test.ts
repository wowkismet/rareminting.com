import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  COMPANY,
  brandAttribution,
  formattedAddress,
  gstinCheckDigit,
  parseCin,
  parseGstin,
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
  it('carries a GSTIN that passes its own checksum', () => {
    const result = parseGstin(COMPANY.gstin);
    assert.equal(result.ok, true, result.ok ? '' : result.reason);
  });

  it('is registered in Maharashtra, matching the Mumbai address', () => {
    const result = parseGstin(COMPANY.gstin);
    assert.ok(result.ok);
    assert.equal(result.parts.stateName, 'Maharashtra');
    assert.equal(COMPANY.address.state, 'Maharashtra');
  });

  it('has a GSTIN identifying a company, not an individual', () => {
    const result = parseGstin(COMPANY.gstin);
    assert.ok(result.ok);
    assert.equal(result.parts.isCompany, true);
  });

  it('has a PAN consistent with its GSTIN', () => {
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
    assert.match(formattedAddress(), /IJMIMA Complex/);
    assert.match(formattedAddress(), /Mumbai, Maharashtra 400064$/);
    assert.equal(
      brandAttribution(),
      'Rare Minting is a brand of Lexoraa Luxury Private Limited.',
    );
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
    assert.ok(
      officer.email.endsWith('@rareminting.com'),
      'the officer should be reachable on our own domain, not a personal address',
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
