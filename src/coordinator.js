import crypto from "crypto";
import config from "./config.js";
import { signMessage } from "./bankr.js";

let authToken = null;
let tokenExpiry = 0;

function authHeaders() {
  return {
    Authorization: `Bearer ${authToken}`,
    "Content-Type": "application/json",
  };
}

async function apiGet(path, authenticated = true) {
  const url = `${config.coordinatorUrl}${path}`;
  const headers = authenticated ? authHeaders() : {};
  const res = await fetch(url, { headers });
  if (res.status === 401) {
    console.log("[Coordinator] Token expired, re-authenticating...");
    await authenticate(globalWalletAddress);
    return apiGet(path, authenticated);
  }
  if (res.status === 409) {
    const text = await res.text();
    console.log(`[Coordinator] 409 Conflict: ${text}. Waiting 30s...`);
    await new Promise((r) => setTimeout(r, 30000));
    return apiGet(path, authenticated);
  }
  if (!res.ok) {
    const text = await res.text();
    if (text.includes("exp") && text.includes("claim timestamp check failed")) {
      console.log("[Coordinator] Token expired (exp claim), re-authenticating...");
      await authenticate(globalWalletAddress);
      return apiGet(path, authenticated);
    }
    throw new Error(`Coordinator GET ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function apiPost(path, body) {
  const url = `${config.coordinatorUrl}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    console.log("[Coordinator] Token expired, re-authenticating...");
    await authenticate(globalWalletAddress);
    return apiPost(path, body);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Coordinator POST ${path} failed (${res.status}): ${text}`
    );
  }
  return res.json();
}

let globalWalletAddress = null;

export async function authenticate(walletAddress) {
  globalWalletAddress = walletAddress;
  console.log("[Coordinator] Requesting auth nonce...");

  const nonceRes = await fetch(
    `${config.coordinatorUrl}/v1/auth/nonce`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ miner: walletAddress }),
    }
  );
  if (!nonceRes.ok) {
    throw new Error(`Auth nonce failed: ${await nonceRes.text()}`);
  }
  const { message } = await nonceRes.json();

  console.log("[Coordinator] Signing auth message via Bankr...");
  const signature = await signMessage(message);

  const verifyRes = await fetch(
    `${config.coordinatorUrl}/v1/auth/verify`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ miner: walletAddress, signature, message }),
    }
  );
  if (!verifyRes.ok) {
    throw new Error(`Auth verify failed: ${await verifyRes.text()}`);
  }
  const data = await verifyRes.json();
  authToken = data.token;

  // Refresh 5 min before expiry with jitter
  const jitter = Math.floor(Math.random() * 60 + 30) * 1000;
  tokenExpiry = Date.now() + (data.expiresIn || 3600) * 1000 - 300000 - jitter;

  console.log("[Coordinator] Authenticated successfully.");
  return authToken;
}

export async function ensureAuth(walletAddress) {
  if (!authToken || Date.now() >= tokenExpiry) {
    await authenticate(walletAddress);
  }
}

export async function listSites() {
  return apiGet("/v1/sites");
}

export async function requestChallenge(minerAddress, siteId) {
  const requestNonce = crypto.randomBytes(32).toString("hex");
  const data = await apiGet(
    `/v1/drill?miner=${minerAddress}&siteId=${siteId}&nonce=${requestNonce}`
  );
  console.log(`[Coordinator] Challenge keys: ${Object.keys(data).join(", ")}`);
  return { ...data, requestNonce };
}

export async function submitArtifact(challengeId, requestNonce, artifact, siteId) {
  return apiPost("/v1/submit", {
    challengeId,
    requestNonce,
    artifact,
    siteId,
  });
}

export async function checkRefineStatus(crudeLotId) {
  return apiGet(`/v1/refine/status?crudeLotId=${crudeLotId}`);
}

export async function getReceiptCalldata(crudeLotId) {
  return apiGet(`/v1/receipt-calldata?crudeLotId=${crudeLotId}`);
}

export async function getStakeApproveCalldata(amountWei) {
  return apiGet(`/v1/stake-approve-calldata?amount=${amountWei}`);
}

export async function getStakeCalldata(amountWei) {
  return apiGet(`/v1/stake-calldata?amount=${amountWei}`);
}

export async function getUnstakeCalldata() {
  return apiGet("/v1/unstake-calldata");
}

export async function getCredits(minerAddress) {
  return apiGet(`/v1/credits?miner=${minerAddress}`);
}

export async function getEpochStatus() {
  return apiGet("/v1/epoch");
}

export async function getClaimCalldata(epochs) {
  return apiGet(`/v1/claim-calldata?epochs=${epochs}`);
}

export async function getTokenInfo() {
  return apiGet("/v1/token");
}
