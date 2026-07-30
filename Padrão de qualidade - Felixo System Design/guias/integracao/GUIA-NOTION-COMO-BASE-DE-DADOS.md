# 🗂️ GUIA-NOTION-COMO-BASE-DE-DADOS — MIGRAR PLANILHAS E ARQUIVOS PARA DATABASES E REORGANIZAR O WORKSPACE

> **O que é**: Um guia reutilizável para transformar planilhas, documentos e pastas heterogêneas em **databases estruturadas do Notion** — com propriedades tipadas, arquivos anexados, importação idempotente e reorganização programática do workspace.
>
> **De onde vem**: Este padrão foi extraído de uma sessão real de organização do workspace "Central pessoal" (Vitis Souls), na qual quatro planilhas (`.xlsx`) e uma pasta de relatórios do Google Drive (`.docx`) viraram seis tópicos com vinte databases e ~1.100 linhas, usando a API do Notion e o ecossistema `notion-starter`/`notion-tasks-cli`.
>
> **Qual é o propósito dentro de `guias/`**: Preservar como bloco reaproveitável o subsistema que usa o **Notion como base de dados operacional** (não só como bloco de notas), para migrações, ETLs, catálogos e painéis internos.
>
> **Quando usar**: Importar planilhas de controle, migrar documentos de um Drive, montar catálogos/inventários, consolidar dados espalhados em bases navegáveis e relacionadas, ou reorganizar a árvore de páginas de um workspace.

Este documento não explica o produto original inteiro. O foco é isolar os padrões técnicos que tornam a migração para o Notion **confiável, idempotente e reversível**, e deixá-los prontos para reaproveitamento.

---

## Visão geral

O padrão é composto por **7 camadas**:

| Camada | Responsabilidade |
|---|---|
| **Extração e normalização** | Ler a fonte (xlsx/docx/zip), corrigir encoding, normalizar datas/números/nomes, deduplicar |
| **Modelagem do schema** | Decidir 1 linha = 1 quê; escolher tipos de propriedade; ID nativo; relações |
| **Cliente resiliente** | Retry com backoff (429/5xx), timeout, versão de API por chamada |
| **Importação idempotente** | Estado local de progresso para retomar sem duplicar; fatiar texto > 2000 |
| **Anexos** | Subir o arquivo original e vinculá-lo à propriedade `files` da linha |
| **Estrutura de navegação** | Pastas → tópicos; tópico = cabeçalho + divisória + links full-page |
| **Reorganização** | Re-parentear páginas e databases; consolidar; arquivar (não destruir) |

---

## 1. Extração e normalização da fonte

O trabalho sujo mora aqui. Antes de qualquer chamada ao Notion, transforme a fonte num JSON limpo e previsível.

- **Encoding de nomes em ZIP**: exports do Google Drive frequentemente vêm em `cp437`. Reconstrua: `nome.encode("cp437").decode("utf-8")` e normalize com `unicodedata.normalize("NFC", ...)`.
- **Números no formato brasileiro**: `1.614` é mil seiscentos e quatorze, não 1,614. Trate o ponto como separador de milhar (`"2,7 mil" → 2700`).
- **Datas**: aceite múltiplos formatos (`dd/mm/aaaa`, `dd_mm`, `aaaa-mm-dd`, serial do Excel) e converta para ISO `YYYY-MM-DD`. Datas inválidas na fonte (ex.: `27/95/2026`) não devem virar data errada — preserve o texto original em "Observações".
- **Deduplicação por conteúdo**: quando a mesma linha/arquivo aparece repetido, gere um hash do conteúdo e agrupe as cópias numa observação, em vez de criar duplicatas.
- **Regra de ouro**: nunca descarte informação ambígua. O que não couber num campo tipado vai para uma propriedade `rich_text` "Observações".

## 2. Modelagem do schema

- **Defina a granularidade**: "1 linha = 1 conta" e "1 linha = 1 conta × plataforma" são databases diferentes e **complementares** — ligue-as por relação em vez de fundir.
- **Tipos importam**: use `select`/`multi_select` (com cores) para estados, `email`, `url`, `date`, `number`, `checkbox` e `relation` — não jogue tudo em texto.
- **ID nativo, não número no título**: use a propriedade `unique_id` (com prefixo, ex. `DVIP`) para numeração automática. Nunca cole um número sequencial dentro do nome da linha. **O prefixo de `unique_id` é único por workspace** — use um prefixo distinto por database.
- **Descrição e ícone** em cada database deixam a base autoexplicativa.

## 3. Cliente resiliente

Toda migração real bate em `429` (rate limit) e `5xx` transitórios.

