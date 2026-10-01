import { Check, Sparkles, TrendingUp, TriangleAlert } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"

function ScoreRing({ value }) {
  const radius = 54
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - value / 100)

  return (
    <div className="relative size-32 shrink-0">
      <svg viewBox="0 0 128 128" className="size-full -rotate-90">
        <circle
          cx="64"
          cy="64"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="9"
          className="text-secondary"
        />
        <circle
          cx="64"
          cy="64"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="text-primary transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center">
        <span className="text-4xl leading-none font-semibold tracking-[-1.2px] tabular-nums">
          {value}
        </span>
        <span className="text-xs text-muted-foreground">overall</span>
      </div>
    </div>
  )
}

function RequirementList({ title, description, requirements, tone }) {
  if (!requirements?.length) return null

  const Icon = tone === "matched" ? Check : TriangleAlert

  return (
    <div className="grid gap-2.5">
      <div className="grid gap-0.5">
        <p className="text-xs tracking-wide text-muted-foreground uppercase">{title}</p>
        <p className="text-xs text-muted-foreground/80">{description}</p>
      </div>
      <ul className="grid gap-2">
        {requirements.map((requirement, index) => (
          <li
            key={`${requirement.requirement}-${index}`}
            className="grid gap-1 border-b border-border pb-2 last:border-b-0 last:pb-0"
          >
            <div className="flex items-start gap-2">
              <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <span className="text-sm">{requirement.requirement}</span>
              {requirement.importance && (
                <Badge variant="outline" className="ml-auto shrink-0 font-normal">
                  {requirement.importance}
                </Badge>
              )}
            </div>
            {(requirement.evidence || requirement.hint) && (
              <p className="pl-5.5 text-sm text-muted-foreground">
                {requirement.evidence ?? requirement.hint}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function JobMatchCard({ match }) {
  const { overallScore, verdict, summary, matched, missing, extras } = match

  return (
    <Card className="gap-6">
      <CardHeader>
        <CardTitle>Matchability</CardTitle>
        <CardDescription>
          How much of this posting your resume covers, weighted by what the role
          actually asks for.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-6">
        <div className="flex flex-wrap items-center gap-6">
          <ScoreRing value={overallScore} />

          <div className="grid min-w-48 flex-1 gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-lg font-normal">{verdict}</h4>
              {summary && (
                <Badge variant="secondary" className="gap-1 font-normal">
                  <Sparkles className="size-3" />
                  AI scored
                </Badge>
              )}
            </div>
            {summary && (
              <p className="text-sm leading-[1.5] text-muted-foreground">{summary}</p>
            )}
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Overall match</span>
                <span className="tabular-nums">{overallScore}%</span>
              </div>
              <Progress value={overallScore} className="[&_[data-slot=progress-track]]:h-1.5" />
            </div>
          </div>
        </div>

        <div className="grid gap-6 border-t border-border pt-6 lg:grid-cols-2">
          <div className="grid content-start gap-6">
            <RequirementList
              title="You already show"
              description="Requirements the posting lists that your resume backs up."
              requirements={matched}
              tone="matched"
            />
            {extras?.length > 0 && (
              <RequirementList
                title="Not asked for"
                description="Strengths on your resume the posting never mentions."
                requirements={extras}
                tone="matched"
              />
            )}
          </div>

          <RequirementList
            title="Still missing"
            description="What the posting wants and your resume never mentions."
            requirements={missing}
            tone="missing"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4 text-sm text-muted-foreground">
          <TrendingUp className="size-4" />
          <span>
            {matched?.length ?? 0} covered, {missing?.length ?? 0} missing
          </span>
          <Badge variant="ghost" className="ml-auto font-normal">
            {overallScore >= 75
              ? "Strong fit"
              : overallScore >= 60
                ? "Stretch role"
                : "Reach"}
          </Badge>
        </div>
      </CardContent>
    </Card>
  )
}

export default JobMatchCard
