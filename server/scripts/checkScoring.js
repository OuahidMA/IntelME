/**
 * Exercises the pure scoring maths and the validators without a database or a
 * network call. These are the two places where a silent mistake would produce a
 * plausible-looking but wrong number, so they are asserted directly.
 */
import "dotenv/config";

import { matchVerdict, normaliseSkill, scoreJobMatch } from "../services/matchingService.js";
import { CV_WEIGHTS, scoreResume } from "../services/scoringService.js";
import { totalExperienceYears, parseResumeDate } from "../utils/dates.js";

let failures = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : ` -> got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`);
}

/* ---------------- weights ---------------- */

const cvTotal = Object.values(CV_WEIGHTS).reduce((sum, w) => sum + w.weight, 0);
check("CV weights sum to 100", cvTotal, 100);
check("CV weight order", Object.values(CV_WEIGHTS).map((w) => [w.label, w.weight]), [
  ["Contact Information", 10],
  ["Professional Summary", 10],
  ["Skills", 20],
  ["Experience", 25],
  ["Education", 10],
  ["Projects", 10],
  ["Certifications", 5],
  ["CV Structure", 10],
]);

/* ---------------- date parsing ---------------- */

check("parse 'January 2021'", parseResumeDate("January 2021"), { year: 2021, month: 0 });
check("parse 'Mar 2022'", parseResumeDate("Mar 2022"), { year: 2022, month: 2 });
check("parse '2021-03'", parseResumeDate("2021-03"), { year: 2021, month: 2 });
check("parse '2019'", parseResumeDate("2019"), { year: 2019, month: 0 });
check("parse 'Present' is null", parseResumeDate("Present"), null);

// Overlapping roles must not be double counted.
check(
  "overlapping roles merged",
  totalExperienceYears([
    { startDate: "2020-01", endDate: "2022-01" },
    { startDate: "2021-01", endDate: "2023-01" },
  ]),
  3,
);
check(
  "sequential roles summed",
  totalExperienceYears([
    { startDate: "2018-01", endDate: "2020-01" },
    { startDate: "2020-01", endDate: "2022-01" },
  ]),
  4,
);

/* ---------------- skill normalisation ---------------- */

check("React.js == React", normaliseSkill("React.js"), normaliseSkill("React"));
check("Node.js == Node.js", normaliseSkill("Node.js"), "node");
check("REST APIs == REST API", normaliseSkill("REST APIs"), normaliseSkill("REST API"));
check("Tailwind CSS == tailwind", normaliseSkill("Tailwind CSS"), "tailwind");
check("noise prefix stripped", normaliseSkill("Strong JavaScript"), "javascript");
check("empty is empty", normaliseSkill(""), "");

/* ---------------- CV scoring ---------------- */

const RAW_TEXT = `
Jane Doe
jane.doe@example.com | +212 600 000 000 | Casablanca, Morocco
https://github.com/janedoe

PROFESSIONAL SUMMARY
Frontend developer with 4 years of experience building React applications.
Shipped 12 projects and improved load time by 40%.

SKILLS
React, TypeScript, JavaScript, Node.js, MongoDB, REST APIs, Git, Tailwind CSS

WORK EXPERIENCE
Senior Frontend Developer, Cartograph, 2023-04 - Present
Led the design system team and cut bundle size by 34%.
Frontend Engineer, Meridian, 2021-01 - 2023-03
Shipped the checkout revamp and owned the analytics pipeline.

EDUCATION
Master in Computer Science, University of Casablanca, 2019 - 2021

PROJECTS
Intelme - CV analysis platform. React, Node.js, MongoDB.
Design System - component library. Storybook, React.

CERTIFICATIONS
AWS Certified Developer, Amazon, 2023
`.trim();

