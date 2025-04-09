import axios from "axios";
require("dotenv").config();

type StakeAccountsResponse = {
  pubkey: {
    address: string;
  };
  lamports: number;
  data: {};
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
      const response = await this.rateLimitedRequest(() => 
        axios.get(`${this.url}/account/${address}/stakes`, {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.SOLANA_BEACH_API_KEY}`,
          },
        })
      );

      return response.data.data;
    } catch (error) {
      console.error("Error fetching stake accounts:", error);
      throw error;
    }
  };
}

export const solanaBeachService = new SolanaBeachService();
