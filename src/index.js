import config from "./config.js";
import { getIdentity, submitTransaction } from "./bankr.js";
import {
  authenticate,
  ensureAuth,
  listSites,
  requestChallenge,
  submitArtifact,
  checkRefineStatus,
  getReceiptCalldata,
  getStakeApproveCalldata,
  getStakeCalldata,
  getCredits,
  getEpochStatus,
  getClaimCalldata,
} from "./coordinator.js";
import { solveChallenge } from "./solver.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function backoff(attempt, base = 5000, cap = 60000) {
  const delay = Math.min(base * 2 ** attempt, cap);
  const jitter = delay * (Math.random() * 0.25);
  return delay + jitter;
}

async function stake(amountWei) {
  console.log(`[Stake] Approving ${amountWei} wei...`);
  const approveData = await getStakeApproveCalldata(amountWei);
  await submitTransaction(approveData.to, approveData.data);

  console.log(`[Stake] Staking ${amountWei} wei...`);
  const stakeData = await getStakeCalldata(amountWei);
  await submitTransaction(stakeData.to, stakeData.data);

  console.log("[Stake] Staking complete.");
}

async function pollRefinery(crudeLotId) {
  console.log(`[Refinery] Polling lot ${crudeLotId}...`);
  for (let i = 0; i < 60; i++) {
    const status = await checkRefineStatus(crudeLotId);
    if (status.status === "ready") {
      console.log(`[Refinery] Lot ${crudeLotId} is ready.`);
      return status;
    }
    if (status.status === "failed") {
      throw new Error(`Refinery failed for lot ${crudeLotId}`);
    }
    const wait = i < 10 ? 60000 : 120000;
    console.log(
      `[Refinery] Status: ${status.status}, waiting ${wait / 1000}s...`
    );
    await sleep(wait);
  }
  throw new Error(`Refinery timed out for lot ${crudeLotId}`);
}

async function postReceipt(crudeLotId) {
  console.log(`[Receipt] Getting calldata for lot ${crudeLotId}...`);
  const receiptData = await getReceiptCalldata(crudeLotId);
  console.log(`[Receipt] Calldata response keys: ${JSON.stringify(Object.keys(receiptData))}`);

  // Handle nested response shapes
  const tx = receiptData.transaction || receiptData.calldata || receiptData;
  const to = tx.to || receiptData.to;
  const data = tx.data || receiptData.data;

  if (!to || !data) {
    console.error(`[Receipt] Full response: ${JSON.stringify(receiptData).slice(0, 500)}`);
    throw new Error(`Receipt calldata missing 'to' or 'data'`);
  }

  console.log(`[Receipt] Posting to ${to}...`);
  const result = await submitTransaction(to, data);
  console.log(`[Receipt] Posted on-chain. TX: ${result.txHash || JSON.stringify(result).slice(0, 200)}`);
  return result;
}

async function claimRewards(walletAddress) {
  const epoch = await getEpochStatus();
  if (!epoch.claimableEpochs || epoch.claimableEpochs.length === 0) {
    console.log("[Claim] No claimable epochs.");
    return;
  }

  const epochs = epoch.claimableEpochs.join(",");
  console.log(`[Claim] Claiming epochs: ${epochs}`);
  const claimData = await getClaimCalldata(epochs);
  await submitTransaction(claimData.to, claimData.data);
  console.log("[Claim] Rewards claimed.");
}

// Eligible depths based on rig tier (Platform = 50M+ stake)
const ELIGIBLE_DEPTHS = ["shallow", "medium"];

// Prefer deeper wells (more credits) among eligible depths
const DEPTH_PRIORITY = ["medium", "shallow"];

