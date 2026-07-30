<#
.SYNOPSIS
  Testes automatizados dos INSTALADORES do comando "felixo" (PowerShell, CMD e Bash).

.DESCRIPTION
  Cobre, sem tocar no ambiente real do usuario (perfil, PATH e registro sao
  redirecionados por variaveis de ambiente proprias para teste):

    PowerShell (install-felixo-powershell.ps1):
      1. Instalar cria o bloco com a funcao "felixo" no $PROFILE (FELIXO_PROFILE).
      2. Reinstalar e idempotente: o bloco aparece UMA unica vez.
      3. Desinstalar remove o bloco e preserva o restante do perfil.

    CMD (install-felixo-cmd.cmd):
      4. Instala felixo.cmd em %LOCALAPPDATA%\felixo e adiciona ao PATH (registro de teste).
      5. Reinstalar e idempotente: a pasta aparece UMA unica vez no PATH.
      6. PATH longo/com %VARIAVEIS% (REG_EXPAND_SZ) e PRESERVADO (regressao do setx,
         que truncava em 1024 chars e convertia o tipo do valor).
      7. Sem felixo-command.cmd local -> baixa da fonte (FELIXO_RAW_BASE aponta para
         file:// local; valida o caminho de download sem depender de rede).
      8. Desinstalar remove felixo.cmd e tira a pasta do PATH.

    Bash (install-felixo-bash-zsh.sh) — pulado se nao houver bash no PATH:
      9. Instala/atualiza/desinstala o bloco no .bashrc de um HOME temporario.

  Nao depende de Pester nem de rede. Requer powershell e cmd (Windows); git e
  bash sao opcionais (casos que dependem deles sao pulados com aviso).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\installers.tests.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$here       = Split-Path -Parent $MyInvocation.MyCommand.Path
$scriptsDir = Split-Path -Parent $here
$psInstaller  = Join-Path $scriptsDir 'powershell\install-felixo-powershell.ps1'
$cmdInstaller = Join-Path $scriptsDir 'cmd\install-felixo-cmd.cmd'
$cmdCommand   = Join-Path $scriptsDir 'cmd\felixo-command.cmd'
$shInstaller  = Join-Path $scriptsDir 'bash-zsh\install-felixo-bash-zsh.sh'

foreach ($f in @($psInstaller, $cmdInstaller, $cmdCommand, $shInstaller)) {
    if (-not (Test-Path -LiteralPath $f)) { throw "Arquivo sob teste nao encontrado: $f" }
}

$BlockBegin = '# >>> felixo command (managed by install-felixo.ps1) >>>'

# --- infra minima de teste (sem dependencias) --------------------------------
$script:Pass = 0
$script:Fail = 0
$script:Skip = 0

function Assert([string]$name, [bool]$cond, [string]$detail = '') {
    if ($cond) {
        $script:Pass++
        Write-Host "  [PASS] $name" -ForegroundColor Green
    } else {
        $script:Fail++
        Write-Host "  [FAIL] $name" -ForegroundColor Red
        if ($detail) { Write-Host "         $detail" -ForegroundColor DarkYellow }
    }
}

function Skip-Case([string]$title, [string]$reason) {
    $script:Skip++
    Write-Host ""
    Write-Host "== $title ==" -ForegroundColor Cyan
    Write-Host "  [SKIP] $reason" -ForegroundColor DarkGray
}

function New-TempDir {
    $root = Join-Path ([System.IO.Path]::GetTempPath()) ('felixo-inst-tests-' + [System.IO.Path]::GetRandomFileName())
    New-Item -ItemType Directory -Force -Path $root | Out-Null
    $root
}

function Test-Case([string]$title, [scriptblock]$body) {
    Write-Host ""
    Write-Host "== $title ==" -ForegroundColor Cyan
    $dir = New-TempDir
    try { & $body $dir }
    catch { $script:Fail++; Write-Host "  [ERRO] $($_.Exception.Message)" -ForegroundColor Red }
    finally { Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue }
}

$hasGit  = [bool](Get-Command git  -ErrorAction SilentlyContinue)
$hasCurl = [bool](Get-Command curl.exe -ErrorAction SilentlyContinue)

# Bash do GIT (o "bash" do PATH pode ser o do WSL, que nao serve para testar
# um HOME temporario do Windows). Procura ao lado do git.exe instalado.
$gitBash = $null
if ($hasGit) {
    $gitExe = (Get-Command git).Source
    foreach ($cand in @(
        (Join-Path (Split-Path -Parent (Split-Path -Parent $gitExe)) 'bin\bash.exe'),
        "$env:ProgramFiles\Git\bin\bash.exe"
    )) {
        if ($cand -and (Test-Path -LiteralPath $cand)) { $gitBash = $cand; break }
    }
}

# =============================================================================
#  PowerShell installer
# =============================================================================

function Invoke-PsInstaller([string]$profileFile, [switch]$Uninstall) {
    $old = $env:FELIXO_PROFILE
    $env:FELIXO_PROFILE = $profileFile
    $env:FELIXO_NO_PAUSE = '1'
    try {
        $args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $psInstaller)
        if ($Uninstall) { $args += '-Uninstall' }
        & powershell @args *> $null
        return $LASTEXITCODE
    } finally {
        $env:FELIXO_PROFILE = $old
    }
}

