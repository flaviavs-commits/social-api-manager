# 🗂️ GUIA-PAINEL-DE-COLECAO-COM-FILTROS-E-VIEWS.md

> **O que é**: Um guia reutilizável para construir um **painel de coleção** — uma tela que lista muitos itens (cards) com **busca, filtros combináveis, ordenação, múltiplos modos de visualização (grade / lista / kanban), grade de colunas ajustável, header fixo e reordenação por arrastar**, tudo persistido no `localStorage`.
>
> **De onde vem**: Este padrão foi extraído da página `Home` (a tela "Meus Projetos") do projeto **Git-Hub-Repositories**.
>
> **Qual é o propósito dentro de `guias/`**: Registrar essa "casca de dashboard" como um bloco reaproveitável do `Felixo System Design`, separando a mecânica de layout/organização do produto original. Serve para qualquer coleção: projetos, produtos, tarefas, artigos, receitas, jogos, etc.
>
> **Quando usar**: sempre que você tiver uma **lista grande de itens homogêneos** e quiser dar ao usuário controle de como filtrar, ordenar e visualizar — sem reinventar a barra de ferramentas, os filtros e a persistência a cada projeto.

Este documento não explica o `Git-Hub-Repositories` inteiro. O foco é isolar a **camada de apresentação e organização** (estado, toolbar, filtros, views) que pode ser transportada para outros projetos trocando apenas o formato do item e o card.

---

## Visão geral

O painel é composto por **5 camadas**, de baixo para cima:

| Camada | Responsabilidade |
|---|---|
| **Modelo do item** | O formato mínimo que cada card precisa expor (nome, tags, dono, status, etc.). |
| **Estado + persistência** | `useState` para view/filtros/ordenação, salvos e restaurados do `localStorage` com sanitização. |
| **Derivação (`useMemo`)** | Aplica busca → filtros → ordenação sobre a lista bruta, uma vez por mudança. |
| **Toolbar + painel de filtros** | Header fixo com busca, alternador de views, seletor de colunas e o painel de filtros retrátil. |
| **Renderização por view** | Grade responsiva (colunas ajustáveis), lista ou kanban — todos consumindo a mesma lista derivada. |

A regra de ouro: **uma única lista derivada** (`filteredItems`) alimenta todas as views. Trocar de view nunca refaz a filtragem — só muda o container que desenha os cards.

---

## 1. Modelo do item

O painel não liga para o que o item **é**; ele só lê alguns campos para filtrar/ordenar. Defina um contrato mínimo e mantenha o resto opaco:

```js
/**
 * Campos que o painel consome. Tudo além disso é problema do card.
 * @typedef {Object} Item
 * @property {string}   id           - Identificador estável (usado em seleção/reordenação).
 * @property {string}   name         - Texto principal; alimenta a busca e a ordenação A-Z.
 * @property {string}  [description] - Texto secundário; entra na busca.
 * @property {string[]}[tags]        - Rótulos multivalorados (tecnologias, categorias…) → filtro por chips.
 * @property {string}  [owner]       - Autor/criador/responsável → filtro por chips.
 * @property {string}  [status]      - Estado do item (ex.: 'in-progress' | 'completed').
 * @property {string}  [complexity]  - Faixa ordinal (ex.: 'simple' | 'medium' | 'complex').
 * @property {string}  [group]       - Coluna no modo kanban.
 * @property {string}  [createdAt]   - Data ISO → ordenação por recência.
 */
```

> **Dica de portabilidade**: renomeie os campos para o seu domínio (`tags` → `ingredientes`, `owner` → `autor`, `complexity` → `dificuldade`). O que importa é **manter os tipos** (string, string[], data ISO) para que filtros e ordenação continuem funcionando.

---

## 2. Estado e persistência

Todo o controle do painel é estado local, com dois pontos salvos no `localStorage`: o **modo de visualização** e o **conjunto de filtros**. A persistência é defensiva — nunca confie no que está gravado.

### Chaves e defaults

