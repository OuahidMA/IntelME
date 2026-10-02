import { useEffect } from "react"
import { Link, useLocation } from "react-router-dom"
import {
  ArrowRight,
  FileSearch,
  ListChecks,
  Radar,
  ScanText,
  ShieldCheck,
  Timer,
  WandSparkles,
} from "lucide-react"

import { Navbar } from "@/components/Navbar"
import { Footer } from "@/components/Footer"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { ScrollProgress } from "@/components/ui/scroll-progress"
import { cn } from "@/lib/utils"
import { scrollToSection } from "@/lib/sectionScroll"

const features = [
  {
    icon: ScanText,
    title: "ATS compatibility score",
    description:
      "We run your file through the same parsing rules a real applicant tracking system uses, then tell you which sections it dropped, merged or misread on the way in.",
    points: ["Column and table detection", "Contact block integrity", "File-structure warnings"],
  },
  {
    icon: ListChecks,
    title: "Job description matching",
    description:
      "Paste a posting and get a ranked list of what you already prove, what the role asks for and what you never mention anywhere on the page.",
    points: ["Keyword gap report", "Weighted requirement tiers", "Per-posting match score"],
  },
  {
    icon: Radar,
    title: "Skills coverage radar",
    description:
      "Your skills get extracted, grouped by category and plotted against the role's requirements so gaps are obvious at a glance instead of buried in a wall of text.",
    points: ["Matched versus missing", "Evidence per skill", "Category-level rollups"],
  },
  {
    icon: FileSearch,
    title: "Experience timeline",
    description:
      "Roles, dates and employers are pulled out of your history and laid on a single spine, with overlaps and unexplained gaps surfaced before a recruiter asks.",
    points: ["Chronology sanity checks", "Overlapping roles flagged", "Tenure summaries"],
  },
  {
    icon: WandSparkles,
    title: "Bullet rewrites",
    description:
      "Responsibility statements get rewritten around outcomes instead of duties, with the numbers you already buried somewhere in the document pulled forward.",
    points: ["Action-verb suggestions", "Quantified impact prompts", "Side-by-side diffs"],
  },
  {
    icon: ShieldCheck,
    title: "Nothing gets stored",
    description:
      "Your resume is parsed in the browser and discarded when you close the tab. No vault, no training corpus, no surprise copy showing up in an inbox later.",
    points: ["Client-side parsing", "Automatic session purge", "No resume retention"],
  },
]

const steps = [
  {
    icon: Timer,
    title: "Upload the file you actually send",
    description:
      "Drop in the PDF or DOCX you are about to email. The same file, not a tidy retyped version — that is the whole point.",
  },
  {
    icon: ScanText,
    title: "Let intelme read it like a machine",
    description:
      "Sections, dates, employers and skills get extracted, then scored against parsing rules and the posting you are targeting.",
  },
  {
    icon: WandSparkles,
    title: "Fix the gaps, send with confidence",
    description:
      "You get a prioritised list of edits worth making, ordered by how much they move your score.",
  },
]

const atsRows = [
  { label: "Contact details parsed", ok: true },
  { label: "Section order preserved", ok: true },
  { label: "Tables detected as text", ok: false },
  { label: "Date format unambiguous", ok: true },
]

const previewSkills = [
  { label: "React", matched: true },
  { label: "TypeScript", matched: true },
  { label: "GraphQL", matched: false },
  { label: "Vite", matched: true },
  { label: "Playwright", matched: false },
  { label: "Node.js", matched: true },
]

function ScoreRing({ value, label }) {
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - value / 100)

  return (
    <div className="relative size-36 shrink-0">
      <svg viewBox="0 0 128 128" className="size-full -rotate-90">
        <circle
          cx="64"
          cy="64"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="10"
          className="text-secondary"
        />
        <circle
          cx="64"
          cy="64"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="text-primary transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center">
        <span className="text-4xl font-semibold tracking-[-1.2px]">{value}</span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
    </div>
  )
}

