import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

import * as api from "@/services/api"
import * as workspaceStore from "@/services/workspace"
import { useAuth } from "./AuthContext"

/**
 * Owns everything the three dashboard routes read: the user's CV versions, the
 * analysis of the selected one, the job description being worked on, the match
 * being scored, and the match history.
 *
 * All of it lives in this browser. `useWorkspace` reads it straight out of
 * `localStorage`, and the API is called only for the work a browser genuinely
 * cannot do — parsing a file, asking the model, scoring the answer. There is no
 * fetch-on-mount for any list here, because there is no server to fetch them from.
 *
 * The consequence worth remembering while editing: the server never tells us
 * anything about a CV that we did not just send it. So every write follows the
 * same shape — call the API, take the result, merge it into the workspace, and
 * let the store re-render. Nothing is written optimistically, because a stored
 * CV the server cannot be asked about again is the one thing we must never claim
 * to have saved when we have not.
 */

const ResumeContext = createContext(null)

/** Below this many characters the server will not accept the text back. */
const MIN_TEXT_LENGTH = 40

export function ResumeProvider({ children }) {
  const { user } = useAuth()
  const userId = user?.id ?? null

  // The documents, read from storage. Signing in, signing out and switching
  // accounts all swap this with the session — there is nothing to load.
  const workspace = workspaceStore.useWorkspace(userId)
  const localStorageUsed = workspaceStore.useStorageFootprint(userId)

  const [activeId, setActiveId] = useState(null)
  const [isAnalysing, setIsAnalysing] = useState(false)
  const [analysingFileName, setAnalysingFileName] = useState(null)
  const [analysisError, setAnalysisError] = useState(null)
  const [storageError, setStorageError] = useState(null)

  const [isImproving, setIsImproving] = useState(false)
  const [improveError, setImproveError] = useState(null)

  const [comparison, setComparison] = useState(null)
  const [isComparing, setIsComparing] = useState(false)

  const [jobDescription, setJobDescription] = useState("")
  const [match, setMatch] = useState(null)
  const [isMatching, setIsMatching] = useState(false)
  const [matchError, setMatchError] = useState(null)

  const [historyFilter, setHistoryFilter] = useState({ sort: "date:desc", search: "" })

  /* ---------------------------------------------------------------- *
   * Persistence
   * ---------------------------------------------------------------- */

  /**
   * Applies a change to the stored documents, and reports whether it landed.
   *
   * The only way they change. A failed write throws inside `update` and is caught
   * here — and because nothing reached `localStorage`, the snapshot is unchanged
   * and the screen still shows the last thing that really happened. The result is
   * returned rather than only set on state, because a caller that just spent an
   * AI call needs to know *now* whether the thing it paid for was saved.
   *
   * @returns {{ok: boolean, value?: object, error?: string}}
   */
  const commit = useCallback(
    (updater) => {
      if (!userId) return { ok: false, error: "Sign in to save changes." }

      try {
        const value = workspaceStore.update(userId, updater)
        setStorageError(null)
        return { ok: true, value }
      } catch (error) {
        setStorageError(error.message)
        return { ok: false, error: error.message }
      }
    },
    [userId],
  )

  /* ---------------------------------------------------------------- *
   * Derived views
   * ---------------------------------------------------------------- */

  const versions = useMemo(
    () => workspaceStore.sortVersions(workspace.resumes).map(workspaceStore.toVersion),
    [workspace.resumes],
  )

  const activeVersion = useMemo(
    () => versions.find((version) => version.id === activeId) ?? null,
    [versions, activeId],
  )

  // The page reads a mapped analysis; the server needs the raw one. Both come out
  // of the same stored object, so they cannot disagree.
  const analysis = useMemo(
    () => (activeVersion ? api.mapAnalysis(activeVersion.analysis, activeVersion) : null),
    [activeVersion],
  )

  const history = useMemo(
    () => workspaceStore.summariseMatches(workspace, historyFilter),
    [workspace, historyFilter],
  )

  /* ---------------------------------------------------------------- *
   * Losing the session
   * ---------------------------------------------------------------- */

  /**
   * The documents are keyed to the account and swap out with it, so there is
   * nothing to clear here. What does need clearing is the transient UI state —
   * the match on screen, a half-finished comparison — which would otherwise be
   * waiting when the next session opens.
   *
   * Both ways of losing a session — signing out, and a 401 from the server —
   * announce themselves by firing this, and both handlers are registered in an
   * effect because they are subscriptions to an external event, not work to do.
   */
  useEffect(() => {
    function handleCleared() {
      setActiveId(null)
      setMatch(null)
      setComparison(null)
      setAnalysisError(null)
      setMatchError(null)
      setImproveError(null)
      setStorageError(null)
      setAnalysingFileName(null)
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
   * Uploads a file, keeps what comes back, and analyses it.
   *
   * The version is written to storage before the analysis is announced, so a
   * successful upload survives a reload even if the score never arrived.
   */
  const analyze = useCallback(
    async (file, options = {}) => {
      setIsAnalysing(true)
      setAnalysingFileName(file.name)
      setAnalysisError(null)

      try {
        const result = await api.uploadResume(file, options)

        if (!result.resume) {
          // No text came back at all, so there is no version to keep.
          setAnalysisError(result.reason ?? "That file could not be read.")
          return null
        }

        const meta = api.mapResumeMeta(result.resume)
        const id = workspaceStore.newId()

        const record = {
          id,
          label: meta.label ?? "Main",
          originalName: meta.name ?? file.name,
          fileType: (result.resume.fileType ?? "").toLowerCase(),
          fileSize: meta.size ?? file.size,
          extractionMethod: meta.extractionMethod ?? null,
          characters: meta.characters ?? 0,
          // The text is the CV from here on: the server deleted the file, and
          // this is what a re-run is made of.
          extractedText: result.resume.extractedText ?? "",
          createdAt: meta.createdAt ?? new Date().toISOString(),
          analysis: result.analysis,
        }

        commit((previous) => ({ ...previous, resumes: [record, ...previous.resumes] }))
        setActiveId(id)

        if (!result.analysis) {
          // The text was read fine, so the version exists and is usable; only the
          // score is missing. Say that rather than implying the upload was lost.
          setAnalysisError(
            `${result.reason ?? "The analysis could not be completed."} Your file was read — use “Re-run analysis” to try again.`,
          )
        }

        return result.analysis
      } catch (error) {
        setAnalysisError(
          error?.message ?? "That file could not be read. Try exporting it as a plain PDF first.",
        )
        return null
      } finally {
        setIsAnalysing(false)
        setAnalysingFileName(null)
      }
    },
    [commit],
  )

  const selectVersion = useCallback((id) => {
    if (!id) return

    setActiveId(id)
    setAnalysisError(null)
    setComparison(null)
    // A match was scored against the version that was selected when it ran, so
    // leaving it on screen after a switch would attribute it to the wrong CV.
    setMatch(null)
  }, [])

  /**
   * Re-runs the analysis on the text already stored for a version.
   *
   * The stored `analysis` is what the server needs in order to score this against
   * a posting later, so the record's own object is what gets replaced — never
   * the mapped display copy. `improvements` goes with it: this is a fresh read of
   * the CV, and suggestions written against the previous one describe a state
   * that no longer exists.
   */
  const reanalyse = useCallback(
    async (id) => {
      const versionId = id ?? activeId
      const record = workspace.resumes.find((resume) => resume.id === versionId)

      if (!record || (record.extractedText ?? "").trim().length < MIN_TEXT_LENGTH) {
        setAnalysisError("This resume has no readable text to analyse.")
        return null
      }

      setIsAnalysing(true)
      setAnalysingFileName(record.originalName)
      setAnalysisError(null)

      try {
        const stored = await api.reanalyse(record.extractedText)

        if (!stored) {
          setAnalysisError("The analysis could not be refreshed. Try again in a moment.")
          return null
        }

        commit((previous) => ({
          ...previous,
          resumes: previous.resumes.map((resume) =>
            resume.id === versionId ? { ...resume, analysis: stored } : resume,
          ),
        }))

        return stored
      } catch (error) {
        setAnalysisError(error?.message ?? "The analysis could not be refreshed.")
        return null
      } finally {
        setIsAnalysing(false)
        setAnalysingFileName(null)
      }
    },
    [activeId, commit, workspace.resumes],
  )

  const renameVersion = useCallback(
    (id, label) => {
      const trimmed = String(label ?? "").trim()
      if (!trimmed) return

      commit((previous) => ({
        ...previous,
        resumes: previous.resumes.map((resume) =>
          resume.id === id ? { ...resume, label: trimmed.slice(0, 60) } : resume,
        ),
      }))
    },
    [commit],
  )

  /**
   * Removes a version from this browser, along with any match scored against it.
   * The next version in the list is selected so the dashboard does not go blank.
   */
  const deleteVersion = useCallback(
    (id) => {
      const remaining = workspaceStore.sortVersions(
        workspace.resumes.filter((resume) => resume.id !== id),
      )

      commit((previous) => workspaceStore.removeResume(previous, id))

      if (id === activeId) {
        setActiveId(remaining[0]?.id ?? null)
        setComparison(null)
        setMatch(null)
      }
    },
    [activeId, commit, workspace.resumes],
  )

  /** The dashboard's remove button. */
  const reset = useCallback(async () => {
    if (activeId) deleteVersion(activeId)
  }, [activeId, deleteVersion])

  /* ---------------------------------------------------------------- *
   * Improve my CV
   * ---------------------------------------------------------------- */

  const improve = useCallback(async () => {
    const record = workspace.resumes.find((resume) => resume.id === activeId)

    if (!record?.analysis) {
      setImproveError("Upload a CV first.")
      return null
    }

    setIsImproving(true)
    setImproveError(null)

    try {
      const improvements = await api.improveCv(record.analysis)

      // Written onto the stored analysis, so the panel survives a reload and the
      // server has it the next time this analysis is used.
      commit((previous) => ({
        ...previous,
        resumes: previous.resumes.map((resume) =>
          resume.id === activeId
            ? { ...resume, analysis: { ...resume.analysis, improvements } }
            : resume,
        ),
      }))

      return improvements
    } catch (error) {
      setImproveError(error?.message ?? "Suggestions could not be generated. Try again in a moment.")
      return null
    } finally {
      setIsImproving(false)
    }
  }, [activeId, commit, workspace.resumes])

  /* ---------------------------------------------------------------- *
   * Comparison
   * ---------------------------------------------------------------- */

  const compare = useCallback(
    async (ids) => {
      if (ids.length < 2) {
        setComparison(null)
        return null
      }

      const chosen = ids
        .map((id) => workspace.resumes.find((resume) => resume.id === id))
        .filter((resume) => resume?.analysis)

      if (chosen.length < 2) {
        setComparison(null)
        setAnalysisError("Those versions could not be compared — one of them has no analysis yet.")
        return null
      }

      setIsComparing(true)
      try {
        const result = await api.compareVersions(chosen)
        setComparison(result)
        return result
      } catch (error) {
        setComparison(null)
        setAnalysisError(error?.message ?? "Those versions could not be compared.")
        return null
      } finally {
        setIsComparing(false)
      }
    },
    [workspace.resumes],
  )

  const clearComparison = useCallback(() => setComparison(null), [])

  /* ---------------------------------------------------------------- *
   * Job matching
   * ---------------------------------------------------------------- */

  const runMatch = useCallback(async () => {
    const record = workspace.resumes.find((resume) => resume.id === activeId)

    if (!record?.analysis) {
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
      // The candidate side of the comparison is the stored analysis, sent as-is.
      const job = await api.createMatch({
        analysis: record.analysis,
        resumeId: activeId,
        jobDescription,
      })

      const saved = commit((previous) => ({ ...previous, matches: [job, ...previous.matches] }))

      if (!saved.ok) {
        // The score came back but there is nowhere to put it. Saying so beats
        // showing a match that the next reload would forget.
        setMatch(null)
        setMatchError(saved.error)
        return null
      }

      // The extras panel needs the CV's own skills, which only the mapped
      // analysis exposes.
      const result = api.toMatchResult(job, analysis)
      setMatch(result)
      return result
    } catch (error) {
      setMatch(null)
      setMatchError(error?.message ?? "The match could not be scored. Try again in a moment.")
      return null
    } finally {
      setIsMatching(false)
    }
  }, [activeId, analysis, commit, jobDescription, workspace.resumes])

  const clearMatch = useCallback(() => {
    setMatch(null)
    setMatchError(null)
  }, [])

  /** Opens a saved match. It is already here — there is nothing to fetch. */
  const openHistoryMatch = useCallback(
    (id) => {
      const job = workspace.matches.find((entry) => entry.id === id)

      if (!job) {
        setMatchError("That match is no longer saved in this browser.")
        return null
      }

      const result = api.toMatchResult(job, analysis)
      setMatchError(null)
      setMatch(result)
      return result
    },
    [analysis, workspace.matches],
  )

  const deleteHistoryMatch = useCallback(
    (id) => {
      commit((previous) => ({
        ...previous,
        matches: previous.matches.filter((entry) => entry.id !== id),
      }))

      setMatch((previous) => (previous?.id === id ? null : previous))
    },
    [commit],
  )

  const clearHistory = useCallback(() => {
    commit((previous) => ({ ...previous, matches: [] }))
    setMatch(null)
  }, [commit])

  const applyHistoryFilter = useCallback((next) => {
    setHistoryFilter((previous) => ({ ...previous, ...next }))
  }, [])

  /** The history is derived from storage, so "refresh" has nothing to do. */
  const refreshHistory = useCallback(async () => undefined, [])

  const requirements = useMemo(
    () => api.extractJobRequirements(jobDescription),
    [jobDescription],
  )

  /**
   * Wipes this account's documents from this browser, leaving the account itself
   * alone. The server holds nothing to wipe, so this is the only place that copy
   * can be destroyed.
   */
  const clearLocalData = useCallback(() => {
    if (!userId) return

    workspaceStore.clear(userId)
    setActiveId(null)
    setMatch(null)
    setComparison(null)
    setAnalysisError(null)
    setMatchError(null)
    setStorageError(null)
  }, [userId])

  const value = useMemo(
    () => ({
      // versions
      versions,
      activeId,
      selectVersion,
      renameVersion,
      deleteVersion,
      reanalyse,

      // the selected version
      resume: activeVersion,
      analysis,
      isAnalysing,
      analysingFileName,
      analysisError,
      analyze,
      reset,

      // this browser's own storage
      storageError,
      localStorageUsed,
      clearLocalData,

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
      refreshHistory,
    }),
    [
      versions,
      activeId,
      selectVersion,
      renameVersion,
      deleteVersion,
      reanalyse,
      activeVersion,
      analysis,
      isAnalysing,
      analysingFileName,
      analysisError,
      analyze,
      reset,
      storageError,
      localStorageUsed,
      clearLocalData,
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
      refreshHistory,
    ],
  )

  return <ResumeContext.Provider value={value}>{children}</ResumeContext.Provider>
}

export function useResume() {
  const context = useContext(ResumeContext)

  if (!context) {
    throw new Error("useResume must be used within a ResumeProvider.")
  }

  return context
}

export default ResumeProvider