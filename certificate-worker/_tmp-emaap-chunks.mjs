import fs from 'node:fs';
import path from 'node:path';

const s = fs.readFileSync(path.join(process.env.TEMP, 'emaap-main.js'), 'utf8');
const marker = '5991:"24903568"';
const i = s.indexOf(marker);
const start = s.lastIndexOf('{', i);
const end = s.indexOf('}', i);
const raw = s.slice(start, end + 1);
const map = JSON.parse(raw.replace(/(\d+):/g, '"$1":'));
for (const id of ['3186', '6243', '5760']) {
  console.log(id, map[id]);
}

const needle = 'path:"edit"';
const editAt = s.indexOf(needle);
console.log('edit idx', editAt);
if (editAt >= 0) console.log(s.slice(editAt - 200, editAt + 80));
const ke = s.lastIndexOf('Ke=', editAt);
console.log('Ke assign', ke);
if (ke >= 0) console.log(s.slice(ke, ke + 400));
