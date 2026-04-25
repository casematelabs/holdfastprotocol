//! Fuzz target: WebAuthn parser helpers
//!
//! Tests the pure-Rust parsing functions used in WebAuthn assertion verification:
//!   • find_json_string_value — extracts a string field from a JSON byte slice
//!   • base64url_encode_32   — encodes a 32-byte hash to unpadded base64url
//!
//! Priority (CAS-336): verifies that the handrolled JSON parser and base64url
//! encoder never panic or produce out-of-range output for arbitrary byte inputs.
//!
//! Invariants checked:
//!   1. find_json_string_value never panics regardless of input bytes
//!   2. base64url_encode_32 always outputs exactly 43 bytes
//!   3. base64url output contains only valid base64url characters ([A-Za-z0-9\-_])
//!   4. base64url_encode_32 is deterministic

#![no_main]

use arbitrary::Arbitrary;
use holdfast::fuzz_helpers::{base64url_encode_32, find_json_string_value};
use libfuzzer_sys::fuzz_target;

#[derive(Arbitrary, Debug)]
struct FuzzInput {
    /// Arbitrary bytes representing a (possibly malformed) JSON document.
    json: Vec<u8>,
    /// Arbitrary bytes representing the JSON key to look up.
    key: Vec<u8>,
    /// Fixed 32-byte hash for base64url encoding.
    hash: [u8; 32],
}

fuzz_target!(|input: FuzzInput| {
    // Invariant 1: parser must never panic on any byte sequence
    let result = find_json_string_value(&input.json, &input.key);
    if let Some((start, end)) = result {
        // Invariant 1a: returned range must be within the input slice
        assert!(
            start <= end && end <= input.json.len(),
            "find_json_string_value returned out-of-bounds range [{}, {}] for input len {}",
            start,
            end,
            input.json.len()
        );
    }

    // Invariant 2: base64url encoder must always produce exactly 43 bytes
    let encoded = base64url_encode_32(&input.hash);
    assert_eq!(
        encoded.len(),
        43,
        "base64url_encode_32 must produce exactly 43 bytes; got {}",
        encoded.len()
    );

    // Invariant 3: all output bytes are valid base64url characters
    for &b in &encoded {
        assert!(
            b.is_ascii_alphanumeric() || b == b'-' || b == b'_',
            "base64url_encode_32 produced invalid character 0x{:02x} ('{}'); \
             only [A-Za-z0-9\\-_] are valid",
            b,
            b as char,
        );
    }

    // Invariant 4: determinism
    let encoded2 = base64url_encode_32(&input.hash);
    assert_eq!(encoded, encoded2, "base64url_encode_32 must be deterministic");
});
