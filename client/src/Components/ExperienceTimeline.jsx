import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

function formatRange({ start, end, current }) {
  const format = (value) =>
    new Date(`${value}-01T00:00:00`).toLocaleDateString("en-GB", {
      month: "short",
      year: "numeric",
    })

  return `${format(start)} — ${current ? "Present" : format(end)}`
}

function monthsBetween({ start, end, current }) {
  const toDate = (value) => new Date(`${value}-01T00:00:00`)
  const from = toDate(start)
  const to = current ? new Date() : toDate(end)
  return Math.max(1, Math.round((to - from) / (1000 * 60 * 60 * 24 * 30.44)))
}

export function ExperienceTimeline({ roles = [] }) {
  return (
    <Card className="gap-5">
      <CardHeader>
        <CardTitle>Experience timeline</CardTitle>
        <CardDescription>
          Roles intelme parsed out of your resume, newest first.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <ol className="relative grid gap-6 pl-6">
          <span
            aria-hidden="true"
            className="absolute top-1 bottom-1 left-[7px] w-px bg-border"
          />

          {roles.map((role) => {
            const months = monthsBetween(role)

            return (
              <li key={role.id} className="relative">
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute top-1.5 -left-6 size-3.5 rounded-full ring-4 ring-card",
                    role.current ? "bg-primary" : "bg-border",
                  )}
                />

                <div className="grid gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-base font-medium">{role.role}</h4>
                    {role.current && <Badge variant="secondary">Current</Badge>}
                  </div>

                  <p className="text-sm text-muted-foreground">
                    {role.company} &middot; {formatRange(role)}
                  </p>

                  <p className="text-sm leading-[1.5] text-muted-foreground">{role.summary}</p>

                  <p className="text-xs tabular-nums text-muted-foreground/80">
                    {months} {months === 1 ? "month" : "months"} in role
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
      </CardContent>
    </Card>
  )
}

export default ExperienceTimeline
