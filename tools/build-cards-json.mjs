// Sinh data/cards.json (tên, từ khóa, thông điệp + đường dẫn ảnh JPG). Chạy: node tools/build-cards-json.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDeck } from './deck-data.mjs';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cards = buildDeck().map((c) => ({ ...c, image: `/cards/${c.id}.jpg` }));
for (const c of cards) if (!fs.existsSync(path.join(ROOT, 'public', c.image))) console.warn('Thiếu ảnh:', c.image);
fs.writeFileSync(path.join(ROOT, 'data', 'cards.json'), JSON.stringify({ back: '/cards/back.jpg', cards }, null, 1));
console.log(`Đã ghi data/cards.json (${cards.length} lá)`);
