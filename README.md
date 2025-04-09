# Solana Stake Authority Changer

A tool for securely changing stake account authorities on the Solana blockchain using Fireblocks for transaction signing.
[Learn more about Stake Accounts Authorities](https://solana.com/docs/references/staking/stake-accounts#understanding-account-authorities).

## Overview

This tool automates the process of transferring authority (both staker and withdrawer) on Solana stake accounts. It uses Fireblocks as a secure signing service and supports batch processing of multiple stake accounts.

## Features

- **Batch Authority Changes**: Change authorities on multiple stake accounts in a single operation
- **Secure Transaction Signing**: Uses Fireblocks for secure transaction signing

## Prerequisites

- Node.js 18+
- TypeScript
- Fireblocks account with API credentials
- Solana Beach API key
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

Create a `.env` file with the following variables:

```bash
FIREBLOCKS_API_KEY=your_fireblocks_api_key
FIREBLOCKS_API_SECRET_PATH=/path/to/your/fireblocks_secret.key
SOLANA_BEACH_API_KEY=your_solana_beach_api_key
CURRENT_AUTHORITY_VAULT_ID=0
NEW_AUTHORITY_VAULT_ID=1
```

## Usage
Run the tool:

```bash
ts-node main.ts
```

