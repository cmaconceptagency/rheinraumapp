/**
 * Baut die Browser-Demo der Mitarbeiter-App als EINE selbstständige HTML-Datei
 * (App-Bundle, Symbol-Schrift und Bilder eingebettet).
 *
 *   npm run demo:build -w @rheinraum/mobile [-- <Ausgabedatei>]
 */
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const outFile = path.resolve(process.argv[2] ?? path.join(appDir, 'dist-demo', 'rheinraum-demo.html'));
const exportDir = mkdtempSync(path.join(tmpdir(), 'rr-web-'));

execSync(`npx expo export --platform web --output-dir "${exportDir}"`, {
  cwd: appDir,
  stdio: 'inherit',
  env: { ...process.env, CI: '1', EXPO_PUBLIC_DEMO: '1' },
});

const jsDir = path.join(exportDir, '_expo/static/js/web');
const entries = readdirSync(jsDir).filter((f) => f.endsWith('.js'));
if (entries.length !== 1) throw new Error(`Erwartet genau ein Bundle, gefunden: ${entries.join(', ')}`);
let js = readFileSync(path.join(jsDir, entries[0]), 'utf8');

// Nur tatsächlich benötigte Assets einbetten: Ionicons-Schrift und kleine PNGs von expo-router.
const mime = { '.ttf': 'font/ttf', '.png': 'image/png' };
const refs = [...new Set(js.match(/"\/assets\/[^"]+\.(ttf|png)"/g) ?? [])].map((s) => s.slice(1, -1));
let embedded = 0;
for (const ref of refs) {
  const isIcon = ref.endsWith('.png') || /\/Ionicons\.[0-9a-f]+\.ttf$/.test(ref);
  if (!isIcon) continue;
  const data = readFileSync(path.join(exportDir, ref));
  js = js.split(`"${ref}"`).join(`"data:${mime[path.extname(ref)]};base64,${data.toString('base64')}"`);
  embedded++;
}

const page = readFileSync(path.join(here, 'page.html'), 'utf8');
const safeJs = js.replace(/<\/script/gi, '<\\/script');
// Funktions-Ersetzung, damit "$"-Zeichen im Bundle nicht als Ersetzungsmuster gelten.
const html = page.replace('<!--APP_BUNDLE-->', () => `<script>\n${safeJs}\n</script>`);
mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, html);
console.log(`Demo gebaut: ${outFile} (${(html.length / 1024 / 1024).toFixed(2)} MB, ${embedded} Assets eingebettet)`);
