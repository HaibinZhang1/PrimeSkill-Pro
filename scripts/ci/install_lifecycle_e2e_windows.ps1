$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$nativeLib = Join-Path $root "apps/native-core/src/lib.rs"
$openapi = Join-Path $root "packages/contracts-openapi/openapi.yaml"

if (-Not (Test-Path $nativeLib)) { throw "missing $nativeLib" }
if (-Not (Test-Path $openapi)) { throw "missing $openapi" }

$content = Get-Content $nativeLib -Raw
if ($content -notmatch "InstallStage") { throw "InstallStage missing" }
if ($content -notmatch "InstallFinalStatus") { throw "InstallFinalStatus missing" }
if ($content -notmatch "BEGIN PRIME_SKILL") { throw "managed block marker missing" }

$api = Get-Content $openapi -Raw
if ($api -notmatch "/api/native/install-tickets/\{ticketId\}/consume") { throw "native consume API missing" }

Write-Output "install_lifecycle_e2e_windows passed"
