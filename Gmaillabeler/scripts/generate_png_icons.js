const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function createPNG(width, height, getPixel) {
  const rowSize = width * 4 + 1;
  const rawData = Buffer.alloc(rowSize * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = getPixel(x, y);
      const pxOffset = rowOffset + 1 + x * 4;
      rawData[pxOffset] = r;
      rawData[pxOffset + 1] = g;
      rawData[pxOffset + 2] = b;
      rawData[pxOffset + 3] = a;
    }
  }

  const compressed = zlib.deflateSync(rawData);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const ihdrChunk = createChunk('IHDR', ihdr);
  const idatChunk = createChunk('IDAT', compressed);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(8 + len + 4);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4);
  data.copy(chunk, 8);

  const crc = crc32(Buffer.concat([Buffer.from(type), data]));
  chunk.writeUInt32BE(crc, 8 + len);
  return chunk;
}

const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

// High-Visibility Transparent Background Icon (Big Envelope + AI Sparkle Star)
function renderIconPixel(x, y, size) {
  const nx = x / size;
  const ny = y / size;

  // 1. AI Sparkle Badge (Top Right Circle: cx=0.74, cy=0.26, r=0.25)
  const sparkX = 0.74;
  const sparkY = 0.26;
  const sparkR = 0.25;

  const dx = nx - sparkX;
  const dy = ny - sparkY;
  const distSq = dx * dx + dy * dy;

  if (distSq <= sparkR * sparkR) {
    const dist = Math.sqrt(distSq);
    // Dark Navy Border Line for Crisp Contrast
    if (dist > sparkR - 0.04) {
      return [0x0f, 0x17, 0x2a, 255];
    }

    // Sparkle Body: Vivid Cyan (#06b6d4) to Deep Purple Gradient
    const st = dist / sparkR;
    const sR = Math.round(0x06 + st * (0x7c - 0x06));
    const sG = Math.round(0xb6 + st * (0x3a - 0xb6));
    const sB = Math.round(0xd4 + st * (0xed - 0xd4));

    // Inner Large AI Star (+) ✦
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    if ((adx < 0.045 && ady < 0.17) || (ady < 0.045 && adx < 0.17)) {
      return [255, 255, 255, 255];
    }

    return [sR, sG, sB, 255];
  }

  // 2. Large Envelope (w=0.84, h=0.56, centered)
  const envX = 0.05;
  const envY = 0.32;
  const envW = 0.84;
  const envH = 0.56;

  if (nx >= envX && nx <= envX + envW && ny >= envY && ny <= envY + envH) {
    // Outer Dark Navy Border for maximum contrast
    if (
      nx <= envX + 0.04 ||
      nx >= envX + envW - 0.04 ||
      ny <= envY + 0.04 ||
      ny >= envY + envH - 0.04
    ) {
      return [0x1e, 0x29, 0x3b, 255];
    }

    const relX = (nx - envX) / envW;
    const relY = (ny - envY) / envH;

    // V-shaped Gmail Red Flap
    const flapY = relX < 0.5 ? relX * 1.15 : (1 - relX) * 1.15;

    if (Math.abs(relY - flapY) < 0.08 && relY <= flapY) {
      return [0xea, 0x43, 0x35, 255]; // Gmail Bold Red Line
    }

    if (relY < flapY) {
      return [0xf1, 0xf5, 0xf9, 255]; // Light Gray Inner Flap
    }

    return [255, 255, 255, 255]; // White Envelope Body
  }

  return [0, 0, 0, 0]; // Transparent Background!
}

[16, 32, 48, 128].forEach((size) => {
  const buf = createPNG(size, size, (x, y) => renderIconPixel(x, y, size));
  const filename = path.join(__dirname, '..', `icon${size}.png`);
  fs.writeFileSync(filename, buf);
  console.log(`Generated: icon${size}.png (${buf.length} bytes)`);
});
