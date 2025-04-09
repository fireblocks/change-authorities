import { FireblocksSigner } from "./fireblocksSigner";
import { solanaBeachService } from "./service/solanaBeachService";
import { SolanaSerializer, web3 } from "./solanaSerializer";
import * as fs from "fs";
import * as path from "path";

interface StakeAccountsResponse {
  pubkey: {
    address: string;
  };
}

export class SolanaAuthorityOrchestrator {
  private currentAuthorityVaultId: string;
  private newAuthorityVaultId: string;
  private fireblocksSigner: FireblocksSigner;
  private solanaSerializer: SolanaSerializer;

  constructor(currentAuthorityVaultId: string, newAuthorityVaultId: string) {
    // Validate constructor parameters
    if (!currentAuthorityVaultId) {
      throw new Error("Current authority vault ID is required");
    }

    if (!newAuthorityVaultId) {
      throw new Error("New authority vault ID is required");
    }

    if(newAuthorityVaultId < currentAuthorityVaultId) {
      throw new Error("New authority vault ID cannot be older than current authority vault ID");
    }

    this.currentAuthorityVaultId = currentAuthorityVaultId;
    this.newAuthorityVaultId = newAuthorityVaultId;

    // Validate environment variables before instantiating dependencies
    this.validateEnvironment();

    this.fireblocksSigner = new FireblocksSigner();
    this.solanaSerializer = new SolanaSerializer();
  }

  /**
   * Validates required environment variables
   */
  private validateEnvironment(): void {
    const requiredEnvVars = [
      "FIREBLOCKS_API_KEY",
      "FIREBLOCKS_API_SECRET_PATH",
      "SOLANA_BEACH_API_KEY",
    ];

    const missingVars = requiredEnvVars.filter(
      (varName) => !process.env[varName]
    );

    if (missingVars.length > 0) {
      throw new Error(
        `Missing required environment variables: ${missingVars.join(", ")}`
      );
    }

    // Validate API secret path file exists
    const apiSecretPath = process.env.FIREBLOCKS_API_SECRET_PATH || "";
    try {
      const fs = require("fs");
      if (!fs.existsSync(apiSecretPath)) {
        throw new Error(
          `Fireblocks API secret file not found at path: ${apiSecretPath}`
        );
      }
    } catch (error) {
      throw new Error(
        `Error checking Fireblocks API secret file: ${error.message}`
      );
    }
  }


  
  /**
   * Write transaction results to a CSV file
   */
  private writeResultsToCsv(
    results: {
      stakeAccount: string;
      currentAuthority: string;
      newAuthority: string;
      txHash?: string;
      status: string;
      errorMessage?: string;
      timestamp: string;
    }[]
  ): string {
    // Create directory if it doesn't exist
    const outputDir = path.join(process.cwd(), "reports");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Generate timestamp for filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = path.join(
      outputDir,
      `authority-change-results-${timestamp}.csv`
    );

    // CSV header
    const header = [
      "Timestamp",
      "Stake Account",
      "Current Authority",
      "New Authority",
      "Transaction Hash",
      "Status",
      "Error Message",
    ].join(",");

    // CSV rows
    const rows = results.map((result) =>
      [
        result.timestamp,
        result.stakeAccount,
        result.currentAuthority,
        result.newAuthority,
        result.txHash || "",
        result.status,
        result.errorMessage?.replace(/,/g, ";") || "",
      ].join(",")
    );

    // Write to file
    fs.writeFileSync(filename, [header, ...rows].join("\n"));

    return filename;
  }

