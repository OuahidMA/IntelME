import { Link, useSearchParams } from "react-router-dom"
import { GraduationCap, Radar, Sparkles, UploadCloud } from "lucide-react"

import { ExperienceTimeline } from "@/components/ExperienceTimeline"
import { FindingList, ScoreBreakdown } from "@/components/ScoreBreakdown"
import { ImprovePanel } from "@/components/ImprovePanel"
import { ScoreCard } from "@/components/ScoreCard"
import { SkillBadge } from "@/components/SkillBadge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useResume } from "@/context/ResumeContext"

const TABS = ["score", "skills", "sections", "timeline"]

function EmptyState() {
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-6">
      <div className="grid gap-1">
        <h2 className="text-2xl font-semibold tracking-[-0.9px]">Nothing to analyse yet</h2>
        <p className="text-muted-foreground">
          Upload a resume on the dashboard and the full read shows up here.
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
                PDF or DOCX, up to 5 MB. Scanned PDFs are read with OCR. The file is
                parsed on the server, then deleted — only the text and the score stay,
                in this browser.
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

/** The extracted profile, so a candidate can see what the parser understood. */
function ProfileCard({ profile }) {
  const rows = [
    ["Name", profile.fullName],
    ["Email", profile.email],
    ["Phone", profile.phone],
    ["Location", profile.location],
  ].filter(([, value]) => value)

  if (!rows.length) return null

  return (
    <Card className="gap-6">
      <CardHeader>
        <CardTitle>Contact details found</CardTitle>
        <CardDescription>
          What the parser read out of the file. A missing row is points lost on the
          contact category.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-2">
        <dl className="grid gap-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex gap-3 text-sm">
              <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-words">{value}</dd>
            </div>
          ))}
        </dl>

        {profile.summary && (
          <div className="mt-2 grid gap-2 border-t border-border pt-4">
            <h4 className="text-sm font-medium">Summary</h4>
            <p className="text-sm leading-relaxed text-muted-foreground">{profile.summary}</p>
          </div>
        )}

        {profile.links?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {profile.links.map((link) => (
              <Badge key={link} variant="outline" className="font-normal">
                {link}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** Education, projects and certifications as read from the document. */
function SectionsCard({ education = [], projects = [], certifications = [], languages = [] }) {
  const empty = !education.length && !projects.length && !certifications.length && !languages.length
  if (empty) return null

  return (
    <div className="grid gap-6">
      {education.length > 0 && (
        <Card className="gap-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <GraduationCap className="size-4" />
              Education
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-3">
              {education.map((entry, index) => (
                <li key={`${entry.degree}-${index}`} className="text-sm">
                  <p className="font-medium">
                    {[entry.degree, entry.field].filter(Boolean).join(" — ") || "Degree not named"}
                  </p>
                  <p className="text-muted-foreground">
                    {[entry.institution, [entry.startDate, entry.endDate].filter(Boolean).join(" – ")]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {entry.grade && <p className="text-xs text-muted-foreground">{entry.grade}</p>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {projects.length > 0 && (
        <Card className="gap-4">
          <CardHeader>
            <CardTitle className="text-base">Projects</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-3">
              {projects.map((project, index) => (
                <li key={`${project.name}-${index}`} className="grid gap-1 text-sm">
                  <p className="font-medium">{project.name || "Untitled project"}</p>
                  {project.description && (
                    <p className="text-muted-foreground">{project.description}</p>
                  )}
                  {project.technologies?.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {project.technologies.map((tech) => (
                        <Badge key={tech} variant="outline" className="font-normal">
                          {tech}
                        </Badge>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {(certifications.length > 0 || languages.length > 0) && (
        <Card className="gap-4">
          <CardHeader>
            <CardTitle className="text-base">Certifications & languages</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 text-sm">
              {certifications.map((cert, index) => (
                <li key={`${cert.name}-${index}`}>
                  <span className="font-medium">{cert.name || "Certification not named"}</span>
                  {cert.issuer && <span className="text-muted-foreground"> · {cert.issuer}</span>}
                  {cert.date && <span className="text-muted-foreground"> · {cert.date}</span>}
                </li>
              ))}
              {languages.map((language, index) => (
                <li key={`${language.name}-${index}`} className="text-muted-foreground">
                  {[language.name, language.proficiency].filter(Boolean).join(" · ")}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export default function Analysis() {
  const { analysis, improve, isImproving, improveError, reanalyse, isAnalysing } = useResume()
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get("tab")
  const tab = TABS.includes(requested) ? requested : "score"

  if (!analysis) return <EmptyState />

  const matched = analysis.skills.matched
  // Grouped by the category the model assigned, which is more useful than one
  // long alphabetical run.
  const byCategory = matched.reduce((groups, skill) => {
    const key = skill.category || "Other"
    groups[key] = groups[key] ?? []
    groups[key].push(skill)
    return groups
  }, {})

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6">
      <div className="grid gap-1">
        <h2 className="text-2xl font-semibold tracking-[-0.9px]">{analysis.fileName}</h2>
        <p className="text-sm text-muted-foreground">
          {[analysis.label, analysis.profile?.fullName, analysis.role && `latest role: ${analysis.role}`]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => setSearchParams({ tab: value })}
        className="gap-6"
      >
        <TabsList>
          <TabsTrigger value="score">Score</TabsTrigger>
          <TabsTrigger value="skills">Skills</TabsTrigger>
          <TabsTrigger value="sections">Sections</TabsTrigger>
          <TabsTrigger value="timeline">Experience</TabsTrigger>
        </TabsList>

        <TabsContent value="score">
          <div className="grid gap-6">
            <ScoreCard
              score={analysis.atsScore}
              checks={analysis.checks}
              suggestions={analysis.suggestions}
            />

            <ScoreBreakdown rows={analysis.scoreBreakdown} />

            <ImprovePanel
              improvements={analysis.improvements}
              onRun={improve}
              isImproving={isImproving}
              error={improveError}
            />

            <div className="grid gap-6 lg:grid-cols-2">
              <FindingList
                title="Strengths"
                items={analysis.strengths}
                tone="positive"
                empty="No strengths were called out on this run."
              />
              <FindingList
                title="Weaknesses"
                items={analysis.weaknesses}
                tone="negative"
                empty="No weaknesses were called out on this run."
              />
            </div>

            <FindingList
              title="How to improve"
              items={analysis.recommendations}
              tone="neutral"
              empty="Nothing to fix — every category scored at least 90%."
            />
          </div>
        </TabsContent>

        <TabsContent value="skills">
          <Card className="gap-6">
            <CardHeader>
              <CardTitle>Skills found</CardTitle>
              <CardDescription>
                {matched.length} {matched.length === 1 ? "skill" : "skills"} extracted,
                grouped by the area each one belongs to.
              </CardDescription>
            </CardHeader>

            <CardContent className="grid gap-6">
              {matched.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No skills were found in this document. That is usually a sign of a
                  scanned or image-based PDF.
                </p>
              ) : (
                Object.entries(byCategory).map(([category, skills]) => (
                  <div key={category} className="grid content-start gap-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-medium">{category}</h4>
                      <Radar className="size-4 text-muted-foreground" />
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {skills.map((skill) => (
                        <SkillBadge
                          key={skill.label}
                          skill={skill.label}
                          tone="matched"
                          evidence={`${skill.level} · read from your resume with ${skill.confidence}% confidence.`}
                        />
                      ))}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sections">
          <div className="grid gap-6">
            <ProfileCard profile={analysis.profile ?? {}} />
            <SectionsCard
              education={analysis.education}
              projects={analysis.projects}
              certifications={analysis.certifications}
              languages={analysis.languages}
            />
          </div>
        </TabsContent>

        <TabsContent value="timeline">
          <ExperienceTimeline roles={analysis.experience} />
        </TabsContent>
      </Tabs>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-6">
        <p className="text-sm text-muted-foreground">
          Happy with the read? Score it against a real posting.
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={reanalyse}
          disabled={isAnalysing}
          className="text-muted-foreground"
        >
          <Sparkles data-icon="inline-start" />
          {isAnalysing ? "Re-running…" : "Re-run analysis"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          render={<Link to="/job-match" />}
          className="ml-auto"
        >
          Go to job match
        </Button>
      </div>
    </div>
  )
}
