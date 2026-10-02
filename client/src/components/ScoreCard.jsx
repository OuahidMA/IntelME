import { Check, CircleDashed, TriangleAlert } from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

function ScoreRing({ value }) {
  const radius = 54
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - value / 100)

  return (
    <div className="relative size-40 shrink-0">
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
        <span className="text-5xl leading-none font-semibold tracking-[-1.5px]">{value}</span>
        <span className="mt-1 text-xs text-muted-foreground">out of 100</span>
      </div>
    </div>
  )
}

const statusIcon = {
  pass: Check,
  warn: TriangleAlert,
  fail: CircleDashed,
}

function CheckRow({ label, status }) {
  const Icon = statusIcon[status] ?? CircleDashed

  return (
    <li className="flex items-center gap-3 py-1.5">
      <span
        className={cn(
          "flex size-6 items-center justify-center rounded-full",
          status === "pass" && "bg-secondary text-secondary-foreground",
          status === "warn" && "bg-secondary text-foreground/70",
          status === "fail" && "bg-destructive/10 text-destructive",
        )}
      >
        <Icon className="size-3.5" />
      </span>
      <span className="text-sm">{label}</span>
    </li>
  )
}

export function ScoreCard({ score, checks = [], suggestions = [] }) {
  return (
    <Card className="gap-6">
      <CardHeader>
        <CardTitle>Compatibility score</CardTitle>
        <CardDescription>
          How cleanly your file survives parsing, out of 100.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-8 lg:grid-cols-[auto_1fr]">
        <div className="grid justify-items-center gap-3">
          <ScoreRing value={score} />
          <p className="max-w-40 text-center text-xs text-muted-foreground">
            {score >= 85
              ? "Ready to send. Small polish will not change much."
              : score >= 70
                ? "Solid, with a few structural fixes worth making."
                : "The parser is losing real information. Fix this first."}
          </p>
        </div>

        <div className="grid content-start gap-6">
          <div>
            <h4 className="mb-2 text-sm font-medium">Parser checks</h4>
            <ul className="divide-y divide-border">
              {checks.map((check) => (
                <CheckRow key={check.label} label={check.label} status={check.status} />
              ))}
            </ul>
          </div>

          <div className="grid gap-3">
            <h4 className="text-sm font-medium">Prioritised fixes</h4>
            <ol className="grid gap-3">
              {suggestions.map((suggestion, index) => (
                <li key={suggestion} className="grid gap-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm">{suggestion}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {index === 0 ? "High impact" : index === 1 ? "Medium" : "Polish"}
                    </span>
                  </div>
                  <Progress value={100 - index * 28} className="[&_[data-slot=progress-track]]:h-1" />
                </li>
              ))}
            </ol>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default ScoreCard
