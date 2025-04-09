import { FireblocksSigner } from "./fireblocksSigner";
import { solanaBeachService } from "./service/solanaBeachService";
import { SolanaSerializer, web3 } from "./solanaSerializer";

export class SolanaAuthorityOrchestrator {
  private currentAuthorityVaultId: string;
  private newAuthorityVaultId: string;
  private fireblocksSigner: FireblocksSigner;
  private solanaSerializer: SolanaSerializer;

  constructor(
    currentAuthorityVaultId: string,
    newAuthorityVaultId: string
  ) {
    // Validate constructor parameters
    if (!currentAuthorityVaultId) {
      throw new Error("Current authority vault ID is required");
    }
    
    if (!newAuthorityVaultId) {
      throw new Error("New authority vault ID is required");
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
      'FIREBLOCKS_API_KEY',
      'FIREBLOCKS_API_SECRET_PATH',
      'SOLANA_BEACH_API_KEY'
    ];
    
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }
    
    // Validate API secret path file exists
    const apiSecretPath = process.env.FIREBLOCKS_API_SECRET_PATH || '';
    try {
      const fs = require('fs');
      if (!fs.existsSync(apiSecretPath)) {
        throw new Error(`Fireblocks API secret file not found at path: ${apiSecretPath}`);
      }
    } catch (error) {
      throw new Error(`Error checking Fireblocks API secret file: ${error.message}`);
    }
  }

  public changeAuthorities = async (): Promise<void> => {
    // Initialize an array to hold transaction data for all stake accounts
    const txDataMap: Map<string, { 
      serializedTransaction: string, 
      stakeAccountPubKey: web3.PublicKey,
      transaction: web3.Transaction 
    }> = new Map();

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

    const existingAuthorityPubKey = new web3.PublicKey(existingAuthorityAddress);
    const newAuthorityPubKey = new web3.PublicKey(newAuthorityAddress);

    // Fetch stake accounts
    console.log(`Fetching stake accounts for address: ${existingAuthorityAddress}`);
    const stakeAccounts = (await solanaBeachService.getStakeAccountsForAddress(
      existingAuthorityAddress
    ));
    
    // Validate stake accounts exist
    if(!stakeAccounts || stakeAccounts.length === 0) {
      throw new Error(`No stake accounts found for address: ${existingAuthorityAddress}`);  
    }
    console.log(`Found ${stakeAccounts.length} stake accounts for authority: ${existingAuthorityAddress}`);

    // Build all transactions first
    console.log(`Building transactions for ${stakeAccounts.length} stake accounts...`);
    for (const stakeAccount of stakeAccounts) {
      try {
        if (!stakeAccount.pubkey || !stakeAccount.pubkey.address) {
          console.warn("Skipping invalid stake account without pubkey address");
          continue;
        }
        
        console.log('Processing stake account:', stakeAccount.pubkey.address);
        const stakeAccountPubKey = new web3.PublicKey(stakeAccount.pubkey.address);
        
        // Build the transaction
        const { transaction, serializedTransaction } = await this.solanaSerializer.buildChangeAuthoritiesTx({
          stakeAccount: stakeAccountPubKey,
          currentAuthorized: existingAuthorityPubKey,
          newAuthorized: newAuthorityPubKey,
        });

        // Store in our map using the serialized transaction as the key
        txDataMap.set(serializedTransaction, {
          serializedTransaction,
          stakeAccountPubKey,
          transaction
        });
      } catch (error) {
        console.error(`Error building transaction for stake account ${stakeAccount.pubkey?.address}:`, error);
        throw error;
      }
    }

    // Validate we have transactions to sign
    if (txDataMap.size === 0) {
      throw new Error("No valid transactions were created for signing");
    }

    // Prepare all transactions for batch signing
    const messagesForSigning = Array.from(txDataMap.keys()).map(serializedTx => ({
      content: serializedTx
    }));

    try {
      // Send all transactions to Fireblocks in a single batch
      console.log(`Sending ${messagesForSigning.length} transactions to Fireblocks for signing...`);
      const signatureResponse = await this.fireblocksSigner.signTransaction(
        messagesForSigning,
        this.currentAuthorityVaultId,
        newAuthorityAddress,
        this.newAuthorityVaultId
      );

      // Validate signature response
      if (!signatureResponse.signedMessages || signatureResponse.signedMessages.length === 0) {
        throw new Error('No signed messages returned from Fireblocks');
      }

      if (signatureResponse.signedMessages.length !== messagesForSigning.length) {
        console.warn(`Warning: Received ${signatureResponse.signedMessages.length} signatures but sent ${messagesForSigning.length} transactions`);
      }

      console.log(`Received ${signatureResponse.signedMessages.length} signed messages from Fireblocks`);

      // Process and send each transaction with its matching signature
      let successCount = 0;
      let failureCount = 0;
      
      // Create an array to store results
      const results: { status: 'fulfilled' | 'rejected'; reason?: string; value?: string }[] = [];
      
      // Process transactions sequentially to avoid Promise.allSettled
      for (const signedMessage of signatureResponse.signedMessages) {
        try {
          // Match the signature with the corresponding transaction data using content
          const txContent = signedMessage.content;
          if (!txContent) {
            console.error("Transaction content is undefined in signed message.");
            failureCount++;
            results.push({ status: 'rejected', reason: 'Missing content' });
            continue;
          }
          
          const txData = txDataMap.get(txContent);
          if (!txData) {
            console.error(`Could not find matching transaction data for content: ${txContent.substring(0, 20)}...`);
            failureCount++;
            results.push({ status: 'rejected', reason: 'No matching transaction data' });
            continue;
          }

          const { serializedTransaction, stakeAccountPubKey } = txData;
          const signatureHex = signedMessage.signature?.fullSig;

          if (!signatureHex) {
            console.error(`Missing signature for stake account: ${stakeAccountPubKey.toString()}`);
            failureCount++;
            results.push({ status: 'rejected', reason: 'Missing signature' });
            continue;
          }

          // Send the signed transaction
          const txId = await this.solanaSerializer.sendSignedTransaction(
            serializedTransaction,
            signatureHex,
            existingAuthorityPubKey
          );

          console.log(`Transaction sent successfully: ${txId} for stake account: ${stakeAccountPubKey.toString()}`);
          successCount++;
          results.push({ status: 'fulfilled', value: txId });
        } catch (error: any) {
          failureCount++;
          console.error(`Error sending transaction:`, error);
          
          if (error.logs) {
            console.error("Transaction logs:", error.logs);
          }
          
          results.push({ status: 'rejected', reason: error });
        }
      }
      
      // Print summary
      console.log("\n===== TRANSACTION SUMMARY =====");
      console.log(`Total transactions: ${messagesForSigning.length}`);
      console.log(`Successful: ${successCount}`);
      console.log(`Failed: ${failureCount}`);
      
      const fulfilledCount = results.filter(r => r.status === 'fulfilled').length;
      const rejectedCount = results.filter(r => r.status === 'rejected').length;
      
      if (failureCount > 0 || rejectedCount > 0) {
        console.warn(`Warning: ${failureCount} transactions failed to process correctly`);
      } else {
        console.log("All transactions processed successfully");

      }
    } catch (error) {
      console.error("Error during transaction signing or sending:", error);
      throw error;
    }
  };
}
