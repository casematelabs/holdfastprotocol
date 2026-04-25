$apiUrl = $env:PAPERCLIP_API_URL
$apiKey = $env:PAPERCLIP_API_KEY
$runId = $env:PAPERCLIP_RUN_ID

$comment = "Done`n`nSAK integration guide written to holdfast/docs/sak-integration-guide.md.`n`n**What the guide covers:**`n`n- Plugin installation and SAK agent wiring`n- All four actions with input/output tables: GET_HOLDFAST_REPUTATION, CHECK_HOLDFAST_REQUIREMENTS, CREATE_HOLDFAST_PACT, GET_HOLDFAST_PACT`n- Agent registration prerequisite (secp256r1 key setup, persistence requirements)`n- End-to-end example, error reference, program addresses, troubleshooting, v1 scope`n- Cross-links to quickstart, integration-guide, reputation-composability, elizaos-integration-guide`n`n**Design choices:**`n`n- Agent-to-agent trust framing per [CAS-133](/CAS/issues/CAS-133) guidance`n- Read-only actions highlighted as zero-registration entry point`n- DEVNET ONLY prominent throughout`n- Registration as prerequisite with persistence warning (option b from CAS-133)"

$payload = @{ status = "done"; comment = $comment } | ConvertTo-Json -Depth 3 -Compress

$headers = @{
    "Authorization" = "Bearer $apiKey"
    "X-Paperclip-Run-Id" = $runId
    "Content-Type" = "application/json"
}

$resp = Invoke-RestMethod -Uri "$apiUrl/api/issues/CAS-438" -Method PATCH -Headers $headers -Body $payload
Write-Output $resp.status
