#!/usr/bin/env bash
#
# Testes automatizados NATIVOS (Linux/macOS) do instalador Bash/Zsh do comando
# "felixo" (install-felixo-bash-zsh.sh).
#
# Complementa a suite PowerShell (scripts/tests/installers.tests.ps1), que so
# roda no Windows. Esta suite permite validar o instalador no proprio ambiente
# em que ele mais e usado (Linux, macOS e WSL), sem depender de rede: o teste
# end-to-end clona de um repositorio git local via file://.
#
# Cobre, sem tocar no ambiente real do usuario (HOME e redirecionado para uma
# pasta temporaria em todos os casos):
#   1. Instalar cria o bloco com a funcao "felixo" no .bashrc.
#   2. Reinstalar e idempotente: o bloco aparece UMA unica vez.
#   3. Desinstalar remove o bloco e preserva o restante do .bashrc.
#   4. --help sai com codigo 0 e mostra o uso.
#   5. Opcao desconhecida sai com codigo diferente de 0.
#   6. End-to-end: "felixo" baixa os arquivos de um repo local (file://),
#      remove o submodulo por padrao, e idempotente e registra a pasta no
#      .gitignore do repositorio de trabalho (pulado se faltar git ou rsync).
#
# Uso:
#   bash scripts/bash-zsh/tests/installers.tests.sh

set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER="$HERE/../install-felixo-bash-zsh.sh"
BLOCK_BEGIN="# >>> felixo command (managed by install-felixo.sh) >>>"

[ -f "$INSTALLER" ] || { echo "Arquivo sob teste nao encontrado: $INSTALLER" >&2; exit 1; }

# --- infra minima de teste (sem dependencias) --------------------------------
PASS=0; FAIL=0; SKIP=0

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET=$'\033[0m'; C_OK=$'\033[1;32m'; C_ERR=$'\033[1;31m'
  C_TITLE=$'\033[1;36m'; C_DIM=$'\033[2m'
else
  C_RESET=''; C_OK=''; C_ERR=''; C_TITLE=''; C_DIM=''
fi

assert() { # assert "nome" <codigo (0 = passou)> ["detalhe"]
  local name="$1" cond="$2" detail="${3:-}"
  if [ "$cond" -eq 0 ]; then
    PASS=$((PASS+1)); printf '  %s[PASS]%s %s\n' "$C_OK" "$C_RESET" "$name"
  else
    FAIL=$((FAIL+1)); printf '  %s[FAIL]%s %s\n' "$C_ERR" "$C_RESET" "$name"
    [ -n "$detail" ] && printf '         %s%s%s\n' "$C_DIM" "$detail" "$C_RESET"
  fi
}

test_case() { # test_case "titulo"; cria TEST_HOME temporario
  printf '\n%s== %s ==%s\n' "$C_TITLE" "$1" "$C_RESET"
  TEST_HOME="$(mktemp -d)"
}

end_case() { rm -rf "$TEST_HOME"; }

skip_case() {
  SKIP=$((SKIP+1))
  printf '\n%s== %s ==%s\n' "$C_TITLE" "$1" "$C_RESET"
  printf '  %s[SKIP] %s%s\n' "$C_DIM" "$2" "$C_RESET"
}

# Roda o instalador com HOME/SHELL redirecionados. Argumentos sao repassados.
run_installer() {
  HOME="$TEST_HOME" SHELL=/bin/bash FELIXO_REPO_URL="${FELIXO_REPO_URL:-}" \
    bash "$INSTALLER" "$@" </dev/null >/dev/null 2>&1
}

block_count() { grep -cxF "$BLOCK_BEGIN" "$TEST_HOME/.bashrc" 2>/dev/null || true; }

# =============================================================================
#  Instalador (bloco no .bashrc)
# =============================================================================

test_case '1. Instalar cria o bloco da funcao "felixo" no .bashrc'
run_installer; rc=$?
assert 'instalador saiu com codigo 0' "$rc" "codigo=$rc"
[ -f "$TEST_HOME/.bashrc" ]; assert '.bashrc foi criado' $?
[ "$(block_count)" -eq 1 ]; assert 'bloco presente no .bashrc (1x)' $? "apareceu $(block_count) vez(es)"
grep -q 'felixo()' "$TEST_HOME/.bashrc"; assert 'funcao felixo definida no bloco' $?
end_case

