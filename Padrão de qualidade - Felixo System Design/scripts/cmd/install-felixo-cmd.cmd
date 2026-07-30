@echo off
setlocal EnableDelayedExpansion
rem ============================================================================
rem  install-felixo-cmd.cmd - registra o comando "felixo" no CMD.
rem
rem  >>> PARA QUAL TERMINAL <<<
rem    Shell:    CMD (Prompt de Comando classico)
rem    Sistemas: Windows
rem    Use os outros instaladores se o seu terminal for:
rem      - Bash ou Zsh (Linux, macOS, Git Bash, WSL) -> bash-zsh/install-felixo-bash-zsh.sh
rem      - PowerShell (qualquer SO)                  -> powershell/install-felixo-powershell.ps1
rem
rem  O que faz: instala felixo-command.cmd em %LOCALAPPDATA%\felixo como
rem  "felixo.cmd" e adiciona a pasta ao PATH do usuario. NAO precisa do
rem  repositorio clonado: se felixo-command.cmd nao estiver ao lado deste
rem  arquivo, ele e baixado direto do GitHub (fonte da verdade).
rem
rem  Instalacao em uma linha (sem clonar nada):
rem    curl -fsSL -o "%TEMP%\install-felixo.cmd" https://raw.githubusercontent.com/Felipe-Alcantara/Felixo-System-Design/main/scripts/cmd/install-felixo-cmd.cmd && "%TEMP%\install-felixo.cmd"
rem
rem  Uso:
rem    install-felixo-cmd.cmd              instala (ou atualiza)
rem    install-felixo-cmd.cmd --uninstall  remove (inclusive do PATH)
rem
rem  Variaveis de ambiente (avancado/testes):
rem    FELIXO_RAW_BASE  base para o download (padrao: raw.githubusercontent.com)
rem    FELIXO_PATH_REG  chave de registro do PATH (padrao: HKCU:\Environment)
rem    FELIXO_NO_PAUSE  se definida, nao pausa no final (modo automatizado)
rem ============================================================================

set "RAW_BASE=%FELIXO_RAW_BASE%"
if not defined RAW_BASE set "RAW_BASE=https://raw.githubusercontent.com/Felipe-Alcantara/Felixo-System-Design/main/scripts/cmd"
set "SRC=%~dp0felixo-command.cmd"
set "TARGET_DIR=%LOCALAPPDATA%\felixo"
set "TARGET=%TARGET_DIR%\felixo.cmd"
set "FELIXO_TARGET_DIR=%TARGET_DIR%"
set "DL_TMP="

if /I "%~1"=="--uninstall" goto :uninstall
if /I "%~1"=="-u" goto :uninstall

where git >nul 2>nul
if errorlevel 1 (
  echo [felixo-install !] Aviso: git nao foi encontrado no PATH. A instalacao continua,
  echo [felixo-install !]        mas o comando "felixo" PRECISA do git para funcionar.
  echo [felixo-install !]        Baixe em: https://git-scm.com/download/win
)

rem --- fonte: arquivo local (repo clonado) ou download direto do GitHub ---
if exist "%SRC%" goto :have_src
echo [felixo-install] felixo-command.cmd nao esta ao lado deste instalador.
echo [felixo-install] Baixando a versao mais recente do GitHub...
set "DL_TMP=%TEMP%\felixo-install-%RANDOM%%RANDOM%"
mkdir "%DL_TMP%" 2>nul
set "SRC=%DL_TMP%\felixo-command.cmd"
where curl >nul 2>nul
if not errorlevel 1 (
  curl -fsSL -o "%SRC%" "%RAW_BASE%/felixo-command.cmd"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}; Invoke-WebRequest -UseBasicParsing -Uri '%RAW_BASE%/felixo-command.cmd' -OutFile '%SRC%'"
)
if not exist "%SRC%" (
  echo [felixo-install X] Falha ao baixar felixo-command.cmd de:
  echo [felixo-install X]   %RAW_BASE%/felixo-command.cmd
  echo [felixo-install X] Causas comuns: sem internet, proxy/firewall corporativo bloqueando o
  echo [felixo-install X] github.com, ou URL indisponivel. Verifique e rode o instalador de novo.
  set "RC=1" & goto :end
)
echo [felixo-install OK] Download concluido.
:have_src

