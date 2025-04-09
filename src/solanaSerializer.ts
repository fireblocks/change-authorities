import * as web3 from "@solana/web3.js";
export { web3 };
import { FireblocksSigner } from "./fireblocksSigner";

type ChangeAuthoritiesParams = {
  stakeAccount: web3.PublicKey;
  currentAuthorized: web3.PublicKey;
  newAuthorized: web3.PublicKey;
};

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

  public async buildChangeAuthoritiesTx(
    params: ChangeAuthoritiesParams
  ): Promise<ChangeAuthoritiesTxResult> {
    const tx = new web3.Transaction();

    tx.add(web3.StakeProgram.authorize({
      stakePubkey: params.stakeAccount,
      newAuthorizedPubkey: params.newAuthorized,
      authorizedPubkey: params.currentAuthorized,
      stakeAuthorizationType: web3.StakeAuthorizationLayout.Staker,
    }))
    .add(web3.StakeProgram.authorize({
      stakePubkey: params.stakeAccount, 
      newAuthorizedPubkey: params.newAuthorized, 
      authorizedPubkey: params.currentAuthorized, 
      stakeAuthorizationType: web3.StakeAuthorizationLayout.Withdrawer,
    }));

    tx.feePayer = params.currentAuthorized;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
    
  
    return {
      transaction: tx,
      serializedTransaction: tx.serializeMessage().toString("hex")
    };
  }

  public sendRawTx = async (rawTx: Buffer): Promise<string> => {
    const signature = await this.connection.sendRawTransaction(rawTx, {
      skipPreflight: false,
      preflightCommitment: 'confirmed'
    });
    return signature;
  }

  public async sendSignedTransaction(
    serializedMessage: string,
    signatureHex: string,
    signerPubKey: web3.PublicKey
  ): Promise<string> {
    // Recreate the transaction from the serialized message
    const messageBytes = Buffer.from(serializedMessage, 'hex');
    const message = web3.Message.from(messageBytes);
    const transaction = web3.Transaction.populate(message);
    
    // Add the signature
    const signatureBuffer = Buffer.from(signatureHex, 'hex');
    transaction.addSignature(signerPubKey, signatureBuffer);
    
    // Verify the signature is valid
    if (!transaction.verifySignatures()) {
      throw new Error('Transaction signature verification failed');
    }
    
    // Send the signed transaction
    const signature = await this.connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed'
    });
    
    return signature;
  }
}

