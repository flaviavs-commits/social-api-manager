# Testes automatizados — `.gitignore` automático (CMD/Windows)

Testa o passo que adiciona a pasta baixada ao `.gitignore` da raiz do repositório,
implementado na sub-rotina `:ensure_gitignore` de `../felixo-command.cmd`.

## Por que estes testes existem

No Windows/CMD o passo do `.gitignore` estava bugado (task do Notion *"Corrigir bug
no Felixo System Design: no Windows o script ainda não está fazendo gitignore
automaticamente"*). Duas causas:

1. **`findstr` não casa nomes acentuados sob `chcp 65001`.** O `.gitignore` é gravado
   em UTF-8 (o nome de destino tem acento — `ã` = bytes `C3 A3`), mas o `findstr`
   procura em OEM e nunca encontra a linha → a entrada era **duplicada** a cada
   execução.
2. **Faltava garantir a quebra de linha final**, então a entrada podia **colar** na
   última linha do `.gitignore`, fazendo o git **não** ignorar a pasta.

As variantes **bash** (`grep -qxF`) e **PowerShell** (`-cnotcontains`) já estavam
corretas; só a do CMD tinha o bug. A correção delega a verificação/gravação ao
PowerShell (UTF-8 sem BOM, idempotente).

## Como rodar

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\ensure-gitignore.tests.ps1
```

Sai com código `0` se tudo passar, `1` se algo falhar. Requer apenas `git` e
`powershell` no PATH (sem Pester, sem rede).

## Casos cobertos

| # | Cenário | Espera-se |
|---|---------|-----------|
| 1 | Fora de um repositório git | não cria `.gitignore` |
| 2 | Repo sem `.gitignore` | cria com a entrada, UTF-8 **sem BOM** |
| 3 | Repo com `.gitignore` sem a entrada | anexa preservando o conteúdo |
| 4 | `.gitignore` sem quebra de linha final | não cola na linha anterior |
| 5 | Rodar 2× (idempotência) | entrada aparece **uma** vez (regressão do `findstr`) |
| 6 | Nome acentuado | `git check-ignore` confirma que a pasta é ignorada |
| 7 | Rodando de um subdiretório | escreve no `.gitignore` da **raiz** do repo |

Os testes usam a entrada interna `felixo-command.cmd --ensure-gitignore "<nome>"`,
que executa **apenas** o passo do `.gitignore` (sem clonar nada).
