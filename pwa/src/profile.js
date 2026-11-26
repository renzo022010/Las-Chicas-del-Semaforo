import { createContext, useContext } from 'react'
const KEY = 'nawia-profile'
export function readProfile() {
  try { return (localStorage.getItem(KEY) || '').trim().slice(0, 40) } catch { return '' }
}
export function storeProfile(name) {
  const value = name.trim().slice(0, 40)
  try { localStorage.setItem(KEY, value) } catch { /* sigue disponible durante esta sesión */ }
  return value
}
export const ProfileContext = createContext({ name: '', setName: () => {} })
export const useProfile = () => useContext(ProfileContext)