async function pickSite() {
  const data = await listSites();
  const sites = data.sites || data;
  if (!sites || sites.length === 0) {
    throw new Error("No drill sites available");
  }

  // Filter to only eligible depths, then prefer deeper (more rewarding)
  const eligible = sites.filter((s) => ELIGIBLE_DEPTHS.includes(s.estimatedDepth));
  if (eligible.length === 0) {
    throw new Error(`No eligible sites. Available depths: ${sites.map((s) => s.estimatedDepth).join(", ")}`);
  }

  const sorted = [...eligible].sort(
    (a, b) => DEPTH_PRIORITY.indexOf(a.estimatedDepth) - DEPTH_PRIORITY.indexOf(b.estimatedDepth)
  );

  // Pick randomly among the top-priority depth to spread across sites
  const bestDepth = sorted[0].estimatedDepth;
  const topSites = sorted.filter((s) => s.estimatedDepth === bestDepth);
  const site = topSites[Math.floor(Math.random() * topSites.length)];

  console.log(`[Sites] Selected: ${site.region} (${site.siteId}) [${site.estimatedDepth}] (${eligible.length} eligible)`);
  return site;
}

// Track background refinery jobs
const pendingLots = [];

async function processLotInBackground(crudeLotId) {
  try {
    await pollRefinery(crudeLotId);
    await postReceipt(crudeLotId);
    console.log(`[Background] Lot ${crudeLotId} fully processed and posted on-chain.`);
  } catch (err) {
    console.error(`[Background] Lot ${crudeLotId} failed: ${err.message}`);
  }
}

async function drillOnce(walletAddress) {
  await ensureAuth(walletAddress);

  const site = await pickSite(walletAddress);

  console.log("[Drill] Requesting challenge...");
  const challenge = await requestChallenge(walletAddress, site.siteId);

  console.log("[Drill] Solving challenge...");
  const artifact = await solveChallenge(challenge);

  console.log("[Drill] Submitting artifact...");
  const submission = await submitArtifact(
    challenge.challengeId,
    challenge.requestNonce,
    artifact,
    challenge.siteId || site.siteId
  );

  if (submission.status === "rejected") {
    console.log(`[Drill] Rejected: ${submission.reason || "unknown"}. Moving to next challenge.`);
    return false;
  }

  if (submission.failedConstraintIndices) {
    console.log(
      `[Drill] Failed constraints: ${JSON.stringify(submission.failedConstraintIndices)}. Skipping.`
    );
    return false;
  }

  const crudeLotId = submission.crudeLotId || submission.lotId || submission.id;
  console.log(`[Drill] Submitted. Lot ID: ${crudeLotId}`);

  // Process refinery + receipt in background, don't block drilling
  if (crudeLotId) {
    pendingLots.push(crudeLotId);
    processLotInBackground(crudeLotId);
  }

  return true;
}

async function main() {
  console.log("=== CRUDE Mining Bot Starting ===");

  const identity = await getIdentity();
  const walletAddress = identity.address;
  console.log(`Wallet: ${walletAddress}`);

  await authenticate(walletAddress);

  if (config.autoStake) {
    console.log("[Init] Auto-staking enabled.");
    try {
      await stake(config.stakeAmountWei);
    } catch (err) {
      console.log(`[Init] Stake failed (may already be staked): ${err.message}`);
    }
  }

  const credits = await getCredits(walletAddress);
  console.log(`[Init] Current credits: ${JSON.stringify(credits)}`);

  console.log("=== Entering Mining Loop ===");
  let consecutiveErrors = 0;

  while (true) {
    try {
      if (config.autoClaim) {
        await claimRewards(walletAddress);
      }

      const success = await drillOnce(walletAddress);
      if (success) {
        consecutiveErrors = 0;
        const creds = await getCredits(walletAddress);
        console.log(`[Status] Credits: ${JSON.stringify(creds)}`);
      }
    } catch (err) {
      consecutiveErrors++;
      console.error(`[Error] Drill failed: ${err.message}`);

      if (consecutiveErrors >= config.maxRetries) {
        console.error(
          `[Error] ${consecutiveErrors} consecutive failures. Cooling down 5 minutes...`
        );
        await sleep(300000);
        consecutiveErrors = 0;
      }
    }

    const delay = backoff(Math.min(consecutiveErrors, 5));
    console.log(`[Loop] Waiting ${Math.round(delay / 1000)}s before next drill...`);
    await sleep(delay);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
