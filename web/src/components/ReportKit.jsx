import { useMemo, useRef, useState } from 'react'
import { Icon } from './ui.jsx'

// Peças dos relatórios: indicadores, gráficos com dica ao passar o rato e tabela ordenável.
// Cores: série 1 azul e série 2 laranja (paleta validada); verde/âmbar/vermelho só para estados.

/** Cartão de painel com título, subtítulo opcional e ações à direita. */
export function Panel({ title, subtitle, actions, children, className = '' }) {
  return (
    <section className={`rpt-panel ${className}`}>
      {(title || actions) && (
        <header className="rpt-panel-head">
          <div>
            {title && <h3>{title}</h3>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="rpt-panel-actions no-print">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

/** Número de destaque. `tone` (ok | warn | bad) só para estados, e sempre com ícone. */
export function StatCard({ label, value, hint, icon, tone, children }) {
  return (
    <div className={tone ? `rpt-stat tone-${tone}` : 'rpt-stat'}>
      <div className="rpt-stat-label">
        {icon && <Icon name={icon} />}
        {label}
      </div>
      <div className="rpt-stat-value">{value}</div>
      {hint && <div className="rpt-stat-hint">{hint}</div>}
      {children}
    </div>
  )
}

/** Proporção de um todo (ex.: taxa de conclusão). */
export function Meter({ value, total, label }) {
  const pct = total ? Math.round((value / total) * 100) : 0
  return (
    <div className="rpt-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </div>
  )
}

/** Dica flutuante partilhada pelos gráficos; segue o rato e também aparece com o teclado. */
function useTooltip() {
  const [tip, setTip] = useState(null)
  const ref = useRef(null)
  const show = (e, content) => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    const target = e.currentTarget.getBoundingClientRect()
    const x = e.clientX ?? target.left + target.width / 2
    const y = e.clientY ?? target.top
    setTip({ content, x: x - box.left, y: y - box.top })
  }
  const hide = () => setTip(null)
  const layer = tip && (
    <div className="rpt-tip" style={{ left: tip.x, top: tip.y }} role="status">
      {tip.content}
    </div>
  )
  return { ref, show, hide, layer }
}

/** Barras horizontais de uma série: valor e percentagem escritos; detalhe na dica. */
export function HBarChart({ items, format = (v) => v, unit = '', empty = 'Sem dados no período.', limit }) {
  const { ref, show, hide, layer } = useTooltip()
  const list = limit ? items.slice(0, limit) : items
  const total = items.reduce((s, i) => s + i.value, 0)
  const max = Math.max(1, ...list.map((i) => i.value))
  if (!list.length || !total) return <p className="rpt-empty">{empty}</p>
  return (
    <div className="rpt-hbars" ref={ref} onPointerLeave={hide}>
      {list.map((i) => {
        const pct = Math.round((i.value / total) * 100)
        const tipContent = (
          <>
            <strong>{format(i.value)}</strong>
            <span>
              {i.label} · {pct}% do total{unit}
            </span>
          </>
        )
        return (
          <div
            key={i.label}
            className="rpt-hbar"
            tabIndex={0}
            onPointerMove={(e) => show(e, tipContent)}
            onFocus={(e) => show(e, tipContent)}
            onBlur={hide}
          >
            <span className="rpt-hbar-label" title={i.label}>
              {i.label}
            </span>
            <span className="rpt-hbar-track">
              <span className="rpt-hbar-fill" style={{ width: i.value ? `${Math.max(1.5, (i.value / max) * 100)}%` : 0 }} />
            </span>
            <span className="rpt-hbar-value">
              {format(i.value)}
              <small>{pct}%</small>
            </span>
          </div>
        )
      })}
      {layer}
    </div>
  )
}

/** Colunas agrupadas por período com duas séries; uma dica mostra as duas no mesmo mês. */
export function ColumnPairChart({ points, series, format = (v) => v, labelOf = (p) => p.label }) {
  const { ref, show, hide, layer } = useTooltip()
  const max = Math.max(1, ...points.flatMap((p) => series.map((s) => p[s.key])))
  const ticks = [1, 0.5, 0].map((f) => max * f)
  return (
    <div className="rpt-columns-wrap">
      <div className="rpt-legend" aria-hidden="true">
        {series.map((s, i) => (
          <span key={s.key}>
            <i className={`s${i + 1}`} />
            {s.label}
          </span>
        ))}
      </div>
      <div className="rpt-columns" ref={ref} onPointerLeave={hide} role="img" aria-label={series.map((s) => s.label).join(' e ') + ' por mês'}>
        <div className="rpt-axis" aria-hidden="true">
          {ticks.map((t, i) => (
            <span key={i}>{format(t)}</span>
          ))}
        </div>
        <div className="rpt-plot">
          {[0, 1, 2].map((i) => (
            <span key={i} className="rpt-grid" style={{ top: `${i * 50}%` }} />
          ))}
          {points.map((p) => {
            const tipContent = (
              <>
                <span className="rpt-tip-title">{labelOf(p)}</span>
                {series.map((s, i) => (
                  <span key={s.key} className="rpt-tip-row">
                    <i className={`s${i + 1}`} />
                    <strong>{format(p[s.key])}</strong> {s.label}
                  </span>
                ))}
              </>
            )
            return (
              <div
                key={labelOf(p)}
                className="rpt-col-group"
                tabIndex={0}
                onPointerMove={(e) => show(e, tipContent)}
                onFocus={(e) => show(e, tipContent)}
                onBlur={hide}
              >
                <div className="rpt-col-bars">
                  {series.map((s, i) => (
                    <span key={s.key} className={`rpt-col s${i + 1}`} style={{ height: `${(p[s.key] / max) * 100}%` }} />
                  ))}
                </div>
                <span className="rpt-col-label">{labelOf(p)}</span>
              </div>
            )
          })}
        </div>
        {layer}
      </div>
    </div>
  )
}

/** Barra empilhada de um todo (ex.: processos por estado), com legenda e números. */
export function SegmentedBar({ parts, format = (v) => v }) {
  const { ref, show, hide, layer } = useTooltip()
  const total = parts.reduce((s, p) => s + p.value, 0)
  if (!total) return <p className="rpt-empty">Sem dados no período.</p>
  return (
    <div ref={ref} className="rpt-seg-wrap" onPointerLeave={hide}>
      <div className="rpt-seg">
        {parts
          .filter((p) => p.value)
          .map((p) => {
            const tipContent = (
              <>
                <strong>{format(p.value)}</strong>
                <span>
                  {p.label} · {Math.round((p.value / total) * 100)}%
                </span>
              </>
            )
            return (
              <span
                key={p.label}
                className={`rpt-seg-part tone-${p.tone}`}
                style={{ flexGrow: p.value }}
                tabIndex={0}
                onPointerMove={(e) => show(e, tipContent)}
                onFocus={(e) => show(e, tipContent)}
                onBlur={hide}
              />
            )
          })}
      </div>
      <div className="rpt-seg-legend">
        {parts.map((p) => (
          <span key={p.label}>
            <i className={`tone-${p.tone}`} />
            {p.label} <strong>{format(p.value)}</strong>
          </span>
        ))}
      </div>
      {layer}
    </div>
  )
}

const collator = new Intl.Collator('pt', { numeric: true, sensitivity: 'base' })

/**
 * Tabela de relatório: procurar, ordenar por coluna e paginar.
 * columns: { key, label, num?, render?(row), sort?(row), search?(row), bar?(row) → 0..1, width? }
 */
export function DataTable({ columns, rows, rowKey = (r) => r.id, empty = 'Sem dados.', pageSize = 15, searchable = true, initialSort, footer }) {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState(initialSort ?? null)
  const [page, setPage] = useState(0)

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let list = rows
    if (needle) {
      list = rows.filter((r) =>
        columns.some((c) => {
          const v = c.search ? c.search(r) : c.sort ? c.sort(r) : r[c.key]
          return v !== null && v !== undefined && String(v).toLowerCase().includes(needle)
        }),
      )
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key)
      const val = (r) => (col.sort ? col.sort(r) : r[col.key])
      list = [...list].sort((a, b) => {
        const x = val(a)
        const y = val(b)
        if (x === y) return 0
        if (x === null || x === undefined) return 1
        if (y === null || y === undefined) return -1
        const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y))
        return sort.dir === 'asc' ? cmp : -cmp
      })
    }
    return list
  }, [rows, columns, q, sort])

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const current = Math.min(page, pages - 1)
  const visible = filtered.slice(current * pageSize, current * pageSize + pageSize)

  const toggle = (c) => {
    setPage(0)
    setSort((s) => (s?.key === c.key ? (s.dir === 'desc' ? { key: c.key, dir: 'asc' } : null) : { key: c.key, dir: c.num ? 'desc' : 'asc' }))
  }

  return (
    <div className="rpt-table">
      {searchable && rows.length > 5 && (
        <div className="rpt-table-tools no-print">
          <label className="rpt-search">
            <Icon name="search" />
            <input
              type="search"
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setPage(0)
              }}
              placeholder="Procurar nesta tabela…"
              aria-label="Procurar nesta tabela"
            />
          </label>
          <span className="rpt-count">
            {filtered.length} {filtered.length === 1 ? 'linha' : 'linhas'}
          </span>
        </div>
      )}
      <div className="rpt-table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key
                return (
                  <th key={c.key} className={c.num ? 'num' : ''} style={c.width ? { width: c.width } : undefined} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" className="rpt-sort" onClick={() => toggle(c)}>
                      {c.label}
                      <span className={active ? `rpt-sort-ind ${sort.dir}` : 'rpt-sort-ind'} aria-hidden="true" />
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={rowKey(r)}>
                {columns.map((c) => (
                  <td key={c.key} className={c.num ? 'num' : c.wrap ? 'wrap' : ''}>
                    {c.bar ? (
                      <span className="rpt-cell-bar">
                        <span className="rpt-cell-bar-text">{c.render ? c.render(r) : r[c.key]}</span>
                        <span className="rpt-cell-bar-track" aria-hidden="true">
                          <span style={{ width: `${Math.round(Math.min(1, c.bar(r) || 0) * 100)}%` }} />
                        </span>
                      </span>
                    ) : c.render ? (
                      c.render(r)
                    ) : (
                      (r[c.key] ?? '—')
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer && <tfoot>{footer}</tfoot>}
        </table>
        {!visible.length && <p className="rpt-empty">{q ? 'Nada corresponde à procura.' : empty}</p>}
      </div>
      {pages > 1 && (
        <div className="rpt-pager no-print">
          <span>
            {current * pageSize + 1}–{Math.min(filtered.length, (current + 1) * pageSize)} de {filtered.length}
          </span>
          <button type="button" onClick={() => setPage(current - 1)} disabled={current === 0} aria-label="Página anterior">
            ‹
          </button>
          <span>
            {current + 1} / {pages}
          </span>
          <button type="button" onClick={() => setPage(current + 1)} disabled={current >= pages - 1} aria-label="Página seguinte">
            ›
          </button>
        </div>
      )}
    </div>
  )
}
