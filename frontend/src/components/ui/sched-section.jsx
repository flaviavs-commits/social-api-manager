// Bloco numerado com título — mesmo padrão visual usado no Agendador para
// dar hierarquia a formulários com vários passos/campos. Ver styles/modules.css
// (.sched-section*) para o CSS compartilhado por todas as páginas que usam isto.
export function SchedSection({ number, title, children }) {
  return (
    <fieldset className="sched-section">
      <legend className="sched-section-title"><span className="sched-section-num">{number}</span> {title}</legend>
      {children}
    </fieldset>
  )
}
