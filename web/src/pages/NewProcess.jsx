import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, errorText } from '../api.js'
import { ErrorBox, Field, Icon, PageHeader } from '../components/ui.jsx'

const EMPTY_CLIENT = { type: 'SINGULAR', name: '', documentNumber: '', isForeign: false, phone: '', email: '', address: '' }
const EMPTY_TRANSPORT = {
  blNumber: '',
  duNumber: '',
  vesselName: '',
  voyageNumber: '',
  dischargeType: 'INDIRECTA',
  regime: '',
  manifestNumber: '',
  weightKg: '',
  packagesCount: '',
  originCountry: '',
  destinationCountry: '',
}
const NEW_VEHICLE = () => ({ chassis: '', brand: '', model: '', tariffCode: '', fuel: '' })
const NEW_CONTAINER = () => ({ number: '', size: '20', type: '', loadStatus: '', seal: '', packages: '', weightKg: '' })
const NEW_GOOD = () => ({ description: '', tariffCode: '', unit: 'Unidade', quantity: '', weightKg: '', carrier: '' })

const clean = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== '' && v !== undefined))
const toNumber = (v) => (v === '' ? undefined : Number(v))

/** Lista editável de itens da carga (veículos, contentores ou mercadorias). */
function ItemList({ title, items, setItems, make, columns, addLabel, empty }) {
  const update = (i, key, value) => setItems(items.map((it, j) => (j === i ? { ...it, [key]: value } : it)))
  return (
    <div className="stack">
      <div className="items-head">
        <h4>{title}</h4>
        <button type="button" onClick={() => setItems([...items, make()])}>
          <Icon name="plus" /> {addLabel}
        </button>
      </div>
      {items.length === 0 ? (
        <p className="muted small">{empty}</p>
      ) : (
        <div className="table-wrap">
          <table className="items-table">
            <thead>
              <tr>
                <th>#</th>
                {columns.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
                <th aria-label="Remover" />
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i}>
                  <td className="muted">{i + 1}</td>
                  {columns.map((c) => (
                    <td key={c.key}>
                      {c.options ? (
                        <select value={it[c.key]} onChange={(e) => update(i, c.key, e.target.value)} required={c.required} aria-label={c.label}>
                          {c.options.map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={c.type ?? 'text'}
                          min={c.type === 'number' ? '0' : undefined}
                          step={c.type === 'number' ? 'any' : undefined}
                          value={it[c.key]}
                          onChange={(e) => update(i, c.key, e.target.value)}
                          required={c.required}
                          aria-label={c.label}
                        />
                      )}
                    </td>
                  ))}
                  <td>
                    <button type="button" className="icon-btn" onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label="Remover">
                      <Icon name="x" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function NewProcess() {
  const navigate = useNavigate()
  const [meta, setMeta] = useState(null)
  const [terminals, setTerminals] = useState([])
  const [clients, setClients] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const [entityId, setEntityId] = useState('')
  const [client, setClient] = useState(EMPTY_CLIENT)
  const [cargoPriority, setCargoPriority] = useState('NAO_PRIORITARIO')
  const [volumeType, setVolumeType] = useState('CARGA_GERAL')
  const [cargoCategory, setCargoCategory] = useState('')
  const [description, setDescription] = useState('')
  const [transport, setTransport] = useState(EMPTY_TRANSPORT)
  const [vehicles, setVehicles] = useState([])
  const [containers, setContainers] = useState([])
  const [goods, setGoods] = useState([NEW_GOOD()])
  const [urgency, setUrgency] = useState({ requested: false, reason: '' })
  const [files, setFiles] = useState({})

  useEffect(() => {
    Promise.all([api('GET', '/meta/cargo'), api('GET', '/forwarders'), api('GET', '/clients')])
      .then(([m, f, c]) => {
        setMeta(m)
        const approved = (f.forwarders[0]?.entities ?? []).filter((e) => e.status === 'APROVADO')
        setTerminals(approved)
        setEntityId(approved[0]?.entityId ? String(approved[0].entityId) : '')
        setClients(c.clients)
      })
      .catch((err) => setError(errorText(err)))
  }, [])

  const categories = useMemo(() => meta?.volumeTypes.find((v) => v.value === volumeType)?.categories ?? [], [meta, volumeType])
  const isContainer = volumeType === 'CONTENTOR'

  const setC = (k) => (e) => setClient((c) => ({ ...c, [k]: e.target.value }))
  const setT = (k) => (e) => setTransport((t) => ({ ...t, [k]: e.target.value }))
  const setFile = (k) => (e) => setFiles((f) => ({ ...f, [k]: e.target.files }))

  // Ao escolher o tipo principal, abre a lista que ele exige (as outras continuam disponíveis).
  function chooseVolume(value) {
    setVolumeType(value)
    setCargoCategory('')
    if (value === 'CONTENTOR' && !containers.length) setContainers([NEW_CONTAINER()])
  }
  function chooseCategory(value) {
    setCargoCategory(value)
    if (value.startsWith('Veículos') && !vehicles.length) setVehicles([NEW_VEHICLE()])
  }

  function onDocumentNumber(e) {
    const documentNumber = e.target.value
    const known = clients.find((c) => c.documentNumber === documentNumber)
    setClient(
      known
        ? { type: known.type, name: known.name, documentNumber, isForeign: known.isForeign, phone: known.phone ?? '', email: known.email ?? '', address: known.address ?? '' }
        : { ...client, documentNumber },
    )
  }

  const carriers = [
    ['', 'Solta'],
    ...vehicles.map((v, i) => [`v${i}`, `Veículo ${i + 1}${v.chassis ? ` (${v.chassis})` : ''}`]),
    ...containers.map((c, i) => [`c${i}`, `Contentor ${i + 1}${c.number ? ` (${c.number})` : ''}`]),
  ]

  async function submit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const data = {
      entityId: Number(entityId),
      client: clean({ ...client, isForeign: client.type === 'EMPRESA' ? client.isForeign : undefined }),
      cargoPriority,
      volumeType,
      cargoCategory: isContainer ? undefined : cargoCategory,
      description: description || undefined,
      ...clean({ ...transport, weightKg: toNumber(transport.weightKg), packagesCount: toNumber(transport.packagesCount) }),
      vehicles: vehicles.map((v) => clean(v)),
      containers: containers.map((c) => clean({ ...c, packages: toNumber(c.packages), weightKg: toNumber(c.weightKg) })),
      goods: goods.map(({ carrier, ...g }) =>
        clean({
          ...g,
          quantity: toNumber(g.quantity),
          weightKg: toNumber(g.weightKg),
          vehicle: carrier.startsWith('v') ? Number(carrier.slice(1)) : undefined,
          container: carrier.startsWith('c') ? Number(carrier.slice(1)) : undefined,
        }),
      ),
      urgencyRequested: urgency.requested || undefined,
      urgencyReason: urgency.requested ? urgency.reason || undefined : undefined,
    }
    const form = new FormData()
    form.append('data', JSON.stringify(data))
    for (const [field, list] of Object.entries(files)) for (const f of list ?? []) form.append(field, f)
    try {
      const r = await api('POST', '/processes', { form })
      navigate(`/processos/${r.process.id}`)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  if (!meta) return error ? <ErrorBox message={error} /> : <p className="muted">A carregar…</p>
  if (!terminals.length) {
    return (
      <>
        <Link to="/processos" className="crumb"><Icon name="back" /> Processos</Link>
        <p className="error">Ainda não está aprovado em nenhum terminal. Contacte a Sogester.</p>
      </>
    )
  }

  const docInput = (field, label, multiple = false) => (
    <Field label={label}>
      <input type="file" accept="application/pdf,image/png,image/jpeg" multiple={multiple} onChange={setFile(field)} />
    </Field>
  )
  const unitOptions = meta.units.map((u) => [u, u])

  return (
    <>
      <Link to="/processos" className="crumb"><Icon name="back" /> Processos</Link>
      <PageHeader title="Novo processo" subtitle="Cadastre o cliente, o transporte e a carga, e anexe a documentação exigida." />
      <form onSubmit={submit} className="stack">
        <section className="card stack">
          <h3>Terminal</h3>
          <Field label="Terminal de destino">
            <select value={entityId} onChange={(e) => setEntityId(e.target.value)}>
              {terminals.map((t) => (
                <option key={t.entityId} value={t.entityId}>
                  {t.entityName}
                </option>
              ))}
            </select>
          </Field>
        </section>

        <section className="card stack">
          <h3>Cliente final (dono da carga)</h3>
          <div className="row">
            <Field label="Tipo">
              <select value={client.type} onChange={setC('type')}>
                <option value="SINGULAR">Pessoa singular</option>
                <option value="EMPRESA">Empresa</option>
              </select>
            </Field>
            <Field label={client.type === 'SINGULAR' ? 'N.º do bilhete' : 'NIF da empresa'}>
              <input list="known-clients" value={client.documentNumber} onChange={onDocumentNumber} required />
              <datalist id="known-clients">
                {clients.map((c) => (
                  <option key={c.id} value={c.documentNumber}>
                    {c.name}
                  </option>
                ))}
              </datalist>
            </Field>
          </div>
          <Field label="Nome">
            <input value={client.name} onChange={setC('name')} required />
          </Field>
          <div className="row">
            <Field label="Telefone">
              <input value={client.phone} onChange={setC('phone')} />
            </Field>
            <Field label="E-mail">
              <input type="email" value={client.email} onChange={setC('email')} />
            </Field>
          </div>
          <Field label="Morada">
            <input value={client.address} onChange={setC('address')} />
          </Field>
          {client.type === 'EMPRESA' && (
            <label className="check">
              <input type="checkbox" checked={client.isForeign} onChange={(e) => setClient({ ...client, isForeign: e.target.checked })} />
              Empresa estrangeira sem alvará (o transitário assume a responsabilidade com o seu NIF)
            </label>
          )}
        </section>

        <section className="card stack">
          <h3>Transporte</h3>
          <div className="row">
            <Field label="N.º do B/L">
              <input value={transport.blNumber} onChange={setT('blNumber')} required />
            </Field>
            <Field label="N.º do DU">
              <input value={transport.duNumber} onChange={setT('duNumber')} required />
            </Field>
          </div>
          <div className="row">
            <Field label="Navio">
              <input value={transport.vesselName} onChange={setT('vesselName')} required />
            </Field>
            <Field label="N.º da viagem">
              <input value={transport.voyageNumber} onChange={setT('voyageNumber')} required />
            </Field>
          </div>
          <div className="row">
            <Field label="Tipo de descarga">
              <select value={transport.dischargeType} onChange={setT('dischargeType')}>
                {meta.dischargeTypes.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Regime (opcional)">
              <select value={transport.regime} onChange={setT('regime')}>
                <option value="">—</option>
                {meta.regimes.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="row">
            <Field label="Peso bruto total (kg)">
              <input type="number" min="0" step="any" value={transport.weightKg} onChange={setT('weightKg')} required />
            </Field>
            <Field label="N.º de volumes (opcional)">
              <input type="number" min="1" step="1" value={transport.packagesCount} onChange={setT('packagesCount')} />
            </Field>
            <Field label="N.º do manifesto (opcional)">
              <input value={transport.manifestNumber} onChange={setT('manifestNumber')} />
            </Field>
          </div>
          <div className="row">
            <Field label="País de origem (opcional)">
              <input value={transport.originCountry} onChange={setT('originCountry')} />
            </Field>
            <Field label="País de destino (opcional)">
              <input value={transport.destinationCountry} onChange={setT('destinationCountry')} />
            </Field>
          </div>
        </section>

        <section className="card stack">
          <h3>Carga</h3>
          <div className="row">
            <Field label="Prioridade">
              <select value={cargoPriority} onChange={(e) => setCargoPriority(e.target.value)}>
                {meta.priorities.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Tipo principal de volume">
              <select value={volumeType} onChange={(e) => chooseVolume(e.target.value)}>
                {meta.volumeTypes.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </select>
            </Field>
            {!isContainer && (
              <Field label="Tipo de carga / faturação">
                <select value={cargoCategory} onChange={(e) => chooseCategory(e.target.value)} required>
                  <option value="" disabled>
                    Escolher…
                  </option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
          <Field label="Descrição geral (opcional)">
            <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
          </Field>
          <p className="muted small">
            Pode misturar tipos: por exemplo, um carro com carga geral dentro. Indique em cada mercadoria onde é transportada.
          </p>

          <ItemList
            title="Veículos"
            items={vehicles}
            setItems={setVehicles}
            make={NEW_VEHICLE}
            addLabel="Veículo"
            empty="Sem veículos."
            columns={[
              { key: 'chassis', label: 'N.º do chassi', required: true },
              { key: 'brand', label: 'Marca', required: true },
              { key: 'model', label: 'Modelo', required: true },
              { key: 'fuel', label: 'Combustível' },
              { key: 'tariffCode', label: 'Posição pautal' },
            ]}
          />
          <ItemList
            title="Contentores"
            items={containers}
            setItems={setContainers}
            make={NEW_CONTAINER}
            addLabel="Contentor"
            empty="Sem contentores."
            columns={[
              { key: 'number', label: 'Matrícula', required: true },
              { key: 'size', label: 'Pés', options: meta.containerSizes.map((s) => [s, `${s}'`]) },
              { key: 'type', label: 'Tipo' },
              { key: 'loadStatus', label: 'Estado', options: [['', '—'], ['CHEIO', 'Cheio'], ['VAZIO', 'Vazio']] },
              { key: 'seal', label: 'Selo' },
              { key: 'packages', label: 'Volumes', type: 'number' },
              { key: 'weightKg', label: 'Peso (kg)', type: 'number' },
            ]}
          />
          {containers.length > 0 && (
            <p className="muted small">
              Contentores de 20&apos;: {containers.filter((c) => c.size === '20').length} · 40&apos;:{' '}
              {containers.filter((c) => c.size === '40').length} · 45&apos;: {containers.filter((c) => c.size === '45').length}
            </p>
          )}
          <ItemList
            title="Mercadorias"
            items={goods}
            setItems={setGoods}
            make={NEW_GOOD}
            addLabel="Mercadoria"
            empty="Sem mercadorias."
            columns={[
              { key: 'description', label: 'Descrição', required: true },
              { key: 'unit', label: 'Unidade', options: unitOptions },
              { key: 'quantity', label: 'Quantidade', type: 'number', required: true },
              { key: 'weightKg', label: 'Peso (kg)', type: 'number' },
              { key: 'tariffCode', label: 'Código pautal' },
              { key: 'carrier', label: 'Transportada em', options: carriers },
            ]}
          />

          <label className="check">
            <input type="checkbox" checked={urgency.requested} onChange={(e) => setUrgency({ ...urgency, requested: e.target.checked })} />
            Solicitar urgência à Sogester
          </label>
          {urgency.requested && (
            <Field label="Motivo da urgência">
              <input value={urgency.reason} onChange={(e) => setUrgency({ ...urgency, reason: e.target.value })} required />
            </Field>
          )}
        </section>

        <section className="card stack">
          <h3>Documentos (PDF, PNG ou JPG, até 10 MB)</h3>
          <p className="muted small">
            Obrigatório: EP17 ou EP15 do porto; {client.type === 'SINGULAR' ? 'bilhete de identidade' : client.isForeign ? 'alvará dispensado (empresa estrangeira)' : 'alvará comercial'}.
          </p>
          <div className="row">
            {docInput('ep17', 'EP17 (retirada)')}
            {docInput('ep15', 'EP15 (embarque)')}
          </div>
          <div className="row">
            {client.type === 'SINGULAR' ? docInput('bilhete', 'Bilhete de identidade') : docInput('alvara', 'Alvará comercial')}
            {docInput('guiaCabotagem', 'Guia de cabotagem (se houver)')}
          </div>
          <div className="row">
            {docInput('bl', 'BL (se houver)')}
            {docInput('outros', 'Outros (até 5)', true)}
          </div>
        </section>

        <ErrorBox message={error} />
        <div><button className="primary" disabled={busy}>{busy ? 'A submeter…' : 'Submeter processo'}</button></div>
      </form>
    </>
  )
}
