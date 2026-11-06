import { expect } from 'chai';
import request from 'supertest';
import { app } from '../src/gateway/server';
import crypto from 'crypto';
import { PublicKey, Keypair } from '@solana/web3.js';

describe('=== Solana x402 Protocol & Video Gateway Suite ===', () => {
  const PROGRAM_ID = new PublicKey('X402pAYwa1111111111111111111111111111111111');
  const MOCK_MERCHANT = Keypair.generate().publicKey;

  it('1. Returns HTTP 402 with full challenge headers when request lacks authorization', async () => {
    const res = await request(app).get('/api/v1/video/x402-feature');

    expect(res.status).to.equal(402);
    expect(res.headers).to.have.property('www-authenticate');
    expect(res.headers['www-authenticate']).to.include('x402');
    expect(res.headers).to.have.property('x402-recipient');
    expect(res.headers).to.have.property('x402-amount-lamports');
    expect(res.headers).to.have.property('x402-nonce');
    expect(res.headers['x402-nonce']).to.have.lengthOf(64); // 32 bytes hex
    expect(res.body.challenge).to.be.an('object');
  });

  it('2. Denies access with HTTP 400 when Authorization header is malformed', async () => {
    const res = await request(app)
      .get('/api/v1/video/x402-feature')
      .set('Authorization', 'x402 INVALID_TOKEN_FORMAT');

    expect(res.status).to.equal(400);
    expect(res.body.error).to.include('Malformed');
  });

  it('3. Denies access with HTTP 403 when challenge nonce is unrecognized or forged', async () => {
    const forgedNonce = crypto.randomBytes(32).toString('hex');
    const fakeSignature = '5fakeSig11111111111111111111111111111111111111111111111';

    const res = await request(app)
      .get('/api/v1/video/x402-feature')
      .set('Authorization', `x402 ${fakeSignature}:${forgedNonce}`);

    expect(res.status).to.equal(403);
    expect(res.body.error).to.include('expired or nonexistent');
  });

  it('4. Correctly derives deterministic Nonce PDA for replay guard', () => {
    const nonce = crypto.randomBytes(32);
    const [merchantPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('merchant'), MOCK_MERCHANT.toBuffer()],
      PROGRAM_ID
    );

    const [receiptPda, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from('x402_receipt'), merchantPda.toBuffer(), nonce],
      PROGRAM_ID
    );

    expect(receiptPda).to.be.instanceOf(PublicKey);
    expect(bump).to.be.a('number');
  });

  it('5. Healthcheck endpoint returns HTTP 200 and online status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).to.equal(200);
    expect(res.body.status).to.equal('ONLINE');
    expect(res.body.subsystem).to.equal('x402-gateway');
  });
});