```js
const VIEW_MODE_STORAGE_KEY = 'painelViewMode';
const FILTERS_STORAGE_KEY   = 'painelFilters';

const DEFAULT_VIEW_MODE  = 'grid';
const VALID_VIEW_MODES   = new Set(['grid', 'list', 'kanban']);
const VALID_SORT_OPTIONS = new Set(['createdAt', 'name', 'complexity', 'custom']);

const DEFAULT_FILTERS = {
  searchTerm: '',
  filterComplexity: 'all',
  filterStatus: 'all',
  filterTags: [],
  filterOwners: [],
  filterReadme: 'all',   // exemplo de filtro booleano ('all' | 'with' | 'without')
  sortBy: 'createdAt',
};
```

### Sanitização na leitura

O ponto mais importante da persistência: **normalizar** os dados lidos para nunca deixar um valor inválido (de uma versão antiga, ou adulterado) contaminar o estado.

```js
const sanitizeArray = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);

const normalizeFilters = (value) => {
  if (!value || typeof value !== 'object') return { ...DEFAULT_FILTERS };
  return {
    searchTerm: typeof value.searchTerm === 'string' ? value.searchTerm : DEFAULT_FILTERS.searchTerm,
    filterComplexity: VALID_COMPLEXITIES.has(value.filterComplexity) ? value.filterComplexity : 'all',
    filterStatus: VALID_STATUSES.has(value.filterStatus) ? value.filterStatus : 'all',
    filterTags: sanitizeArray(value.filterTags),
    filterOwners: sanitizeArray(value.filterOwners),
    filterReadme: VALID_README_FILTERS.has(value.filterReadme) ? value.filterReadme : 'all',
    sortBy: VALID_SORT_OPTIONS.has(value.sortBy) ? value.sortBy : DEFAULT_FILTERS.sortBy,
  };
};

const loadSavedFilters = () => {
  try {
    const raw = localStorage.getItem(FILTERS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_FILTERS };
    return normalizeFilters(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_FILTERS };
  }
};
```

### Inicialização e escrita

Carregue os filtros salvos **uma única vez** (via `useRef`, para não reler a cada render) e grave-os num `useEffect` sempre que mudarem:

```js
const initialFiltersRef = useRef(null);
if (!initialFiltersRef.current) initialFiltersRef.current = loadSavedFilters();
const initialFilters = initialFiltersRef.current;

const [viewMode, setViewMode]     = useState(() => {
  try {
    const saved = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    return VALID_VIEW_MODES.has(saved) ? saved : DEFAULT_VIEW_MODE;
  } catch { return DEFAULT_VIEW_MODE; }
});
const [gridColumns, setGridColumns] = useState(3);
const [searchTerm, setSearchTerm]   = useState(initialFilters.searchTerm);
const [filterTags, setFilterTags]   = useState(initialFilters.filterTags);
const [sortBy, setSortBy]           = useState(initialFilters.sortBy);
const [showFilters, setShowFilters] = useState(false);
// … demais filtros seguem o mesmo molde …

// Persiste o modo de visualização
useEffect(() => {
  try { localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode); } catch {}
}, [viewMode]);

// Persiste o conjunto de filtros
useEffect(() => {
  try {
    localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify({
      searchTerm, filterComplexity, filterStatus, filterTags, filterOwners, filterReadme, sortBy,
    }));
  } catch {}
}, [searchTerm, filterComplexity, filterStatus, filterTags, filterOwners, filterReadme, sortBy]);
```

> **Por que `useRef` para o valor inicial?** Um `useState(loadSavedFilters())` chamaria `loadSavedFilters()` em **todo** render (o React ignora o retorno, mas o custo de `JSON.parse` fica). O `useRef` garante leitura única. Alternativa equivalente: `useState(() => loadSavedFilters())` (inicializador preguiçoso).

---

## 3. Opções disponíveis derivadas dos dados

Tags e autores não são hardcoded: são **descobertos** a partir dos próprios itens, para o painel se adaptar a qualquer coleção.

```js
const usedTags = useMemo(() => {
  const set = new Set();
  items.forEach(i => Array.isArray(i.tags) && i.tags.forEach(t => set.add(t)));
  return Array.from(set).sort();
}, [items]);

const usedOwners = useMemo(() => {
  const set = new Set();
  items.forEach(i => i.owner && set.add(i.owner));
  return Array.from(set).sort();
}, [items]);
```

