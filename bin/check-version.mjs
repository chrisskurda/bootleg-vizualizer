// VERSION, package.json and CHANGELOG.md must agree (runs in `npm test`).
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), read = f => fs.readFileSync(path.join(root, f), 'utf8');
const a = read('VERSION').trim(), b = JSON.parse(read('package.json')).version, log = read('CHANGELOG.md'), bad = [];
if (a !== b) bad.push(`VERSION (${a}) and package.json (${b}) differ`);
if (!/^\d+\.\d+\.\d+$/.test(a)) bad.push(`"${a}" is not a semantic version`);
if (!new RegExp(`^## \\[${a.replace(/\./g, '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}`, 'm').test(log)) bad.push(`CHANGELOG.md has no entry for ${a}`);
if (!/^## \[Unreleased\]/m.test(log)) bad.push('CHANGELOG.md has no [Unreleased] section');
if (bad.length) { console.error('version check FAILED:\n - ' + bad.join('\n - ')); process.exit(1); } console.log(`version ${a}: consistent, changelog entry present`);
