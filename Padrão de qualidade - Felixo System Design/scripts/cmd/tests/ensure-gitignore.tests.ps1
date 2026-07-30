<#
.SYNOPSIS
  Testes automatizados do passo ".gitignore automatico" do felixo-command.cmd (CMD/Windows).

.DESCRIPTION
  Exercita a sub-rotina :ensure_gitignore do felixo-command.cmd por meio da entrada
  interna "--ensure-gitignore", cobrindo todos os casos relevantes:

    1. Fora de um repositorio git       -> nao cria .gitignore.
    2. Repo sem .gitignore              -> cria com a entrada, UTF-8 SEM BOM.
    3. Repo com .gitignore sem a entrada-> anexa preservando o conteudo.
    4. .gitignore sem quebra de linha final -> nao cola na linha anterior.
    5. Idempotencia (rodar 2x)          -> a entrada aparece UMA unica vez
                                           (regressao do bug do findstr com acentos).
    6. Nome ACENTUADO                   -> gravado em UTF-8 e o git realmente
                                           ignora a pasta (git check-ignore).
    7. Rodando de um subdiretorio       -> escreve no .gitignore da RAIZ do repo.

  Nao depende de Pester nem de rede. Requer apenas git e powershell no PATH.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\ensure-gitignore.tests.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

# --- localizacao do script sob teste (o .cmd fica um nivel acima de tests\) ---
$here    = Split-Path -Parent $MyInvocation.MyCommand.Path
$felixo  = Join-Path (Split-Path -Parent $here) 'felixo-command.cmd'
if (-not (Test-Path -LiteralPath $felixo)) {
    throw "Nao encontrei felixo-command.cmd em: $felixo"
}

$DestName = 'Padrão de qualidade - Felixo System Design'   # nome real (acentuado)
$Entry    = "$DestName/"

# --- infra minima de teste (sem dependencias) --------------------------------
$script:Pass = 0
$script:Fail = 0

function New-TempDir {
    # Cria uma pasta temporaria com caminho ACENTUADO/COM ESPACOS, como no uso real.
    $root = Join-Path ([System.IO.Path]::GetTempPath()) ("felixo teste ção " + [System.IO.Path]::GetRandomFileName())
    New-Item -ItemType Directory -Force -Path $root | Out-Null
    $root
}

function Invoke-GitInit([string]$path) {
    Push-Location $path
    try {
        git init -q 2>$null | Out-Null
        git config user.email 'teste@felixo.dev' 2>$null | Out-Null
        git config user.name  'Felixo Teste'       2>$null | Out-Null
    } finally { Pop-Location }
}

function Invoke-Felixo([string]$workDir) {
    # Roda a entrada interna a partir de $workDir (como se o usuario estivesse la).
    Push-Location $workDir
    try {
        & cmd.exe /c "`"$felixo`" --ensure-gitignore `"$DestName`"" 2>&1 | Out-Null
    } finally { Pop-Location }
}

function Get-IgnoreBytes([string]$repoRoot) {
    $f = Join-Path $repoRoot '.gitignore'
    if (Test-Path -LiteralPath $f) { return [System.IO.File]::ReadAllBytes($f) }
    return $null
}

function Get-IgnoreLines([string]$repoRoot) {
    $f = Join-Path $repoRoot '.gitignore'
    $u = New-Object System.Text.UTF8Encoding($false)
    # A virgula unaria preserva o array no return (evita o "unwrap" do PowerShell,
    # que colapsaria um array de 1 elemento em string escalar e quebraria $lines[0]).
    if (Test-Path -LiteralPath $f) { return ,([string[]][System.IO.File]::ReadAllLines($f, $u)) }
    return ,([string[]]@())
}

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

function Test-Case([string]$title, [scriptblock]$body) {
    Write-Host ""
    Write-Host "== $title ==" -ForegroundColor Cyan
    $dir = New-TempDir
    try { & $body $dir }
    catch { $script:Fail++; Write-Host "  [ERRO] $($_.Exception.Message)" -ForegroundColor Red }
    finally { Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue }
}

# ---------------------------------------------------------------------------
Write-Host "Testando: $felixo" -ForegroundColor Gray

Test-Case '1. Fora de um repositorio git -> nao cria .gitignore' {
    param($dir)
    Invoke-Felixo $dir
    Assert 'nenhum .gitignore foi criado' (-not (Test-Path -LiteralPath (Join-Path $dir '.gitignore')))
}