Assim os chips de filtro só mostram valores que **existem** — nunca uma tag órfã.

---

## 4. Header e toolbar

O header é **fixo no topo** (`sticky top-0 z-50`) e muda de largura conforme a view (kanban ocupa a tela toda; grade/lista ficam centradas num `max-w-7xl`):

```jsx
<header className="bg-dark-surface border-b border-dark-border sticky top-0 inset-x-0 z-50 w-full">
  <div className={viewMode === 'kanban'
    ? 'w-full px-4 sm:px-6 lg:px-8 py-6'
    : 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6'}>
    <div className="flex flex-col gap-4">
      {/* título + ações à direita … */}

      {/* Linha de busca + controles */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Busca */}
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar…"
            className="w-full pl-10 pr-4 py-2 bg-dark-bg border border-dark-border rounded-lg
                       text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
          />
        </div>

        <div className="flex gap-2">
          {/* Botão que abre/fecha o painel de filtros */}
          <button
            onClick={() => setShowFilters(v => !v)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors
              ${showFilters ? 'bg-blue-600 text-white' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
          >
            <SlidersHorizontal className="w-4 h-4" /> Filtros
          </button>

          {/* Seletor de colunas — só faz sentido na grade */}
          {viewMode === 'grid' && (
            <select
              value={gridColumns}
              onChange={(e) => setGridColumns(Number(e.target.value))}
              title="Colunas por linha"
              className="px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-white text-sm
                         focus:outline-none focus:border-blue-500"
            >
              {[2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n} colunas</option>)}
            </select>
          )}

          {/* Alternador de visualização */}
          <div className="flex bg-dark-bg border border-dark-border rounded-lg">
            <button onClick={() => setViewMode('grid')}   title="Grade"
              className={`p-2 ${viewMode === 'grid'   ? 'bg-dark-hover text-blue-400' : 'text-gray-400'}`}>
              <Grid3x3 className="w-5 h-5" />
            </button>
            <button onClick={() => setViewMode('list')}   title="Lista"
              className={`p-2 ${viewMode === 'list'   ? 'bg-dark-hover text-blue-400' : 'text-gray-400'}`}>
              <List className="w-5 h-5" />
            </button>
            <button onClick={() => setViewMode('kanban')} title="Kanban"
              className={`p-2 ${viewMode === 'kanban' ? 'bg-dark-hover text-blue-400' : 'text-gray-400'}`}>
              <Columns className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {showFilters && <FilterPanel /* … */ />}
    </div>
  </div>
</header>
```

Ícones vêm do **lucide-react** (`Search`, `SlidersHorizontal`, `Grid3x3`, `List`, `Columns`, `Tag`, `User`, `X`).

---

## 5. Painel de filtros retrátil

Renderizado condicionalmente (`showFilters`) com uma animação de entrada `animate-slideDown` (ver §8). Combina dois tipos de controle:

- **`<select>`** para filtros de valor único (ordenação, complexidade, status, booleanos).
- **chips clicáveis** para filtros multivalorados (tags, autores) — cada chip alterna um valor.

