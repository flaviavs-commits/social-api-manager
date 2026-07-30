# GUIA MINIMO DE QUALIDADE DE SOFTWARE

> **O que e**: Um contrato curto de qualidade para qualquer projeto que use o `Felixo System Design`.
>
> **Quando usar**: Sempre. Este arquivo deve ser lido antes dos design systems completos quando a sessao precisa de um resumo rapido dos padroes obrigatorios.
>
> **Objetivo**: Preservar qualidade de software sem depender de documentos longos, memoria da conversa ou interpretacao livre do modelo.

---

## 1. Regra central

Nenhuma entrega deve ser tratada como pronta se ela melhora uma parte do sistema enquanto piora arquitetura, seguranca, manutencao, documentacao ou previsibilidade.

Quando houver duvida, siga os documentos completos:

- Backend: [`DESIGN_SYSTEM_BACKEND.md`](DESIGN_SYSTEM_BACKEND.md)
- Frontend: [`DESIGN_SYSTEM_FRONTEND.md`](DESIGN_SYSTEM_FRONTEND.md)
- README: [`DESIGN_SYSTEM_README.md`](DESIGN_SYSTEM_README.md)
- Contexto operacional: [`TEMPLATE-CONTEXTO-IA.md`](TEMPLATE-CONTEXTO-IA.md)
- Menu de entrada (start app): [`GUIA-START-APP-SCRIPT.md`](GUIA-START-APP-SCRIPT.md)

---

## 2. Padroes obrigatorios

1. **Entender antes de alterar**
   - Leia a estrutura existente, identifique o padrao local e preserve a intencao do projeto.
   - Nao invente stack, arquitetura ou convencao se o repositorio ja define uma.

2. **Manter responsabilidades separadas**
   - Regra de negocio nao fica misturada com view/controller, acesso a banco, UI ou integracao externa.
   - Arquivos "faz-tudo" devem ser tratados como sinal de refatoracao.

3. **Preferir simplicidade verificavel**
   - Use a solucao mais simples que resolva o problema real.
   - Nao adicione camada, dependencia, fila, microservico ou abstracao sem justificativa concreta.

4. **Preservar contratos**
   - APIs, DTOs, modelos, props, eventos e formatos de resposta devem ser estaveis.
   - Mudanca quebradora precisa ser explicita, documentada e justificada.

5. **Validar entradas e erros**
   - Toda entrada externa deve ser validada.
   - Erros precisam ser previsiveis, compreensiveis e seguros para quem consome o sistema.
   - Cubra os riscos classicos (OWASP Top 10) na camada certa: injecao (SQL/comando), XSS, CSRF e falhas de autenticacao/autorizacao. Checklist detalhado nos design systems de backend e frontend.

6. **Proteger dados e segredos**
   - Nunca registre tokens, senhas, cookies, dados pessoais ou HTML sensivel em repositorio publico.
   - Logs devem ajudar debug sem vazar segredo.
   - Dependencias tambem sao superficie de ataque: pine versoes, commite o lockfile e rode auditoria (`pip-audit`, `npm audit`) quando adicionar ou atualizar dependencia.

7. **Testar comportamento importante**
   - Regras criticas, bugs corrigidos, contratos de API, parser, autenticacao e fluxo destrutivo precisam de teste quando aplicavel.
   - Se nao houver teste automatico viavel, registre verificacao manual objetiva.
   - **Regua unica de testes** (vale para backend e frontend): teste automatizado e obrigatorio para logica de negocio, contrato e correcao de bug; e opcional para UI puramente visual — nesse caso, registre a verificacao manual feita.
   - **Validacao exige evidencia real**: nao declare uma entrega pronta sem executar o codigo (ou os testes) e observar a saida real. "Deve funcionar" nao e validacao; saida de execucao e.
   - **Anti-alucinacao**: antes de usar uma API, biblioteca, metodo ou opcao de configuracao, confirme que ela existe na versao instalada (doc oficial, codigo-fonte ou execucao). Nao presuma de memoria.

