import { useState } from "react"
import { Link } from "react-router-dom"
import { ClipboardPaste, History, Trash2, UploadCloud } from "lucide-react"

import { JobMatchCard } from "@/components/JobMatchCard"
import { FindingList, ScoreBreakdown } from "@/components/ScoreBreakdown"
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
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { useResume } from "@/context/ResumeContext"

const MIN_DESCRIPTION_LENGTH = 80

function formatDate(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
}

function MissingResume() {
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-6">
      <div className="grid gap-1">
        <h2 className="text-2xl font-semibold tracking-[-0.9px]">Job match</h2>
        <p className="text-muted-foreground">
          A match is only meaningful against a resume, so upload one first.
        </p>
      </div>

      <Card>
        <CardContent>
          <div className="grid justify-items-center gap-4 py-8 text-center">
            <span className="flex size-11 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
              <UploadCloud className="size-5" />
            </span>
            <div className="grid gap-1">
              <p className="text-lg">No resume on file</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Upload a PDF or DOCX and come straight back here.
              </p>
            </div>
            <Button render={<Link to="/dashboard" />} className="inset-button">
              Go to dashboard
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function DetectedRequirements() {
  const { requirements } = useResume()

  if (requirements.length === 0) return null

  return (
    <div className="grid gap-2.5 border-t border-border pt-4">
      <p className="text-xs tracking-wide text-muted-foreground uppercase">
        Picked up from this posting
      </p>
      <p className="text-xs text-muted-foreground">
        A quick local read of the text you pasted. The scored match below is produced
        by the model, not by this list.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {requirements.map((requirement) => (
          <Badge
            key={requirement.label}
            variant="outline"
            className="rounded-full font-normal"
          >
            {requirement.label}
          </Badge>
        ))}
      </div>
    </div>
  )
}

function MatchSkeleton() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-56 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  )
}

/**
 * Every match this account has scored, with the same sort and filter the server
 * supports. Matches are stored, so this list survives a reload.
 */
function MatchHistory() {
  const {
    history,
    openHistoryMatch,
    deleteHistoryMatch,
    clearHistory,
    refreshHistory,
    historyFilter,
    applyHistoryFilter,
  } = useResume()

  if (!history.length) return null

  return (
    <Card className="gap-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="size-4" />
          Your job matches
        </CardTitle>
        <CardDescription>
          {history.length} saved {history.length === 1 ? "match" : "matches"}. Open one to
          see the full breakdown again.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={historyFilter.search}
            onChange={(event) => applyHistoryFilter({ search: event.target.value })}
            placeholder="Search title or company"
            aria-label="Search matches"
            className="h-8 max-w-56 text-sm"
          />

          <select
            value={historyFilter.sort}
            onChange={(event) => applyHistoryFilter({ sort: event.target.value })}
            aria-label="Sort matches"
            className="h-8 rounded-lg border border-border bg-card px-2 text-sm"
          >
            <option value="date:desc">Newest first</option>
            <option value="date:asc">Oldest first</option>
            <option value="score:desc">Highest score</option>
            <option value="score:asc">Lowest score</option>
          </select>

          <Button
            size="sm"
            variant="ghost"
            onClick={clearHistory}
            className="ml-auto text-destructive"
          >
            <Trash2 data-icon="inline-start" />
            Clear all
          </Button>
        </div>

        <ul className="divide-y divide-border">
          {history.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{entry.jobTitle}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[entry.company, formatDate(entry.createdAt), `${entry.matchingSkills.length} covered`]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>

              <Badge variant="secondary" className="shrink-0 font-normal">
                {entry.score}%
              </Badge>

              <div className="flex shrink-0 items-center gap-1">
                <Button size="sm" variant="outline" onClick={() => openHistoryMatch(entry.id)}>
                  Open
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => deleteHistoryMatch(entry.id)}
                  aria-label={`Delete match for ${entry.jobTitle}`}
                  className="text-destructive"
                >
                  <Trash2 />
                </Button>
              </div>
            </li>
          ))}
        </ul>

        <Button size="sm" variant="ghost" onClick={() => refreshHistory()} className="w-fit text-muted-foreground">
          Refresh
        </Button>
      </CardContent>
    </Card>
  )
}

