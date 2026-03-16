import Anthropic from "@anthropic-ai/sdk";
import config from "./config.js";

const client = new Anthropic({ apiKey: config.anthropicApiKey });

export async function solveChallenge(challenge) {
  const doc = challenge.doc || challenge.document;
  const questions = challenge.questions || challenge.question;
  const constraints = challenge.constraints;
  const companies = challenge.companies;

  let userPrompt = "";
  if (doc) {
    userPrompt += `DOCUMENT:\n${doc}\n\n`;
  }
  if (companies && companies.length > 0) {
    userPrompt += `VALID COMPANY NAMES (you MUST use these exact strings):\n${companies.map((c, i) => `  ${i + 1}. "${c}"`).join("\n")}\n\n`;
  }
  if (questions) {
    const q = Array.isArray(questions) ? questions.join("\n") : questions;
    userPrompt += `QUESTIONS:\n${q}\n\n`;
  }
  if (constraints && constraints.length > 0) {
    userPrompt += `CONSTRAINTS (every single one MUST be satisfied — deterministic verification):\n${constraints.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\n`;
  }
  userPrompt += `CRITICAL INSTRUCTIONS:
- Companies may be referenced by ALIASES or alternate names throughout the document. Always map back to the exact name from VALID COMPANY NAMES.
- IGNORE all hypothetical, speculative, projected, or conditional statements (e.g. "could potentially", "is expected to", "if they were to"). Only use confirmed/factual data.
- For multi-hop questions (e.g. "which company had the highest X"), carefully extract ALL relevant data points, compare them, then select the answer.
- Your answer must satisfy ALL constraints simultaneously. Double-check each constraint against your answer before responding.
- Output ONLY the single-line artifact. Company names separated by ' | ' if multiple answers.
- Do NOT output any reasoning, labels like "Q1:", "Answer:", or preamble. Just the answer string.`;

  console.log("[Solver] Sending challenge to Claude...");

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 16000,
    thinking: {
      type: "enabled",
      budget_tokens: 12000,
    },
    system: "You are a precise analytical engine. You read documents, answer questions about them, and output ONLY the final answer as a single-line string. Never explain your reasoning in the output. Never prefix with labels. Company names must match the provided list exactly — character for character.",
    messages: [{ role: "user", content: userPrompt }],
  });

  // With extended thinking, find the text block (not the thinking block)
  let artifact = "";
  for (const block of response.content) {
    if (block.type === "text") {
      artifact = block.text.trim();
      break;
    }
  }

  // If somehow multiline, extract the pipe-delimited answer
  if (artifact.includes("\n")) {
    const lines = artifact
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const answerLine = lines.find((l) => l.includes("|")) || lines[0];
    artifact = answerLine;
  }

  // Strip quotes/markdown
  artifact = artifact.replace(/^["'`]+|["'`]+$/g, "");

  console.log(
    `[Solver] Artifact: ${artifact.substring(0, 80)}${artifact.length > 80 ? "..." : ""}`
  );
  return artifact;
}
