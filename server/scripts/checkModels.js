/**
 * Probes which Groq models this key can reach and whether each one honours
 * `response_format: json_object`, so the default in .env is one that has
 * actually been verified rather than assumed.
 */
import "dotenv/config";

import Groq from "groq-sdk";

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

const CANDIDATES = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3.8-27b",
  "allam-2-7b",
];

const PROMPT = 'Reply with ONLY this JSON object, no prose: {"ok":true,"n":3}';

for (const model of CANDIDATES) {
  try {
    const completion = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: PROMPT }],
      temperature: 0.2,
      max_completion_tokens: 512,
      response_format: { type: "json_object" },
    });

    const content = completion.choices?.[0]?.message?.content ?? "";
    let parsed = null;

    try {
      parsed = JSON.parse(content);
    } catch {
      /* reported below */
    }

    console.log(
      `  ok   ${model.padEnd(24)} json=${parsed ? "yes" : "NO"} raw=${JSON.stringify(content).slice(0, 90)}`,
    );
  } catch (error) {
    console.log(`  FAIL ${model.padEnd(24)} ${error.status ?? ""} ${error.message?.slice(0, 110)}`);
  }
}
