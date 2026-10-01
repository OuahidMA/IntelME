/**
 * Dumps the model's raw JSON using the exact production contract, so the
 * normalisers can be compared against what the model really returns.
 */
import "dotenv/config";

import Groq from "groq-sdk";

import { PROMPT_RESUME_ANALYSIS, RESUME_JSON_CONTRACT } from "../services/aiService.js";

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

const CV = `John Doe
john@example.com | +212 600 123 456 | Casablanca, Morocco

PROFESSIONAL SUMMARY
Frontend developer with 3 years of experience building React and TypeScript applications.

SKILLS
React, TypeScript, JavaScript, REST APIs, Git, Tailwind CSS, Node.js, MongoDB

WORK EXPERIENCE
Senior Frontend Developer, Cartograph, 2023-04 - Present
Led the design system team and cut bundle size by 34 percent.

EDUCATION
Master in Computer Science, University of Casablanca, 2019 - 2021

CERTIFICATIONS
AWS Certified Developer, Amazon, 2023

PROJECTS
Intelme - CV analysis platform. React, Node.js, MongoDB.`;

const prompt = PROMPT_RESUME_ANALYSIS.replace("{{RESUME_TEXT}}", CV);

const completion = await client.chat.completions.create({
  model: process.env.GROQ_MODEL,
  messages: [{ role: "user", content: `${prompt}\n${RESUME_JSON_CONTRACT}` }],
  temperature: 0.2,
  max_completion_tokens: 4096,
  response_format: { type: "json_object" },
});

const raw = completion.choices[0].message.content;
const parsed = JSON.parse(raw);

console.log("skills[0..2] :", JSON.stringify((parsed.skills ?? []).slice(0, 3)));
console.log("keywords     :", JSON.stringify(parsed.keywords));
console.log("finish_reason:", completion.choices[0].finish_reason);
console.log("raw length   :", raw.length);
console.log("top-level keys:", Object.keys(parsed).join(", "));
