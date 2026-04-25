import json, os, urllib.request, sys

sys.stdout.reconfigure(encoding='utf-8')

body_text = """# Script: What is Holdfast Protocol?

**Video:** HOL-31 - First Video
**Composition:** HoldfastPitch (Remotion, video/src/HoldfastPitch.tsx)
**Duration:** 78 seconds (1:18) @ 30fps, 1920x1080
**Tone:** Technical but accessible; confident, not hype-driven

---

## Scene 1 - The Problem (0:00 - 0:14)

**Visuals:** Dark background with red radial glow. THE PROBLEM label fades up. Headline "AI Agents Can't Trust Each Other" rises in. Three icon cards appear: No escrow / No reputation / No accountability.

**Narration:**
> "Autonomous AI agents are already transacting real value. But there is no foundation for trust between them -- no escrow, no reputation, no accountability. Every interaction is an open risk."

---

## Scene 2 - The Solution (0:14 - 0:28)

**Visuals:** Holdfast shield logo springs in with blue glow. THE SOLUTION label, Holdfast Protocol headline. Three pillar cards: Escrow / Reputation / Attestation.

**Narration:**
> "Holdfast Protocol is trust infrastructure for the autonomous economy, built on Solana. Three on-chain primitives: escrow to lock funds until conditions are met, stake-weighted reputation, and hardware-backed identity attestation."

---

## Scene 3 - How It Works (0:28 - 0:52)

**Visuals:** Agent A and Agent B nodes on opposite sides. Escrow vault in center. Animated arrows and flow particles between agents. Four step cards at bottom.

**Steps shown:**
1. Agent A creates escrow -- locks SOL + stakes reputation
2. Agent B fulfills the task -- delivers work, stakes own reputation
3. Escrow releases -- funds transfer, reputation updates on-chain
4. Or: dispute resolution -- on-chain arbitration with deadline

**Narration:**
> "Here's how it works. Agent A creates an on-chain escrow, locking funds and staking their reputation. Agent B accepts, delivers the work, and stakes theirs. On completion, funds release automatically and both agents' reputation scores update. If there's a dispute, on-chain arbitration resolves it with a binding deadline -- no human required."

---

## Scene 4 - Why Holdfast (0:52 - 1:08)

**Visuals:** Three differentiator cards animate in. Solana badge at bottom.

**Differentiators shown:**
- On-Chain Reputation -- Stake-weighted trust scores that travel with agents across protocols. No walled gardens.
- Hardware Attestation -- Hardline Protocol verifies agent identity at the hardware level. No spoofing.
- Protocol Fees on Usage -- Revenue from every escrow transaction. Sustainable economics for builders and stakers.
- Built on Solana -- 400ms finality, less than $0.01 per escrow

**Narration:**
> "What sets Holdfast apart: reputation that travels with an agent across any protocol -- no walled gardens. Identity verified at the hardware level through Hardline. And protocol fees on every escrow create sustainable economics. All on Solana: 400-millisecond finality, less than a cent per transaction."

---

## Scene 5 - CTA (1:08 - 1:18)

**Visuals:** Full Holdfast wordmark with pulsing glow. "Build with Holdfast Protocol" headline. Two buttons: Explore the SDK / Join Devnet. CASEMATE LABS attribution.

**Narration:**
> "Holdfast Protocol. The trust layer for the autonomous economy. Explore the SDK and join Devnet today."

---

## Accuracy Notes

- All on-chain claims reflect real system behavior in the vaultpact-escrow and vaultpact programs
- Hardware attestation via Hardline is an external dependency presented as a feature, not an audit status claim
- No mainnet claims; Devnet CTA is accurate (both programs deployed to devnet)
- No security audit status mentioned -- consistent with constraints (audit in progress, mainnet gated)
- Less than $0.01 per escrow is a Solana network property, not a Holdfast-specific guarantee

## Render Command

```bash
cd video && npm run render:pitch
# Output: video/out/holdfast-pitch.mp4
```
"""

payload = json.dumps({
    'title': 'Script: What is Holdfast Protocol?',
    'format': 'markdown',
    'body': body_text,
    'baseRevisionId': 'd40cd9e9-76aa-46d0-9956-b5228fb02b33'
}).encode('utf-8')

api_url = os.environ['PAPERCLIP_API_URL']
api_key = os.environ['PAPERCLIP_API_KEY']
run_id = os.environ['PAPERCLIP_RUN_ID']

req = urllib.request.Request(
    api_url + '/api/issues/HOL-31/documents/plan',
    data=payload,
    headers={
        'Authorization': 'Bearer ' + api_key,
        'X-Paperclip-Run-Id': run_id,
        'Content-Type': 'application/json'
    },
    method='PUT'
)
with urllib.request.urlopen(req) as resp:
    result = json.loads(resp.read())
    print('OK id:', result.get('id',''), 'rev:', result.get('revisionId',''))
