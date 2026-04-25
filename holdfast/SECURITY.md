# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| devnet (current) | :white_check_mark: |

Holdfast Protocol is pre-mainnet. All devnet deployments receive security updates.

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

If you discover a vulnerability in Holdfast Protocol's on-chain programs, SDK, oracle, or indexer, please report it privately.

### Contact

- **Email:** [security@holdfastprotocol.com](mailto:security@holdfastprotocol.com)
- **Subject line format:** `[HOLDFAST-VULN] Brief description`

### What to Include

- Affected component (program, SDK, oracle, indexer)
- Description of the vulnerability and its potential impact
- Steps to reproduce or proof of concept
- Your suggested fix (if any)
- Whether you want public credit in the advisory

### Response Timeline

| Stage | Timeframe |
|---|---|
| Acknowledgement | Within 48 hours |
| Initial assessment | Within 5 business days |
| Status update | Every 7 days until resolution |
| Fix deployed | Depends on severity (see below) |

Severity-based fix targets:

- **Critical** (fund loss, program takeover): patch within 72 hours, emergency deploy
- **High** (privilege escalation, data corruption): patch within 7 days
- **Medium** (DoS, information disclosure): patch within 30 days
- **Low** (minor issues, hardening): next scheduled release

## Responsible Disclosure Policy

We follow a coordinated disclosure process:

1. **Reporter** submits the vulnerability privately via email.
2. **Holdfast team** acknowledges receipt within 48 hours.
3. **Assessment** — we confirm the issue, assess severity, and begin developing a fix.
4. **Coordination** — we work with the reporter to agree on a disclosure timeline (default: 90 days from report).
5. **Fix & deploy** — we deploy the fix to devnet (and mainnet when applicable).
6. **Public disclosure** — after the fix is live, we publish a security advisory crediting the reporter (unless they request anonymity).

We ask that reporters:

- Allow reasonable time for a fix before any public disclosure
- Avoid accessing or modifying other users' data
- Avoid disrupting devnet services (DoS, spam transactions)
- Act in good faith

We commit to:

- Not pursuing legal action against good-faith reporters
- Crediting reporters in public advisories (with consent)
- Keeping reporters informed throughout the process

## Scope

The following components are in scope:

| Component | Location |
|---|---|
| Reputation program | `programs/vaultpact/` |
| Escrow program | `programs/vaultpact-escrow/` |
| TypeScript SDK | `sdk/` |
| Oracle service | `oracle/` |
| Indexer service | `indexer/` |
| Anchor configuration | `Anchor.toml` |

Out of scope:

- Third-party dependencies (report upstream; let us know if it affects Holdfast)
- The Solana runtime itself
- Frontend documentation site

## Bug Bounty

A formal bug bounty program is not yet active. Significant vulnerability reports will be rewarded on a case-by-case basis at the team's discretion. A structured bounty program will launch alongside mainnet deployment.

## Security Audit Status

A full source review of both on-chain programs (`vaultpact` and `vaultpact-escrow`) was completed in April 2026.

**Verdict:** Conditional sign-off — all blocking findings remediated before devnet deployment.

| Severity | Found | Fixed | Accepted |
|---|---|---|---|
| Critical | 0 | — | — |
| High | 1 | 1 | 0 |
| Medium | 4 | 4 | 0 |
| Low | 3 | 1 | 2 |
| Informational | 6 | — | Documented |

The High finding (H-1: missing reputation updates in fallback resolution paths) and all four Medium findings (PDA seed constraints, dead constants, vault balance guard, escrow authority verification) were fixed before devnet deployment. Two Low findings were reviewed and accepted as known design trade-offs. One Low finding (zero-pubkey guard on `set_protocol_authority`) was fixed.

Full findings and remediation details: [`docs/security-audit-2026-04.md`](docs/security-audit-2026-04.md)

Residual risks and known gaps: [`docs/THREAT_MODEL.md § 8`](docs/THREAT_MODEL.md#8-residual-risks-and-known-gaps)

A formal third-party audit engagement is planned prior to mainnet deployment. This section will be updated with the audit firm, report links, and findings when available.

## PGP Key

A dedicated PGP key for encrypted vulnerability reports will be published here prior to mainnet launch. In the interim, reports sent to the security email are handled through encrypted channels internally.