const RICH_ANALYSIS = {
  profile: {
    fullName: "Jane Doe",
    email: "jane.doe@example.com",
    phone: "+212 600 000 000",
    location: "Casablanca, Morocco",
    summary:
      "Frontend developer with 4 years of experience building React applications. Shipped 12 projects and improved load time by 40% while working with React and TypeScript daily.",
    links: ["https://github.com/janedoe"],
  },
  skills: [
    { name: "React", category: "Frontend", level: "Advanced" },
    { name: "TypeScript", category: "Frontend", level: "Advanced" },
    { name: "JavaScript", category: "Frontend", level: "Advanced" },
    { name: "Node.js", category: "Backend", level: "Intermediate" },
    { name: "MongoDB", category: "Database", level: "Intermediate" },
    { name: "REST APIs", category: "Backend", level: "Advanced" },
    { name: "Git", category: "Tools", level: "Advanced" },
    { name: "Tailwind CSS", category: "Frontend", level: "Intermediate" },
    { name: "Storybook", category: "Tools", level: "Intermediate" },
    { name: "Jest", category: "Testing", level: "Intermediate" },
  ],
  experience: [
    {
      title: "Senior Frontend Developer",
      company: "Cartograph",
      startDate: "2023-04",
      endDate: "Present",
      current: true,
      description: "Led the design system team and cut bundle size by 34%.",
    },
    {
      title: "Frontend Engineer",
      company: "Meridian",
      startDate: "2021-01",
      endDate: "2023-03",
      description: "Shipped the checkout revamp and owned the analytics pipeline.",
    },
  ],
  education: [
    {
      degree: "Master",
      field: "Computer Science",
      institution: "University of Casablanca",
      startDate: "2019",
      endDate: "2021",
    },
  ],
  certifications: [{ name: "AWS Certified Developer", issuer: "Amazon", date: "2023" }],
  projects: [
    {
      name: "Intelme",
      description: "CV analysis platform with structured scoring.",
      technologies: ["React", "Node.js", "MongoDB"],
    },
    {
      name: "Design System",
      description: "Component library used across three products.",
      technologies: ["Storybook", "React"],
    },
  ],
};

const rich = scoreResume({ analysis: RICH_ANALYSIS, rawText: RAW_TEXT });
console.log(`\n  strong CV scores ${rich.score}/100`);
for (const row of rich.breakdown) {
  console.log(`    ${row.label.padEnd(24)} ${String(row.score).padStart(3)}/100  x${row.weight}%  = ${row.earned}`);
}
check("strong CV scores >= 80", rich.score >= 80, true);
check("breakdown has 8 rows", rich.breakdown.length, 8);
check(
  "earned values sum to the total",
  Math.round(rich.breakdown.reduce((s, r) => s + r.earned, 0)),
  rich.score,
);

const EMPTY_ANALYSIS = {
  profile: {},
  skills: [],
  experience: [],
  education: [],
  certifications: [],
  projects: [],
};
const empty = scoreResume({ analysis: EMPTY_ANALYSIS, rawText: "" });
check("empty CV scores 0", empty.score, 0);
check("all empty categories report 0", empty.breakdown.every((r) => r.score === 0), true);

const WEAK_ANALYSIS = {
  profile: { fullName: "Bob", summary: "Developer with experience in web development" },
  skills: [{ name: "HTML", category: "Frontend", level: "Beginner" }],
  experience: [{ title: "Dev", company: "X", description: "Worked on things" }],
  education: [],
  certifications: [],
  projects: [],
};
const weak = scoreResume({ analysis: WEAK_ANALYSIS, rawText: "Bob\nDeveloper with experience in web development" });
check("weak CV scores below 50", weak.score < 50, true);
check("weak CV has weaknesses", weak.weaknesses.length > 0, true);
console.log(`  weak CV scores ${weak.score}/100`);

/* ---------------- job match scoring ---------------- */

