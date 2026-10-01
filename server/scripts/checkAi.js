/**
 * End-to-end check of the two canonical prompts against the live Groq API.
 * Prints the structured JSON the model returns plus the deterministic score the
 * server then assigns, so the prompt and the scoring can be inspected together.
 */
import "dotenv/config";

import { analyseResume, improveCv, matchJobToDescription, toMatchProfile } from "../services/aiService.js";
import { scoreResume } from "../services/scoringService.js";
import { matchVerdict, scoreJobMatch } from "../services/matchingService.js";

const CV = `John Doe
john@example.com | +212 600 123 456 | Casablanca, Morocco
github.com/johndoe

PROFESSIONAL SUMMARY
Frontend developer with 3 years of experience building React and TypeScript applications. Shipped 8 projects and improved load time by 40 percent.

SKILLS
React, TypeScript, JavaScript, REST APIs, Git, Tailwind CSS, Node.js, MongoDB

WORK EXPERIENCE
Senior Frontend Developer, Cartograph, 2023-04 - Present
Led the design system team and cut bundle size by 34 percent across 3 products.
Frontend Engineer, Meridian, 2021-01 - 2023-03
Shipped the checkout revamp serving 12000 users and owned the analytics pipeline.

EDUCATION
Master in Computer Science, University of Casablanca, 2019 - 2021

CERTIFICATIONS
AWS Certified Developer, Amazon, 2023

PROJECTS
Intelme - CV analysis platform. React, Node.js, MongoDB.
Design System - component library. Storybook, React.`;

const JOB = `Frontend Developer
We are looking for a React developer with experience in:
React, TypeScript, JavaScript, REST APIs, Git, Tailwind CSS
2+ years of professional experience required.`;

console.log("=== Resume analysis (PROMPT_RESUME_ANALYSIS) ===\n");

const structured = await analyseResume(CV);

console.log("profile :", JSON.stringify(structured.profile));
console.log("skills  :", structured.skills.map((s) => `${s.name} [${s.category}/${s.level}]`).join(", "));
console.log("exp     :", structured.experience.map((e) => `${e.title} @ ${e.company} (${e.startDate}->${e.endDate})`).join(" | "));
console.log("edu     :", structured.education.map((e) => `${e.degree} ${e.field} @ ${e.institution}`).join(" | "));
console.log("certs   :", structured.certifications.map((c) => `${c.name} (${c.issuer})`).join(" | "));
console.log("projects:", structured.projects.map((p) => p.name).join(" | "));
console.log("langs   :", structured.languages.map((l) => `${l.name}/${l.proficiency}`).join(" | "));
console.log("keywords:", structured.keywords.join(", "));

const scored = scoreResume({ analysis: structured, rawText: CV });
console.log(`\nscore   : ${scored.score}/100`);
for (const row of scored.breakdown) {
  console.log(`  ${row.label.padEnd(24)} ${String(row.score).padStart(3)}/100 x${row.weight}% = ${row.earned}`);
}

console.log("\n=== Job match (PROMPT_JOB_MATCH) ===\n");

const aiMatch = await matchJobToDescription({ profile: toMatchProfile(structured), jobDescription: JOB });

console.log("model overallScore :", aiMatch.overallScore);
console.log("jobTitle / company :", aiMatch.jobTitle, "/", aiMatch.company);
console.log("verdict            :", aiMatch.verdict);
console.log("summary            :", aiMatch.summary);
console.log("matchingSkills     :", aiMatch.matchingSkills.map((s) => s.name).join(", "));
console.log("missingSkills      :", aiMatch.missingSkills.map((s) => `${s.name} (${s.importance})`).join(", "));
console.log("matchingExperience :", JSON.stringify(aiMatch.matchingExperience));
console.log("matchingEducation  :", JSON.stringify(aiMatch.matchingEducation));
console.log("recommendations    :", aiMatch.recommendations.join(" | "));

const analysisDoc = { ...structured, score: scored.score };
const match = scoreJobMatch({ result: aiMatch, analysis: analysisDoc });

console.log(`\nserver score  : ${match.score}/100 (${matchVerdict(match.score)})`);
for (const row of match.breakdown) {
  console.log(`  ${row.label.padEnd(16)} ${String(row.score).padStart(3)}/100 x${row.weight}% = ${row.earned}`);
}
console.log("\nmatching skills :", match.matchingSkills.map((s) => s.name).join(", ") || "(none)");
console.log("missing skills  :", match.missingSkills.map((s) => s.name).join(", ") || "(none)");
console.log("strengths       :\n  + " + match.explain.strengths.join("\n  + "));
console.log("gaps            :\n  - " + match.explain.gaps.join("\n  - "));
console.log("recommendations :\n  - " + match.explain.recommendations.join("\n  - "));

console.log("\n=== Improve my CV (PROMPT_IMPROVE_CV) ===\n");

const improved = await improveCv({
  profile: structured.profile,
  weaknesses: structured.weaknesses,
  recommendations: structured.recommendations,
});

console.log("summary    :", improved.improvedSummary);
console.log("suggestions:");
for (const s of improved.suggestions) console.log("  -", s);
console.log("disclaimer :", improved.disclaimer);
