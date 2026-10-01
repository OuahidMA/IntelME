import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

import * as api from "@/services/api"
import { clear } from "@/services/workspace"

/**
 * Session state backed by the real API.
 *
 * There is no server-side session to look up: the JWT in `localStorage` *is* the
 * session, so `GET /auth/me` on boot is the only way to tell whether it is still
 * valid. `isInitialising` covers that round-trip, and protected routes stay
 * closed until it finishes rather than flashing the dashboard and bouncing the
 * user back out.
 *
 * What the session unlocks is deliberately thin. The database knows a name, an
 * email and a password hash; the CVs, analyses and job matches live in this
 * browser under the account id, and only this provider knows where.
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

  // Signing out empties the screen but leaves the account's documents in this
  // browser. They are the user's, keyed to their account id, and signing back in
  // brings them straight back — while nobody else at the machine sees anything,
  // because the provider state below is gone.
  const handleLogout = useCallback(() => {
    api.logout()
    setUser(null)
    window.dispatchEvent(new CustomEvent("intelme:data-cleared"))
  }, [])

  // Signing in must not inherit the last person's data. The documents are keyed to
  // the account id, so a different account reads a different key — but the
  // in-memory copy has to be dropped before the new session is adopted, or the
  // dashboard would briefly render the previous one's CVs while the load effect
  // catches up. Dispatching first and setting the user second is what makes the
  // order right: the event is handled synchronously, the load happens on the
  // next render.
  const adoptSession = useCallback((session) => {
    window.dispatchEvent(new CustomEvent("intelme:data-cleared"))
    setUser(session)
    return session
  }, [])

  const login = useCallback(
    async (credentials) => {
      setIsLoading(true)
      try {
        return adoptSession(await api.login(credentials))
      } finally {
        setIsLoading(false)
      }
    },
    [adoptSession],
  )

  const register = useCallback(
    async (details) => {
      setIsLoading(true)
      try {
        return adoptSession(await api.register(details))
      } finally {
        setIsLoading(false)
      }
    },
    [adoptSession],
  )

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
   * Deletes the account, then signs out locally.
   *
   * The server removes one document holding three fields, and there is no cascade
   * because nothing about a CV was ever stored there. The copy this browser holds
   * *is* the CV, so it is destroyed here alongside the account — keeping data
   * keyed to an account id that no longer resolves would be the one way to leave
   * a CV behind on a machine the user believes they have cleaned.
   */
  const deleteAccount = useCallback(async () => {
    setIsDeleting(true)
    try {
      await api.deleteAccount()
      if (user?.id) clear(user.id)
      setUser(null)
      window.dispatchEvent(new CustomEvent("intelme:data-cleared"))
    } finally {
      setIsDeleting(false)
    }
  }, [user?.id])

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
