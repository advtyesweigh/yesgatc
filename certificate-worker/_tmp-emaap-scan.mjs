import fs from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
const s = fs.readFileSync(file, 'utf8');
const keys = process.argv.slice(3);
console.log(path.basename(file), s.length);
for (const k of keys) {
  const i = s.indexOf(k);
  console.log((i >= 0 ? 'YES' : 'NO '), k);
  if (i >= 0) console.log(s.slice(Math.max(0, i - 120), i + 220).replaceAll('\n', ' '));
  console.log('---');
}
