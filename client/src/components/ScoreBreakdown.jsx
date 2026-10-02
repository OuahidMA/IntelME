import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

/**
 * The weighted score, shown as the arithmetic that produced it.
 *
 * Every row is `score × weight = earned`, and the earned column sums to the
 * headline number — so a candidate can see exactly which category cost them
 * points rather than being handed a single opaque figure.
 */
export function ScoreBreakdown({ rows = [], title = "Where the score comes from", description }) {
  if (!rows.length) return null

  const totalEarned = rows.reduce((sum, row) => sum + (row.earned ?? 0), 0)

  return (
    <Card className="gap-6">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {description ?? "Each category is scored on its own, then weighted to reach 100."}
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4">
        <ul className="grid gap-4">
          {rows.map((row) => (
            <li key={row.key} className="grid gap-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{row.label}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {row.score}/100 &times; {row.weight}% ={" "}
                  <span className="text-foreground">{row.earned}</span>
                </span>
              </div>

              <Progress
                value={row.score}
                className="[&_[data-slot=progress-track]]:h-1.5"
              />

              {row.note && <p className="text-xs text-muted-foreground">{row.note}</p>}
            </li>
          ))}
        </ul>

        <div className="flex items-baseline justify-between border-t border-border pt-3 text-sm">
          <span className="font-medium">Total</span>
          <span className="tabular-nums">
            {Math.round(totalEarned * 10) / 10} / 100
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

/** A bulleted list of AI findings, with the polarity baked into the heading. */
export function FindingList({ title, items = [], tone = "neutral", empty }) {
  if (!items.length) {
    if (!empty) return null
    return (
      <Card className="gap-4">
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{empty}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2">
          {items.map((item) => (
            <li
              key={item}
              className={cn(
                "flex gap-2 text-sm",
                tone === "positive" && "text-foreground",
                tone === "negative" && "text-foreground",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "mt-1.5 size-1.5 shrink-0 rounded-full",
                  tone === "positive" && "bg-emerald-500",
                  tone === "negative" && "bg-destructive",
                  tone === "neutral" && "bg-muted-foreground/40",
                )}
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

export default ScoreBreakdown
