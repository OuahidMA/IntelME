import { Check, HelpCircle, Minus } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const tones = {
  matched: {
    label: "Matched",
    icon: Check,
    className: "bg-secondary text-secondary-foreground",
  },
  missing: {
    label: "Missing",
    icon: Minus,
    className: "border border-dashed border-border bg-transparent text-muted-foreground",
  },
  optional: {
    label: "Nice to have",
    icon: HelpCircle,
    className: "border border-border bg-transparent text-muted-foreground",
  },
}

export function SkillBadge({ skill, tone = "matched", evidence }) {
  const config = tones[tone] ?? tones.matched
  const Icon = config.icon
  const description =
    evidence ?? (tone === "matched" ? "Found on your resume." : "Not mentioned anywhere on your resume.")

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            variant="outline"
            className={cn("h-6 gap-1.5 rounded-full px-2.5 font-normal", config.className)}
          />
        }
      >
        <Icon className="size-3" />
        {skill}
        <span className="sr-only">{config.label}</span>
      </TooltipTrigger>
      <TooltipContent>{description}</TooltipContent>
    </Tooltip>
  )
}

export function SkillLegend({ className }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-4 text-xs text-muted-foreground", className)}>
      {Object.entries(tones).map(([key, config]) => (
        <span key={key} className="flex items-center gap-1.5">
          <config.icon className="size-3" />
          {config.label}
        </span>
      ))}
    </div>
  )
}

export default SkillBadge
