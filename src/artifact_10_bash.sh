# 1. Clone repository and install dependencies
git clone https://github.com/sponsor-org/solana-x402-suite.git
cd solana-x402-suite
npm install

# 2. Build Solana Anchor Program
anchor build

# 3. Deploy to Solana Devnet
solana config set --url https://api.devnet.solana.com
solana airdrop 2
anchor deploy --provider.cluster devnet

# 4. Initialize Merchant Profile on Devnet
ts-node scripts/init-merchant.ts \
  --base-rate 5000000 \
  --name "Official x402 Video Portal"

# 5. Launch Enterprise Gateway & CLI Test Client
npm run start:gateway
# In a separate terminal:
npm run client:pay-and-stream