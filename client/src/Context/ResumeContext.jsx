import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

import * as api from "@/services/api"
import { useAuth } from "./AuthContext"

/**
 * Owns everything the three dashboard routes read: the user's CV versions, the
 * analysis of the selected one, the job description being worked on, the match
 * being scored, and the stored match history.
 *
 * All of it lives in MongoDB, so this provider is a cache over the API rather
 * than the source of truth. Anything that changes on the server is refetched
 * here before the components that depend on it re-render.
 */

const ResumeContext = createContext(null)

export function ResumeProvider({ children }) {
  const { isAuthenticated } = useAuth()

  const [versions, setVersions] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [resume, setResume] = useState(null)
  const [analysis, setAnalysis] = useState(null)

  const [isLoadingVersions, setIsLoadingVersions] = useState(false)
  const [isAnalysing, setIsAnalysing] = useState(false)
  const [analysisError, setAnalysisError] = useState(null)

  const [isImproving, setIsImproving] = useState(false)
  const [improveError, setImproveError] = useState(null)

  const [comparison, setComparison] = useState(null)
  const [isComparing, setIsComparing] = useState(false)

  const [jobDescription, setJobDescription] = useState("")
  const [match, setMatch] = useState(null)
  const [isMatching, setIsMatching] = useState(false)
  const [matchError, setMatchError] = useState(null)

  const [history, setHistory] = useState([])
  const [historyFilter, setHistoryFilter] = useState({ sort: "date:desc", search: "" })

  /* ---------------------------------------------------------------- *
   * Loading
   * ---------------------------------------------------------------- */

  const loadHistory = useCallback(async (filter = historyFilter) => {
    try {
      const matches = await api.listMatches(filter)
      setHistory(matches)
    } catch (error) {
      // A history that failed to load should not take the rest of the page
      // down; the list simply stays as it was.
      if (error?.status !== 401) setHistory([])
    }
  }, [historyFilter])

  const loadVersions = useCallback(async () => {
    setIsLoadingVersions(true)
    try {
      const list = await api.listResumes()

      // The resume list carries no score, and the analysis list carries no file
      // metadata. Merging them here means the version cards can show both
      // without a request per version.
      let scores = []
      try {
        scores = await api.listAnalyses()
      } catch {
        // Scores are a nicety on this screen; a failure here must not hide the
        // versions themselves.
      }

      const byResume = new Map(scores.map((entry) => [String(entry.resumeId), entry]))

      const merged = list.map((version) => {
        const entry = byResume.get(String(version.id))
        return entry ? { ...version, score: entry.score, verdict: entry.verdict } : version
      })

      setVersions(merged)
      return merged
    } catch (error) {
      if (error?.status === 401) setVersions([])
      return []
    } finally {
      setIsLoadingVersions(false)
    }
  }, [])

  // Load the account's documents when a session starts. The signed-out half of
  // this is handled by the event listeners below rather than here: clearing
  // state synchronously in an effect body triggers a cascading render, and both
  // ways of losing a session (signing out, and a 401 from the server) already
  // announce themselves.
  useEffect(() => {
    if (!isAuthenticated) return

    let cancelled = false

    async function load() {
      const list = await loadVersions()
      if (cancelled || !list.length) return

      // Open on the newest version so the dashboard is never empty after a
      // reload, and pull its analysis without a second round-trip.
      const [first] = list
      setActiveId(first.id)
      setResume(first)

      try {
        const full = await api.getAnalysis(first.id)
        if (!cancelled) setAnalysis(full)
      } catch {
        if (!cancelled) setAnalysis(null)
      }

      loadHistory()
    }

    load()

    return () => {
      cancelled = true
    }
  }, [isAuthenticated, loadVersions, loadHistory])

  // Losing the session drops the cached documents too, otherwise the next
  // person to sign in on this browser would briefly see the previous one.
  useEffect(() => {
    function handleCleared() {
      setVersions([])
      setActiveId(null)
      setResume(null)
      setAnalysis(null)
      setMatch(null)
      setHistory([])
      setComparison(null)
      setAnalysisError(null)
      setMatchError(null)
      setImproveError(null)
    }

    window.addEventListener("intelme:data-cleared", handleCleared)
    window.addEventListener("intelme:signed-out", handleCleared)
    return () => {
      window.removeEventListener("intelme:data-cleared", handleCleared)
      window.removeEventListener("intelme:signed-out", handleCleared)
    }
  }, [])

  /* ---------------------------------------------------------------- *
   * Versions
   * ---------------------------------------------------------------- */

  /**
   * Uploads a file and runs its analysis. The filename is set immediately so the
   * progress screen names the right file while the server is still working.
   */
  const analyze = useCallback(async (file, options = {}) => {
    setIsAnalysing(true)
    setAnalysisError(null)

    const optimistic = { name: file.name, size: file.size, type: (file.type || "").split("/").pop() }
    setResume(optimistic)

    try {
      const result = await api.uploadResume(file, options)
      const meta = result.resume ?? optimistic

      setVersions((previous) => [
        { ...meta, score: result.analysis?.atsScore, verdict: result.analysis?.verdict },
        ...previous,
      ])
      setResume(meta)
      setActiveId(meta.id)

      if (result.analysis) {
        setAnalysis(result.analysis)
        setAnalysisError(null)
      } else {
        // The file is stored and appears in the version list; only the analysis
        // is missing, so say that rather than implying the upload was lost.
        setAnalysis(null)
        setAnalysisError(
          `${result.reason ?? "The analysis could not be completed."} Your file was saved — use “Re-run analysis” to try again.`,
        )
      }

      loadHistory()
      return result.analysis
    } catch (error) {
      setAnalysisError(error?.message ?? "That file could not be read. Try exporting it as a plain PDF first.")
      return null
    } finally {
      setIsAnalysing(false)
    }
  }, [loadHistory])

  const selectVersion = useCallback(async (id) => {
    if (!id || id === activeId) return

    setActiveId(id)
    setAnalysisError(null)
    setComparison(null)

    const meta = versions.find((version) => version.id === id)
    if (meta) setResume(meta)

    try {
      const full = await api.getAnalysis(id)
      setResume((previous) => ({ ...(previous ?? {}), ...full }))
      setAnalysis(full)
    } catch (error) {
      setAnalysis(null)
      setAnalysisError(error?.message ?? "This version could not be loaded.")
    }
  }, [activeId, versions])

  const reanalyse = useCallback(async () => {
    if (!activeId) return null

    setIsAnalysing(true)
    setAnalysisError(null)

    try {
      const result = await api.reanalyse(activeId)
      setAnalysis(result.analysis)
      setVersions((previous) =>
        previous.map((version) =>
          version.id === activeId
            ? { ...version, score: result.analysis?.atsScore, verdict: result.analysis?.verdict }
            : version,
        ),
      )
      return result.analysis
    } catch (error) {
      setAnalysisError(error?.message ?? "The analysis could not be refreshed.")
      return null
    } finally {
      setIsAnalysing(false)
    }
  }, [activeId])

  const renameVersion = useCallback(async (id, label) => {
    const meta = await api.renameResume(id, label)
    setVersions((previous) => previous.map((version) => (version.id === id ? { ...version, ...meta } : version)))
    if (id === activeId) setResume((previous) => ({ ...(previous ?? {}), ...meta }))
    return meta
  }, [activeId])

  /**
   * Removes a version from the account, along with its file, its analyses and
   * any job matches scored against it. The next version in the list is selected
   * so the dashboard does not go blank.
   */
  const deleteVersion = useCallback(async (id) => {
    const message = await api.deleteResume(id)

    const remaining = versions.filter((version) => version.id !== id)
    setVersions(remaining)

    if (id === activeId) {
      setActiveId(null)
      setAnalysis(null)
      setComparison(null)

      if (remaining.length) {
        const [next] = remaining
        setActiveId(next.id)
        setResume(next)
        try {
          setAnalysis(await api.getAnalysis(next.id))
        } catch {
          setAnalysis(null)
        }
      } else {
        setResume(null)
      }
    }

    loadHistory()
    return message
  }, [activeId, versions, loadHistory])

  /**
   * "Reset" is the dashboard's remove button. Versions are persisted now, so
   * this deletes the selected one rather than just forgetting it locally.
   */
  const reset = useCallback(async () => {
    if (activeId) await deleteVersion(activeId)
  }, [activeId, deleteVersion])

  /* ---------------------------------------------------------------- *
   * Improve my CV
   * ---------------------------------------------------------------- */

  const improve = useCallback(async () => {
    if (!activeId) {
      setImproveError("Upload a CV first.")
      return null
    }

    setIsImproving(true)
    setImproveError(null)

    try {
      const improvements = await api.improveCv(activeId)
      // The suggestions are persisted against the analysis, so keep the cached
      // copy in step and the panel survives a reload.
      setAnalysis((previous) => (previous ? { ...previous, improvements } : previous))
      return improvements
    } catch (error) {
      setImproveError(error?.message ?? "Suggestions could not be generated. Try again in a moment.")
      return null
    } finally {
      setIsImproving(false)
    }
  }, [activeId])

  /* ---------------------------------------------------------------- *
   * Comparison
   * ---------------------------------------------------------------- */

  const compare = useCallback(async (resumeIds) => {
    if (resumeIds.length < 2) {
      setComparison(null)
      return null
    }

    setIsComparing(true)
    try {
      const result = await api.compareVersions(resumeIds)
      setComparison(result)
      return result
    } catch (error) {
      setComparison(null)
      setAnalysisError(error?.message ?? "Those versions could not be compared.")
      return null
    } finally {
      setIsComparing(false)
    }
  }, [])

  const clearComparison = useCallback(() => setComparison(null), [])

  /* ---------------------------------------------------------------- *
   * Job matching
   * ---------------------------------------------------------------- */

  const runMatch = useCallback(async () => {
    if (!activeId) {
      setMatchError("Upload a resume first so there is something to compare against.")
      return null
    }

    if (!jobDescription.trim()) {
      setMatchError("Paste the job description you want to score against.")
      return null
    }

    setIsMatching(true)
    setMatchError(null)

    try {
      const job = await api.createMatch({ resumeId: activeId, jobDescription })
      // The extras panel needs the CV's own skills, which only the selected
      // analysis has.
      const result = mapWithExtras(job, analysis)
      setMatch(result)
      loadHistory()
      return result
    } catch (error) {
      setMatch(null)
      setMatchError(error?.message ?? "The match could not be scored. Try again in a moment.")
      return null
    } finally {
      setIsMatching(false)
    }
  }, [activeId, analysis, jobDescription, loadHistory])

  const clearMatch = useCallback(() => {
    setMatch(null)
    setMatchError(null)
  }, [])

  const openHistoryMatch = useCallback(async (id) => {
    setMatchError(null)
    try {
      const job = await api.getMatch(id)
      const result = mapWithExtras(job, analysis)
      setMatch(result)
      return result
    } catch (error) {
      setMatchError(error?.message ?? "That match could not be opened.")
      return null
    }
  }, [analysis])

  const deleteHistoryMatch = useCallback(async (id) => {
    await api.deleteMatch(id)
    setHistory((previous) => previous.filter((entry) => entry.id !== id))
    setMatch((previous) => (previous?.id === id ? null : previous))
  }, [])

  const clearHistory = useCallback(async () => {
    await api.clearMatches()
    setHistory([])
    setMatch(null)
  }, [])

  const applyHistoryFilter = useCallback((next) => {
    setHistoryFilter((previous) => ({ ...previous, ...next }))
    loadHistory({ ...historyFilter, ...next })
  }, [historyFilter, loadHistory])

  const requirements = useMemo(
    () => api.extractJobRequirements(jobDescription),
    [jobDescription],
  )

  const value = useMemo(
    () => ({
      // versions
      versions,
      activeId,
      isLoadingVersions,
      selectVersion,
      renameVersion,
      deleteVersion,
      reanalyse,

      // the selected version
      resume,
      analysis,
      isAnalysing,
      analysisError,
      analyze,
      reset,

      // improve my CV
      improve,
      isImproving,
      improveError,

      // comparison
      compare,
      clearComparison,
      comparison,
      isComparing,

      // job match
      jobDescription,
      setJobDescription,
      requirements,
      match,
      isMatching,
      matchError,
      runMatch,
      clearMatch,

      // match history
      history,
      isLoadingHistory: false,
      historyFilter,
      applyHistoryFilter,
      openHistoryMatch,
      deleteHistoryMatch,
      clearHistory,
      refreshHistory: loadHistory,
    }),
    [
      versions,
      activeId,
      isLoadingVersions,
      selectVersion,
      renameVersion,
      deleteVersion,
      reanalyse,
      resume,
      analysis,
      isAnalysing,
      analysisError,
      analyze,
      reset,
      improve,
      isImproving,
      improveError,
      compare,
      clearComparison,
      comparison,
      isComparing,
      jobDescription,
      requirements,
      match,
      isMatching,
      matchError,
      runMatch,
      clearMatch,
      history,
      historyFilter,
      applyHistoryFilter,
      openHistoryMatch,
      deleteHistoryMatch,
      clearHistory,
      loadHistory,
    ],
  )

  return <ResumeContext.Provider value={value}>{children}</ResumeContext.Provider>
}

/**
 * `mapMatch` is private to the API module because the extras list depends on the
 * selected analysis, which only this provider holds. Re-exporting it here keeps
 * the components free of mapping code.
 */
function mapWithExtras(job, analysis) {
  return api.toMatchResult(job, analysis)
}

export function useResume() {
  const context = useContext(ResumeContext)

  if (!context) {
    throw new Error("useResume must be used within a ResumeProvider.")
  }

  return context
}

export default ResumeProvider
