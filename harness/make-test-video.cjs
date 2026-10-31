// Usage: node harness/make-test-video.cjs <out.webm>
// Makes the animated-map test's video: a bar sweeping across a blue field, 2 seconds at 15 frames a second. The frames are
// drawn and saved as JPEG by Chromium, and Playwright's own ffmpeg (which only reads JPEG frames) encodes them as VP8.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const out = process.argv[2];
const ffmpeg = process.env.FFMPEG || path.join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'ffmpeg-1011', 'ffmpeg-win64.exe');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const frames = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 400;
    const context = canvas.getContext('2d');
    const list = [];
    for (let i = 0; i < 30; i++) {
      context.fillStyle = '#2a4a8a'; context.fillRect(0, 0, 640, 400);
      context.fillStyle = '#f5b73d'; context.fillRect((i * 760) / 30 - 120, 0, 120, 400);
      list.push(canvas.toDataURL('image/jpeg', 0.9).split(',')[1]);
    }
    return list;
  });
  await browser.close();
  const child = spawn(ffmpeg, ['-y', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', '15', '-i', 'pipe:0', '-c:v', 'libvpx', '-b:v', '600k', '-pix_fmt', 'yuv420p', out], { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  child.stdin.on('error', () => undefined);
  for (const frame of frames) child.stdin.write(Buffer.from(frame, 'base64'));
  child.stdin.end();
  child.on('close', (code) => {
    if (code !== 0) { console.error(err.slice(-400)); process.exit(1); }
    console.log(`wrote ${out} (${fs.statSync(out).size} bytes)`);
  });
})();
