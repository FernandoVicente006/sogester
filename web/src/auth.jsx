import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, getToken, setToken, setUnauthorizedHandler } from './api.js'

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

export const ROLE_LABELS = {
  SUPER_ADMIN: 'Administrador geral',
  ADMIN_ENTIDADE: 'Administrador da entidade',
  LOJA: 'Loja',
  CADASTRO: 'Cadastro',
  FINANCAS: 'Finanças de processos',
  CHEFE_COMERCIAL: 'Chefe comercial',
  PORTARIA: 'Portaria',
  TRANSITARIO: 'Transitário',
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(!!getToken())

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(logout)
    if (!getToken()) return
    api('GET', '/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => setToken(null))
      .finally(() => setLoading(false))
  }, [logout])

  const login = useCallback(async (email, password) => {
    const r = await api('POST', '/auth/login', { body: { email, password } })
    setToken(r.token)
    setUser(r.user)
  }, [])

  // Transitário: entra num terminal; o token novo limita a sessão a esse terminal.
  const selectTerminal = useCallback(async (entityId) => {
    const r = await api('POST', '/auth/terminal', { body: { entityId } })
    setToken(r.token)
    setUser(r.user)
  }, [])

  const value = useMemo(() => ({ user, loading, login, logout, selectTerminal }), [user, loading, login, logout, selectTerminal])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
