/**
 * Anchor IDL field-offset calculator for Borsh-encoded accounts.
 *
 * Computes the byte offset of a named field within an Anchor account struct at
 * runtime, so callers never need to hard-code a numeric offset that can silently
 * drift when the on-chain layout changes.
 *
 * Only fixed-size types are supported (primitives, pubkeys, arrays, unit enums,
 * nested structs).  Variable-length types (vec, option, string) throw because
 * their preceding-field size cannot be determined statically.
 */

// ── Anchor IDL v0.1.0 type shapes ────────────────────────────────────────────

type PrimType =
  | "bool"
  | "u8" | "u16" | "u32" | "u64" | "u128"
  | "i8" | "i16" | "i32" | "i64" | "i128"
  | "f32" | "f64"
  | "pubkey" | "bytes" | "string";

type IdlType =
  | PrimType
  | { defined: { name: string } }
  | { array: [IdlType, number] }
  | { vec: IdlType }
  | { option: IdlType };

interface IdlField {
  name: string;
  type: IdlType;
}

type IdlTypeDef =
  | { name: string; type: { kind: "struct"; fields: IdlField[] } }
  | { name: string; type: { kind: "enum"; variants: { name: string; fields?: unknown[] }[] } };

export interface Idl {
  types?: IdlTypeDef[];
  accounts?: { name: string }[];
}

// ── Fixed Borsh sizes for primitive types ─────────────────────────────────────

const PRIM_SIZES: Partial<Record<PrimType, number>> = {
  bool: 1,
  u8: 1,   u16: 2,  u32: 4,  u64: 8,  u128: 16,
  i8: 1,   i16: 2,  i32: 4,  i64: 8,  i128: 16,
  f32: 4,  f64: 8,
  pubkey: 32,
};

// ── Core size calculation ─────────────────────────────────────────────────────

function borshFieldSize(type: IdlType, typeMap: ReadonlyMap<string, IdlTypeDef>): number {
  if (typeof type === "string") {
    const size = PRIM_SIZES[type as PrimType];
    if (size === undefined) {
      // bytes/string are variable-length
      throw new Error(`Cannot compute fixed Borsh size for type "${type}" (variable-length)`);
    }
    return size;
  }

  if ("defined" in type) {
    const def = typeMap.get(type.defined.name);
    if (!def) {
      throw new Error(`IDL type not found: "${type.defined.name}"`);
    }
    if (def.type.kind === "struct") {
      return def.type.fields.reduce(
        (sum, f) => sum + borshFieldSize(f.type, typeMap),
        0,
      );
    }
    if (def.type.kind === "enum") {
      // Unit enums (no per-variant fields) encode as a single u8 discriminant.
      const hasFields = def.type.variants.some(
        (v) => Array.isArray(v.fields) && v.fields.length > 0,
      );
      if (hasFields) {
        throw new Error(
          `Cannot compute fixed Borsh size for enum with tuple/struct variants: "${def.name}"`,
        );
      }
      return 1;
    }
    throw new Error(`Unknown type kind for "${def.name}"`);
  }

  if ("array" in type) {
    const [elemType, len] = type.array;
    return len * borshFieldSize(elemType, typeMap);
  }

  // vec / option are variable-length
  throw new Error(
    `Cannot compute fixed Borsh size for variable-length type: ${JSON.stringify(type)}`,
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Return the byte offset of `fieldName` within the named account struct,
 * including the 8-byte Anchor account discriminator prefix.
 *
 * Throws if the struct or field is not found in the IDL, or if any field
 * preceding the target has a variable-length encoding.
 */
export function computeFieldOffset(
  idl: Idl,
  structName: string,
  fieldName: string,
): number {
  const typeMap = new Map<string, IdlTypeDef>(
    (idl.types ?? []).map((t) => [t.name, t]),
  );

  const def = typeMap.get(structName);
  if (!def) {
    throw new Error(`Account/struct "${structName}" not found in IDL types`);
  }
  if (def.type.kind !== "struct") {
    throw new Error(`"${structName}" is not a struct in the IDL`);
  }

  let offset = 8; // Anchor 8-byte discriminator prefix
  for (const field of def.type.fields) {
    if (field.name === fieldName) return offset;
    offset += borshFieldSize(field.type, typeMap);
  }

  throw new Error(`Field "${fieldName}" not found in struct "${structName}"`);
}

/** Convenience wrapper: byte offset of `nonce` in `ReputationAccount`. */
export function computeNonceOffset(idl: Idl): number {
  return computeFieldOffset(idl, "ReputationAccount", "nonce");
}
