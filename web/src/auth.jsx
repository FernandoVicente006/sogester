import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, getToken, setToken, setUnauthorizedHandler } from './api.js'

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

export const ROLE_LABELS = {
  SUPER_ADMIN: 'Administrador geral',
  ADMIN_ENTIDADE: 'Administrador da entidade',
  LOJA: 'Loja',
  CADASTRO: 'Cadastro',
  FATURACAO: 'Faturação',
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

  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading, login, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
