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
    userPrompt += `VALID COMPANY NAMES (use these exact names only):\n${companies.join(", ")}\n\n`;
  }
  if (questions) {
    const q = Array.isArray(questions) ? questions.join("\n") : questions;
    userPrompt += `QUESTION:\n${q}\n\n`;
  }
  if (constraints && constraints.length > 0) {
    userPrompt += `CONSTRAINTS (ALL must be satisfied):\n${constraints.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\n`;
  }
  userPrompt +=
    "Respond with ONLY the artifact string. Company names separated by ' | '. Use EXACT names from the VALID COMPANY NAMES list. Nothing else.";

  console.log("[Solver] Sending challenge to Claude...");

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 16000,
    thinking: {
      type: "enabled",
      budget_tokens: 10000,
    },
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
