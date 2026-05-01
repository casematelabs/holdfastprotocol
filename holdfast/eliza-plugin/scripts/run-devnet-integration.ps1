param(
  [string]$EnvFile = ".env.devnet.integration",
  [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $EnvFile)) {
  Write-Error "Missing $EnvFile. Copy .env.devnet.integration.example to $EnvFile and fill values."
}

Get-Content -LiteralPath $EnvFile | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#")) { return }
  $parts = $line -split "=", 2
  if ($parts.Count -ne 2) { return }
  [System.Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), "Process")
}

$required = @(
  "HF_DEVNET_SIGNER_PRIVATE_KEY_BASE58",
  "HF_DEVNET_AGENT_WALLET",
  "HF_DEVNET_COUNTERPARTY",
  "HF_DEVNET_MINT",
  "HF_DEVNET_AMOUNT_BASE_UNITS"
)

$missing = @()
foreach ($name in $required) {
  $value = [System.Environment]::GetEnvironmentVariable($name, "Process")
  if ([string]::IsNullOrWhiteSpace($value)) {
    $missing += $name
  }
}

if ($missing.Count -gt 0) {
  Write-Error ("Missing required variables: " + ($missing -join ", "))
}

if ($CheckOnly) {
  Write-Output "CAS-3 env check passed. Required variables are present."
  exit 0
}

npm run test:integration:devnet
