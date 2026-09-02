import Link from 'next/link';
import { HELP_ARTICLES, STATUS_SURFACES } from '@/app/lib/platform/help-center';

export const metadata = {
  title: 'Ayuda — Cimbra',
  description: 'Centro de ayuda de Cimbra: sandbox, roles, soporte, camino PSPCP y API keys. Sin SLA inventado ni rieles simulados.',
};

export default function HelpPage() {
  return <main className="investor-shell">
    <header>
      <Link className="brand" href="/"><span className="brand-mark"><i /><i /><i /></span><span>CIMBRA</span></Link>
      <nav>
        <Link href="/status">Status</Link>
        <Link href="/developers">Developers</Link>
        <Link href="/console">Consola</Link>
      </nav>
    </header>
    <article>
      <p className="eyebrow"><span /> CENTRO DE AYUDA</p>
      <h1>Límites reales.<br /><em>Acciones reales.</em></h1>
      <p className="investor-lede">Estas respuestas salen del mismo dominio que la consola y la API. Abrí un caso desde Soporte si tu tenant ya está autenticado. Un operador de plataforma responde sólo si está provisionado; no hay chat de red ni SLA comercial.</p>
      <div className="help-center">
        {HELP_ARTICLES.map((article) => <details key={article.id} open={article.id === 'support'}>
          <summary><strong>{article.title}</strong><small>{article.summary}</small></summary>
          <p>{article.body}</p>
        </details>)}
      </div>
      <p className="investor-note">Superficies relacionadas: {STATUS_SURFACES.map((surface, index) => <span key={surface.id}>{index > 0 ? ' · ' : ''}<Link href={surface.href}>{surface.name}</Link></span>)}.</p>
    </article>
  </main>;
}
