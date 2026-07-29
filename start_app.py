#!/usr/bin/env python3
"""Porta de entrada do MeuEcooMedia.

    python start_app.py

Abre um menu interativo onde da pra instalar, configurar, iniciar e conferir
o estado do projeto, sem precisar decorar comando nenhum.

O script apenas orquestra npm/node: nao guarda segredo, nao edita logica e
nao substitui o package.json. Segue o GUIA-START-APP-SCRIPT do Felixo
System Design.
"""

from __future__ import annotations

import os
import platform
import shutil
import socket
import subprocess
import sys
import webbrowser
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
ENV = RAIZ / ".env"
ENV_EXEMPLO = RAIZ / ".env.example"
NODE_MODULES = RAIZ / "node_modules"
PORTA_PADRAO = 3000


# ----------------------------------------------------------------------------
# Bootstrap das dependencias de TUI
#
# O menu usa questionary + rich. Se faltarem, oferecemos instalar na hora --
# sem isso o script nao conseguiria nem desenhar o proprio menu.
# ----------------------------------------------------------------------------
def _garantir_tui() -> None:
    try:
        import questionary  # noqa: F401
        import rich  # noqa: F401
        return
    except ImportError:
        pass

    print("O menu precisa das bibliotecas 'questionary' e 'rich'.")
    resposta = input("Instalar agora com pip? [S/n] ").strip().lower()
    if resposta not in ("", "s", "sim", "y", "yes"):
        print("\nSem elas o menu nao abre. Para instalar manualmente:")
        print(f"  {sys.executable} -m pip install questionary rich")
        sys.exit(1)

    try:
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "questionary", "rich"],
            check=True,
        )
    except subprocess.CalledProcessError:
        print("\nNao consegui instalar. Tente manualmente:")
        print(f"  {sys.executable} -m pip install questionary rich")
        sys.exit(1)


_garantir_tui()

import questionary  # noqa: E402
from questionary import Style  # noqa: E402
from rich.console import Console  # noqa: E402
from rich.panel import Panel  # noqa: E402
from rich.table import Table  # noqa: E402

console = Console()

ESTILO = Style([
    ("qmark", "fg:#22d3ee bold"),
    ("question", "bold"),
    ("pointer", "fg:#22d3ee bold"),
    ("highlighted", "fg:#22d3ee bold"),
    ("selected", "fg:#22d3ee"),
])


# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------
def npm() -> str | None:
    """Caminho do npm. No Windows o executavel e npm.cmd."""
    return shutil.which("npm") or shutil.which("npm.cmd")


def versao_node() -> str | None:
    caminho = shutil.which("node")
    if not caminho:
        return None
    try:
        saida = subprocess.run(
            [caminho, "--version"], capture_output=True, text=True, timeout=10
        )
        return saida.stdout.strip() or None
    except (subprocess.SubprocessError, OSError):
        return None


def porta_configurada() -> int:
    """Le PORT do .env; cai para o default se ausente ou invalido."""
    if ENV.exists():
        try:
            for linha in ENV.read_text(encoding="utf-8").splitlines():
                linha = linha.strip()
                if linha.startswith("PORT=") and not linha.startswith("#"):
                    return int(linha.split("=", 1)[1].strip() or PORTA_PADRAO)
        except (ValueError, OSError):
            pass
    return PORTA_PADRAO