8. **Documentar estado relevante**
   - README explica uso, setup e decisao importante.
   - `IA.md` registra contexto operacional, decisoes, bugs relevantes, testes e proximos passos.
   - `IA.md` deve preservar a linha do tempo do projeto: nao apague nem reescreva registros antigos para "corrigir" uma decisao anterior; adicione um novo registro datado explicando a mudanca, o motivo e a validacao.
   - Como a maioria dos projetos e open source, escreva documentacao e logs com linguagem geral e acessivel, sem valores hardcoded e sem depender de contexto privado.
   - Enquadre trabalho futuro como convite a contribuicao: prefira "ideias para quem quiser contribuir" ou "melhorias que o projeto poderia expandir" em vez de "features futuras para implementar". Detalhes em [`DESIGN_SYSTEM_README.md`](DESIGN_SYSTEM_README.md), secao 3.5.

9. **Preferir automacao e ferramenta reutilizavel (nao descuidar da qualidade)**
   - **Regra explicita**: toda vez que o agente precisar fazer uma mudanca manual — em dados de um sistema externo (ex.: Notion, planilhas, APIs) ou em qualquer projeto que use este padrao de qualidade — ele deve preferir usar scripts e automacoes para manipular os dados, nunca a edicao manual como primeiro recurso.
   - **Por que**: scripts reutilizaveis viram patrimonio do projeto. Modelos de IA cada vez mais inteligentes podem ler, melhorar e estender essas ferramentas ao longo do tempo — o ecossistema se aprimora naturalmente a cada geracao de modelo. Uma mudanca manual nao deixa rastro reutilizavel; um script deixa.
   - Ao alterar codigo, conteudo estruturado ou dados, procure primeiro se ja existe script, comando, automacao ou ferramenta para esse tipo de mudanca.
   - Se a base existente quase resolve, prefira estender a automacao atual em vez de fazer ajuste manual pontual.
   - Edicao manual e excecao: use apenas quando automacao nao for viavel ou quando o custo de criar a ferramenta for maior do que o ganho real.
   - Quando houver excecao manual, registre a decisao e o motivo de forma objetiva para manter o historico auditavel e repetivel.
   - **Scripts e automacoes nao sao "codigo descartavel"**: eles devem seguir os MESMOS padroes de qualidade do projeto (responsabilidade separada, estrutura clara, sem hardcodes, com documentacao, com tratamento de erros). Desorganizacao ou codigo de baixa qualidade em scripts piora a manutencao tanto quanto em qualquer outra parte do sistema.
   - Organize scripts em pastas apropriadas (ex: `scripts/`, `tools/`, conforme o projeto define), nao na raiz. Se o projeto define um padrao para onde scripts vivem, preserve-o; se nao define, crie uma convencao clara e documente no README.
   - Scripts devem ser estaveis e reutilizaveis: se um script sera usado mais de uma vez, trate-o como codigo de producao, nao como prototipo descartavel.

10. **Fazer mudanca pequena e rastreavel**
   - Prefira entregas coesas, com escopo claro.
   - Nao misture refatoracao ampla com feature sem necessidade.
   - **Versionamento (git):** commite direto no `main` por padrao; so crie branch para feature grande, refatoracao significativa ou alto risco. Commits pequenos no formato `tipo: descricao` (`feat`/`fix`/`docs`/`refactor`/`chore`), explicando o que e por que. Politica completa em [`../docs/GIT-POLITICA-DE-VERSIONAMENTO.md`](../docs/GIT-POLITICA-DE-VERSIONAMENTO.md).

11. **Entregar um menu de entrada (`start_app.py`) em todo programa**
    - Todo programa (web, CLI, automacao, script, desktop) deve ter um `start_app.py` na raiz que abre um **menu interativo, colorido e descritivo** — a porta de entrada unica por onde a pessoa instala, configura, inicia e deixa o programa pronto (`python start_app.py`).
    - Sempre menu interativo, nunca flags decoradas; nada de prompt cru "digite a letra". Menu minimo: Iniciar/Rodar, Instalar/Setup, Configurar, Status/Sair.
    - Cross-platform, com mensagens de erro claras, para facilitar quem nao tem facilidade com terminal.
    - Excecao coerente com o item 3 (simplicidade): script interno pequeno e de uso pontual, sem usuario final, pode dispensar o menu — registre a excecao e o motivo. O padrao completo continua obrigatorio para qualquer programa com usuarios.
    - Detalhes em [`GUIA-START-APP-SCRIPT.md`](GUIA-START-APP-SCRIPT.md).

