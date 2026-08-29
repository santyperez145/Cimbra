'use client';

import { useMemo, useState } from 'react';
import type { ApiReferenceOperation } from '@/app/lib/platform/openapi-reference';

const ALL = 'Todos';

function statusTone(status: string) {
  if (status.startsWith('2')) return 'success';
  if (status.startsWith('4')) return 'client-error';
  return 'server-error';
}

function groupId(name: string) {
  return `group-${name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

export default function EndpointReference({ operations }: { operations: ApiReferenceOperation[] }) {
  const groups = useMemo(() => [ALL, ...new Set(operations.map((operation) => operation.group))], [operations]);
  const [group, setGroup] = useState(ALL);
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('es');
    return operations.filter((operation) => {
      const matchesGroup = group === ALL || operation.group === group;
      const matchesQuery = !normalized || `${operation.method} ${operation.path} ${operation.summary} ${operation.scope ?? ''}`.toLocaleLowerCase('es').includes(normalized);
      return matchesGroup && matchesQuery;
    });
  }, [group, operations, query]);
  const visibleGroups = groups.slice(1).filter((name) => filtered.some((operation) => operation.group === name));

  return <div className="api-reference-browser">
    <div className="api-reference-controls">
      <label>
        <span>Buscar en el contrato</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="GET /customers, ledger, risk…" />
      </label>
      <span className="api-reference-count"><strong>{filtered.length}</strong> de {operations.length} operaciones</span>
    </div>
    <div className="api-reference-filters" aria-label="Filtrar recursos">
      {groups.map((name) => <button type="button" className={group === name ? 'active' : ''} onClick={() => setGroup(name)} key={name}>{name}</button>)}
    </div>
    {visibleGroups.map((name) => <section className="api-reference-group" key={name} aria-labelledby={groupId(name)}>
      <header><h3 id={groupId(name)}>{name}</h3><span>{filtered.filter((operation) => operation.group === name).length} operaciones</span></header>
      {filtered.filter((operation) => operation.group === name).map((operation) => <details className="api-operation" id={operation.id} key={`${operation.method}-${operation.path}`}>
        <summary>
          <b className={`method-${operation.method.toLowerCase()}`}>{operation.method}</b>
          <code>{operation.path}</code>
          <span>{operation.summary}</span>
          <i>+</i>
        </summary>
        <div className="api-operation-body">
          {operation.description && <p>{operation.description}</p>}
          <dl className="api-operation-contract">
            <div><dt>Autenticación</dt><dd>{operation.authentication}</dd></div>
            <div><dt>Scope S2S</dt><dd><code>{operation.scope ?? 'No aplica'}</code></dd></div>
            <div><dt>Content-Type</dt><dd><code>{operation.contentType ?? 'Sin body'}</code></dd></div>
          </dl>
          {operation.fields.length > 0 && <div className="api-operation-section">
            <h4>Parámetros</h4>
            <div className="api-field-table">
              {operation.fields.map((field) => <div key={`${field.location}-${field.name}`}>
                <code>{field.name}</code>
                <span>{field.location}</span>
                <span>{field.type}</span>
                <b>{field.required ? 'requerido' : 'opcional'}</b>
                {field.description && <p>{field.description}</p>}
              </div>)}
            </div>
          </div>}
          <div className="api-operation-section">
            <h4>Respuestas documentadas</h4>
            <div className="api-response-list">
              {operation.responses.map((response) => <div key={response.status}><b className={statusTone(response.status)}>{response.status}</b><span>{response.description}</span></div>)}
            </div>
          </div>
          <a className="api-source-link" href="/openapi.yaml">Ver contrato OpenAPI 3.1 original ↗</a>
        </div>
      </details>)}
    </section>)}
    {filtered.length === 0 && <div className="api-reference-empty"><strong>Sin coincidencias</strong><span>Probá por método, ruta, dominio o scope.</span></div>}
  </div>;
}
