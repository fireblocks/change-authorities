import axios from "axios";
require("dotenv").config();

type StakeAccountsResponse = {
  pubkey: {
    address: string;
  };
  lamports: number;
  data: {};
};

type PaginatedResponse = {
  totalPages: number;
  data: StakeAccountsResponse[];
};

class SolanaBeachService {
  private readonly url = "https://api.solanabeach.io/v1";
  private requestQueue: (() => void)[] = [];
  private processing = false;
  private readonly requestInterval = 100;
  
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
      // Get first page and check total pages
      const firstPageResponse = await this.rateLimitedRequest(() => 
        axios.get<PaginatedResponse>(`${this.url}/account/${address}/stakes`, {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.SOLANA_BEACH_API_KEY}`,
          },
          params: {
            page: 1
          }
        })
      );

      if (firstPageResponse.status !== 200) {
        throw new Error(`Error fetching stake accounts: ${firstPageResponse.statusText}`);
      }

      const totalPages = firstPageResponse.data.totalPages;
      let allStakeAccounts = [...firstPageResponse.data.data];

      console.log(`Found ${totalPages} total pages of stake accounts for ${address}`);
      
      // Fetch remaining pages if there are any
      if (totalPages > 1) {
        // Create an array of page numbers from 2 to totalPages
        const remainingPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
        
        // We'll fetch pages sequentially to respect rate limits
        for (const pageNum of remainingPages) {
          console.log(`Fetching page ${pageNum} of ${totalPages}...`);
          
          const pageResponse = await this.rateLimitedRequest(() => 
            axios.get<PaginatedResponse>(`${this.url}/account/${address}/stakes`, {
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.SOLANA_BEACH_API_KEY}`,
              },
              params: {
                page: pageNum
              }
            })
          );
          
          allStakeAccounts = [...allStakeAccounts, ...pageResponse.data.data];
        }
      }
      
      console.log(`Total stake accounts fetched: ${allStakeAccounts.length}`);
      return allStakeAccounts;
    } catch (error) {
      console.error("Error fetching stake accounts:", error);
      throw error;
    }
  };
}

export const solanaBeachService = new SolanaBeachService();
