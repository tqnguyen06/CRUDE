import Anthropic from "@anthropic-ai/sdk";
import config from "./config.js";

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const SYSTEM_PROMPT = `You are solving a CRUDE Driller mining challenge. You will receive a prose document and a set of constraints that your answer must satisfy.

RULES:
- Your response must be EXACTLY one line — the artifact string and nothing else.
- Do NOT output explanations, preamble, thinking, reasoning steps, or anything other than the artifact.
- Do NOT say "Wait", "Let me", "I need to", or any other filler. Just the answer.
- The artifact is typically company names separated by " | " (pipe with spaces).
- The artifact must satisfy ALL constraints listed.
- Read the prose carefully — answers require multi-hop reasoning across the document.
- Be precise and literal in your answer.
- Use exact company names as they appear in the document.`;

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
    userPrompt += `VALID COMPANY NAMES (use these exact names):\n${companies.join(", ")}\n\n`;
  }
  if (questions) {
    const q = Array.isArray(questions) ? questions.join("\n") : questions;
    userPrompt += `QUESTION:\n${q}\n\n`;
  }
  if (constraints && constraints.length > 0) {
    userPrompt += `CONSTRAINTS (ALL must be satisfied):\n${constraints.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\n`;
  }
  userPrompt += "Think step by step about each constraint, then respond with ONLY the artifact string on a single line. Use EXACT company names from the VALID COMPANY NAMES list.";

  console.log("[Solver] Sending challenge to Claude...");

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  let artifact = response.content[0].text.trim();

  // If Claude leaked reasoning, extract just the pipe-delimited answer line
  if (artifact.includes("\n")) {
    const lines = artifact.split("\n").map((l) => l.trim()).filter(Boolean);
    // Find the line that looks like a pipe-delimited answer (Company | Company)
    const answerLine = lines.find((l) => l.includes("|")) || lines[0];
    artifact = answerLine;
  }

  // Strip any leading/trailing quotes or markdown
  artifact = artifact.replace(/^["'`]+|["'`]+$/g, "");

  console.log(`[Solver] Artifact: ${artifact.substring(0, 80)}${artifact.length > 80 ? "..." : ""}`);
  return artifact;
}
