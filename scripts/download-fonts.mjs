import { mkdir, writeFile } from 'node:fs/promises';
const url =
  'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800;900&family=DM+Sans:wght@400;450;500;550;600;650;700;750;800;900;1000&display=swap';
const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
if (!response.ok) throw new Error(`Font stylesheet: ${response.status}`);
let css = await response.text();
await mkdir('public/fonts', { recursive: true });
const urls = [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]))];
for (const [i, asset] of urls.entries()) {
  if (new URL(asset).hostname !== 'fonts.gstatic.com') throw new Error('Unexpected font origin');
  const result = await fetch(asset);
  if (!result.ok) throw new Error(`Font asset: ${result.status}`);
  const file = `font-${i}.${asset.split('.').pop()}`;
  await writeFile(`public/fonts/${file}`, Buffer.from(await result.arrayBuffer()));
  css = css.replaceAll(asset, `/fonts/${file}`);
}
await writeFile('public/fonts/fonts.css', css);
console.log(`Saved ${urls.length} font files for offline use.`);