if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"
if not exist "%TARGET_DIR%" (
  echo [felixo-install X] Nao consegui criar a pasta %TARGET_DIR%.
  echo [felixo-install X] Verifique se o seu usuario tem permissao de escrita em %%LOCALAPPDATA%%.
  set "RC=1" & goto :end
)
copy /y "%SRC%" "%TARGET%" >nul
if errorlevel 1 (
  echo [felixo-install X] Falha ao copiar felixo.cmd para %TARGET_DIR%.
  echo [felixo-install X] Se o "felixo" estiver rodando em outro terminal, feche-o e tente de novo.
  set "RC=1" & goto :end
)

rem --- adiciona ao PATH do usuario (via registro, preservando o tipo do valor) ---
rem  NAO usa "setx": o setx trunca o PATH em 1024 caracteres (podendo APAGAR
rem  entradas do usuario) e converte REG_EXPAND_SZ em REG_SZ (quebrando entradas
rem  com %VARIAVEIS%). O PowerShell le o valor bruto, anexa e regrava com o
rem  mesmo tipo, de forma idempotente.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $reg=$env:FELIXO_PATH_REG; if(-not $reg){$reg='HKCU:\Environment'}; $dir=$env:FELIXO_TARGET_DIR; if(-not (Test-Path -LiteralPath $reg)){New-Item -Path $reg -Force | Out-Null}; $key=Get-Item -LiteralPath $reg; $cur=[string]$key.GetValue('Path','',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames); $kind='ExpandString'; if($key.GetValueNames() -contains 'Path'){$kind=[string]$key.GetValueKind('Path')}; $parts=@($cur -split ';' | Where-Object { $_ -ne '' }); if($parts -contains $dir){ exit 0 }; $new=(@($parts)+$dir) -join ';'; Set-ItemProperty -Path $reg -Name 'Path' -Value $new -Type $kind; exit 10"
if errorlevel 10 (
  echo [felixo-install OK] Pasta adicionada ao PATH do usuario: %TARGET_DIR%
) else if errorlevel 1 (
  echo [felixo-install !] Nao consegui adicionar a pasta ao PATH automaticamente.
  echo [felixo-install !] Adicione manualmente "%TARGET_DIR%" ao PATH do usuario em:
  echo [felixo-install !]   Configuracoes ^> Sistema ^> Variaveis de Ambiente.
) else (
  echo [felixo-install] Pasta ja estava no PATH: %TARGET_DIR%
)

echo [felixo-install OK] Comando "felixo" instalado.
echo [felixo-install] Abra um NOVO terminal (o PATH so vale para novas janelas) e rode: felixo
echo [felixo-install]   felixo                  -^> baixa tudo, menos o submodulo
echo [felixo-install]   felixo --with-submodules -^> inclui o banco de componentes
set "RC=0" & goto :end

:uninstall
if exist "%TARGET%" del /q "%TARGET%"
if exist "%TARGET_DIR%" rmdir "%TARGET_DIR%" 2>nul
rem --- remove a pasta do PATH do usuario (mesma tecnica do install) ---
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $reg=$env:FELIXO_PATH_REG; if(-not $reg){$reg='HKCU:\Environment'}; $dir=$env:FELIXO_TARGET_DIR; if(-not (Test-Path -LiteralPath $reg)){ exit 0 }; $key=Get-Item -LiteralPath $reg; if(-not ($key.GetValueNames() -contains 'Path')){ exit 0 }; $cur=[string]$key.GetValue('Path','',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames); $kind=[string]$key.GetValueKind('Path'); $parts=@($cur -split ';' | Where-Object { $_ -ne '' }); if(-not ($parts -contains $dir)){ exit 0 }; $new=@($parts | Where-Object { $_ -ne $dir }) -join ';'; Set-ItemProperty -Path $reg -Name 'Path' -Value $new -Type $kind; exit 10"
if errorlevel 10 (
  echo [felixo-install OK] Pasta removida do PATH do usuario.
) else if errorlevel 1 (
  echo [felixo-install !] Nao consegui remover a pasta do PATH automaticamente.
  echo [felixo-install !] Remova "%TARGET_DIR%" do PATH em Variaveis de Ambiente, se desejar.
)
echo [felixo-install OK] felixo.cmd removido de %TARGET_DIR%.
set "RC=0" & goto :end

:end
rem --- limpa o download temporario, se houve ---
if defined DL_TMP rmdir /s /q "%DL_TMP%" 2>nul
rem --- confirmacao final: mantem a janela aberta ate o usuario confirmar ---
echo.
if "%RC%"=="0" (
  echo [felixo-install OK] Script finalizado COM SUCESSO.
) else (
  echo [felixo-install X] Script finalizado COM ERRO (codigo %RC%^).
)
if not defined FELIXO_NO_PAUSE pause
exit /b %RC%