  public changeAuthorities = async (): Promise<void> => {
    // Initialize an array to store all transaction results
    const allTxResults: {
      stakeAccount: string;
      currentAuthority: string;
      newAuthority: string;
      txHash?: string;
      status: string;
      errorMessage?: string;
      timestamp: string;
    }[] = [];

    console.log("Starting authority change process...");
    console.log(`Current Authority Vault ID: ${this.currentAuthorityVaultId}`);
    console.log(`New Authority Vault ID: ${this.newAuthorityVaultId}`);

    // Get existing authority address
    console.log("Fetching existing authority address...");
    const existingAuthorityAddress =
      await this.fireblocksSigner.getAddressForVault(
        this.currentAuthorityVaultId
      );
    if (!existingAuthorityAddress) {
      throw new Error(
        `No existing authority found for vault ID: ${this.currentAuthorityVaultId}`
      );
    }
    console.log(`Existing authority address: ${existingAuthorityAddress}`);

    // Get new authority address
    console.log("Fetching new authority address...");
    const newAuthorityAddress = await this.fireblocksSigner.getAddressForVault(
      this.newAuthorityVaultId
    );
    if (!newAuthorityAddress) {
      throw new Error(
        `No new authority found for vault ID: ${this.newAuthorityVaultId}`
      );
    }

    
    console.log(`New authority address: ${newAuthorityAddress}`);

    // Validate authorities are different
    if (existingAuthorityAddress === newAuthorityAddress) {
      throw new Error(
        `Existing authority and new authority are the same: ${existingAuthorityAddress}`
      );
    }

    const existingAuthorityPubKey = new web3.PublicKey(
      existingAuthorityAddress
    );
    const newAuthorityPubKey = new web3.PublicKey(newAuthorityAddress);

    // Fetch stake accounts
    console.log(
      `Fetching stake accounts for address: ${existingAuthorityAddress}`
    );
    const stakeAccounts = (await solanaBeachService.getStakeAccountsForAddress(
      existingAuthorityAddress
    ));

    // Validate stake accounts exist
    if (!stakeAccounts || stakeAccounts.length === 0) {
      throw new Error(
        `No stake accounts found for address: ${existingAuthorityAddress}`
      );
    }
    console.log(
      `Found ${stakeAccounts.length} stake accounts for authority: ${existingAuthorityAddress}`
    );

    // Filter out invalid stake accounts
    const validStakeAccounts = stakeAccounts.filter(
      (account) => account.pubkey && account.pubkey.address
    );

    if (validStakeAccounts.length === 0) {
      throw new Error("No valid stake accounts found");
    }

    console.log(`Processing ${validStakeAccounts.length} valid stake accounts`);

    // Process in batches of 50
    const BATCH_SIZE = 50;
    const batches: StakeAccountsResponse[][] = [];

    for (let i = 0; i < validStakeAccounts.length; i += BATCH_SIZE) {
      batches.push(validStakeAccounts.slice(i, i + BATCH_SIZE));
    }

    console.log(
      `Split stake accounts into ${batches.length} batches of up to ${BATCH_SIZE} accounts each`
    );

    let totalSuccessCount = 0;
    let totalFailureCount = 0;

    // Process each batch sequentially
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      console.log(
        `\n===== Processing Batch ${batchIndex + 1}/${batches.length} (${
          batch.length
        } accounts) =====`
      );

      // Initialize an array to hold transaction data for current batch
      const txDataMap: Map<
        string,
        {
          serializedTransaction: string;
          stakeAccountPubKey: web3.PublicKey;
          transaction: web3.Transaction;
        }
      > = new Map();

      // Build all transactions for this batch
      console.log(
        `Building transactions for ${batch.length} stake accounts in batch ${
          batchIndex + 1
        }...`
      );
      for (const stakeAccount of batch) {
        try {
          console.log("Processing stake account:", stakeAccount.pubkey.address);
          const stakeAccountPubKey = new web3.PublicKey(
            stakeAccount.pubkey.address
          );

          // Build the transaction
          const { transaction, serializedTransaction } =
            await this.solanaSerializer.buildChangeAuthoritiesTx({
              stakeAccount: stakeAccountPubKey,
              currentAuthorized: existingAuthorityPubKey,
              newAuthorized: newAuthorityPubKey,
            });

          // Store in our map using the serialized transaction as the key
          txDataMap.set(serializedTransaction, {
            serializedTransaction,
            stakeAccountPubKey,
            transaction,
          });
        } catch (error) {
          console.error(
            `Error building transaction for stake account ${stakeAccount.pubkey.address}:`,
            error
          );
          // Continue with other transactions in batch instead of failing completely
          totalFailureCount++;
        }
      }

      // Validate we have transactions to sign
      if (txDataMap.size === 0) {
        console.warn(
          `No valid transactions were created for batch ${
            batchIndex + 1
          }, skipping`
        );
        continue;
      }

      // Prepare all transactions for batch signing
      const messagesForSigning = Array.from(txDataMap.keys()).map(
        (serializedTx) => ({
          content: serializedTx,
        })
      );

      try {
        // Send all transactions to Fireblocks in a single batch
        console.log(
          `Sending ${messagesForSigning.length} transactions to Fireblocks for signing...`
        );
        const signatureResponse = await this.fireblocksSigner.signTransaction(
          messagesForSigning,
          this.currentAuthorityVaultId,
          newAuthorityAddress,
          this.newAuthorityVaultId
        );

        // Validate signature response
        if (
          !signatureResponse.signedMessages ||
          signatureResponse.signedMessages.length === 0
        ) {
          throw new Error("No signed messages returned from Fireblocks");
        }

        if (
          signatureResponse.signedMessages.length !== messagesForSigning.length
        ) {
          console.warn(
            `Warning: Received ${signatureResponse.signedMessages.length} signatures but sent ${messagesForSigning.length} transactions`
          );
        }

        console.log(
          `Received ${signatureResponse.signedMessages.length} signed messages from Fireblocks`
        );

        // Process and send each transaction with its matching signature
        let batchSuccessCount = 0;
        let batchFailureCount = 0;

        // Create an array to store results
        const results: {
          status: "fulfilled" | "rejected";
          reason?: string;
          value?: string;
        }[] = [];

        // Array to store detailed transaction results for the CSV
        const batchTxResults: {
          stakeAccount: string;
          currentAuthority: string;
          newAuthority: string;
          txHash?: string;
          status: string;
          errorMessage?: string;
          timestamp: string;
        }[] = [];

        // Process transactions sequentially
        for (const signedMessage of signatureResponse.signedMessages) {
          // Define txContent outside the try block so it's available in the catch
          let txContent: string | undefined = undefined;

          try {
            // Match the signature with the corresponding transaction data using content
            txContent = signedMessage.content;
            if (!txContent) {
              console.error(
                "Transaction content is undefined in signed message."
              );
              batchFailureCount++;
              results.push({ status: "rejected", reason: "Missing content" });

              // Add to CSV results
              batchTxResults.push({
                stakeAccount: "Unknown",
                currentAuthority: existingAuthorityAddress,
                newAuthority: newAuthorityAddress,
                status: "Failed",
                errorMessage: "Missing transaction content in signed message",
                timestamp: new Date().toISOString(),
              });
              continue;
            }

            const txData = txDataMap.get(txContent);
            if (!txData) {
              console.error(
                `Could not find matching transaction data for content: ${txContent.substring(
                  0,
                  20
                )}...`
              );
              batchFailureCount++;
              results.push({
                status: "rejected",
                reason: "No matching transaction data",
              });

              // Add to CSV results
              batchTxResults.push({
                stakeAccount: "Unknown",
                currentAuthority: existingAuthorityAddress,
                newAuthority: newAuthorityAddress,
                status: "Failed",
                errorMessage: "No matching transaction data found",
                timestamp: new Date().toISOString(),
              });
              continue;
            }

            const { serializedTransaction, stakeAccountPubKey } = txData;
            const signatureHex = signedMessage.signature?.fullSig;

            if (!signatureHex) {
              console.error(
                `Missing signature for stake account: ${stakeAccountPubKey.toString()}`
              );
              batchFailureCount++;
              results.push({ status: "rejected", reason: "Missing signature" });

              // Add to CSV results
              batchTxResults.push({
                stakeAccount: stakeAccountPubKey.toString(),
                currentAuthority: existingAuthorityAddress,
                newAuthority: newAuthorityAddress,
                status: "Failed",
                errorMessage: "Missing signature from Fireblocks",
                timestamp: new Date().toISOString(),
              });
              continue;
            }

            // Send the signed transaction
            const txId = await this.solanaSerializer.sendSignedTransaction(
              serializedTransaction,
              signatureHex,
              existingAuthorityPubKey
            );

            console.log(
              `Transaction sent successfully: ${txId} for stake account: ${stakeAccountPubKey.toString()}`
            );
            batchSuccessCount++;
            results.push({ status: "fulfilled", value: txId });

            // Add to CSV results
            batchTxResults.push({
              stakeAccount: stakeAccountPubKey.toString(),
              currentAuthority: existingAuthorityAddress,
              newAuthority: newAuthorityAddress,
              txHash: txId,
              status: "Success",
              timestamp: new Date().toISOString(),
            });
          } catch (error: any) {
            batchFailureCount++;
            console.error(`Error sending transaction:`, error);

            let errorMessage = "Unknown error";
            let stakeAccount = "Unknown";

            // Try to extract stake account from the transaction data
            try {
              if (txContent && txDataMap.get(txContent)) {
                stakeAccount = txDataMap
                  .get(txContent)!
                  .stakeAccountPubKey.toString();
              }
            } catch (e) {
              console.error(
                "Error extracting stake account from transaction data:",
                e
              );
            }

            // Extract error message
            if (error.message) {
              errorMessage = error.message;
            }

            if (error.logs) {
              console.error("Transaction logs:", error.logs);
              errorMessage += ` - Logs: ${error.logs.join("; ")}`;
            }

            results.push({ status: "rejected", reason: error });

            // Add to CSV results
            batchTxResults.push({
              stakeAccount,
              currentAuthority: existingAuthorityAddress,
              newAuthority: newAuthorityAddress,
              status: "Failed",
              errorMessage,
              timestamp: new Date().toISOString(),
            });
          }
        }

        // Add batch results to overall results
        allTxResults.push(...batchTxResults);
        totalSuccessCount += batchSuccessCount;
        totalFailureCount += batchFailureCount;

        // Print batch summary
        console.log(`\n===== BATCH ${batchIndex + 1} SUMMARY =====`);
        console.log(
          `Total transactions in batch: ${messagesForSigning.length}`
        );
        console.log(`Successful: ${batchSuccessCount}`);
        console.log(`Failed: ${batchFailureCount}`);

        if (batchFailureCount > 0) {
          console.warn(
            `Warning: ${batchFailureCount} transactions in batch ${
              batchIndex + 1
            } failed to process correctly`
          );
        } else {
          console.log(
            `All transactions in batch ${batchIndex + 1} processed successfully`
          );
        }
      } catch (error) {
        console.error(`Error processing batch ${batchIndex + 1}:`, error);
        // Continue with next batch instead of failing completely
      }
    }

    // Print overall summary
    console.log("\n===== OVERALL TRANSACTION SUMMARY =====");
    console.log(`Total stake accounts: ${validStakeAccounts.length}`);
    console.log(`Total successful: ${totalSuccessCount}`);
    console.log(`Total failed: ${totalFailureCount}`);

    // Write all results to CSV
    const csvFilename = this.writeResultsToCsv(allTxResults);
    console.log(`All transaction results written to CSV file: ${csvFilename}`);
  };
}
