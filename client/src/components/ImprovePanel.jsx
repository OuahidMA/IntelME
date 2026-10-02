import { Sparkles } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useResume } from "@/context/ResumeContext"

/**
 * "Improve My CV": a rewritten summary plus sharper wording for the weakest
 * parts of the CV.
 *
 * The disclaimer is not optional decoration. The server attaches it to every
 * response and it is rendered unconditionally: these are model suggestions, and
 * a candidate is the only one who knows whether a claim is true.
 */
export function ImprovePanel({ improvements, onRun, isImproving, error }) {
  const { improve } = useResume()

  function handleRun() {
    if (onRun) onRun()
    else improve()
  }

  return (
    <Card className="gap-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4" />
          Improve my CV
        </CardTitle>
        <CardDescription>
          {improvements
            ? "A rewritten summary and sharper wording, based on the gaps in your score."
            : "Get a rewritten summary and sharper wording for the parts costing you points."}
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-6">
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Could not generate suggestions</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!improvements ? (
          <Button
            onClick={handleRun}
            disabled={isImproving}
            className="inset-button w-fit"
          >
            <Sparkles data-icon="inline-start" />
            {isImproving ? "Writing…" : "Generate suggestions"}
          </Button>
        ) : (
          <div className="grid gap-6">
            {improvements.improvedSummary && (
              <div className="grid gap-2">
                <h4 className="text-sm font-medium">Rewritten summary</h4>
                <p className="rounded-xl border border-border bg-secondary/30 p-4 text-sm leading-relaxed">
                  {improvements.improvedSummary}
                </p>
              </div>
            )}

            {improvements.suggestions?.length > 0 && (
              <div className="grid gap-2">
                <h4 className="text-sm font-medium">Suggested changes</h4>
                <ul className="grid gap-2">
                  {improvements.suggestions.map((suggestion) => (
                    <li key={suggestion} className="flex gap-2 text-sm">
                      <span
                        aria-hidden="true"
                        className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
                      />
                      <span>{suggestion}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {improvements.rewrittenBullets?.length > 0 && (
              <div className="grid gap-2">
                <h4 className="text-sm font-medium">Sharper bullet points</h4>
                <ul className="grid gap-2">
                  {improvements.rewrittenBullets.map((bullet) => (
                    <li
                      key={bullet}
                      className="rounded-xl border border-border bg-card p-3 text-sm leading-relaxed"
                    >
                      {bullet}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Button variant="outline" size="sm" onClick={handleRun} disabled={isImproving} className="w-fit">
              {isImproving ? "Rewriting…" : "Try again"}
            </Button>
          </div>
        )}

        {improvements?.disclaimer && (
          <p className="border-t border-border pt-4 text-xs text-muted-foreground">
            {improvements.disclaimer}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

export default ImprovePanel