```jsx
{showFilters && (
  <div className="flex flex-wrap gap-4 p-4 bg-dark-bg border border-dark-border rounded-lg animate-slideDown">

    {/* Ordenar por */}
    <div className="flex-1 min-w-[200px]">
      <label className="block text-sm text-gray-400 mb-2">Ordenar por</label>
      <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}
        className="w-full px-3 py-2 bg-dark-surface border border-dark-border rounded text-white focus:border-blue-500">
        <option value="createdAt">Data de criação</option>
        <option value="name">Nome (A-Z)</option>
        <option value="complexity">Complexidade</option>
        <option value="custom">Customizado (arraste para reordenar)</option>
      </select>
      {sortBy === 'custom' && <p className="text-xs text-blue-400 mt-1">💡 Arraste os cards para reordenar</p>}
    </div>

    {/* Filtros de valor único: mesmo molde para complexidade, status, etc. */}
    <div className="flex-1 min-w-[200px]">
      <label className="block text-sm text-gray-400 mb-2">Status</label>
      <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
        className="w-full px-3 py-2 bg-dark-surface border border-dark-border rounded text-white focus:border-blue-500">
        <option value="all">Todos</option>
        <option value="in-progress">Em andamento</option>
        <option value="completed">Finalizados</option>
      </select>
    </div>

    {/* Filtro multivalorado por chips (tags) */}
    {usedTags.length > 0 && (
      <div className="w-full">
        <label className="block text-sm text-gray-400 mb-2"><Tag className="w-4 h-4 inline mr-1" /> Filtrar por tag</label>
        <div className="flex flex-wrap gap-2">
          {usedTags.map(tag => (
            <button key={tag} onClick={() => toggleTagFilter(tag)}
              className={`px-3 py-1 rounded-lg text-sm flex items-center gap-1 transition-colors
                ${filterTags.includes(tag)
                  ? 'bg-blue-600 text-white'
                  : 'bg-dark-surface border border-dark-border text-gray-300 hover:bg-dark-hover'}`}>
              <Tag className="w-3 h-3" /> {tag}
              {filterTags.includes(tag) && <X className="w-3 h-3 ml-1" />}
            </button>
          ))}
        </div>
        {filterTags.length > 0 && (
          <button onClick={() => setFilterTags([])} className="mt-2 text-xs text-gray-400 hover:text-white">
            Limpar filtros de tag
          </button>
        )}
      </div>
    )}
  </div>
)}
```

O toggle de um chip é um `set` imutável clássico:

```js
const toggleTagFilter = (tag) =>
  setFilterTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
```

---

## 6. A lógica de filtragem e ordenação

O coração do painel: **um único `useMemo`** que aplica, em ordem, busca → filtros → ordenação. Roda só quando uma dependência muda; as views apenas consomem o resultado.

```js
const filteredItems = useMemo(() => {
  let out = [...items];

  // 1) Busca (nome + descrição + tags)
  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    out = out.filter(i =>
      i.name.toLowerCase().includes(q) ||
      i.description?.toLowerCase().includes(q) ||
      i.tags?.some(t => t.toLowerCase().includes(q))
    );
  }

  // 2) Filtros de valor único
  if (filterComplexity !== 'all') out = out.filter(i => i.complexity === filterComplexity);
  if (filterStatus !== 'all')     out = out.filter(i =>
    filterStatus === 'completed' ? i.isCompleted : !i.isCompleted);

  // 3) Filtros multivalorados — 'every' = E lógico (item precisa ter TODAS as tags marcadas)
  if (filterTags.length > 0)   out = out.filter(i =>
    filterTags.every(t => Array.isArray(i.tags) && i.tags.includes(t)));
  if (filterOwners.length > 0) out = out.filter(i => i.owner && filterOwners.includes(i.owner));

  // 4) Ordenação
  out.sort((a, b) => {
    switch (sortBy) {
      case 'name':       return a.name.localeCompare(b.name);
      case 'createdAt':  return new Date(b.createdAt) - new Date(a.createdAt);
      case 'complexity': {
        const order = { simple: 0, medium: 1, complex: 2, unfeasible: 3 };
        return order[a.complexity] - order[b.complexity];
      }
      case 'custom': {                         // ordem manual salva pelo drag-and-drop
        const ia = customOrder.indexOf(a.id);
        const ib = customOrder.indexOf(b.id);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return 0;
      }
      default: return 0;
    }
  });

  return out;
}, [items, searchTerm, filterComplexity, filterStatus, filterTags, filterOwners, sortBy, customOrder]);
```

**Decisões que valem a pena copiar:**

- **`every` vs `some`** nos filtros multivalorados define a semântica: `every` = "tem todas as tags marcadas" (interseção, mais restritivo); troque por `some` se quiser "tem qualquer uma" (união).
- **Ordinal por mapa** (`{ simple: 0, … }`) ordena categorias não-alfabéticas na ordem certa.
- **Ordem `custom`** delega a um array de ids (`customOrder`) salvo separadamente — itens fora do array caem no fim, preservando estabilidade.

---

## 7. As três visualizações

Todas partem da **mesma** `filteredItems`. O que muda é só a classe do container:

