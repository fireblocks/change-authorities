# Solana Stake Authority Changer

A tool for securely changing stake account authorities on the Solana blockchain using Fireblocks RAW Signing feature.
[Learn more about Stake Accounts Authorities](https://solana.com/docs/references/staking/stake-accounts#understanding-account-authorities).

## Overview

This tool automates the process of the following operations:

- **Batch Authority Changes**: Transferring authority (both staker and withdrawer) on Solana stake accounts.
- **Withdraw Funds**: Withdrawing the entire balance of an inactive stake account to the current authority address.


## Prerequisites

- Node.js 18+
- TypeScript
- Fireblocks account with API credentials
- Solscan API Key
- Two Fireblocks Vault accounts (existing authority and new authority)

Fireblocks Workspace Configuration:
1. Make sure that RAW signing is enabled in your workspace
2. [Create an API key](https://developers.fireblocks.com/docs/manage-api-keys)
3. [Create a Transaction Authorization Policy Rule for RAW signing](https://developers.fireblocks.com/docs/set-transaction-authorization-policy)


## Installation

1. Clone the repository:
```bash
git clone https://github.com/fireblocks/change-authorities.git
cd change-authorities
```

Install dependencies:

```bash
npm install -g typescript
npm install
```


## Usage

### Changing the Authorities on your stake account

Create a `.env` file with the following variables:

```bash
FIREBLOCKS_API_KEY=your_fireblocks_api_key
FIREBLOCKS_API_SECRET_PATH=/path/to/your/fireblocks_secret.key
SOLSCAN_API_KEY='solscan API key'
CURRENT_AUTHORITY_VAULT_ID='<your existing authority vault account ID>'
NEW_AUTHORITY_VAULT_ID='<your new authority vault account ID>'
OPERATION='change-authority'
```


### Withdrawing funds from an inactive stake account

Create a `.env` file with the following variables:

```bash
FIREBLOCKS_API_KEY=your_fireblocks_api_key
FIREBLOCKS_API_SECRET_PATH=/path/to/your/fireblocks_secret.key
SOLSCAN_API_KEY='solscan API key'
CURRENT_AUTHORITY_VAULT_ID='<your existing authority vault account ID>'
OPERATION='withdraw'
```


## Usage
Run the tool:

```bash
ts-node main.ts
```

