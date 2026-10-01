import { useEffect, useState } from "react"
import { Check, LoaderCircle } from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

const STAGES = [
  { label: "Reading file structure", weight: 15 },
  { label: "Extracting sections and dates", weight: 20 },
  { label: "Running parser compatibility checks", weight: 25 },
  { label: "Extracting skills and keywords", weight: 20 },
  { label: "Scoring and ranking suggestions", weight: 20 },
]

function buildSchedule() {
  let cursor = 0
  return STAGES.map((stage) => {
    const start = cursor
    cursor += stage.weight
    return { ...stage, start, end: cursor }
  })
}

export function LoadingAnalysis({ fileName }) {
  const schedule = buildSchedule()
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const duration = 2600
    const startedAt = performance.now()
    let frame

    const tick = (now) => {
      const elapsed = Math.min(1, (now - startedAt) / duration)
      // ease-out so the bar settles instead of stopping dead
      setProgress(Math.round((1 - Math.pow(1 - elapsed, 2)) * 100))
      if (elapsed < 1) frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  const activeIndex = schedule.findIndex(
    (stage) => progress < stage.end,
  )

  return (
    <Card className="gap-6">
      <CardHeader>
        <CardTitle>Analysing your resume</CardTitle>
        <CardDescription>
          {fileName ? `Working through ${fileName}.` : "Working through your file."}{" "}
          This usually takes a few seconds.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-6">
        <div className="grid gap-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Overall progress</span>
            <span className="tabular-nums">{progress}%</span>
          </div>
          <Progress value={progress} className="[&_[data-slot=progress-track]]:h-1.5" />
        </div>

        <ul className="grid gap-3">
          {schedule.map((stage, index) => {
            const isDone = progress >= stage.end
            const isActive = index === activeIndex

            return (
              <li key={stage.label} className="flex items-center gap-3">
                <span
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full transition-colors",
                    isDone && "bg-primary text-primary-foreground",
                    isActive && "bg-secondary text-secondary-foreground",
                    !isDone && !isActive && "bg-secondary/50 text-muted-foreground",
                  )}
                >
                  {isDone ? (
                    <Check className="size-3.5" />
                  ) : isActive ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : (
                    <span className="size-1.5 rounded-full bg-current" />
                  )}
                </span>

                <span
                  className={cn(
                    "text-sm",
                    isActive ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {stage.label}
                </span>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}

export default LoadingAnalysis
