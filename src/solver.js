import Anthropic from "@anthropic-ai/sdk";
import config from "./config.js";

const client = new Anthropic({ apiKey: config.anthropicApiKey });

export async function solveChallenge(challenge) {
  const doc = challenge.doc || challenge.document;
  const questions = challenge.questions || challenge.question;
  const constraints = challenge.constraints;
  const companies = challenge.companies;

  // Count number of questions to help calibrate expected answer count
  const questionList = Array.isArray(questions) ? questions : (questions ? [questions] : []);
  const numQuestions = questionList.length;

  let userPrompt = "";
  if (doc) {
    userPrompt += `DOCUMENT:\n${doc}\n\n`;
  }
  if (companies && companies.length > 0) {
    userPrompt += `VALID COMPANY NAMES (you MUST use these exact strings):\n${companies.map((c, i) => `  ${i + 1}. "${c}"`).join("\n")}\n\n`;
  }
  if (questionList.length > 0) {
    userPrompt += `QUESTIONS (${numQuestions} total — provide exactly ${numQuestions} answer${numQuestions > 1 ? 's' : ''} separated by ' | '):\n${questionList.map((q, i) => `Q${i + 1}: ${q}`).join("\n")}\n\n`;
  }
  if (constraints && constraints.length > 0) {
    userPrompt += `CONSTRAINTS (every single one MUST be satisfied — deterministic verification):\n${constraints.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\n`;
  }
  userPrompt += `CRITICAL INSTRUCTIONS:
- There are ${numQuestions} question(s). Your artifact must contain EXACTLY ${numQuestions} answer(s) separated by ' | '.
- Each answer corresponds to one question, in order (Q1's answer | Q2's answer | ...).
- Each answer MUST be a company name from the VALID COMPANY NAMES list, spelled EXACTLY as shown.
- Companies may be referenced by ALIASES or alternate names in the document. Always map back to the exact name from the valid list.
- IGNORE all hypothetical, speculative, projected, or conditional statements (e.g. "could potentially", "is expected to", "if they were to"). Only use CONFIRMED factual data from the document.
- For multi-hop questions (e.g. "which company had the highest X"), extract ALL relevant data points, compare them carefully, then select the answer.
- Your answer must satisfy ALL constraints simultaneously. Double-check each constraint against your answer.
- NEVER repeat the same company name for different questions unless you are absolutely certain.
- Output ONLY the single-line artifact. No reasoning, no labels, no preamble.`;

  console.log(`[Solver] Sending challenge to Claude (${numQuestions} questions, ${(constraints || []).length} constraints, ${(companies || []).length} companies)...`);

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

  // Validate answer count matches question count
  const parts = artifact.split(" | ").map((p) => p.trim()).filter(Boolean);
  if (parts.length !== numQuestions && numQuestions > 0) {
    console.log(`[Solver] WARNING: Got ${parts.length} answers for ${numQuestions} questions. Artifact: ${artifact}`);
  }

  // Check for duplicate answers (often a sign of error)
  const uniqueParts = [...new Set(parts)];
  if (uniqueParts.length < parts.length) {
    console.log(`[Solver] WARNING: Duplicate company names detected in artifact`);
  }

  // Validate all answers are from the valid companies list
  if (companies && companies.length > 0) {
    for (const part of parts) {
      if (!companies.includes(part)) {
        console.log(`[Solver] WARNING: "${part}" not in valid companies list`);
      }
    }
  }

  console.log(
    `[Solver] Artifact (${parts.length} answers): ${artifact.substring(0, 100)}${artifact.length > 100 ? "..." : ""}`
  );
  return artifact;
}