Test-Case '2. Repo sem .gitignore -> cria com a entrada, UTF-8 sem BOM' {
    param($dir)
    Invoke-GitInit $dir
    Invoke-Felixo $dir
    $bytes = Get-IgnoreBytes $dir
    $lines = Get-IgnoreLines $dir
    Assert '.gitignore foi criado' ($null -ne $bytes)
    Assert 'contem exatamente a entrada esperada' ($lines.Count -eq 1 -and $lines[0] -ceq $Entry) ("linhas=" + ($lines -join '|'))
    $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
    Assert 'sem BOM UTF-8' (-not $hasBom)
    # "a" com til = C3 A3 em UTF-8: confirma gravacao UTF-8 correta.
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    Assert 'acento gravado em UTF-8' (($utf8.GetString($bytes)) -like '*Padrão*')
}

Test-Case '3. Repo com .gitignore sem a entrada -> anexa preservando conteudo' {
    param($dir)
    Invoke-GitInit $dir
    $f = Join-Path $dir '.gitignore'
    $u = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($f, "node_modules/`r`n*.log`r`n", $u)
    Invoke-Felixo $dir
    $lines = Get-IgnoreLines $dir
    Assert 'conteudo anterior preservado' (($lines -ccontains 'node_modules/') -and ($lines -ccontains '*.log'))
    Assert 'entrada adicionada' ($lines -ccontains $Entry)
    Assert 'entrada aparece 1x' ((@($lines | Where-Object { $_ -ceq $Entry }).Count) -eq 1)
}

Test-Case '4. .gitignore sem quebra de linha final -> nao cola na linha anterior' {
    param($dir)
    Invoke-GitInit $dir
    $f = Join-Path $dir '.gitignore'
    $u = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($f, "node_modules/", $u)   # SEM \n no final
    Invoke-Felixo $dir
    $lines = Get-IgnoreLines $dir
    Assert 'linha anterior intacta' ($lines -ccontains 'node_modules/') ("linhas=" + ($lines -join '|'))
    Assert 'entrada em linha propria' ($lines -ccontains $Entry) ("linhas=" + ($lines -join '|'))
}

Test-Case '5. Idempotencia: rodar 2x -> entrada aparece 1x (regressao do findstr)' {
    param($dir)
    Invoke-GitInit $dir
    Invoke-Felixo $dir
    Invoke-Felixo $dir
    $lines = Get-IgnoreLines $dir
    $count = @($lines | Where-Object { $_ -ceq $Entry }).Count
    Assert 'entrada nao duplicada apos 2 execucoes' ($count -eq 1) ("apareceu $count vez(es); linhas=" + ($lines -join '|'))
}

Test-Case '6. Nome acentuado -> git realmente ignora a pasta (git check-ignore)' {
    param($dir)
    Invoke-GitInit $dir
    Invoke-Felixo $dir
    New-Item -ItemType Directory -Force -Path (Join-Path $dir $DestName) | Out-Null
    Set-Content -LiteralPath (Join-Path $dir (Join-Path $DestName 'x.txt')) -Value 'oi'
    Push-Location $dir
    try {
        git check-ignore -q -- "$DestName/x.txt" 2>$null
        $ignored = ($LASTEXITCODE -eq 0)
    } finally { Pop-Location }
    Assert 'git ignora o arquivo dentro da pasta' $ignored
}

Test-Case '7. Rodando de um subdiretorio -> escreve no .gitignore da RAIZ' {
    param($dir)
    Invoke-GitInit $dir
    $sub = Join-Path $dir 'core\sub'
    New-Item -ItemType Directory -Force -Path $sub | Out-Null
    Invoke-Felixo $sub
    Assert '.gitignore na raiz do repo' (Test-Path -LiteralPath (Join-Path $dir '.gitignore'))
    Assert 'nenhum .gitignore no subdiretorio' (-not (Test-Path -LiteralPath (Join-Path $sub '.gitignore')))
    $lines = Get-IgnoreLines $dir
    Assert 'entrada na raiz' ($lines -ccontains $Entry)
}

# ---------------------------------------------------------------------------
Write-Host ""
$color = 'Green'; if ($script:Fail -gt 0) { $color = 'Red' }
Write-Host ("Resultado: {0} passou, {1} falhou." -f $script:Pass, $script:Fail) -ForegroundColor $color
if ($script:Fail -gt 0) { exit 1 } else { exit 0 }
