import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

import * as api from "@/services/api"

/**
 * Session state backed by the real API.
 *
 * There is no server-side session to look up: the JWT in `localStorage` *is* the
 * session, so `GET /auth/me` on boot is the only way to tell whether it is still
 * valid. `isInitialising` covers that round-trip, and protected routes stay
 * closed until it finishes rather than flashing the dashboard and bouncing the
 * user back out.
 */

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isInitialising, setIsInitialising] = useState(true)
  // The three account actions on the settings page each own a button, so each
  // gets its own flag rather than one shared spinner that would light up the
  // whole page.
  const [isUpdating, setIsUpdating] = useState(false)
  const [isChangingPassword, setIsChangingPassword] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  // Validate a stored token once on mount. A request that never gets a response
  // is treated as "signed out" rather than leaving the app in limbo.
  useEffect(() => {
    let cancelled = false

    async function restore() {
      if (!api.hasStoredToken()) {
        if (!cancelled) setIsInitialising(false)
        return
      }

      try {
        const session = await api.getMe()
        if (!cancelled) setUser(session)
      } catch {
        api.logout()
        if (!cancelled) setUser(null)
      } finally {
        if (!cancelled) setIsInitialising(false)
      }
    }

    restore()

    return () => {
      cancelled = true
    }
  }, [])

  // The API layer clears the token and fires this when the server rejects it, so
  // an expired session signs the user out here too instead of leaving a dashboard
  // full of failing panels.
  useEffect(() => {
    function handleSignedOut() {
      setUser(null)
    }

    window.addEventListener("intelme:signed-out", handleSignedOut)
    return () => window.removeEventListener("intelme:signed-out", handleSignedOut)
  }, [])

  // Signing out invalidates every cached resume, analysis and match, otherwise
  // the next person to sign in on this browser would see the previous one.
  const handleLogout = useCallback(() => {
    api.logout()
    setUser(null)
    window.dispatchEvent(new CustomEvent("intelme:data-cleared"))
  }, [])

  const login = useCallback(async (credentials) => {
    setIsLoading(true)
    try {
      const session = await api.login(credentials)
      setUser(session)
      return session
    } finally {
      setIsLoading(false)
    }
  }, [])

  const register = useCallback(async (details) => {
    setIsLoading(true)
    try {
      const session = await api.register(details)
      setUser(session)
      return session
    } finally {
      setIsLoading(false)
    }
  }, [])

  /**
   * Writes a name or email change to the account and adopts the session the
   * server sends back. Re-fetching the profile afterwards would be a second
   * round-trip for data we already have — and would leave the header showing
   * the old name for as long as it took.
   */
  const updateProfile = useCallback(async (patch) => {
    setIsUpdating(true)
    try {
      const session = await api.updateProfile(patch)
      setUser(session)
      return session
    } finally {
      setIsUpdating(false)
    }
  }, [])

  /** The server re-hashes the new password; this session keeps working. */
  const changePassword = useCallback(async (credentials) => {
    setIsChangingPassword(true)
    try {
      return await api.changePassword(credentials)
    } finally {
      setIsChangingPassword(false)
    }
  }, [])

  /**
   * Deletes the account, then signs out locally. The account document held the
   * resumes, analyses and job matches, so the server removed all of them in the
   * same delete — what is left to do here is drop the token that now points at
   * nothing and clear the copies the browser is still holding.
   */
  const deleteAccount = useCallback(async () => {
    setIsDeleting(true)
    try {
      await api.deleteAccount()
      setUser(null)
      window.dispatchEvent(new CustomEvent("intelme:data-cleared"))
    } finally {
      setIsDeleting(false)
    }
  }, [])

  const value = useMemo(
    () => ({
      user,
      isLoading,
      isInitialising,
      isAuthenticated: Boolean(user),
      isUpdating,
      isChangingPassword,
      isDeleting,
      login,
      register,
      logout: handleLogout,
      updateProfile,
      changePassword,
      deleteAccount,
    }),
    [
      user,
      isLoading,
      isInitialising,
      isUpdating,
      isChangingPassword,
      isDeleting,
      login,
      register,
      handleLogout,
      updateProfile,
      changePassword,
      deleteAccount,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// The hook is intentionally exported next to the provider it reads from.
export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider.")
  }

  return context
}

export default AuthProvider
