# Tokens visuais globais

O frontend usa `frontend/src/styles/tokens.css` como fonte única para a identidade do produto.

## Papéis de marca

- `--brand-paper`: fundo principal, creme no tema claro e papel escuro quente no tema escuro.
- `--brand-surface` e `--brand-surface-soft`: superfícies e variações de separação.
- `--brand-ink`, `--brand-ink-secondary`, `--brand-ink-muted`: hierarquia de texto.
- `--brand-gold`, `--brand-gold-strong`, `--brand-gold-bright`: ação e assinatura visual.
- `--brand-on-gold`: texto/ícone sobre dourado.
- `--brand-border` e `--brand-border-hover`: separação estrutural.

Os aliases legados (`--app-bg`, `--surface`, `--accent`, `--text` e equivalentes) apontam para esses papéis. A landing mantém `--mkt-*` apenas como aliases de compatibilidade; os valores vêm dos tokens globais.

Estados de sucesso, erro, aviso e informação continuam com tokens próprios e não devem ser substituídos por dourado.