```jsx
<div className={
  viewMode === 'grid'
    ? `grid gap-6 ${
        gridColumns === 2 ? 'grid-cols-1 md:grid-cols-2' :
        gridColumns === 3 ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3' :
        gridColumns === 4 ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' :
        gridColumns === 5 ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5' :
                            'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6'
      }`
    : viewMode === 'list'
    ? 'space-y-4'
    : 'flex gap-4 h-[calc(100vh-250px)] px-4 sm:px-6 lg:px-8'  /* kanban: colunas roláveis */
}>
  {viewMode === 'kanban'
    ? <KanbanBoard groups={groups} items={filteredItems} /* … */ />
    : filteredItems.map(item => <ItemCard key={item.id} item={item} view={viewMode} />)}
</div>
```

| View | Container | Observações |
|---|---|---|
| **Grade** | `grid` + `grid-cols-*` responsivo | O número de colunas é **explícito por breakpoint** — nunca pule de 1 para 6 no mobile. `gridColumns` só sobe o teto nos breakpoints grandes (`xl`, `2xl`). |
| **Lista** | `space-y-4` | Uma coluna; o card decide render "horizontal" via a prop `view`. |
| **Kanban** | `flex` horizontal com altura fixa | Colunas por `group`; scroll horizontal. Header vira largura total nessa view. |

> **Por que classes explícitas e não `grid-cols-${n}`?** O Tailwind faz *purge* das classes por análise estática do código-fonte. Uma classe interpolada (`grid-cols-${gridColumns}`) **não existe** no build final e simplesmente não aplica. Sempre escreva os nomes completos (ou use `safelist` no `tailwind.config`).

---

## 8. Reordenação por arrastar (opcional)

