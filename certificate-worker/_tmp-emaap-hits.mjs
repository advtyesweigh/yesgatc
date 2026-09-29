import fs from 'node:fs';

const s = fs.readFileSync(process.argv[2], 'utf8');
const key = process.argv[3];
let i = 0;
let n = 0;
while ((i = s.indexOf(key, i)) >= 0 && n < 12) {
  console.log('\n#' + n + ' @' + i);
  console.log(s.slice(Math.max(0, i - 160), i + 240));
  i += key.length;
  n += 1;
}
