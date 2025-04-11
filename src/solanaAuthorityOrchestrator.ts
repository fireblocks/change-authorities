import { FireblocksSigner } from "./fireblocksSigner";
import { solscanService } from "./service/solscanService";
import { SolanaSerializer, web3 } from "./solanaSerializer";
import * as fs from "fs";
import * as path from "path";


export class SolanaAuthorityOrchestrator {
  private currentAuthorityVaultId: string;
  private newAuthorityVaultId: string;
  private fireblocksSigner: FireblocksSigner;
  private solanaSerializer: SolanaSerializer;
  private readonly MAX_ACCOUNTS_PER_TX = 6; 

  constructor(currentAuthorityVaultId: string, newAuthorityVaultId: string) {
    
    if (!currentAuthorityVaultId) {
      throw new Error("Current authority vault ID is required");
    }

    if (!newAuthorityVaultId) {
      throw new Error("New authority vault ID is required");
    }

    this.currentAuthorityVaultId = currentAuthorityVaultId;
    this.newAuthorityVaultId = newAuthorityVaultId;

    // Validate environment variables
    this.validateEnvironment();

    this.fireblocksSigner = new FireblocksSigner();
    this.solanaSerializer = new SolanaSerializer();
  }

  
  private validateEnvironment(): void {
    const requiredEnvVars = [
      "FIREBLOCKS_API_KEY",
      "FIREBLOCKS_API_SECRET_PATH",
      "SOLSCAN_API_KEY",
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
      "Stake Accounts"
    ].join(",");


    const rows = results.map((result) =>
      [
        result.timestamp,
        result.txHash || "",
        result.status,
        result.errorMessage?.replace(/,/g, ";") || "",
        result.currentAuthority,
        result.newAuthority,
        `"${result.stakeAccounts.join("; ")}"`
      ].join(",")
    );

    fs.writeFileSync(filename, [header, ...rows].join("\n"));

    return filename;
  }