12. **Finalizar com criterio de pronto**
    - Codigo/guia revisado.
    - Links internos validos.
    - Testes ou verificacoes executados.
    - Riscos, limites e pendencias registrados.

13. **Ser multiplataforma por padrao (Windows, Linux, macOS)**
    - Todo programa gerado sob este padrao de qualidade deve rodar em Windows, Linux e macOS por padrao, mesmo que o agente esteja construindo/testando em apenas um sistema operacional no momento. Nao presuma o SO de quem vai rodar o projeto a partir do SO da sessao atual.
    - Evite caminho, separador, comando de shell, variavel de ambiente ou API do sistema de arquivos especifica de um SO. Use as abstracoes da linguagem/framework (ex.: `pathlib`/`os.path` em vez de strings com `/` ou `\` fixos, `sys.executable`, `webbrowser`) e bibliotecas cross-platform.
    - Se uma dependencia ou integracao so existir para um SO, documente a limitacao explicitamente (README/`IA.md`) e ofereça alternativa ou fallback quando possivel; nao vire padrao implicito do projeto.
    - Excecao coerente com o item 3 (simplicidade): script interno pequeno, de uso pontual e sem usuario final, pode ser especifico de um SO — registre a excecao e o motivo. Qualquer programa com usuario final ou reuso continua exigindo suporte multi-SO.
    - Testes/verificacoes que dependem de SO (ex.: instaladores, scripts de shell) devem cobrir os sistemas relevantes ou registrar verificacao manual objetiva por SO nao testado automaticamente.

---

## 3. Checklist rapido antes de encerrar

- [ ] A solucao segue o padrao existente do repositorio.
- [ ] As responsabilidades continuam separadas.
- [ ] Nao ha segredo, dado sensivel ou URL privada exposta.
- [ ] Contratos afetados foram preservados ou documentados.
- [ ] Testes/verificacoes relevantes foram executados ou justificados.
- [ ] O codigo foi executado de verdade e a saida real foi observada (nao apenas "deve funcionar").
- [ ] APIs, bibliotecas e metodos usados existem na versao instalada (verificado, nao presumido).
- [ ] Dependencias novas/atualizadas estao pinadas, com lockfile commitado e auditoria rodada.
- [ ] Scripts, automacoes e ferramentas reutilizaveis foram priorizados antes de editar manualmente (inclusive para manipular dados em sistemas externos, como o Notion); se houve excecao manual, ela foi registrada com o motivo.
- [ ] Qualidade de scripts: organizados em pasta apropriada (nao na raiz), com responsabilidade clara, tratamento de erros, sem hardcodes, documentados; seguem os mesmos padroes do projeto, nao sao codigo descartavel.
- [ ] Documentacao e logs usam linguagem geral/open source, sem valores hardcoded, e enquadram trabalho futuro como convite a contribuicao.
- [ ] Todo programa tem `start_app.py` com menu interativo (Iniciar/Rodar, Instalar/Setup, Configurar, Status/Sair) funcionando.
- [ ] O programa e multiplataforma por padrao (Windows, Linux, macOS): sem caminho/comando/API preso a um SO so; excecoes pontuais foram registradas com o motivo.
- [ ] README, `IA.md` ou guia afetado foram atualizados quando necessario.
- [ ] O `IA.md` preserva o historico: decisoes novas foram adicionadas como registros datados, sem apagar a linha de raciocinio anterior.
- [ ] O versionamento segue [`../docs/GIT-POLITICA-DE-VERSIONAMENTO.md`](../docs/GIT-POLITICA-DE-VERSIONAMENTO.md): mudanca no `main` (ou branch justificada), commit pequeno no formato `tipo: descricao`, doc atualizada no mesmo passo.
- [ ] O proximo mantenedor consegue entender a decisao sem reler toda a conversa.

---

## 4. Frase de controle

Se a entrega nao puder responder claramente **o que mudou**, **por que mudou**, **como foi validado** e **qual risco sobrou**, ela ainda nao esta pronta.
