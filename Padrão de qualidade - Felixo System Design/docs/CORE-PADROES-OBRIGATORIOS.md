# Core — Padroes Obrigatorios

A pasta [`core/`](../core/) concentra os artefatos que devem acompanhar **todo projeto**. Ela separa padroes tecnicos de qualidade, prompts operacionais para IA e template de memoria operacional.

> Voltar ao [README](../README.md).

## Design System Frontend

Guia completo de padronizacao visual para front-end, extraido do **FelixoVerse**. Documenta paleta, tipografia, layout, componentes, animacoes e padroes de interface. Inclui separacao explicita entre principios universais e escolhas especificas do FelixoVerse, alem dos baselines obrigatorios de **acessibilidade** (teclado, foco visivel, contraste AA) e **seguranca no frontend** (XSS, tokens, links externos).

[Ver design system frontend](../core/DESIGN_SYSTEM_FRONTEND.md)

## Design System Backend

Guia de **qualidade de sistema backend**. Define principios de arquitetura, escolha de stack (fonte canonica), modularizacao forte, separacao de responsabilidades, estrutura por camadas, padroes de API, persistencia, testes, TDD, SQLite como padrao inicial, Open/Closed, documentacao viva, checklist OWASP minimo, dependencias pinadas com auditoria e checklist de qualidade.

[Ver design system backend](../core/DESIGN_SYSTEM_BACKEND.md)

## Design System README

Guia de padronizacao para `README.md`, usado como referencia para manter documentacao consistente entre projetos.

[Ver design system README](../core/DESIGN_SYSTEM_README.md)

## Guia Minimo de Qualidade

Contrato curto e obrigatorio para preservar qualidade de software em qualquer projeto. Resume os padroes essenciais de arquitetura, seguranca, testes, documentacao, criterio de pronto e a regra de priorizar scripts, automacoes e ferramentas reutilizaveis antes de recorrer a edicao manual. Inclui a regua unica de testes e as regras anti-alucinacao: validacao exige execucao real com saida observada, e toda API usada deve existir na versao instalada.

[Ver guia minimo de qualidade](../core/GUIA_MINIMO_QUALIDADE.md)

## Start App Script (obrigatorio por programa)

Contrato obrigatorio: **todo programa** (web, CLI, automacao, script, desktop) deve ter um `start_app.py` na raiz que abre um **menu interativo, colorido e descritivo** — a porta de entrada unica por onde a pessoa instala, configura, inicia e deixa o programa pronto (`python start_app.py`). Sempre menu, nunca flags decoradas; nada de prompt cru "digite a letra". Menu minimo: Iniciar/Rodar, Instalar/Setup, Configurar, Status/Sair. Facilita quem nao tem facilidade com terminal e padroniza a porta de entrada de qualquer projeto.

[Ver guia do start app script](../core/GUIA-START-APP-SCRIPT.md)

## Prompt Base Backend

Guia tecnico para montar prompts de backend completos na primeira interacao. Inclui stacks recomendadas, decisoes tecnicas por cenario e exige que a IA siga o `DESIGN_SYSTEM_BACKEND.md` como contrato de qualidade.

[Ver prompt base backend](../core/PROMPT_BASE_BACKEND.md)

## Prompt Base Frontend

Guia tecnico para montar prompts de frontend completos na primeira interacao. Inclui stacks recomendadas, decisoes visuais por cenario, campos para componentes, identidade visual, responsividade e animacoes.

[Ver prompt base frontend](../core/PROMPT_BASE_FRONTEND.md)

## TEMPLATE-CONTEXTO-IA.md — Template de Contexto Operacional

Template padrao de **memoria operacional** para projetos com IA. Deve ser copiado para o projeto destino **como `IA.md`** e preenchido continuamente durante o desenvolvimento para registrar:

- objetivo atual e milestones
- decisoes tecnicas
- stack e convencoes
- bugs e correcoes relevantes
- testes importantes
- contexto necessario para outra IA retomar o trabalho sem reler tudo

O `IA.md` deve ser tratado como **linha do tempo**, nao como resumo reescrito: quando uma decisao tecnica mudar, preserve o registro anterior e acrescente uma nova entrada datada com contexto, motivo e validacao. Ele tambem traz uma secao **Estado atual (resumo vivo)** reescrevivel para retomada rapida e uma estrategia de **compactacao sem perda**: quando o arquivo crescer demais, registros antigos sao movidos (nunca apagados) para `docs/ia-archive/`.

[Ver o template](../core/TEMPLATE-CONTEXTO-IA.md)