  public changeAuthorities = async (): Promise<void> => {
    
    const txResults: {
      stakeAccounts: string[];
      currentAuthority: string;
      newAuthority: string;
      txHash?: string;
      status: string;
      errorMessage?: string;
      timestamp: string;
    }[] = [];

    console.log("Starting batch authority change process...");
    console.log(`Current Authority Vault ID: ${this.currentAuthorityVaultId}`);
    console.log(`New Authority Vault ID: ${this.newAuthorityVaultId}`);

    if(parseInt(this.currentAuthorityVaultId) > parseInt(this.newAuthorityVaultId)) {
      throw new Error("New authority vault account has to be a newer account than the current authority vault account");
    }

    if(parseInt(this.currentAuthorityVaultId) === parseInt(this.newAuthorityVaultId)) {
      throw new Error("New authority vault account has to be a different account than the current authority vault account");
    }
    
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

    const existingAuthorityPubKey = new web3.PublicKey(existingAuthorityAddress);
    const newAuthorityPubKey = new web3.PublicKey(newAuthorityAddress);

    // Fetch stake accounts
    console.log(`Fetching stake accounts for address: ${existingAuthorityAddress}`);
    const stakeAccounts = await solscanService.getStakeAccountsForAddress(
      existingAuthorityAddress
    );

    if (!stakeAccounts || stakeAccounts.length === 0) {
      throw new Error(
        `No stake accounts found for address: ${existingAuthorityAddress}`
      );
    }
    console.log(`Found ${stakeAccounts.length} stake accounts for authority: ${existingAuthorityAddress}`);

    // Filter out invalid stake accounts
    const validStakeAccounts = stakeAccounts.filter(
      (account) => account.pubkey && account.pubkey.address
    );

    if (validStakeAccounts.length === 0) {
      throw new Error("No valid stake accounts found");
    }

    console.log(`Processing ${validStakeAccounts.length} valid stake accounts`);

    // Split stake accounts into transaction sized batches
    const txBatches: web3.PublicKey[][] = [];
    for (let i = 0; i < validStakeAccounts.length; i += this.MAX_ACCOUNTS_PER_TX) {
      const accountBatch = validStakeAccounts.slice(i, i + this.MAX_ACCOUNTS_PER_TX);
      txBatches.push(accountBatch.map(account => new web3.PublicKey(account.pubkey.address)));
    }

    console.log(`Split stake accounts into ${txBatches.length} transaction batches of up to ${this.MAX_ACCOUNTS_PER_TX} accounts each`);

    let totalSuccessCount = 0;
    let totalFailureCount = 0;

    // Process each transaction batch
    for (let txBatchIndex = 0; txBatchIndex < txBatches.length; txBatchIndex++) {
      const txBatch = txBatches[txBatchIndex];
      console.log(`\n----- Processing Transaction ${txBatchIndex + 1}/${txBatches.length} (${txBatch.length} accounts) -----`);
      
      try {
        
        console.log("Stake accounts in this transaction:");
        txBatch.forEach((pk, i) => console.log(`  ${i+1}. ${pk.toString()}`));
        
        // Build a single transaction with multiple authority change instructions
        console.log(`Building transaction for ${txBatch.length} accounts...`);
        const { transaction, serializedTransaction } = 
          await this.solanaSerializer.buildBatchChangeAuthoritiesTx(
            txBatch,
            existingAuthorityPubKey,
            newAuthorityPubKey
          );

        // Send transaction to Fireblocks for signing
        console.log(`Sending transaction to Fireblocks for signing...`);
        const signatureResponse = await this.fireblocksSigner.signTransaction(
          [{ content: serializedTransaction }],
          this.currentAuthorityVaultId,
          newAuthorityAddress,
          this.newAuthorityVaultId
        );

        // Validate signature response
        if (!signatureResponse.signedMessages || signatureResponse.signedMessages.length === 0) {
          throw new Error("No signed messages returned from Fireblocks");
        }

        const signedMessage = signatureResponse.signedMessages[0];
        const signatureHex = signedMessage.signature?.fullSig;

        if (!signatureHex) {
          throw new Error("Missing signature from Fireblocks");
        }

        // Send the signed transaction
        console.log(`Sending signed transaction to Solana network...`);
        const txId = await this.solanaSerializer.sendSignedTransaction(
          serializedTransaction,
          signatureHex,
          existingAuthorityPubKey
        );

        console.log(`Transaction sent successfully: ${txId}`);
        console.log(`Changed authorities for ${txBatch.length} stake accounts in a single transaction`);
        
        // Add to transaction results
        txResults.push({
          stakeAccounts: txBatch.map(pk => pk.toString()),
          currentAuthority: existingAuthorityAddress,
          newAuthority: newAuthorityAddress,
          txHash: txId,
          status: "Success",
          timestamp: new Date().toISOString(),
        });
        
        totalSuccessCount += txBatch.length;
        
      } catch (error: any) {
        // Record failure
        console.error(`Error processing transaction ${txBatchIndex + 1}:`, error);
        
        let errorMessage = "Unknown error";
        
        // Extract error message
        if (error.message) {
          errorMessage = error.message;
        }
        
        if (error.logs) {
          console.error("Transaction logs:", error.logs);
          errorMessage += ` - Logs: ${error.logs.join("; ")}`;
        }
        
        // Add to transaction results
        txResults.push({
          stakeAccounts: txBatch.map(pk => pk.toString()),
          currentAuthority: existingAuthorityAddress,
          newAuthority: newAuthorityAddress,
          status: "Failed",
          errorMessage,
          timestamp: new Date().toISOString(),
        });
        
        totalFailureCount += txBatch.length;
      }
    }

    // Print overall summary
    console.log("\n===== TRANSACTION SUMMARY =====");
    console.log(`Total transactions: ${txBatches.length}`);
    console.log(`Total stake accounts: ${validStakeAccounts.length}`);
    console.log(`Successfully processed stake accounts: ${totalSuccessCount}`);
    console.log(`Failed stake accounts: ${totalFailureCount}`);
    

    // Write all results to CSV
    const csvFilename = this.writeResultsToCsv(txResults);
    console.log(`All transaction results written to CSV file: ${csvFilename}`);
  };
}
