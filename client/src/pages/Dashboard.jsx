import { useState } from "react"
import { Link } from "react-router-dom"
import { Columns3, FileText, Pencil, ScanText, Sparkles, Target, Trash2 } from "lucide-react"

import { LoadingAnalysis } from "@/components/LoadingAnalysis"
import { ResumeUploader } from "@/components/ResumeUploader"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useResume } from "@/context/ResumeContext"

function formatSize(bytes) {
  if (!bytes) return null
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
}

/** The extraction method is worth surfacing: OCR on a scan takes far longer. */
function extractionNote(version) {
  if (version?.extractionMethod === "ocr") return "Read with OCR"
  if (version?.extractionMethod === "text") return "Text layer"
  if (version?.extractionMethod === "hybrid") return "Text layer + OCR"
  return null
}

function VersionRow({ version, isActive, isSelected, onSelect, onToggleCompare }) {
  const [isRenaming, setIsRenaming] = useState(false)
  const [draft, setDraft] = useState(version.label ?? "")
  const { renameVersion, deleteVersion, reanalyse } = useResume()

  function commitRename(event) {
    event.preventDefault()
    const label = draft.trim()
    setIsRenaming(false)
    if (label && label !== version.label) renameVersion(version.id, label)
  }

  return (
    <div
      className={
        isActive
          ? "flex flex-wrap items-center gap-3 rounded-xl border border-primary/40 bg-secondary/40 p-3"
          : "flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3"
      }
    >
      <input
        type="checkbox"
        checked={isSelected}
        onChange={() => onToggleCompare(version.id)}
        aria-label={`Compare ${version.label}`}
        className="size-4 shrink-0 accent-primary"
      />

      <button
        type="button"
        onClick={() => onSelect(version.id)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
          <FileText className="size-4.5" />
        </span>

        <span className="min-w-0 flex-1">
          {isRenaming ? (
            <Input
              autoFocus
              value={draft}
              maxLength={60}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitRename(event)
                if (event.key === "Escape") setIsRenaming(false)
              }}
              onClick={(event) => event.stopPropagation()}
              className="h-7 text-sm"
            />
          ) : (
            <span className="block truncate text-sm font-medium">{version.label}</span>
          )}

          <span className="block truncate text-xs text-muted-foreground">
            {[
              version.name,
              version.type,
              formatSize(version.size),
              formatDate(version.createdAt),
              extractionNote(version),
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
      </button>

      {version.score !== undefined && version.score !== null && (
        <Badge variant="secondary" className="shrink-0 font-normal">
          {version.score} ATS
        </Badge>
      )}

      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="icon-sm"
          variant="ghost"
          title="Rename version"
          onClick={() => setIsRenaming(true)}
        >
          <Pencil />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          title="Re-run the analysis"
          onClick={() => reanalyse(version.id)}
        >
          <Sparkles />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          title="Delete this version"
          onClick={() => deleteVersion(version.id)}
          className="text-destructive"
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  )
}

function ComparePanel({ versions, selected, onRun, onClear, comparison, isComparing }) {
  if (selected.length < 2) return null

  const chosen = versions.filter((version) => selected.includes(version.id))

  return (
    <Card className="gap-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Columns3 className="size-4" />
          Compare {selected.length} versions
        </CardTitle>
        <CardDescription>
          {selected.length > 5
            ? "Pick up to five versions."
            : chosen.map((version) => version.label).join(" · ")}
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={onRun}
            disabled={isComparing || selected.length > 5}
            className="inset-button"
          >
            {isComparing ? "Comparing…" : "Compare scores"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClear}>
            Clear selection
          </Button>
        </div>

        {comparison && (
          <div className="grid gap-3 overflow-x-auto">
            <table className="w-full min-w-[32rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-2 pr-3 font-medium text-muted-foreground">Metric</th>
                  {comparison.versions.map((version) => (
                    <th
                      key={version.resumeId}
                      className={
                        comparison.winner?.resumeId === version.resumeId
                          ? "py-2 pr-3 font-medium"
                          : "py-2 pr-3 font-medium text-muted-foreground"
                      }
                    >
                      {version.label}
                      {comparison.winner?.resumeId === version.resumeId && (
                        <Badge variant="secondary" className="ml-2 font-normal">
                          best
                        </Badge>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparison.rows.map((row) => (
                  <tr key={row.metric} className="border-b border-border/50 last:border-0">
                    <td className="py-2 pr-3 text-muted-foreground">{row.label}</td>
                    {row.values.map((value, index) => (
                      <td
                        key={comparison.versions[index]?.resumeId ?? index}
                        className={
                          row.best?.[index]
                            ? "py-2 pr-3 font-medium text-primary"
                            : "py-2 pr-3 tabular-nums"
                        }
                      >
                        {Math.round(value)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function CurrentResume() {
  const { resume, analysis } = useResume()

  return (
    <Card className="gap-6">
      <CardHeader>
        <CardTitle>Selected version</CardTitle>
        <CardDescription>
          This is what Analysis and Job match are reading. Pick a different version
          below, or upload a new one.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-6">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-secondary/40 p-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
            <FileText className="size-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{resume?.label ?? resume?.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {[resume?.name, resume?.type, formatSize(resume?.size)]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          {analysis && (
            <Badge variant="secondary" className="shrink-0 font-normal">
              {analysis.atsScore} ATS
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" render={<Link to="/analysis" />} className="inset-button">
            <ScanText data-icon="inline-start" />
            View analysis
          </Button>
          <Button size="sm" variant="outline" render={<Link to="/job-match" />}>
            <Target data-icon="inline-start" />
            Score a job
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export default function Dashboard() {
  const {
    analysis,
    isAnalysing,
    analysingFileName,
    analysisError,
    storageError,
    analyze,
    versions,
    activeId,
    selectVersion,
    compare,
    comparison,
    isComparing,
  } = useResume()

  const [selected, setSelected] = useState([])

  if (isAnalysing) {
    return (
      <div className="mx-auto grid w-full max-w-3xl gap-6">
        <LoadingAnalysis fileName={analysingFileName} />
      </div>
    )
  }

  function toggleCompare(id) {
    setSelected((previous) =>
      previous.includes(id) ? previous.filter((value) => value !== id) : [...previous, id],
    )
  }

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <div className="grid gap-1">
        <h2 className="text-2xl font-semibold tracking-[-0.9px]">Your resume versions</h2>
        <p className="text-muted-foreground">
          Upload the CV you plan to send. Every version is kept in this browser only —
          tailor a copy per role and compare them.
        </p>
      </div>

      {storageError && (
        <Alert variant="destructive">
          <AlertTitle>Not saved</AlertTitle>
          <AlertDescription>{storageError}</AlertDescription>
        </Alert>
      )}

      {analysisError && (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{analysisError}</AlertDescription>
        </Alert>
      )}

      {analysis ? <CurrentResume /> : null}

      {versions.length > 0 && (
        <Card className="gap-6">
          <CardHeader>
            <CardTitle>Saved versions</CardTitle>
            <CardDescription>
              {versions.length} {versions.length === 1 ? "version" : "versions"}. Tick two
              or more to compare their scores.
            </CardDescription>
          </CardHeader>

          <CardContent className="grid gap-2">
            {versions.map((version) => (
              <VersionRow
                key={version.id}
                version={version}
                isActive={version.id === activeId}
                isSelected={selected.includes(version.id)}
                onSelect={selectVersion}
                onToggleCompare={toggleCompare}
              />
            ))}
          </CardContent>
        </Card>
      )}

      <ComparePanel
        versions={versions}
        selected={selected}
        isComparing={isComparing}
        comparison={comparison}
        onRun={() => compare(selected)}
        onClear={() => {
          setSelected([])
        }}
      />

      <Card>
        <CardHeader>
          <CardTitle>Upload a version</CardTitle>
          <CardDescription>PDF or DOCX, up to 5 MB.</CardDescription>
        </CardHeader>
        <CardContent className={analysis ? "grid gap-4" : undefined}>
          <ResumeUploader onSubmit={analyze} isSubmitting={isAnalysing} />
        </CardContent>
      </Card>
    </div>
  )
}
