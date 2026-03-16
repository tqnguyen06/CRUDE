import config from "./config.js";

const headers = () => ({
  "X-API-Key": config.bankrApiKey,
  "Content-Type": "application/json",
});

async function request(method, path, body) {
  const url = `${config.bankrUrl}${path}`;
  const opts = { method, headers: headers() };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bankr ${method} ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function getIdentity() {
  const data = await request("GET", "/agent/me");
  const evmWallet = data.wallets?.find((w) => w.chain === "evm");
  const address = evmWallet?.address;
  console.log(`[Bankr] Wallet: ${address}`);
  return { ...data, address };
}

export async function signMessage(message) {
  const data = await request("POST", "/agent/sign", { message });
  return data.signature;
}

export async function submitTransaction(to, data, value = "0") {
  const res = await request("POST", "/agent/submit", {
    to,
    data,
    value,
    chainId: 8453,
    waitForConfirmation: true,
  });

  if (res.jobId) {
    return pollJob(res.jobId);
  }
  return res;
}

export async function pollJob(jobId, maxAttempts = 60) {
  for (let i = 0; i < maxAttempts; i++) {
    const job = await request("GET", `/agent/job/${jobId}`);
    if (job.status === "completed" || job.status === "confirmed") {
      console.log(`[Bankr] Job ${jobId} confirmed: ${job.txHash}`);
      return job;
    }
    if (job.status === "failed") {
      throw new Error(`[Bankr] Job ${jobId} failed: ${JSON.stringify(job)}`);
    }
    await sleep(5000);
  }
  throw new Error(`[Bankr] Job ${jobId} timed out`);
}

export async function promptBankr(prompt) {
  return request("POST", "/agent/prompt", { prompt });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
