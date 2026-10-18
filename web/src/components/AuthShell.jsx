import { Brand, Icon } from './ui.jsx'

/** Moldura das páginas públicas: painel institucional à esquerda, formulário à direita. */
export default function AuthShell({ children }) {
  return (
    <div className="auth-shell">
      <section className="auth-hero">
        <Brand width={210} />
        <div>
          <h1>Processos portuários, sem recadastro</h1>
          <p>
            Plataforma de gestão de processos entre transitários e a Sogester: submissão digital, fila por prioridade e
            faturação sem recadastro.
          </p>
          <div className="auth-points">
            <div>
              <Icon name="clipboard" /> Submeta o processo uma só vez, com toda a documentação
            </div>
            <div>
              <Icon name="zap" /> Cargas perecíveis com prioridade e saída antecipada garantida
            </div>
            <div>
              <Icon name="shield" /> Autorizações digitais verificáveis e histórico completo
            </div>
          </div>
        </div>
        <small>Sociedade Gestora de Terminais · Cabinda · Soyo · Luanda</small>
      </section>
      <section className="auth-panel">{children}</section>
    </div>
  )
}
