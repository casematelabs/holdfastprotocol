const https = require('https');
const http = require('http');

const apiUrl = process.env.PAPERCLIP_API_URL;
const apiKey = process.env.PAPERCLIP_API_KEY;
const runId = process.env.PAPERCLIP_RUN_ID;
const issueId = 'CAS-438';

const comment = [
  'Done',
  '',
  'SAK integration guide written to `holdfast/docs/sak-integration-guide.md`.',
  '',
  '**What the guide covers:**',
  '',
  '- Plugin installation and SAK agent wiring (`agent.use(holdfastPlugin)`)',
  '- All four actions with full input/output field tables and code examples:',
  '  - `GET_HOLDFAST_REPUTATION` — live on-chain reputation lookup, score interpretation table, tier definitions',
  '  - `CHECK_HOLDFAST_REQUIREMENTS` — pre-flight threshold check, mirrors the on-chain `validate_reputation_for_pact` constraint',
  '  - `CREATE_HOLDFAST_PACT` — create + fund escrow, release condition types, reputation guard params, internals note',
  '  - `GET_HOLDFAST_PACT` — pact state read, full status table',
  '- Agent registration prerequisite (secp256r1 / P-256 key setup, persistence requirements)',
  '- Complete end-to-end example: reputation inspect → pre-flight → pact creation → status poll',
  '- Error reference table (all JSON error keys returned by the plugin)',
  '- Program addresses, troubleshooting section, v1 scope limitations',
  '- Cross-links to quickstart, integration-guide, reputation-composability, and elizaos-integration-guide',
  '',
  '**Design choices:**',
  '',
  '- Framed around the agent-to-agent trust use case, not escrow mechanics — consistent with [CAS-133](/CAS/issues/CAS-133) framing guidance',
  '- Read-only actions explicitly called out as zero-registration, lowest-friction entry',
  '- DEVNET ONLY notice prominent in opening paragraph and in CREATE_HOLDFAST_PACT description',
  '- Registration treated as a prerequisite with clear persistence warning (option b from [CAS-133](/CAS/issues/CAS-133) internal notes)'
].join('\n');

const body = JSON.stringify({ status: 'done', comment });

const url = new URL(apiUrl + '/api/issues/' + issueId);
const lib = url.protocol === 'https:' ? https : http;

const req = lib.request({
  hostname: url.hostname,
  port: url.port,
  path: url.pathname,
  method: 'PATCH',
  headers: {
    'Authorization': 'Bearer ' + apiKey,
    'X-Paperclip-Run-Id': runId,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  }
}, (res) => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => console.log(res.statusCode, data.slice(0, 400)));
});
req.on('error', e => console.error(e));
req.write(body);
req.end();