function HeroPreview() {
  return (
    <Card className="mx-auto w-full max-w-4xl gap-0 py-0">
      <div className="grid gap-0 md:grid-cols-[auto_1fr]">
        <div className="grid place-content-center gap-3 border-b border-border bg-secondary/50 p-6 md:border-r md:border-b-0">
          <ScoreRing value={84} label="ATS score" />
          <p className="max-w-36 text-center text-xs text-muted-foreground">
            Clear sections and scannable layout. Close two keyword gaps to reach the 90s.
          </p>
        </div>

        <div className="grid gap-6 p-6 sm:grid-cols-2">
          <div className="grid content-start gap-3">
            <p className="text-sm font-medium">Parser checks</p>
            <ul className="grid gap-2">
              {atsRows.map((row) => (
                <li key={row.label} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      row.ok ? "bg-chart-5" : "bg-destructive",
                    )}
                  />
                  <span className={cn(!row.ok && "text-foreground")}>{row.label}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid content-start gap-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">Keyword coverage</p>
              <span className="text-sm tabular-nums text-muted-foreground">6 / 9</span>
            </div>
            <Progress value={66} />
            <div className="flex flex-wrap gap-1.5">
              {previewSkills.map((skill) => (
                <Badge
                  key={skill.label}
                  variant={skill.matched ? "secondary" : "outline"}
                  className={cn("font-normal", !skill.matched && "border-dashed text-muted-foreground")}
                >
                  {skill.label}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Card>
  )
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="hero-wash pointer-events-none absolute inset-x-0 top-0 h-[36rem]" aria-hidden="true" />
      <div className="container-page relative grid justify-items-center gap-8 py-24 text-center sm:py-32">
        <h1 className="max-w-4xl text-4xl leading-[1.08] font-semibold tracking-[-0.9px] sm:text-5xl sm:tracking-[-1.2px] lg:text-[3.75rem] lg:leading-[1.1] lg:tracking-[-1.5px]">
          Resume optimisation tool
        </h1>

        <p className="max-w-2xl text-lg leading-[1.38] text-muted-foreground">
          Run a full analysis on your resume and see how it matches to any job descrption as well as any gaps before you hit send.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button size="lg" render={<Link to="/dashboard" />} className="inset-button h-10 px-4">
            Analyse my resume
            <ArrowRight data-icon="inline-end" />
          </Button>
          <Button
            size="lg"
            variant="outline"
            render={<a href="#features" />}
            className="h-10 px-4"
          >
            See what it checks
          </Button>
        </div>

        <div className="mt-8 w-full">
          <HeroPreview />
        </div>
      </div>
    </section>
  )
}

function FeatureCards() {
  return (
    <section id="features" className="scroll-mt-24 border-t border-border">
      <div className="container-page grid gap-12 py-24 sm:py-32">
        <div className="grid max-w-2xl gap-4">
          <p className="text-sm text-muted-foreground">What intelme does</p>
          <h2 className="text-3xl leading-tight font-semibold tracking-[-0.9px] sm:text-4xl sm:tracking-[-1.2px]">
            Six checks between you and the interview
          </h2>
          <p className="text-lg leading-[1.38] text-muted-foreground">
            Most resume advice is generic. These are the specific, mechanical things
            that decide whether a human ever sees your application.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <Card
              key={feature.title}
              className="gap-4 transition-colors hover:ring-foreground/20"
            >
              <CardHeader>
                <span className="mb-1 flex size-9 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                  <feature.icon className="size-4.5" />
                </span>
                <CardTitle className="text-xl leading-[1.25] font-normal">
                  {feature.title}
                </CardTitle>
                <CardDescription className="text-[15px] leading-[1.5] text-muted-foreground">
                  {feature.description}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="grid gap-2 border-t border-border pt-4">
                  {feature.points.map((point) => (
                    <li key={point} className="text-sm text-muted-foreground">
                      {point}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}

function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-24 border-t border-border bg-secondary/40">
      <div className="container-page grid gap-12 py-24 sm:py-32">
        <div className="grid max-w-2xl gap-4">
          <p className="text-sm text-muted-foreground">How it works</p>
          <h2 className="text-3xl leading-tight font-semibold tracking-[-0.9px] sm:text-4xl sm:tracking-[-1.2px]">
            In three steps
          </h2>
        </div>

        <ol className="grid gap-4 md:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.title} className="grid gap-3 border-t border-border pt-6">
              <div className="flex items-center gap-3">
                <span className="text-sm tabular-nums text-muted-foreground">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <step.icon className="size-4.5 text-muted-foreground" />
              </div>
              <h3 className="text-xl leading-[1.25] font-normal">{step.title}</h3>
              <p className="text-[15px] leading-[1.5] text-muted-foreground">
                {step.description}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

function CallToAction() {
  return (
    <section className="border-t border-border">
      <div className="container-page py-24 sm:py-32">
        <div className="inset-button grid justify-items-center gap-6 rounded-2xl bg-primary px-8 py-20 text-center text-primary-foreground">
          <h2 className="max-w-2xl text-3xl leading-tight font-semibold tracking-[-0.9px] text-balance sm:text-4xl sm:tracking-[-1.2px]">
            Find out what the parser never saw.
          </h2>
          <p className="max-w-xl text-lg leading-[1.38] text-primary-foreground/70">
            Create an account, upload one file, get the full read. No card, no
            follow-up email from a recruiter bot.
          </p>
          <Button
            size="lg"
            variant="secondary"
            render={<Link to="/dashboard" />}
            className="h-10 px-4"
          >
            Analyse my resume
            <ArrowRight data-icon="inline-end" />
          </Button>
        </div>
      </div>
    </section>
  )
}

export default function Home() {
  const { hash } = useLocation()

  // Catches arrivals from another route that carry a section hash.
  useEffect(() => {
    if (!hash) return
    scrollToSection(hash.slice(1))
  }, [hash])

  return (
    <div className="flex min-h-svh flex-col">
      <Navbar />
      <ScrollProgress className="top-18" />
      <main className="flex-1">
        <Hero />
        <FeatureCards />
        <HowItWorks />
        <CallToAction />
      </main>
      <Footer />
    </div>
  )
}
