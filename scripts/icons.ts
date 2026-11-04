/** Regenerate browser icon variants from the code-native Scene Loom mark. */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { repositoryRoot } from '../shared/config.js';

const folder = join(repositoryRoot, 'public');
const mark = await readFile(join(folder, 'scene-loom-mark.svg'), 'utf8');
const icon = mark.replace(
  /(<svg[^>]*>)/,
  '$1\n  <rect width="32" height="32" rx="7" fill="#101215" />',
);
await writeFile(join(folder, 'favicon.svg'), icon);
const png32 = await sharp(Buffer.from(icon)).resize(32, 32).png().toBuffer();
await writeFile(join(folder, 'favicon-32.png'), png32);
await sharp(Buffer.from(icon))
  .resize(180, 180)
  .png()
  .toFile(join(folder, 'apple-touch-icon.png'));
await sharp(Buffer.from(icon))
  .resize(512, 512)
  .png()
  .toFile(join(folder, 'icon-512.png'));
// A single PNG-encoded 32px ICO entry for browsers requesting /favicon.ico.
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header[6] = 32;
header[7] = 32;
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png32.length, 14);
header.writeUInt32LE(22, 18);
await writeFile(join(folder, 'favicon.ico'), Buffer.concat([header, png32]));
console.log('Generated Scene Loom browser icons.');
