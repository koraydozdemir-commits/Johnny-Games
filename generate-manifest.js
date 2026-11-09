import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const gamesDir = path.join(root, "games");
const manifestPath = path.join(root, "games.json");
const existing = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const byFile = new Map();

for (const entry of existing) {
  if (entry && typeof entry.name === "string") {
    const fileName = (entry.game || entry.name) + ".html";
    byFile.set(fileName.toLowerCase(), entry);
  }
}

const files = fs.readdirSync(gamesDir, { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith(".html"))
  .map(entry => entry.name)
  .sort((a, b) => a.localeCompare(b));

const generated = files.map(file => {
  const existingEntry = byFile.get(file.toLowerCase());
  if (existingEntry) return existingEntry;
  return { name: file.slice(0, -5) };
});

// Keep explicitly external games, which do not have a local HTML file.
for (const entry of existing) {
  if (entry && typeof entry.url === "string" && !generated.some(game => game.name === entry.name)) {
    generated.push(entry);
  }
}

fs.writeFileSync(manifestPath, JSON.stringify(generated, null, 2) + "\n");
console.log(`Generated games.json from ${files.length} local games and ${generated.length - files.length} external entries.`);
