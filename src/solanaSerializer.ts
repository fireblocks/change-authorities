import * as web3 from "@solana/web3.js";
export { web3 };


type ChangeAuthoritiesTxResult = {
  transaction: web3.Transaction;
  serializedTransaction: string;
};


export class SolanaSerializer {
  private connection: web3.Connection;
  
  constructor() {
    this.connection = new web3.Connection(web3.clusterApiUrl("mainnet-beta"))
  }

  public getConnection(): web3.Connection {
    return this.connection;
  }


  public async buildBatchChangeAuthoritiesTx(
    stakeAccounts: web3.PublicKey[],
    currentAuthorized: web3.PublicKey,
    newAuthorized: web3.PublicKey
  ): Promise<ChangeAuthoritiesTxResult> {
    
    const tx = new web3.Transaction();
    
    const recentBlockhash = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = recentBlockhash.blockhash;
    tx.feePayer = currentAuthorized;
    
    console.log(`Using blockhash: ${recentBlockhash.blockhash} for all instructions`);
    
    
    // Add instructions for each stake account
    for (const stakeAccount of stakeAccounts) {
      tx.add(web3.StakeProgram.authorize({
        stakePubkey: stakeAccount,
        authorizedPubkey: currentAuthorized,
        newAuthorizedPubkey: newAuthorized,
        stakeAuthorizationType: web3.StakeAuthorizationLayout.Staker,
      }));
      
      tx.add(web3.StakeProgram.authorize({
        stakePubkey: stakeAccount,
        authorizedPubkey: currentAuthorized, 
        newAuthorizedPubkey: newAuthorized,
        stakeAuthorizationType: web3.StakeAuthorizationLayout.Withdrawer,
      }));
    }
    
    const serializedTx = tx.serializeMessage();
    
    console.log(`Transaction size: ${serializedTx.length} bytes (max: 1232 bytes)`);
    
    return {
      transaction: tx,
      serializedTransaction: serializedTx.toString("hex")
    };
  }


  public async sendSignedTransaction(
    serializedMessage: string,
    signatureHex: string,
    signerPubKey: web3.PublicKey
  ): Promise<string> {
    
    const messageBytes = Buffer.from(serializedMessage, 'hex');
    const message = web3.Message.from(messageBytes);
    const transaction = web3.Transaction.populate(message);
    
    
    const signatureBuffer = Buffer.from(signatureHex, 'hex');
    transaction.addSignature(signerPubKey, signatureBuffer);
    
    
    if (!transaction.verifySignatures()) {
      throw new Error('Transaction signature verification failed');
    }
    
    
    const signature = await this.connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed'
    });
    
    return signature;
  }
}