/** Why the score landed where it did, in the candidate's own terms. */
function MatchExplanation({ match }) {
  const experience = match.matchingExperience ?? {}
  const education = match.matchingEducation ?? {}

  const facts = [
    experience.requiredYears
      ? `The posting asks for ${experience.requiredYears} ${experience.requiredYears === 1 ? "year" : "years"}; you show ${experience.candidateYears}. Status: ${experience.status}.`
      : null,
    education.required || education.candidate
      ? `Education asked for: ${education.required || "not specified"}. You show: ${education.candidate || "not specified"}. Status: ${education.status}.`
      : null,
  ].filter(Boolean)

  return (
    <div className="grid gap-6">
      <ScoreBreakdown
        rows={match.scoreBreakdown}
        title="Where the match score comes from"
        description="Six categories, each weighted, summing to the headline percentage."
      />

      {facts.length > 0 && (
        <Card className="gap-4">
          <CardHeader>
            <CardTitle className="text-base">Requirements compared</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 text-sm text-muted-foreground">
              {facts.map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <FindingList title="What works" items={match.strengths} tone="positive" />
        <FindingList title="What is missing" items={match.gaps} tone="negative" />
      </div>

      <FindingList
        title="What to do about it"
        items={match.recommendations}
        tone="neutral"
        empty="No specific actions came back for this posting."
      />
    </div>
  )
}

export default function JobMatch() {
  const {
    analysis,
    jobDescription,
    setJobDescription,
    match,
    isMatching,
    matchError,
    runMatch,
    clearMatch,
  } = useResume()

  const [tab, setTab] = useState("result")

  if (!analysis) return <MissingResume />

  const isTooShort =
    jobDescription.trim().length > 0 && jobDescription.trim().length < MIN_DESCRIPTION_LENGTH

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <div className="grid gap-1">
        <h2 className="text-2xl font-semibold tracking-[-0.9px]">Job match</h2>
        <p className="text-muted-foreground">
          Paste the full posting. intelme compares it against {analysis.fileName} and
          scores how much of what the role asks for your resume actually covers.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardPaste className="size-4.5 text-muted-foreground" />
            Job description
          </CardTitle>
          <CardDescription>
            Include the requirements and responsibilities sections — that is where
            the scoring signal lives.
          </CardDescription>
        </CardHeader>

        <CardContent className="grid gap-4">
          <Textarea
            value={jobDescription}
            onChange={(event) => setJobDescription(event.target.value)}
            placeholder="Paste the posting here…"
            rows={12}
            aria-label="Job description"
            className="resize-y font-normal leading-[1.5]"
          />

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={runMatch} disabled={isMatching || isTooShort} className="inset-button">
              {isMatching ? "Scoring…" : "Analyse match"}
            </Button>
            {jobDescription.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setJobDescription("")
                  clearMatch()
                }}
                disabled={isMatching}
                className="text-muted-foreground"
              >
                Clear
              </Button>
            )}
            <span className="text-xs text-muted-foreground tabular-nums">
              {jobDescription.trim().length} characters
            </span>
          </div>

          {isTooShort && (
            <p role="alert" className="text-xs text-destructive">
              Paste at least {MIN_DESCRIPTION_LENGTH} characters so there is enough to
              compare.
            </p>
          )}

          <DetectedRequirements />
        </CardContent>
      </Card>

      {matchError && (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{matchError}</AlertDescription>
        </Alert>
      )}

      {isMatching && <MatchSkeleton />}

      {!isMatching && match && (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center gap-1 border-b border-border">
            {[
              ["result", "Overview"],
              ["why", "Why this score"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                className={
                  tab === value
                    ? "border-b-2 border-primary px-3 py-2 text-sm font-medium"
                    : "border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground"
                }
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "result" ? <JobMatchCard match={match} /> : <MatchExplanation match={match} />}
        </div>
      )}

      <MatchHistory />
    </div>
  )
}