def porta_ocupada(porta: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", porta)) == 0


def variaveis_faltando() -> list[str]:
    """Variaveis obrigatorias sem valor no .env."""
    obrigatorias = [
        "DATABASE_URL",
        "AUTH_TOKEN_SECRET",
        "SESSION_SECRET",
        "TOKEN_ENCRYPTION_KEY",
    ]
    if not ENV.exists():
        return obrigatorias

    preenchidas = set()
    try:
        for linha in ENV.read_text(encoding="utf-8").splitlines():
            linha = linha.strip()
            if not linha or linha.startswith("#") or "=" not in linha:
                continue
            chave, valor = linha.split("=", 1)
            if valor.strip():
                preenchidas.add(chave.strip())
    except OSError:
        return obrigatorias

    return [v for v in obrigatorias if v not in preenchidas]


def rodar(args: list[str], titulo: str) -> bool:
    """Executa um comando mostrando a saida ao vivo. True se deu certo."""
    console.print(f"\n[cyan]>[/cyan] {titulo}")
    console.print(f"[dim]  {' '.join(args)}[/dim]\n")
    try:
        subprocess.run(args, cwd=RAIZ, check=True)
        console.print(f"\n[green]OK[/green] {titulo}")
        return True
    except FileNotFoundError:
        console.print(f"\n[red]ERRO[/red] Comando nao encontrado: {args[0]}")
        console.print("  Instale o Node.js 20+ em https://nodejs.org")
        return False
    except subprocess.CalledProcessError as e:
        console.print(f"\n[red]ERRO[/red] {titulo} (codigo {e.returncode})")
        return False
    except KeyboardInterrupt:
        console.print("\n[yellow]Interrompido.[/yellow]")
        return False


def pausar() -> None:
    console.print()
    questionary.press_any_key_to_continue("Enter para voltar ao menu...").ask()


# ----------------------------------------------------------------------------
# Acoes
# ----------------------------------------------------------------------------
def acao_status() -> None:
    console.print()
    tabela = Table(title="Estado do projeto", title_style="bold", show_lines=False)
    tabela.add_column("Item")
    tabela.add_column("Estado")

    node = versao_node()
    tabela.add_row(
        "Node.js",
        f"[green]{node}[/green]" if node else "[red]nao encontrado (precisa 20+)[/red]",
    )
    tabela.add_row(
        "npm",
        "[green]disponivel[/green]" if npm() else "[red]nao encontrado[/red]",
    )
    tabela.add_row(
        "Dependencias",
        "[green]instaladas[/green]" if NODE_MODULES.exists()
        else "[yellow]faltando — use Instalar/Setup[/yellow]",
    )

    if ENV.exists():
        faltando = variaveis_faltando()
        tabela.add_row(
            ".env",
            "[green]completo[/green]" if not faltando
            else f"[yellow]faltam: {', '.join(faltando)}[/yellow]",
        )
    else:
        tabela.add_row(".env", "[yellow]nao existe — use Configurar[/yellow]")

    porta = porta_configurada()
    tabela.add_row(
        f"Servidor (porta {porta})",
        "[green]rodando[/green]" if porta_ocupada(porta) else "[dim]parado[/dim]",
    )

    console.print(tabela)
    pausar()


def acao_instalar() -> None:
    gerenciador = npm()
    if not gerenciador:
        console.print("\n[red]npm nao encontrado.[/red] Instale o Node.js 20+ em https://nodejs.org")
        pausar()
        return

    escolha = questionary.select(
        "Como instalar?",
        choices=[
            questionary.Choice(
                "npm ci — exatamente o que esta no package-lock.json (recomendado)",
                value="ci",
            ),
            questionary.Choice(
                "npm install — resolve versoes de novo e pode atualizar o lockfile",
                value="install",
            ),
            questionary.Choice("Voltar", value=None),
        ],
        style=ESTILO,
    ).ask()

    if not escolha:
        return

    if rodar([gerenciador, escolha], "Instalando dependencias") and not ENV.exists():
        console.print("\n[yellow]Falta o .env.[/yellow] Use a opcao Configurar para cria-lo.")
    pausar()


def acao_configurar() -> None:
    opcoes = []
    if not ENV.exists():
        opcoes.append(questionary.Choice(
            "Criar .env a partir do .env.example", value="criar"))
    else:
        opcoes.append(questionary.Choice(
            "Conferir variaveis obrigatorias", value="conferir"))
        opcoes.append(questionary.Choice(
            "Abrir o .env no editor padrao", value="abrir"))
    opcoes.append(questionary.Choice("Voltar", value=None))

    escolha = questionary.select("O que deseja fazer?", choices=opcoes, style=ESTILO).ask()

    if escolha == "criar":
        if not ENV_EXEMPLO.exists():
            console.print("\n[red]ERRO[/red] .env.example nao encontrado no repositorio.")
        else:
            shutil.copyfile(ENV_EXEMPLO, ENV)
            console.print(f"\n[green]OK[/green] .env criado em {ENV}")
            console.print("  Abra o arquivo e preencha os valores — ele ja vem comentado.")
            console.print("  [dim]Nenhum valor real e versionado; o .env fica fora do git.[/dim]")

    elif escolha == "conferir":
        faltando = variaveis_faltando()
        if faltando:
            console.print("\n[yellow]Sem valor no .env:[/yellow]")
            for v in faltando:
                console.print(f"  - {v}")
            console.print("\n  [dim]Para gerar segredos: openssl rand -hex 32[/dim]")
        else:
            console.print("\n[green]OK[/green] Todas as obrigatorias estao preenchidas.")

    elif escolha == "abrir":
        try:
            if platform.system() == "Windows":
                os.startfile(ENV)  # type: ignore[attr-defined]
            elif platform.system() == "Darwin":
                subprocess.run(["open", str(ENV)], check=True)
            else:
                subprocess.run(["xdg-open", str(ENV)], check=True)
            console.print(f"\n[green]OK[/green] Abrindo {ENV}")
        except (OSError, subprocess.CalledProcessError):
            console.print(f"\n[yellow]Nao consegui abrir automaticamente.[/yellow] Edite: {ENV}")

    if escolha:
        pausar()


def acao_iniciar() -> None:
    gerenciador = npm()
    if not gerenciador:
        console.print("\n[red]npm nao encontrado.[/red] Instale o Node.js 20+ em https://nodejs.org")
        pausar()
        return

    # O menu avisa o que falta, mas nao bloqueia: quem decide e a pessoa.
    if not NODE_MODULES.exists():
        console.print("\n[yellow]As dependencias nao estao instaladas.[/yellow] O servidor provavelmente nao sobe.")
        if not questionary.confirm("Tentar iniciar mesmo assim?", default=False, style=ESTILO).ask():
            return

    faltando = variaveis_faltando()
    if faltando:
        console.print(f"\n[yellow]Variaveis obrigatorias sem valor:[/yellow] {', '.join(faltando)}")
        if not questionary.confirm("Tentar iniciar mesmo assim?", default=False, style=ESTILO).ask():
            return

    porta = porta_configurada()
    if porta_ocupada(porta):
        console.print(f"\n[yellow]A porta {porta} ja esta em uso.[/yellow] Pode haver outra instancia rodando.")
        if not questionary.confirm("Continuar?", default=False, style=ESTILO).ask():
            return

    modo = questionary.select(
        "Como iniciar?",
        choices=[
            questionary.Choice("Desenvolvimento — nodemon, reinicia ao salvar", value="dev"),
            questionary.Choice("Producao — node direto, sem reload", value="start"),
            questionary.Choice("Voltar", value=None),
        ],
        style=ESTILO,
    ).ask()

    if not modo:
        return

    if questionary.confirm(
        f"Abrir o navegador em http://localhost:{porta} ?", default=False, style=ESTILO
    ).ask():
        webbrowser.open(f"http://localhost:{porta}")

    console.print("\n[dim]Ctrl+C para parar o servidor e voltar ao menu.[/dim]")
    rodar([gerenciador, "run", modo], f"Servidor ({modo})")
    pausar()


def acao_testes() -> None:
    gerenciador = npm()
    if not gerenciador:
        console.print("\n[red]npm nao encontrado.[/red]")
        pausar()
        return

    escolha = questionary.select(
        "Qual verificacao?",
        choices=[
            questionary.Choice("Testes — suite completa (Jest)", value=["run", "test"]),
            questionary.Choice("Testes com cobertura", value=["run", "test:coverage"]),
            questionary.Choice(
                "Auditoria de seguranca — so o que vai para producao",
                value=["audit", "--omit=dev"],
            ),
            questionary.Choice("Voltar", value=None),
        ],
        style=ESTILO,
    ).ask()

    if escolha:
        rodar([gerenciador] + escolha, "Verificacao")
        pausar()


# ----------------------------------------------------------------------------
# Menu
# ----------------------------------------------------------------------------
def cabecalho() -> None:
    console.clear()
    porta = porta_configurada()

    if not NODE_MODULES.exists():
        resumo = "[yellow]dependencias faltando[/yellow]"
    elif variaveis_faltando():
        resumo = "[yellow].env incompleto[/yellow]"
    elif porta_ocupada(porta):
        resumo = f"[green]rodando na porta {porta}[/green]"
    else:
        resumo = "[green]pronto para iniciar[/green]"

    console.print(Panel(
        "[bold]MeuEcooMedia[/bold] — publicacao multi-plataforma em redes sociais\n"
        f"Estado: {resumo}",
        border_style="cyan",
    ))


def main() -> None:
    while True:
        cabecalho()

        escolha = questionary.select(
            "O que deseja fazer?",
            choices=[
                questionary.Choice("Iniciar        — sobe o servidor (dev ou producao)", value=acao_iniciar),
                questionary.Choice("Instalar/Setup — baixa as dependencias do projeto", value=acao_instalar),
                questionary.Choice("Configurar     — cria e confere o .env", value=acao_configurar),
                questionary.Choice("Testes         — suite, cobertura e auditoria", value=acao_testes),
                questionary.Choice("Status         — o que esta instalado e rodando", value=acao_status),
                questionary.Choice("Sair", value=None),
            ],
            style=ESTILO,
        ).ask()

        if escolha is None:
            console.print("\n[dim]Ate mais.[/dim]\n")
            return
        escolha()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        console.print("\n\n[dim]Ate mais.[/dim]\n")
        sys.exit(0)
