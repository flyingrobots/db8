// Remove `title:` from YAML frontmatter to avoid MD025 conflicts with H1s.
import fs from 'node:fs';

const files = process.argv.slice(2);
let changed = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const lines = src.split(/\r?\n/);
  if (!lines.length || lines[0].trim() !== '---') continue;
  let i = 1;
  let modified = false;
  while (i < lines.length && lines[i].trim() !== '---') {
    if (/^title:\s*/.test(lines[i])) {
      lines.splice(i, 1);
      modified = true;
      continue;
    }
    i++;
  }
  if (modified) {
    fs.writeFileSync(f, lines.join('\n'));
    changed++;
  }
}
console.warn(`Removed title from ${changed} files`);