O modo de ordenação `custom` e o kanban usam **[@dnd-kit](https://dndkit.com/)**. O essencial:

```jsx
import { DndContext } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';

// grade/kanban usam rectSortingStrategy; lista usa verticalListSortingStrategy
const strategy = viewMode === 'list' ? verticalListSortingStrategy : rectSortingStrategy;

<DndContext onDragEnd={handleDragEnd}>
  <SortableContext items={itemIds} strategy={strategy}>
    {/* cards … */}
  </SortableContext>
</DndContext>

function handleDragEnd({ active, over }) {
  if (!over || active.id === over.id) return;
  const next = arrayMove(itemIds, itemIds.indexOf(active.id), itemIds.indexOf(over.id));
  setCustomOrder(next);          // vira a fonte da ordenação 'custom'
  saveCustomOrder(next);         // persiste (localStorage / backend)
}
```

Ao soltar um card, grave a nova ordem e mude `sortBy` para `'custom'` — o `useMemo` da §6 passa a respeitar o array.

---

## 9. Tokens de design e animações

O visual é **dark-first**, com 4 tokens de cor no `tailwind.config.js` e algumas animações no CSS global.

```js
// tailwind.config.js
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: { extend: { colors: { dark: {
    bg:      '#0d1117',  // fundo da página
    surface: '#161b22',  // header, painéis, cards
    border:  '#30363d',  // bordas
    hover:   '#21262d',  // estado hover / view ativa
  } } } },
};
```

```css
/* index.css — painel de filtros entra deslizando */
@keyframes slideDown {
  0%   { opacity: 0; transform: translateY(-10px); max-height: 0; }
  100% { opacity: 1; transform: translateY(0);     max-height: 500px; }
}
.animate-slideDown { animation: slideDown 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards; }

/* Scrollbar discreto combinando com o tema (útil no kanban) */
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: #161b22; }
::-webkit-scrollbar-thumb { background: #30363d; border-radius: 5px; }
::-webkit-scrollbar-thumb:hover { background: #484f58; }
```

| Token / classe | Onde aparece |
|---|---|
| `bg-dark-surface` | Header, painel de filtros, cards |
| `bg-dark-bg` | Fundo da página, inputs |
| `border-dark-border` | Todas as bordas |
| `bg-dark-hover text-blue-400` | Botão da **view ativa** no alternador |
| `.animate-slideDown` | Entrada do painel de filtros |

---

## Como reproduzir (passo a passo)

1. **Stack**: React + Tailwind CSS. Ícones via `lucide-react`. Reordenação opcional via `@dnd-kit/core` + `@dnd-kit/sortable`.
2. **Tokens**: adicione o bloco `colors.dark` ao `tailwind.config.js` e as animações/scrollbar ao CSS global (§9).
3. **Modelo**: mapeie seu item para o contrato mínimo (§1) — renomeie os campos, mantenha os tipos.
4. **Estado + persistência**: copie as chaves, defaults, `sanitizeArray`/`normalizeFilters`/`loadSavedFilters` e os dois `useEffect` de gravação (§2). **Troque os prefixos das storage keys** para não colidir com outros painéis.
5. **Opções derivadas**: gere `usedTags`/`usedOwners` a partir dos dados (§3).
6. **Toolbar**: monte o header fixo com busca, botão de filtros, seletor de colunas e alternador de views (§4).
7. **Painel de filtros**: adicione os `<select>` de valor único e os chips de tag/autor com `toggle*` (§5).
8. **Derivação**: implemente o `useMemo` de `filteredItems` (§6), ajustando os campos e a semântica `every`/`some`.
9. **Views**: escreva o container com o mapa de `grid-cols-*` explícito, `space-y-4` e o kanban (§7).
10. **(Opcional)** Ative o drag-and-drop e a ordenação `custom` (§8).

### O que customizar primeiro

| O que | Onde mexer |
|---|---|
| **Campos do item** | O contrato da §1 e os acessos em `filteredItems` |
| **Quais filtros existem** | Adicione/remova blocos no painel (§5) e cláusulas no `useMemo` (§6) |
| **E lógico vs OU** nas tags | `every` → `some` na §6 |
| **Nº de colunas / breakpoints** | O mapa `grid-cols-*` na §7 |
| **Paleta** | Os 4 tokens `dark.*` no `tailwind.config.js` |
| **Prefixo das storage keys** | `VIEW_MODE_STORAGE_KEY` / `FILTERS_STORAGE_KEY` |

---

## Referência de arquivos (no projeto original)

| Arquivo | O que faz |
|---|---|
| `src/pages/Home.jsx` | Página do painel: estado, persistência, `useMemo` de filtragem, toolbar, painel de filtros e as três views |
| `src/components/ProjectCard.jsx` | O card individual (recebe `viewMode` para render grade/lista) |
| `src/utils/storage.js` | Persistência de ordem customizada e grupos (`getCustomOrder`, `saveCustomOrder`, grupos do kanban) |
| `src/index.css` | Animações (`slideDown`, drag), scrollbar customizado e reset dark |
| `tailwind.config.js` | Tokens de cor `dark.*` |

---

## Resumo da receita

1. **Uma lista derivada** (`filteredItems`) alimenta **todas** as views — trocar de view nunca refiltra.
2. **Pipeline claro** no `useMemo`: busca → filtros de valor único → filtros multivalorados → ordenação.
3. **Persistência defensiva**: salve view e filtros no `localStorage`, mas **sanitize sempre** na leitura.
4. **Opções descobertas dos dados** (tags/autores), nunca hardcoded.
5. **Header fixo** que muda de largura por view; toolbar com busca + filtros + colunas + alternador.
6. **Painel de filtros retrátil** combinando `<select>` (valor único) e chips (multivalorado).
7. **Grade com `grid-cols-*` explícito por breakpoint** — nada de classe interpolada (o purge do Tailwind a descarta).
8. **`every` vs `some`** decide a semântica dos filtros de tag (interseção vs união).
9. **Drag-and-drop opcional** (@dnd-kit) alimenta a ordenação `custom`.
10. **Dark-first** com 4 tokens de cor + animação `slideDown` para o painel.

---

> **Assinatura de Origem**
> Este arquivo foi criado por **Felipe Martin** e faz parte do repositório **Felixo System Design**.
> Origem: https://github.com/Felipe-Alcantara/Felixo-System-Design
> Extraído de: **Git-Hub-Repositories** (página `Home` / "Meus Projetos").
> Data desta versão: 2026-07-07
> Sugestões e pull requests são bem-vindos.