test_case '2. Reinstalar e idempotente (bloco aparece 1x)'
run_installer
run_installer
n="$(block_count)"
[ "$n" -eq 1 ]; assert 'bloco aparece exatamente 1x apos 2 instalacoes' $? "apareceu $n vez(es)"
end_case

test_case '3. Desinstalar remove o bloco e preserva o resto do .bashrc'
printf '# minha config pessoal\n' > "$TEST_HOME/.bashrc"
run_installer
run_installer --uninstall; rc=$?
assert 'desinstalador saiu com codigo 0' "$rc" "codigo=$rc"
[ "$(block_count)" -eq 0 ]; assert 'bloco removido' $?
grep -q 'minha config pessoal' "$TEST_HOME/.bashrc"; assert 'conteudo pessoal preservado' $?
end_case

test_case '4. --help sai com 0 e mostra o uso'
out="$(HOME="$TEST_HOME" SHELL=/bin/bash bash "$INSTALLER" --help </dev/null 2>&1)"; rc=$?
assert '--help saiu com codigo 0' "$rc" "codigo=$rc"
printf '%s' "$out" | grep -q -- '--uninstall'; assert 'ajuda menciona --uninstall' $?
end_case

test_case '5. Opcao desconhecida sai com erro'
run_installer --opcao-que-nao-existe; rc=$?
[ "$rc" -ne 0 ]; assert 'codigo de saida diferente de 0' $? "codigo=$rc"
end_case

# =============================================================================
#  End-to-end: comando "felixo" contra um repositorio local (sem rede)
# =============================================================================

if command -v git >/dev/null 2>&1 && command -v rsync >/dev/null 2>&1; then
  test_case '6. felixo baixa de repo local, e idempotente e ajusta o .gitignore'

  # Repositorio "fonte da verdade" local, com um submodulo simulado.
  src="$TEST_HOME/fonte"
  mkdir -p "$src/core" "$src/components-database"
  printf '# doc de teste\n' > "$src/core/DOC.md"
  printf 'nao deve ser baixado\n' > "$src/components-database/dummy.txt"
  git -C "$src" init --quiet
  git -C "$src" add -A
  git -C "$src" -c user.name=teste -c user.email=teste@teste commit --quiet -m 'fonte de teste'

  # Instala apontando para a fonte local e roda "felixo" num repo de trabalho.
  FELIXO_REPO_URL="file://$src" run_installer
  work="$TEST_HOME/projeto"
  mkdir -p "$work"
  git -C "$work" init --quiet

  run_felixo() {
    HOME="$TEST_HOME" bash -c 'source "$HOME/.bashrc" && cd "$1" && felixo' _ "$work" </dev/null 2>&1
  }

  out1="$(run_felixo)"; rc=$?
  assert 'felixo saiu com codigo 0' "$rc" "codigo=$rc"
  dest="$work/Padrão de qualidade - Felixo System Design"
  [ -f "$dest/core/DOC.md" ]; assert 'arquivos baixados no destino' $?
  [ ! -d "$dest/components-database" ]; assert 'submodulo NAO baixado por padrao' $?
  grep -qxF 'Padrão de qualidade - Felixo System Design/' "$work/.gitignore"; \
    assert 'pasta registrada no .gitignore do projeto' $?

  out2="$(run_felixo)"
  printf '%s' "$out2" | grep -q 'Nenhuma mudanca'; \
    assert 'segunda execucao nao muda nada (idempotente)' $? "saida: $(printf '%s' "$out2" | tail -n 2)"
  n="$(grep -cxF 'Padrão de qualidade - Felixo System Design/' "$work/.gitignore")"
  [ "$n" -eq 1 ]; assert 'entrada no .gitignore aparece 1x' $? "apareceu $n vez(es)"
  end_case
else
  skip_case '6. End-to-end do comando felixo' 'git e/ou rsync nao estao no PATH.'
fi

# ---------------------------------------------------------------------------
printf '\n'
if [ "$FAIL" -gt 0 ]; then
  printf '%sResultado: %d passou, %d falhou, %d pulado(s).%s\n' "$C_ERR" "$PASS" "$FAIL" "$SKIP" "$C_RESET"
  exit 1
fi
printf '%sResultado: %d passou, %d falhou, %d pulado(s).%s\n' "$C_OK" "$PASS" "$FAIL" "$SKIP" "$C_RESET"
exit 0
