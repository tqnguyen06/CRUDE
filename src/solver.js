import Anthropic from "@anthropic-ai/sdk";
import config from "./config.js";

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const SYSTEM_PROMPT = `You are solving a CRUDE Driller mining challenge. You will receive a prose document and a set of constraints that your answer must satisfy.

RULES:
- Your response must be EXACTLY one line — the artifact string and nothing else.
- Do NOT output explanations, preamble, thinking, or anything other than the artifact.
- The artifact must satisfy ALL constraints listed.
- Read the prose carefully — answers require multi-hop reasoning across the document.
- Be precise and literal in your answer.`;

export async function solveChallenge(challenge) {
  const doc = challenge.doc || challenge.document;
  const questions = challenge.questions || challenge.question;
  const constraints = challenge.constraints;

  let userPrompt = "";
  if (doc) {
    userPrompt += `DOCUMENT:\n${doc}\n\n`;
  }
  if (questions) {
    const q = Array.isArray(questions) ? questions.join("\n") : questions;
    userPrompt += `QUESTION:\n${q}\n\n`;
  }
  if (constraints && constraints.length > 0) {
    userPrompt += `CONSTRAINTS:\n${constraints.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\n`;
  }
  userPrompt += "Respond with ONLY the artifact string on a single line.";

  console.log("[Solver] Sending challenge to Claude...");

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const artifact = response.content[0].text.trim();
  console.log(`[Solver] Artifact: ${artifact.substring(0, 80)}${artifact.length > 80 ? "..." : ""}`);
  return artifact;
}