const AI_MATCH = {
  overallScore: 87, // deliberately ignored in favour of the weighted recompute
  matchingSkills: [
    { name: "React", evidence: "3 years of React at Cartograph" },
    { name: "JavaScript", evidence: "Core language across all roles" },
    { name: "REST APIs", evidence: "Built the Meridian checkout API" },
    { name: "Git", evidence: "Daily use at Meridian" },
    { name: "Tailwind CSS", evidence: "Migrated the Meridian dashboard" },
  ],
  missingSkills: [
    { name: "TypeScript", importance: "required", hint: "Add a TypeScript project" },
  ],
  matchingExperience: { requiredYears: 2, candidateYears: 4, status: "meets", note: "" },
  missingExperience: [],
  matchingEducation: { required: "Bachelor", candidate: "Master", status: "compatible", note: "Exceeds requirement" },
  matchingProjects: ["Intelme"],
  missingProjects: [],
  matchingKeywords: ["frontend", "react", "api"],
  missingKeywords: ["typescript"],
  matchingCertifications: [],
  missingCertifications: [],
  strengths: ["+ Strong React experience"],
  gaps: ["- TypeScript not clearly demonstrated"],
  recommendations: [],
};

// The sample CV above lists TypeScript, so for the "TypeScript is a real gap"
// case we score against a CV that genuinely does not have it.
const NO_TS_ANALYSIS = {
  ...RICH_ANALYSIS,
  skills: RICH_ANALYSIS.skills.filter((s) => s.name !== "TypeScript"),
};

const match = scoreJobMatch({ result: AI_MATCH, analysis: NO_TS_ANALYSIS });
console.log(`\n  job match scores ${match.score}/100 (model claimed ${AI_MATCH.overallScore})`);
for (const row of match.breakdown) {
  console.log(`    ${row.label.padEnd(16)} ${String(row.score).padStart(3)}/100  x${row.weight}%  = ${row.earned}`);
}

check("recomputed score is not the model's number", match.score !== AI_MATCH.overallScore, true);
check("match breakdown has 6 rows", match.breakdown.length, 6);
check("match weights sum to 100", match.breakdown.reduce((s, r) => s + r.weight, 0), 100);
check("earned values sum to the total", Math.round(match.breakdown.reduce((s, r) => s + r.earned, 0)), match.score);
check("strong match is >= 80", match.score >= 80, true);
check("skills dominates at 40%", match.breakdown[0].weight, 40);
check("TypeScript survives as a real gap", match.missingSkills.map((g) => g.name), ["TypeScript"]);
check("required importance is preserved", match.missingSkills[0].importance, "required");
check("gap hint is preserved", match.missingSkills[0].hint, "Add a TypeScript project");
check("matching skills preserved", match.matchingSkills.length, 5);
check("experience recomputed from the CV", match.matchingExperience.candidateYears >= 4, true);
check("verdict for 80+ is Strong fit", matchVerdict(match.score), "Strong fit");
check("verdict for 60 is Stretch role", matchVerdict(60), "Stretch role");
check("explain keeps the model strengths", match.explain.strengths, ["+ Strong React experience"]);
check("explain keeps the model gaps", match.explain.gaps, ["- TypeScript not clearly demonstrated"]);

// TypeScript IS on this CV, so the model's claim that it is missing is wrong and
// must not be charged against the candidate.
const TS_ON_CV = scoreJobMatch({ result: AI_MATCH, analysis: RICH_ANALYSIS });
check("gap on a skill the CV has is dropped", TS_ON_CV.missingSkills.length, 0);
check("dropping the false gap raises the score", TS_ON_CV.score > match.score, true);
console.log(`  same match with TypeScript on the CV rescored to ${TS_ON_CV.score}/100`);

// Every reported gap being false must not resurrect the claims in the table.
const FALSE_GAP = {
  ...AI_MATCH,
  overallScore: 40,
  matchingSkills: [],
  missingSkills: [{ name: "React", importance: "required", hint: "" }],
};
const corrected = scoreJobMatch({ result: FALSE_GAP, analysis: RICH_ANALYSIS });
check("false gap on React is not penalised", corrected.missingSkills.length, 0);
check("false-gap run scores above the raw model claim", corrected.score > FALSE_GAP.overallScore, true);
console.log(`  false-gap run rescored to ${corrected.score}/100 (model claimed ${FALSE_GAP.overallScore})`);

console.log(failures === 0 ? "\nAll scoring checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
