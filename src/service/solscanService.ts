import axios from "axios";
require("dotenv").config();

type StakeAccountsResponse = {
  pubkey: {
    address: string;
  };
  lamports: number;
  data: {};
  status: string;
  delegated_stake_amount: number;
  total_reward: number;
  sol_balance: number;
};

interface SolscanResponse {
  success: boolean;
  data: {
    stake_account: string;
    sol_balance: number;
    status: string;
    role: string[];
    total_reward: string,
    delegated_stake_amount: string,
  }[];
  metadata: any;
}

class SolscanService {
  private readonly url = "https://pro-api.solscan.io/v2.0/account/stake";
  private readonly pageSize = 40;
  private requestQueue: (() => void)[] = [];
  private processing = false;
  private readonly requestInterval = 200;
  
  constructor() {}

  private async processQueue() {
    if (this.processing || this.requestQueue.length === 0) return;
    
    this.processing = true;
    
    while (this.requestQueue.length > 0) {
      const request = this.requestQueue.shift();
      if (request) request();
    
      await new Promise(resolve => setTimeout(resolve, this.requestInterval));
    }
    
    this.processing = false;
  }

  private async rateLimitedRequest<T>(request: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.requestQueue.push(() => {
        request()
          .then(resolve)
          .catch(reject);
      });
      this.processQueue();
    });
  }

  public getStakeAccountsForAddress = async (
    address: string
  ): Promise<StakeAccountsResponse[]> => {
    try {
      let allStakeAccounts: StakeAccountsResponse[] = [];
      let currentPage = 1;
      let hasMoreData = true;
      
      console.log(`Fetching stake accounts for ${address} from Solscan API...`);
      
      // Loop through pages until no more data is returned
      while (hasMoreData) {
        console.log(`Fetching page ${currentPage}...`);
        
        const response = await this.rateLimitedRequest(() => 
          axios.get<SolscanResponse>(this.url, {
            headers: {
              "Content-Type": "application/json",
              "token": process.env.SOLSCAN_API_KEY || "",
            },
            params: {
              address: address,
              page_size: this.pageSize,
              page: currentPage
            }
          })
        );

        if (!response.data.success) {
          throw new Error(`Solscan API error: ${JSON.stringify(response.data)}`);
        }

        // Check if we got data back
        if (response.data.data && response.data.data.length > 0) {
          console.log(`Received ${response.data.data.length} stake accounts from page ${currentPage}`);
          
          // Transform and keep all relevant data from Solscan response
          const transformedData: StakeAccountsResponse[] = response.data.data.map(account => ({
            pubkey: {
              address: account.stake_account
            },
            lamports: account.sol_balance,
            data: {},
            
            status: account.status ? account.status.toLowerCase() : "",
            delegated_stake_amount: parseFloat(account.delegated_stake_amount || "0"),
            total_reward: parseFloat(account.total_reward || "0"),
            sol_balance: account.sol_balance
          }));
          
          allStakeAccounts = [...allStakeAccounts, ...transformedData];
          currentPage++;
        } else {
          // No more data
          hasMoreData = false;
        }
      }
      
      console.log(`Total stake accounts fetched from Solscan: ${allStakeAccounts.length}`);
      return allStakeAccounts;
    } catch (error) {
      console.error("Error fetching stake accounts from Solscan:", error);
      throw error;
    }
  };
}

export const solscanService = new SolscanService();