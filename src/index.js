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

function backoff(attempt, base = 2000, cap = 60000) {
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
  for (let i = 0; i < 120; i++) {
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
  const result = await submitTransaction(receiptData.to, receiptData.data);
  console.log(`[Receipt] Posted on-chain.`);
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

// Prefer shallowest sites first to avoid tier rejections
const DEPTH_ORDER = ["shallow", "medium", "deep"];

async function pickSite() {
  const data = await listSites();
  const sites = data.sites || data;
  if (!sites || sites.length === 0) {
    throw new Error("No drill sites available");
  }

  // Sort by depth (shallowest first) to maximize eligibility
  const sorted = [...sites].sort(
    (a, b) => DEPTH_ORDER.indexOf(a.estimatedDepth) - DEPTH_ORDER.indexOf(b.estimatedDepth)
  );

  const site = sorted[0];
  console.log(`[Sites] Selected: ${site.region} (${site.siteId}) [${site.estimatedDepth}]`);
  return site;
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
    artifact
  );

  if (submission.failedConstraintIndices) {
    console.log(
      `[Drill] Failed constraints: ${JSON.stringify(submission.failedConstraintIndices)}. Skipping to next challenge.`
    );
    return false;
  }

  const crudeLotId = submission.crudeLotId;
  console.log(`[Drill] Submitted. Lot ID: ${crudeLotId}`);

  await pollRefinery(crudeLotId);
  await postReceipt(crudeLotId);

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