- **Retry com backoff exponencial**, respeitando `Retry-After` quando presente.
- **Distinga idempotência**: `PATCH` pode ser repetido à vontade; `POST` (criação) só deve ser repetido em `429`/`529` para não duplicar.
- **Timeout por requisição** e um pequeno `sleep` entre escritas evitam estourar o limite.
- **Versão de API por chamada**: algumas rotas novas (data sources, mover database) exigem `Notion-Version: 2025-09-03` sem que você troque a versão padrão do resto.

## 4. Importação idempotente e retomável

Migrações grandes (centenas de linhas) vão falhar no meio em algum momento.

- Mantenha um **arquivo de estado local** (`{chave_da_linha: page_id}`) gravado a cada criação. Ao reexecutar, pule o que já existe. Isso torna o script **retomável após crash** sem duplicar nada.
- Alternativa no próprio Notion: idempotência por uma propriedade única (ex. "Origem"/URL), fazendo *upsert* — bom para sincronizações recorrentes.
- **Fatie texto > 2000 unidades UTF-16** em múltiplos itens de `rich_text`; o Notion recusa valores maiores. (O corpo da página, em blocos, não tem esse teto apertado — jogue o conteúdo longo lá.)

## 5. Anexos: o arquivo original junto do dado

Extrair o conteúdo do documento para blocos é ótimo para leitura, mas **guarde também o arquivo original** na propriedade `files` da linha.

- Fluxo da File Upload API (parte única, até 20 MB): `POST /v1/file_uploads` (cria) → `POST /v1/file_uploads/{id}/send` (envia `multipart/form-data`) → referencie `{"type": "file_upload", "file_upload": {"id": ...}}` na propriedade.
- Assim cada linha tem o **dado estruturado** (propriedades), a **leitura** (blocos) e a **fonte de verdade** (arquivo anexado).

## 6. Estrutura de navegação: pastas viram tópicos

Reproduza a hierarquia de pastas como tópicos aninhados, e deixe só os arquivos finais como linhas de database.

- **Tópico = cabeçalho (`heading`) + divisória + databases/páginas full-page linkadas** logo abaixo. Sem parágrafos longos de introdução no meio.
- **Pasta com subpastas → página-pasta com subtópicos**; cada subpasta é um `heading` + divisória; o nível mais fundo é que vira database.
- **Inserção posicional**: a API só anexa blocos no fim de uma página, mas o parâmetro `after` no append permite inserir num ponto específico — útil para colocar um cabeçalho imediatamente antes de um link já existente.

## 7. Reorganização programática (mover, consolidar, arquivar)

Reorganizar não exige recriar. A API permite **re-parentear**:

- **Mover página**: `PATCH /pages/{id}` com novo `parent`. **Pegadinha**: mover uma página que *contém databases* retorna `200` mas é silenciosamente ignorado — nesse caso, mova os databases um a um e descarte a página vazia.
- **Mover database**: `PATCH /databases/{id}` com `parent`, exigindo `Notion-Version: 2025-09-03`.
- **Consolidar**: projeto espalhado em vários tópicos vira um folder único movendo as databases para dentro dele.
- **Arquivar, não destruir**: `PATCH` com `archived: true` manda para a lixeira (recuperável). Prefira arquivar a apagar; e antes de arquivar algo que você não criou, confirme que é mesmo redundante.

---

## Checklist de migração confiável

- [ ] A fonte foi normalizada (encoding, datas, números BR, dedup) **antes** de tocar o Notion?
- [ ] Cada informação ambígua tem destino (campo tipado ou "Observações")?
- [ ] O schema usa tipos corretos, `unique_id` com prefixo próprio e relações em vez de fusão?
- [ ] O import é **idempotente/retomável** (estado local ou upsert por propriedade)?
- [ ] Texto > 2000 é fatiado; conteúdo longo foi para o corpo em blocos?
- [ ] O arquivo original foi anexado na propriedade `files`?
- [ ] A navegação segue "pastas → tópicos; cabeçalho + divisória + links full-page"?
- [ ] A reorganização usou re-parent/arquivamento (reversível), não recriação/destruição?

---

## Anti-padrões a evitar

- **Número sequencial colado no título** em vez da propriedade `unique_id` nativa.
- **Tudo em `rich_text`** perdendo filtros, agrupamentos e cores de `select`.
- **Fundir databases de granularidades diferentes** em vez de relacioná-las.
- **Reexecutar o import do zero** sem estado — gera centenas de duplicatas.
- **Apagar (destrutivo)** quando arquivar resolveria de forma reversível.
- **Chamar a API sem retry** — a primeira leva de `429` derruba a migração.

---

> **Assinatura de Origem**
> Guia contribuído ao **Felixo System Design** a partir de uma migração real de workspace Notion (Vitis Souls / Automações do Notion).
> Origem do padrão: ecossistema `notion-starter` + `notion-tasks-cli`.
