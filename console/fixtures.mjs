// Synthetic account and records. This console does not call ARM.
// Dates are fixed so the expiry rule is stable.

export const AS_OF = "2026-10-05";

export const account = {
  account_id: "fixture:block-aero-americas-nap8",
  label: "block-aero-americas-nap8",
  org_name: "BLOCK AERO AMERICAS LLC",
  account_state: "active",
  source: "fixture",
};

export const session = {
  session_id: "sess_fixture_americas_readonly",
  mode: "read_only",
  writes_enabled: false,
};

export const records = [
  {
    record_id: "rec-arc-8130",
    status: "processed",
    doc_type_code: "8130-3",
    part_number: "65C35700-1",
    serial_number: "SN-FIXTURE-1001",
    life_limited: true,
    birth_record: false,
    summary: "Release certificate on file. Trace stops at the last operator.",
  },
  {
    record_id: "rec-shop-visit",
    status: "processed",
    doc_type_code: "SHOP-VISIT",
    part_number: "ESN-FIXTURE-9",
    serial_number: "ESN-FIXTURE-9",
    life_limited: true,
    birth_record: true,
    missing_fields: ["time_cycles_since_overhaul"],
    summary: "Shop visit report processed. Cycles since overhaul were not in the OCR text.",
  },
  {
    record_id: "rec-cal-cert",
    status: "processed",
    doc_type_code: "CAL-CERT",
    part_number: "TOOL-CAL-44",
    expires_on: "2026-10-20",
    summary: "Calibration certificate processed. Expires 20 Oct 2026.",
  },
  {
    record_id: "rec-packing",
    status: "processed",
    doc_type_code: null,
    part_number: "NAS1149F0332P",
    summary: "Packing slip processed. No doc type code was stored.",
  },
  {
    record_id: "rec-ad-status",
    status: "processed",
    doc_type_code: "AD-STATUS",
    part_number: "CFM56-7B",
    life_limited: false,
    birth_record: true,
    summary: "AD status is processed and the cited fields are present.",
  },
  {
    record_id: "rec-inbox",
    status: "inbox",
    doc_type_code: "UNKNOWN",
    part_number: "SHOULD-NOT-APPEAR",
    summary: "Still in the inbox. The reader must leave this row alone.",
  },
];
