import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, errorText } from '../api.js'
import { ErrorBox, Field, Icon, PageHeader } from '../components/ui.jsx'

const EMPTY_CLIENT = { type: 'SINGULAR', name: '', documentNumber: '', isForeign: false, phone: '', email: '', address: '' }

const clean = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== '' && v !== undefined))

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
  const [cargo, setCargo] = useState({ description: '', quantity: '', weightKg: '', vehicleBrand: '', vehicleModel: '' })
  const [container, setContainer] = useState({ plate: '', type: '', volume: '', weightKg: '' })
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
  const isVehicle = cargoCategory.startsWith('Veículos')

  const setC = (k) => (e) => setClient((c) => ({ ...c, [k]: e.target.value }))
  const setCargoField = (k) => (e) => setCargo((c) => ({ ...c, [k]: e.target.value }))
  const setCont = (k) => (e) => setContainer((c) => ({ ...c, [k]: e.target.value }))
  const setFile = (k) => (e) => setFiles((f) => ({ ...f, [k]: e.target.files }))

  function onDocumentNumber(e) {
    const documentNumber = e.target.value
    const known = clients.find((c) => c.documentNumber === documentNumber)
    setClient(
      known
        ? { type: known.type, name: known.name, documentNumber, isForeign: known.isForeign, phone: known.phone ?? '', email: known.email ?? '', address: known.address ?? '' }
        : { ...client, documentNumber },
    )
  }

  async function submit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const data = {
      entityId: Number(entityId),
      client: clean({ ...client, isForeign: client.type === 'EMPRESA' ? client.isForeign : undefined }),
      cargoPriority,
      volumeType,
      urgencyRequested: urgency.requested || undefined,
      urgencyReason: urgency.requested ? urgency.reason || undefined : undefined,
    }
    if (isContainer) {
      data.container = { plate: container.plate, type: container.type, volume: Number(container.volume), weightKg: Number(container.weightKg) }
    } else {
      data.cargoCategory = cargoCategory
      if (isVehicle) Object.assign(data, clean({ vehicleBrand: cargo.vehicleBrand, vehicleModel: cargo.vehicleModel }))
      else {
        Object.assign(data, clean({ description: cargo.description }))
        if (cargo.quantity) data.quantity = Number(cargo.quantity)
        if (cargo.weightKg) data.weightKg = Number(cargo.weightKg)
      }
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

  return (
    <>
      <Link to="/processos" className="crumb"><Icon name="back" /> Processos</Link>
      <PageHeader title="Novo processo" subtitle="Cadastre o cliente, a carga e anexe a documentação exigida." />
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
            <Field label="Tipo de volume">
              <select
                value={volumeType}
                onChange={(e) => {
                  setVolumeType(e.target.value)
                  setCargoCategory('')
                }}
              >
                {meta.volumeTypes.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {isContainer ? (
            <>
              <div className="row">
                <Field label="Matrícula do contentor">
                  <input value={container.plate} onChange={setCont('plate')} required />
                </Field>
                <Field label="Tipo de contentor">
                  <input value={container.type} onChange={setCont('type')} required />
                </Field>
              </div>
              <div className="row">
                <Field label="Volume (m³)">
                  <input type="number" min="0" step="any" value={container.volume} onChange={setCont('volume')} required />
                </Field>
                <Field label="Peso (kg)">
                  <input type="number" min="0" step="any" value={container.weightKg} onChange={setCont('weightKg')} required />
                </Field>
              </div>
            </>
          ) : (
            <>
              <Field label="Tipo de carga / faturação">
                <select value={cargoCategory} onChange={(e) => setCargoCategory(e.target.value)} required>
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
              {isVehicle ? (
                <div className="row">
                  <Field label="Marca">
                    <input value={cargo.vehicleBrand} onChange={setCargoField('vehicleBrand')} required />
                  </Field>
                  <Field label="Modelo">
                    <input value={cargo.vehicleModel} onChange={setCargoField('vehicleModel')} required />
                  </Field>
                </div>
              ) : (
                <>
                  <Field label="Descrição da mercadoria">
                    <input value={cargo.description} onChange={setCargoField('description')} required />
                  </Field>
                  <div className="row">
                    <Field label="Quantidade">
                      <input type="number" min="0" step="any" value={cargo.quantity} onChange={setCargoField('quantity')} required />
                    </Field>
                    <Field label="Peso (kg)">
                      <input type="number" min="0" step="any" value={cargo.weightKg} onChange={setCargoField('weightKg')} required />
                    </Field>
                  </div>
                </>
              )}
            </>
          )}

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
