import { FireblocksSigner } from "./fireblocksSigner";
import { solscanService } from "./service/solscanService";
import { SolanaSerializer, web3 } from "./solanaSerializer";
import { processBatchedTransactions, writeChangeAuthorityResultsToCsv, writeResultsToWithdrawalCsv } from "./utils";

export class SolanaAuthorityOrchestrator {
  private currentAuthorityVaultId: string;
  private newAuthorityVaultId: string;
  private fireblocksSigner: FireblocksSigner;
  private solanaSerializer: SolanaSerializer;
  private readonly MAX_ACCOUNTS_PER_AUTHORITY_TX = 6;
  private readonly MAX_ACCOUNTS_PER_WITHDRAW_TX = 4;

  constructor(currentAuthorityVaultId: string, newAuthorityVaultId: string) {
    if (!currentAuthorityVaultId && process.env.OPERATION.toLowerCase() == "withdraw") {
      throw new Error("Current authority vault ID is required");
    }

    if (!newAuthorityVaultId && process.env.OPERATION.toLowerCase() == "change-authority") {
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
  

  public changeAuthorities = async (): Promise<void> => {
    console.log("Starting batch authority change process...");
    console.log(`Current Authority Vault ID: ${this.currentAuthorityVaultId}`);
    console.log(`New Authority Vault ID: ${this.newAuthorityVaultId}`);

    if (parseInt(this.currentAuthorityVaultId) > parseInt(this.newAuthorityVaultId)) {
      throw new Error("New authority vault account has to be a newer account than the current authority vault account");
    }

    if (parseInt(this.currentAuthorityVaultId) === parseInt(this.newAuthorityVaultId)) {
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

    // Process authority changes in batches
    const { results } = await processBatchedTransactions(
      validStakeAccounts,
      this.MAX_ACCOUNTS_PER_AUTHORITY_TX,
      async (batch) => {
        
        const pubkeys = batch.map(account => new web3.PublicKey(account.pubkey.address));
        
        // Build transaction for authority changes
        console.log(`Building transaction for ${batch.length} accounts...`);
        const { serializedTransaction } = 
          await this.solanaSerializer.buildBatchChangeAuthoritiesTx(
            pubkeys,
            existingAuthorityPubKey,
            newAuthorityPubKey
          );

        // Send transaction to Fireblocks for signing
        console.log(`Sending transaction to Fireblocks for signing...`);
        const signatureResponse = await this.fireblocksSigner.signTransaction(
          [{ content: serializedTransaction }],
          this.currentAuthorityVaultId,
          "changeAuthority",
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

        return {
          txHash: txId,
          status: "Success"
        };
      },
      (account) => account.pubkey.address
    );

    // Transform results for CSV
    const txResults = results.map(result => ({
      stakeAccounts: result.items,
      currentAuthority: existingAuthorityAddress,
      newAuthority: newAuthorityAddress,
      txHash: result.txHash,
      status: result.status,
      errorMessage: result.errorMessage,
      timestamp: result.timestamp
    }));

    // Write all results to CSV
    const csvFilename = writeChangeAuthorityResultsToCsv(txResults);
    console.log(`All transaction results written to CSV file: ${csvFilename}`);
  };

  public withdrawFromInactiveAccounts = async (): Promise<void> => {
    console.log("Starting withdrawal from inactive stake accounts process...");
    console.log(`Authority Vault ID: ${this.currentAuthorityVaultId}`);

    
    console.log("Fetching authority address...");
    const authorityAddress = await this.fireblocksSigner.getAddressForVault(
      this.currentAuthorityVaultId
    );

    
    if (!authorityAddress) {
      throw new Error(
        `No authority found for vault ID: ${this.currentAuthorityVaultId}`
      );
    }
    console.log(`Authority address: ${authorityAddress}`);

    const authorityPubKey = new web3.PublicKey(authorityAddress);

    // Fetch stake accounts
    console.log(`Fetching stake accounts for address: ${authorityAddress}`);
    const stakeAccounts = await solscanService.getStakeAccountsForAddress(
      authorityAddress
    );

    if (!stakeAccounts || stakeAccounts.length === 0) {
      throw new Error(
        `No stake accounts found for address: ${authorityAddress}`
      );
    }
    console.log(
      `Found ${stakeAccounts.length} stake accounts for authority: ${authorityAddress}`
    );

    // Filter inactive accounts
    const inactiveAccounts = stakeAccounts.filter(
      (account) => account.status === "inactive"
    );
    console.log(
      `Found ${inactiveAccounts.length} inactive stake accounts out of ${stakeAccounts.length} total accounts`
    );

    if (inactiveAccounts.length === 0) {
      console.log("No inactive accounts found to withdraw from");
      return;
    }

    // Process withdrawals in batches
    const { results } = await processBatchedTransactions(
      inactiveAccounts,
      this.MAX_ACCOUNTS_PER_WITHDRAW_TX,
      async (batch) => {
        
        console.log(
          `Building transaction for withdrawing from ${batch.length} inactive accounts...`
        );
        const { serializedTransaction } =
          await this.solanaSerializer.buildInactiveAccountsWithdrawTx(
            batch,
            authorityPubKey
          );

        // Send transaction to Fireblocks for signing
        console.log(`Sending withdrawal transaction to Fireblocks for signing...`);
        const signatureResponse = await this.fireblocksSigner.signTransaction(
          [{ content: serializedTransaction }],
          this.currentAuthorityVaultId,
          "withdraw",
          authorityAddress
        );

        // Validate signature response
        if (
          !signatureResponse.signedMessages ||
          signatureResponse.signedMessages.length === 0
        ) {
          throw new Error("No signed messages returned from Fireblocks");
        }

        const signedMessage = signatureResponse.signedMessages[0];
        const signatureHex = signedMessage.signature?.fullSig;

        if (!signatureHex) {
          throw new Error("Missing signature from Fireblocks");
        }

        // Send the signed transaction
        console.log(`Sending signed withdrawal transaction to Solana network...`);
        const txId = await this.solanaSerializer.sendSignedTransaction(
          serializedTransaction,
          signatureHex,
          authorityPubKey
        );

        return {
          txHash: txId,
          status: "Success",
        };
      },
      (account) => account.pubkey.address
    );

    // Transform results for CSV
    const txResults = results.map((result) => ({
      stakeAccounts: result.items,
      authority: authorityAddress,
      txHash: result.txHash,
      status: result.status,
      errorMessage: result.errorMessage,
      timestamp: result.timestamp,
    }));

    // Write results to CSV
    const csvFilename = writeResultsToWithdrawalCsv(txResults);
    console.log(`Withdrawal transaction results written to CSV file: ${csvFilename}`);
  };


}
