import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { generateX402ExplainerVideo } from '../video/render';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'http://127.0.0.1:8899';
const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID || 'X402pAYwa1111111111111111111111111111111111'
);

const MERCHANT_VAULT = new PublicKey(
  process.env.MERCHANT_VAULT || '4nd123456789ABCDEF123456789ABCDEF123456789A'
);
const MERCHANT_AUTHORITY = new PublicKey(
  process.env.MERCHANT_AUTHORITY || '6Lk123456789ABCDEF123456789ABCDEF123456789A'
);

const REQUIRED_LAMPORTS = 5_000_000; // 0.005 SOL for HD Video Explainer
const ACTIVE_NONCES = new Map<string, { resourceId: string; expiresAt: number }>();

// -----------------------------------------------------------------------------
// ENTERPRISE NOTIFICATION DISPATCHER
// -----------------------------------------------------------------------------
async function dispatchEnterpriseNotification(receiptData: {
  txSignature: string;
  payer: string;
  amountLamports: number;
  resourceId: string;
}) {
  const webhookUrl = process.env.ENTERPRISE_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log('[Webhook] ENTERPRISE_WEBHOOK_URL not configured. Skipping alert.');
    return;
  }

  const payload = {
    event: 'x402_PAYMENT_SETTLED',
    timestamp: new Date().toISOString(),
    network: 'solana-cluster',
    details: {
      transactionSignature: receiptData.txSignature,
      payerAddress: receiptData.payer,
      amountSol: (receiptData.amountLamports / 1e9).toFixed(6),
      resourceAccessed: receiptData.resourceId,
      status: 'FINALIZED',
    },
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    console.log(`[Webhook] Dispatched settlement notification to enterprise bus. Status: ${res.status}`);
  } catch (err: any) {
    console.error(`[Webhook Error] Failed to publish settlement notice: ${err.message}`);
  }
}

// -----------------------------------------------------------------------------
// x402 MIDDLEWARE GATEWAY
// -----------------------------------------------------------------------------
async function x402PaywallMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers['authorization'];
  const resourceId = 'video-x402-v1';

  if (!authHeader || !authHeader.startsWith('x402 ')) {
    const challengeNonce = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 mins validity
    ACTIVE_NONCES.set(challengeNonce, { resourceId, expiresAt });

    res.status(402);
    res.setHeader('WWW-Authenticate', 'x402 realm="Solana High Performance Paywall"');
    res.setHeader('x402-recipient', MERCHANT_VAULT.toBase58());
    res.setHeader('x402-amount-lamports', REQUIRED_LAMPORTS.toString());
    res.setHeader('x402-nonce', challengeNonce);
    res.setHeader('x402-program-id', PROGRAM_ID.toBase58());
    res.json({
      statusCode: 402,
      error: 'Payment Required',
      message: 'Access to the x402 Explainer Feature Video requires on-chain settlement.',
      challenge: {
        recipientVault: MERCHANT_VAULT.toBase58(),
        requiredLamports: REQUIRED_LAMPORTS,
        nonceHex: challengeNonce,
        programId: PROGRAM_ID.toBase58(),
        expiresAt: new Date(expiresAt).toISOString(),
      },
    });
    return;
  }

  // Parse: "Authorization: x402 <txSignature>:<nonceHex>"
  const credentials = authHeader.substring(5).trim();
  const [txSignature, nonceHex] = credentials.split(':');

  if (!txSignature || !nonceHex) {
    res.status(400).json({ error: 'Malformed x402 authorization credentials' });
    return;
  }

  const nonceRecord = ACTIVE_NONCES.get(nonceHex);
  if (!nonceRecord || nonceRecord.expiresAt < Date.now()) {
    res.status(403).json({ error: 'Nonce challenge expired or nonexistent' });
    return;
  }

  try {
    // Derive expected Payment Receipt PDA
    const nonceBuffer = Buffer.from(nonceHex, 'hex');
    const [merchantPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('merchant'), MERCHANT_AUTHORITY.toBuffer()],
      PROGRAM_ID
    );

    const [receiptPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('x402_receipt'), merchantPda.toBuffer(), nonceBuffer],
      PROGRAM_ID
    );

    const receiptAccount = await connection.getAccountInfo(receiptPda, 'confirmed');
    if (!receiptAccount) {
      res.status(402).json({
        error: 'Receipt PDA account not found on-chain. Transaction may still be in mempool.',
      });
      return;
    }

    // Mark nonce as spent
    ACTIVE_NONCES.delete(nonceHex);

    await dispatchEnterpriseNotification({
      txSignature,
      payer: 'Verified On-Chain PDA',
      amountLamports: REQUIRED_LAMPORTS,
      resourceId,
    });

    next();
  } catch (err: any) {
    res.status(500).json({ error: `Verification failed: ${err.message}` });
  }
}

// -----------------------------------------------------------------------------
// SECURED ROUTE: GENERATE AND DELIVER x402 EXPLAINER VIDEO
// -----------------------------------------------------------------------------
app.get('/api/v1/video/x402-feature', x402PaywallMiddleware, async (req: Request, res: Response) => {
  try {
    console.log('[VideoCore] Assembling and rendering the x402 feature technical video...');
    const videoBuffer = await generateX402ExplainerVideo();

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename="solana-x402-feature-explainer.mp4"');
    res.setHeader('Content-Length', videoBuffer.length.toString());
    res.send(videoBuffer);
  } catch (error: any) {
    console.error(`[VideoCore Error] ${error.message}`);
    res.status(500).json({ error: 'Failed to generate explainer video.' });
  }
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ONLINE',
    subsystem: 'x402-gateway',
    timestamp: new Date().toISOString(),
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[x402 Engine] Server active on http://0.0.0.0:${PORT}`);
    console.log(`[x402 Engine] Protected Endpoint: GET /api/v1/video/x402-feature`);
  });
}

export { app };