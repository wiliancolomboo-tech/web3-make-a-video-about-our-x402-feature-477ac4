import { createCanvas } from 'canvas';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import os from 'os';

export async function generateX402ExplainerVideo(): Promise<Buffer> {
  const width = 1280;
  const height = 720;
  const fps = 30;
  const durationSec = 4;
  const totalFrames = fps * durationSec;

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'x402-render-'));

  try {
    // Generate synthetic motion frames explaining x402
    for (let frame = 0; frame < totalFrames; frame++) {
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext('2d');

      const progress = frame / totalFrames;

      // Dark Tech Background
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, '#0a0b10');
      gradient.addColorStop(1, '#13141f');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      // Solana Purple/Green Accents
      ctx.strokeStyle = '#14F195';
      ctx.lineWidth = 4;
      ctx.strokeRect(40, 40, width - 80, height - 80);

      // Title
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 44px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('SOLANA x402 PROTOCOL SPECIFICATION', width / 2, 110);

      ctx.fillStyle = '#9945FF';
      ctx.font = '28px Arial';
      ctx.fillText('Autonomous HTTP 402 Micropayments at 65,000 TPS', width / 2, 160);

      // Render Step Diagrams based on timeline
      const stepIndex = Math.min(3, Math.floor(progress * 4));
      const steps = [
        'Phase 1: Client sends GET -> Intercepted by Gateway with HTTP 402',
        'Phase 2: Gateway returns Nonce PDA Challenge + Payment Spec',
        'Phase 3: Client signs Solana Atomic Transaction & Settles Vault Lamports',
        'Phase 4: Receipt Verified On-Chain -> High-Def Stream Delivered!',
      ];

      for (let i = 0; i < 4; i++) {
        const boxY = 220 + i * 90;
        const isActive = i <= stepIndex;
        ctx.fillStyle = isActive ? '#14F195' : '#2A2E3D';
        ctx.fillRect(100, boxY, 30, 50);

        ctx.fillStyle = isActive ? '#FFFFFF' : '#71788E';
        ctx.font = 'bold 22px Arial';
        ctx.textAlign = 'left';
        ctx.fillText(steps[i], 150, boxY + 32);
      }

      // Live metrics visualizer
      ctx.fillStyle = '#14F195';
      ctx.font = '20px monospace';
      ctx.textAlign = 'right';
      const simulatedBlock = 289401200 + frame;
      ctx.fillText(`SLOT: ${simulatedBlock} | CONFIRMATION: FINALIZED | TPS: 2,840`, width - 70, height - 60);

      const framePath = path.join(tempDir, `frame_${String(frame).padStart(4, '0')}.png`);
      fs.writeFileSync(framePath, canvas.toBuffer('image/png'));
    }

    const outputPath = path.join(tempDir, 'output.mp4');

    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(path.join(tempDir, 'frame_%04d.png'))
        .inputFPS(fps)
        .outputOptions(['-c:v libx264', '-pix_fmt yuv420p', '-movflags +faststart'])
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run();
    });

    const outputBuffer = fs.readFileSync(outputPath);
    return outputBuffer;
  } finally {
    // Cleanup temporary frame cache
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}