function Get-BlockCount([string]$file) {
    if (-not (Test-Path -LiteralPath $file)) { return 0 }
    @((Get-Content -LiteralPath $file) | Where-Object { $_ -eq $BlockBegin }).Count
}

if ($hasGit) {
    Test-Case 'PS 1. Instalar cria o bloco da funcao "felixo" no perfil' {
        param($dir)
        $prof = Join-Path $dir 'profile.ps1'
        $rc = Invoke-PsInstaller $prof
        Assert 'instalador saiu com codigo 0' ($rc -eq 0) "codigo=$rc"
        Assert 'perfil foi criado' (Test-Path -LiteralPath $prof)
        Assert 'bloco presente no perfil' ((Get-BlockCount $prof) -eq 1)
        Assert 'funcao felixo definida no bloco' ((Get-Content -LiteralPath $prof -Raw) -match 'function felixo')
    }

    Test-Case 'PS 2. Reinstalar e idempotente (bloco aparece 1x)' {
        param($dir)
        $prof = Join-Path $dir 'profile.ps1'
        Invoke-PsInstaller $prof | Out-Null
        Invoke-PsInstaller $prof | Out-Null
        $n = Get-BlockCount $prof
        Assert 'bloco aparece exatamente 1x apos 2 instalacoes' ($n -eq 1) "apareceu $n vez(es)"
    }

    Test-Case 'PS 3. Desinstalar remove o bloco e preserva o resto do perfil' {
        param($dir)
        $prof = Join-Path $dir 'profile.ps1'
        Set-Content -LiteralPath $prof -Value '# minha config pessoal'
        Invoke-PsInstaller $prof | Out-Null
        $rc = Invoke-PsInstaller $prof -Uninstall
        Assert 'desinstalador saiu com codigo 0' ($rc -eq 0) "codigo=$rc"
        Assert 'bloco removido' ((Get-BlockCount $prof) -eq 0)
        Assert 'conteudo pessoal preservado' ((Get-Content -LiteralPath $prof -Raw) -match 'minha config pessoal')
    }
} else {
    Skip-Case 'PS 1-3. Instalador PowerShell' 'git nao esta no PATH (o instalador exige git).'
}

# =============================================================================
#  CMD installer  (registro e LOCALAPPDATA redirecionados para area de teste)
# =============================================================================

$regBase = 'HKCU:\Software\FelixoInstallTests\' + [System.IO.Path]::GetRandomFileName()

