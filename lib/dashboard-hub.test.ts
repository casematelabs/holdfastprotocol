import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dashboardHubPath = resolve(here, '../app/dashboard/page.tsx');
const dashboardHubSource = readFileSync(dashboardHubPath, 'utf8');

describe('HOL-145 dashboard hub page: static contract checks', () => {
  test('dashboard root is a client-side hub and no longer hard-redirects to /dashboard/reputation', () => {
    // Invariant: /dashboard must render the new hub surface directly so users can access overview cards.
    assert.match(dashboardHubSource, /'use client';/);
    assert.match(dashboardHubSource, /export\s+default\s+function\s+DashboardHub\s*\(/);
    assert.doesNotMatch(dashboardHubSource, /redirect\('\/dashboard\/reputation'\)/);
  });

  test('quick actions expose the expected navigation entry points', () => {
    // Invariant: hub CTAs must link to pact creation, disputes view, and escrow dashboard.
    assert.match(dashboardHubSource, /href="\/dashboard\/create-pact"/);
    assert.match(dashboardHubSource, /href="\/dashboard\/escrow\?filter=dispute"/);
    assert.match(dashboardHubSource, /href="\/dashboard\/escrow"/);
  });

  test('data loaders are wallet-scoped and preserve active-pact constraints', () => {
    // Invariant: API fetches must be scoped to connected wallet and active states must include disputed pacts.
    assert.match(dashboardHubSource, /fetchReputation\(publicKey\.toBase58\(\)\)/);
    assert.match(dashboardHubSource, /fetchPacts\(publicKey\.toBase58\(\),\s*'active',\s*5\)/);
    assert.match(dashboardHubSource, /const\s+ACTIVE_STATUSES:\s+PactStatus\[\]\s*=\s*\['pending',\s*'funded',\s*'locked',\s*'disputed'\]/);
  });

  test('error path for reputation fetch is surfaced through danger banner', () => {
    // Invariant: indexer fetch failures must be visible to operators instead of failing silently.
    assert.match(dashboardHubSource, /\.catch\(e => setError\(e instanceof Error \? e\.message : 'Failed to load reputation'\)\)/);
    assert.match(dashboardHubSource, /<AlertBanner\s+type="danger"\s+message=\{error\}\s*\/>/);
  });

  test('HOL-148: dispute rate is treated as a 0–1 decimal (multiply × 100 before display)', () => {
    // Invariant: disputeRate from the indexer is a ratio (0–1), not a percentage.
    // The hub must multiply by 100 before rendering and use > 0.1 as the red threshold.
    assert.match(dashboardHubSource, /repData\.disputeRate > 0\.1/);
    assert.match(dashboardHubSource, /\(repData\?\.disputeRate \?\? 0\) \* 100/);
    assert.doesNotMatch(dashboardHubSource, /disputeRate > 10[^0]/);
  });
});