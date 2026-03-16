const required = (name) => {
  const val = process.env[name];
  if (!val) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return val;
};

const config = {
  bankrApiKey: required("BANKR_API_KEY"),
  anthropicApiKey: required("ANTHROPIC_API_KEY"),
  coordinatorUrl:
    process.env.COORDINATOR_URL ||
    "https://coordinator-production-38c0.up.railway.app",
  bankrUrl: process.env.BANKR_URL || "https://api.bankr.bot",
  stakeAmountWei:
    process.env.STAKE_AMOUNT_WEI || "25000000000000000000000000",
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || "60000", 10),
  maxRetries: parseInt(process.env.MAX_RETRIES || "5", 10),
  autoStake: process.env.AUTO_STAKE === "true",
  autoClaim: process.env.AUTO_CLAIM === "true",
};

export default config;
