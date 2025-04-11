import * as fs from "fs";
import * as path from "path";

/**
 * Write withdrawal results to a CSV file
 */
export function writeResultsToWithdrawalCsv(
  results: {
    stakeAccounts: string[];
    authority: string;
    txHash?: string;
    status: string;
    errorMessage?: string;
    timestamp: string;
  }[]
): string {
  const outputDir = path.join(process.cwd(), "reports");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = path.join(outputDir, `withdrawal-results-${timestamp}.csv`);

  const header = [
    "Timestamp",
    "Transaction Hash",
    "Status",
    "Error Message",
    "Authority",
    "Stake Accounts",
  ].join(",");

  const rows = results.map((result) =>
    [
      result.timestamp,
      result.txHash || "",
      result.status,
      result.errorMessage?.replace(/,/g, ";") || "",
      result.authority,
      `"${result.stakeAccounts.join("; ")}"`,
    ].join(",")
  );

  fs.writeFileSync(filename, [header, ...rows].join("\n"));

  return filename;
}

/**
 * Shared method to handle transaction batch processing
 */
export async function processBatchedTransactions<T>(
  items: T[],
  batchSize: number,
  processTransaction: (batch: T[]) => Promise<{
    txHash: string;
    status: string;
    errorMessage?: string;
  }>,
  getItemIdentifier: (item: T) => string
) {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    batches.push(batch);
  }

  console.log(
    `Split ${items.length} items into ${batches.length} transaction batches of up to ${batchSize} items each`
  );

  let totalSuccessCount = 0;
  let totalFailureCount = 0;

  const results: {
    items: string[];
    txHash?: string;
    status: string;
    errorMessage?: string;
    timestamp: string;
  }[] = [];

  
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    console.log(
      `\n----- Processing Transaction ${batchIndex + 1}/${batches.length} (${
        batch.length
      } items) -----`
    );

    
    console.log("Items in this transaction:");
    batch.forEach((item, i) =>
      console.log(`  ${i + 1}. ${getItemIdentifier(item)}`)
    );

    try {
      const { txHash, status, errorMessage } = await processTransaction(batch);

      // Add to results
      results.push({
        items: batch.map(getItemIdentifier),
        txHash,
        status,
        timestamp: new Date().toISOString(),
      });

      totalSuccessCount += batch.length;
      console.log(`Transaction sent successfully: ${txHash}`);
      console.log(`Processed ${batch.length} items in a single transaction`);
    } catch (error: any) {
      
      console.error(`Error processing transaction ${batchIndex + 1}:`, error);

      let errorMessage = "Unknown error";

      if (error.message) {
        errorMessage = error.message;
      }

      if (error.logs) {
        console.error("Transaction logs:", error.logs);
        errorMessage += ` - Logs: ${error.logs.join("; ")}`;
      }

      
      results.push({
        items: batch.map(getItemIdentifier),
        status: "Failed",
        errorMessage,
        timestamp: new Date().toISOString(),
      });

      totalFailureCount += batch.length;
    }
  }

  
  console.log("\n===== TRANSACTION SUMMARY =====");
  console.log(`Total transactions: ${batches.length}`);
  console.log(`Total items: ${items.length}`);
  console.log(`Successfully processed items: ${totalSuccessCount}`);
  console.log(`Failed items: ${totalFailureCount}`);

  return { results, totalSuccessCount, totalFailureCount };
}

/**
 * Write changeAuthority results to a CSV file
 */
export function writeChangeAuthorityResultsToCsv(
  results: {
    stakeAccounts: string[];
    currentAuthority: string;
    newAuthority: string;
    txHash?: string;
    status: string;
    errorMessage?: string;
    timestamp: string;
  }[]
): string {
  const outputDir = path.join(process.cwd(), "reports");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = path.join(
    outputDir,
    `authority-change-results-${timestamp}.csv`
  );

  const header = [
    "Timestamp",
    "Transaction Hash",
    "Status",
    "Error Message",
    "Current Authority",
    "New Authority",
    "Stake Accounts",
  ].join(",");

  const rows = results.map((result) =>
    [
      result.timestamp,
      result.txHash || "",
      result.status,
      result.errorMessage?.replace(/,/g, ";") || "",
      result.currentAuthority,
      result.newAuthority,
      `"${result.stakeAccounts.join("; ")}"`,
    ].join(",")
  );

  fs.writeFileSync(filename, [header, ...rows].join("\n"));

  return filename;
}
