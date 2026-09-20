import fs from 'fs';
import path from 'path';

const API_BASE = process.env.API_BASE || 'https://stream.techwithjoshi.in';
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'fluidislive@2026';
const CHUNK_SIZE = 25 * 1024 * 1024; // 25 MB chunks

const filesToUpload = [
  {
    localPath: 'iPhone Dial Pad song guessing challenge #4k [zpJzMCpSwog].mp4',
    customKey: 'iPhone_Dial_Pad_song_guessing_challenge_4k.mp4',
  },
  {
    localPath: 'YTDown.com_YouTube_iPhone-Dial-Pad-song-guessing-challenge-_Media_euJ55EljHas_002_720p.mp4',
    customKey: 'iPhone_Dial_Pad_song_guessing_challenge_720p.mp4',
  }
];

async function uploadFileMultipart(fileConfig) {
  const { localPath, customKey } = fileConfig;
  if (!fs.existsSync(localPath)) {
    console.error(`File not found: ${localPath}`);
    return;
  }

  const stat = fs.statSync(localPath);
  const totalSize = stat.size;
  const totalSizeMB = (totalSize / (1024 * 1024)).toFixed(1);
  console.log(`\n======================================================`);
  console.log(`🚀 Starting Multipart Upload for: ${customKey}`);
  console.log(`Size: ${totalSizeMB} MB (${totalSize} bytes)`);
  console.log(`======================================================`);

  // Step 1: Create Multipart Upload
  console.log(`[1/3] Initializing R2 multipart session...`);
  const createRes = await fetch(`${API_BASE}/api/upload/multipart/create`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${AUTH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filename: path.basename(localPath),
      customKey,
      contentType: 'video/mp4',
    }),
  });

  const createData = await createRes.json();
  if (!createData.success) {
    throw new Error(`Create multipart failed: ${JSON.stringify(createData)}`);
  }

  const { uploadId, key } = createData;
  console.log(`Initialized! UploadId: ${uploadId}`);

  // Step 2: Read & Upload Chunks
  const totalParts = Math.ceil(totalSize / CHUNK_SIZE);
  const parts = [];
  const fd = fs.openSync(localPath, 'r');
  const buffer = Buffer.alloc(CHUNK_SIZE);

  console.log(`[2/3] Uploading ${totalParts} parts (25MB each)...`);
  for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
    const bytesRead = fs.readSync(fd, buffer, 0, CHUNK_SIZE, (partNumber - 1) * CHUNK_SIZE);
    const chunk = buffer.subarray(0, bytesRead);

    const percent = Math.round(((partNumber - 1) / totalParts) * 100);
    process.stdout.write(`\r[Part ${partNumber}/${totalParts}] Uploading ${(bytesRead / (1024 * 1024)).toFixed(1)} MB (${percent}%)...`);

    let retries = 3;
    let partData = null;
    while (retries > 0) {
      try {
        const partRes = await fetch(
          `${API_BASE}/api/upload/multipart/part?uploadId=${encodeURIComponent(uploadId)}&key=${encodeURIComponent(key)}&partNumber=${partNumber}`,
          {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${AUTH_TOKEN}`,
              'Content-Type': 'application/octet-stream',
            },
            body: chunk,
          }
        );

        partData = await partRes.json();
        if (partData.success) break;
        throw new Error(partData.error || 'Unknown part upload error');
      } catch (e) {
        retries--;
        console.warn(`\nRetry part ${partNumber}... (${e.message})`);
        if (retries === 0) throw e;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    parts.push({ partNumber: partData.partNumber, etag: partData.etag });
  }
  fs.closeSync(fd);
  console.log(`\nAll parts uploaded successfully!`);

  // Step 3: Complete Multipart Upload
  console.log(`[3/3] Completing multipart upload in R2...`);
  const completeRes = await fetch(`${API_BASE}/api/upload/multipart/complete`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${AUTH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ uploadId, key, parts }),
  });

  const completeData = await completeRes.json();
  if (!completeData.success) {
    throw new Error(`Complete multipart failed: ${JSON.stringify(completeData)}`);
  }

  console.log(`✅ SUCCESS! Upload complete:`);
  console.log(`Key: ${completeData.key}`);
  console.log(`URL: ${API_BASE}${completeData.url}`);
}

async function main() {
  for (const fileConfig of filesToUpload) {
    await uploadFileMultipart(fileConfig);
  }
  console.log(`\n🎉 ALL FILES UPLOADED TO CLOUDFLARE R2 SUCCESSFULLY!`);
}

main().catch((err) => {
  console.error('\n❌ Upload script error:', err);
  process.exit(1);
});
