import {
  BasePath,
  CreateTransactionResponse,
  Fireblocks,
  TransactionOperation,
  TransactionResponse,
  TransactionStateEnum,
  TransferPeerPathType,
} from "@fireblocks/ts-sdk";
import * as fs from "fs";



export class FireblocksSigner {
  private fireblocks: Fireblocks;
  private apiKey: string;
  private apiSecretPath: string;
  private baseApiPath: string;

  constructor() {
    this.apiKey = process.env.FIREBLOCKS_API_KEY || "";
    this.apiSecretPath = process.env.FIREBLOCKS_API_SECRET_PATH || "";
    this.baseApiPath = process.env.FIREBLOCKS_BASE_API_PATH || BasePath.US;

    this.fireblocks = new Fireblocks({
      apiKey: this.apiKey,
      secretKey: fs.readFileSync(this.apiSecretPath, "utf8"),
      basePath: this.baseApiPath ? this.baseApiPath : BasePath.US,
    });
  }

  
  private waitForSignature = async (
    tx: CreateTransactionResponse,
    pollingInterval?: number
  ): Promise<TransactionResponse | undefined> => {
    try {
      if (!tx.id) {
        throw new Error("Transaction ID is undefined");
      }

      let txResponse = await this.fireblocks.transactions.getTransaction({
        txId: tx.id,
      });
      let lastStatus = txResponse.data.status;

      console.log(
        `Transaction ${txResponse.data.id} is currently at status - ${txResponse.data.status}`
      );

      while (
        txResponse.data.status !== TransactionStateEnum.Completed &&
        txResponse.data.status !== TransactionStateEnum.Broadcasting
      ) {
        await new Promise((resolve) =>
          setTimeout(resolve, pollingInterval || 2000)
        );

        txResponse = await this.fireblocks.transactions.getTransaction({
          txId: tx.id,
        });

        if (txResponse.data.status !== lastStatus) {
          console.log(
            `Transaction ${txResponse.data.id} is currently at status - ${txResponse.data.status}`
          );
          lastStatus = txResponse.data.status;
        }

        switch (txResponse.data.status) {
          case TransactionStateEnum.Blocked:
          case TransactionStateEnum.Cancelled:
          case TransactionStateEnum.Failed:
          case TransactionStateEnum.Rejected:
            throw new Error(
              `Signing request failed/blocked/cancelled: Transaction: ${txResponse.data.id} status is ${txResponse.data.status}\nSub-Status: ${txResponse.data.subStatus}`
            );
          default:
            break;
        }
      }

      return txResponse.data;
    } catch (e) {
      console.error("Error waiting for signature", e);
    }
  };
  
  public getAddressForVault = async (
    vaultAccountId: string
  ): Promise<string | undefined> => {
    try {
      const address =
        await this.fireblocks.vaults.getVaultAccountAssetAddressesPaginated({
          vaultAccountId,
          assetId: "SOL",
        });

      if (!address.data.addresses || address.data.addresses.length === 0) {
        throw new Error(
          `No addresses found for vault account ${vaultAccountId}`
        );
      }
      return address.data.addresses![0].address as string;
    } catch (e) {
      console.error("Error getting address for vault", e);
    }
  };

  public signTransaction = async (
    dataToSign: { content: string }[],
    vaultAccountId: string,
    newAuthorityAddress: string,
    newAuthorityVaultId: string
  ): Promise<TransactionResponse> => {
    try {
      const tx = await this.fireblocks.transactions.createTransaction({
        transactionRequest: {
          assetId: "SOL",
          operation: TransactionOperation.Raw,
          source: {
            type: TransferPeerPathType.VaultAccount,
            id: vaultAccountId,
          },
          extraParameters: {
            rawMessageData: {
              messages: [...dataToSign],
            },
          },
          note: `Changing authority for Solana Stake account. New authority VA is ${newAuthorityVaultId} and new authority address is ${newAuthorityAddress}`
        },
      });

      console.log("Transaction created", tx.data.id);
      const txResponse = await this.waitForSignature(tx.data);
      if (!txResponse || !txResponse.signedMessages) {
        throw new Error("Transaction response is undefined");
      }
      return txResponse;
    } catch (e) {
      console.error("Error signing transaction", e);
      throw e; 
    }
  };
}
