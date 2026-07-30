<#
.SYNOPSIS
  Roda TODAS as suites de teste dos scripts do Felixo System Design.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\run-tests.ps1
#>
[CmdletBinding()]
param()

$here       = Split-Path -Parent $MyInvocation.MyCommand.Path
$scriptsDir = Split-Path -Parent $here
$suites = @(
    (Join-Path $here 'installers.tests.ps1'),
    (Join-Path $scriptsDir 'cmd\tests\ensure-gitignore.tests.ps1')
)

$failed = 0
foreach ($suite in $suites) {
    Write-Host ""
    Write-Host ("#" * 70) -ForegroundColor Magenta
    Write-Host "# Suite: $suite" -ForegroundColor Magenta
    Write-Host ("#" * 70) -ForegroundColor Magenta
    & powershell -NoProfile -ExecutionPolicy Bypass -File $suite
    if ($LASTEXITCODE -ne 0) { $failed++ }
}

Write-Host ""
if ($failed -gt 0) {
    Write-Host "[tests X] $failed suite(s) com falha." -ForegroundColor Red
    exit 1
}
Write-Host '[tests OK] Todas as suites passaram.' -ForegroundColor Green
exit 0