function Invoke-CmdInstaller([string]$installer, [string]$localAppData, [string]$regPath, [string]$flag = '', [string]$rawBase = '') {
    $saved = @{}
    foreach ($n in 'LOCALAPPDATA', 'FELIXO_PATH_REG', 'FELIXO_NO_PAUSE', 'FELIXO_RAW_BASE') { $saved[$n] = [Environment]::GetEnvironmentVariable($n) }
    try {
        $env:LOCALAPPDATA   = $localAppData
        $env:FELIXO_PATH_REG = $regPath
        $env:FELIXO_NO_PAUSE = '1'
        if ($rawBase) { $env:FELIXO_RAW_BASE = $rawBase } else { $env:FELIXO_RAW_BASE = $null }
        & cmd.exe /c "`"$installer`" $flag" *> $null
        return $LASTEXITCODE
    } finally {
        foreach ($n in $saved.Keys) { [Environment]::SetEnvironmentVariable($n, $saved[$n]) }
    }
}

function Get-TestPathValue([string]$regPath) {
    if (-not (Test-Path -LiteralPath $regPath)) { return $null }
    $key = Get-Item -LiteralPath $regPath
    if ($key.GetValueNames() -notcontains 'Path') { return $null }
    [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
}

Test-Case 'CMD 4. Instala felixo.cmd e adiciona a pasta ao PATH' {
    param($dir)
    $reg = "$regBase\t4"
    $rc = Invoke-CmdInstaller $cmdInstaller $dir $reg
    Assert 'instalador saiu com codigo 0' ($rc -eq 0) "codigo=$rc"
    Assert 'felixo.cmd instalado' (Test-Path -LiteralPath (Join-Path $dir 'felixo\felixo.cmd'))
    $path = Get-TestPathValue $reg
    Assert 'pasta no PATH do usuario (registro)' ($path -like "*$dir\felixo*") "Path=$path"
}

Test-Case 'CMD 5. Reinstalar e idempotente (pasta aparece 1x no PATH)' {
    param($dir)
    $reg = "$regBase\t5"
    Invoke-CmdInstaller $cmdInstaller $dir $reg | Out-Null
    Invoke-CmdInstaller $cmdInstaller $dir $reg | Out-Null
    $path = Get-TestPathValue $reg
    $target = Join-Path $dir 'felixo'
    $n = @(($path -split ';') | Where-Object { $_ -eq $target }).Count
    Assert 'pasta aparece exatamente 1x no PATH' ($n -eq 1) "apareceu $n vez(es); Path=$path"
}

Test-Case 'CMD 6. Preserva PATH longo e com %VARIAVEIS% (regressao do setx)' {
    param($dir)
    $reg = "$regBase\t6"
    New-Item -Path $reg -Force | Out-Null
    # PATH > 1024 chars (o setx truncava aqui) e com variavel nao expandida.
    $long = (1..40 | ForEach-Object { "C:\ferramentas\pasta-de-teste-$_" }) -join ';'
    $pre  = '%USERPROFILE%\bin;' + $long
    Set-ItemProperty -Path $reg -Name 'Path' -Value $pre -Type ExpandString
    Invoke-CmdInstaller $cmdInstaller $dir $reg | Out-Null
    $key  = Get-Item -LiteralPath $reg
    $path = Get-TestPathValue $reg
    Assert 'tipo REG_EXPAND_SZ preservado' (([string]$key.GetValueKind('Path')) -eq 'ExpandString') ("tipo=" + $key.GetValueKind('Path'))
    Assert 'entrada %USERPROFILE% preservada (nao expandida)' ($path -like '%USERPROFILE%\bin;*') "inicio=$($path.Substring(0, [Math]::Min(60, $path.Length)))"
    Assert 'nenhuma entrada antiga perdida (sem truncar)' ($path -like "*pasta-de-teste-40*") "tamanho=$($path.Length)"
    Assert 'nova pasta anexada no final' ($path -like "*;$dir\felixo") ''
}

if ($hasCurl) {
    Test-Case 'CMD 7. Sem arquivo local -> baixa felixo-command.cmd da fonte' {
        param($dir)
        $reg = "$regBase\t7"
        # Copia SO o instalador para uma pasta isolada (sem felixo-command.cmd ao lado)
        # e aponta a "fonte da verdade" para o proprio repo via file:// (sem rede).
        $iso = Join-Path $dir 'isolado'
        New-Item -ItemType Directory -Force -Path $iso | Out-Null
        Copy-Item -LiteralPath $cmdInstaller -Destination (Join-Path $iso 'install-felixo-cmd.cmd')
        $rawBase = 'file:///' + ((Split-Path -Parent $cmdCommand) -replace '\\', '/')
        $appData = Join-Path $dir 'appdata'
        New-Item -ItemType Directory -Force -Path $appData | Out-Null
        $rc = Invoke-CmdInstaller (Join-Path $iso 'install-felixo-cmd.cmd') $appData $reg '' $rawBase
        Assert 'instalador saiu com codigo 0' ($rc -eq 0) "codigo=$rc"
        $installed = Join-Path $appData 'felixo\felixo.cmd'
        Assert 'felixo.cmd baixado e instalado' (Test-Path -LiteralPath $installed)
        if (Test-Path -LiteralPath $installed) {
            $same = (Get-FileHash $installed -Algorithm MD5).Hash -eq (Get-FileHash $cmdCommand -Algorithm MD5).Hash
            Assert 'conteudo identico ao da fonte' $same
        }
    }
} else {
    Skip-Case 'CMD 7. Download da fonte' 'curl.exe nao esta no PATH (Windows 10 1803+ ja inclui).'
}

Test-Case 'CMD 8. Desinstalar remove felixo.cmd e tira a pasta do PATH' {
    param($dir)
    $reg = "$regBase\t8"
    Invoke-CmdInstaller $cmdInstaller $dir $reg | Out-Null
    $rc = Invoke-CmdInstaller $cmdInstaller $dir $reg '--uninstall'
    Assert 'desinstalador saiu com codigo 0' ($rc -eq 0) "codigo=$rc"
    Assert 'felixo.cmd removido' (-not (Test-Path -LiteralPath (Join-Path $dir 'felixo\felixo.cmd')))
    $path = Get-TestPathValue $reg
    $target = Join-Path $dir 'felixo'
    Assert 'pasta fora do PATH' (-not (@(($path -split ';') | Where-Object { $_ -eq $target }).Count)) "Path=$path"
}

# =============================================================================
#  Bash installer (via Git Bash, se disponivel)
# =============================================================================

if ($gitBash -and $hasGit) {
    Test-Case 'BASH 9. Instala, atualiza e desinstala o bloco no .bashrc' {
        param($dir)
        $bashrc = Join-Path $dir '.bashrc'
        Set-Content -LiteralPath $bashrc -Value '# minha config pessoal' -Encoding Ascii
        $saved = @{ HOME = $env:HOME; SHELL = $env:SHELL }
        try {
            $env:HOME = $dir; $env:SHELL = 'bash'
            & cmd.exe /c "`"$gitBash`" `"$shInstaller`" < NUL > NUL 2>&1"
            $rc1 = $LASTEXITCODE
            & cmd.exe /c "`"$gitBash`" `"$shInstaller`" < NUL > NUL 2>&1"
            $raw = Get-Content -LiteralPath $bashrc -Raw
            $n = @((Get-Content -LiteralPath $bashrc) | Where-Object { $_ -like '# >>> felixo command*' }).Count
            Assert 'instalador saiu com codigo 0' ($rc1 -eq 0) "codigo=$rc1"
            Assert 'funcao felixo no .bashrc' ($raw -match 'felixo\(\)')
            Assert 'bloco aparece 1x apos 2 instalacoes' ($n -eq 1) "apareceu $n vez(es)"
            & cmd.exe /c "`"$gitBash`" `"$shInstaller`" --uninstall < NUL > NUL 2>&1"
            $raw = Get-Content -LiteralPath $bashrc -Raw
            Assert 'bloco removido no uninstall' ($raw -notmatch 'felixo\(\)')
            Assert 'config pessoal preservada' ($raw -match 'minha config pessoal')
        } finally {
            $env:HOME = $saved.HOME; $env:SHELL = $saved.SHELL
        }
    }
} else {
    Skip-Case 'BASH 9. Instalador Bash/Zsh' 'bash e/ou git nao estao no PATH (instale o Git for Windows para cobrir este caso).'
}

# --- limpeza do registro de teste --------------------------------------------
Remove-Item -Path 'HKCU:\Software\FelixoInstallTests' -Recurse -Force -ErrorAction SilentlyContinue

# ---------------------------------------------------------------------------
Write-Host ""
$color = 'Green'; if ($script:Fail -gt 0) { $color = 'Red' }
Write-Host ("Resultado: {0} passou, {1} falhou, {2} pulado(s)." -f $script:Pass, $script:Fail, $script:Skip) -ForegroundColor $color
if ($script:Fail -gt 0) { exit 1 } else { exit 0 }
