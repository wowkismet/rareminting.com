-- Two more kinds of KYC document: a masked Aadhaar, and proof of the bank
-- account a payout goes to.
--
-- `aadhaar_masked` and not a full copy, deliberately. UIDAI restricts who may
-- hold Aadhaar copies and requires the first eight digits to be obscured where
-- one is held at all; the number itself is already stored here only as a
-- one-way fingerprint plus its last four characters, so a full image would
-- reverse the protection that gives and turn any breach into a reportable
-- incident. Masked still lets a reviewer check the last four against the
-- fingerprint, which is the whole job.
--
-- `bank_proof` is a cancelled cheque or a passbook page. The account number on
-- it is already held encrypted in bank_accounts; the image exists so a human
-- can confirm the name on the account matches the seller before money moves.
--
-- Nothing here uses the new values: Postgres allows ALTER TYPE ... ADD VALUE
-- inside a transaction but refuses to let the same transaction reference what
-- it just added.

alter type kyc_doc_kind add value if not exists 'aadhaar_masked';
alter type kyc_doc_kind add value if not exists 'bank_proof';
