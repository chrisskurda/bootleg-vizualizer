#!/usr/bin/env node
// Reports, and with --apply updates, the copy of this repository (version and pack library) that each consumer carries.
//
//   node bin/sync-consumers.mjs                    report only (the default): which consumers match this checkout
//   node bin/sync-consumers.mjs --apply            update every consumer that differs, using that consumer's own vendoring script
//   node bin/sync-consumers.mjs --json             the report as JSON on stdout (schema below), for other tools
//   --root <dir>                                   where the consumer checkouts live (default: the folder this checkout is in)
//   --path <id>=<dir>                              one consumer's checkout, when it is somewhere else
//   --only <id,id>                                 limit to these consumers
//
// The comparison is by content, not by the VERSION file: every file a consumer carries is hashed and compared with the
// same file at the upstream ref. The ref is the tag v<VERSION>; --apply refuses unless that tag is this checkout's HEAD
// and the tree is clean, because consumers pin by tag (VENDORING.md).
//
// Exit status: 0 every consumer found is in sync · 1 at least one differs, is blocked, or is missing · 2 the tool could not run.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPORT_SCHEMA = 1;
const upstreamDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The one list of consumers. `takes` says which upstream files the consumer is expected to carry; `generated` are files
// its vendoring script writes itself; `patched` are files that script changes on purpose (named in its VENDORED.md).
const everything = () => true;
const CONSUMERS = [
  { id: 'bootleg', mode: 'subtree', prefix: 'vendor/bootleg-vizualizer', takes: everything },
  { id: 'bootleg-vizualizer-videocreator', mode: 'subtree', prefix: 'vendor/bootleg-vizualizer', takes: everything },
  {
    id: 'bootleg-composer', mode: 'copy', prefix: 'vendor/bootleg-vizualizer', command: ['bash', 'scripts/vendor-vizualizer.sh'],
    takes: p => /^(core|packs|tests|bin)\//.test(p) || ['CHANGELOG.md', 'LICENSE', 'README.md', 'SPEC.md', 'VENDORING.md', 'VERSION', 'package.json'].includes(p),
    generated: ['VENDORED.md'],
  },
  {
    id: 'bootleg-bridge-thing', mode: 'copy', prefix: 'apps/bootleg-bridge-thing/public/viz', command: ['node', 'scripts/vendor-viz.mjs'],
    takes: p => ['core/pack-runtime.js', 'core/stems.js', 'core/meta.js', 'core/look.js'].includes(p) || /^packs\/[^_/][^/]*\//.test(p),
    generated: ['VENDORED.md', 'packs.json'], patched: ['core/pack-runtime.js'],
  },
];

function parseArgs(argv) {
  const options = { apply: false, json: false, root: path.dirname(upstreamDir), paths: {}, only: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') options.apply = true;
    else if (a === '--json') options.json = true;
    else if (a === '--root') options.root = path.resolve(argv[++i] ?? fail('--root needs a folder'));
    else if (a === '--only') options.only = (argv[++i] ?? fail('--only needs a list')).split(',');
    else if (a === '--path') {
      const [id, dir] = (argv[++i] ?? '').split('=');
      if (!id || !dir) fail('--path needs <id>=<dir>');
      options.paths[id] = path.resolve(dir);
    } else fail(`unknown option ${a}`);
  }
  const unknown = [...(options.only ?? []), ...Object.keys(options.paths)].filter(id => !CONSUMERS.some(c => c.id === id));
  if (unknown.length) fail(`unknown consumer: ${unknown.join(', ')} (known: ${CONSUMERS.map(c => c.id).join(', ')})`);
  return options;
}

function fail(message) { console.error(`sync-consumers: ${message}`); process.exit(2); }

function git(cwd, args, { input, allowFailure = false } = {}) {
  const r = spawnSync('git', args, { cwd, input, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) fail(`git could not be run: ${r.error.message}`);
  if (r.status !== 0 && !allowFailure) fail(`git ${args.join(' ')} failed in ${cwd}:\n${r.stderr.trim()}`);
  return { ok: r.status === 0, out: r.stdout.trim(), err: r.stderr.trim() };
}

function readUpstream() {
  const version = fs.readFileSync(path.join(upstreamDir, 'VERSION'), 'utf8').trim();
  const tag = `v${version}`;
  const head = git(upstreamDir, ['rev-parse', 'HEAD']).out;
  const tagCommit = git(upstreamDir, ['rev-parse', '--verify', '--quiet', `${tag}^{commit}`], { allowFailure: true });
  const isTagged = tagCommit.ok && tagCommit.out === head;
  const isClean = git(upstreamDir, ['status', '--porcelain']).out === '';
  const ref = tagCommit.ok ? tag : 'HEAD';
  const files = new Map();   // path -> blob hash at the ref
  for (const line of git(upstreamDir, ['ls-tree', '-r', ref]).out.split('\n')) {
    const [meta, file] = line.split('\t');
    if (meta?.split(' ')[1] === 'blob') files.set(file, meta.split(' ')[2]);
  }
  const packs = new Set([...files.keys()].filter(f => /^packs\/[^/]+\/pack\.json$/.test(f)).map(f => f.split('/')[1]));
  return { version, tag, ref, head, isTagged, isClean, tagExists: tagCommit.ok, files, packs };
}

function consumerVersion(dir) {
  const versionFile = path.join(dir, 'VERSION');
  if (fs.existsSync(versionFile)) return fs.readFileSync(versionFile, 'utf8').trim();
  const note = path.join(dir, 'VENDORED.md');
  return fs.existsSync(note) ? (fs.readFileSync(note, 'utf8').match(/bootleg-vizualizer \**([0-9][0-9A-Za-z.+-]*)/)?.[1] ?? 'unknown') : 'unknown';
}

function inspect(consumer, upstream, options) {
  const repo = options.paths[consumer.id] ?? path.join(options.root, consumer.id);
  const report = { id: consumer.id, path: repo, mode: consumer.mode, state: 'in-sync', version: null, packs: null, differing: [], missing: [], extra: [], note: '' };
  const dir = path.join(repo, consumer.prefix);
  if (!fs.existsSync(path.join(repo, '.git'))) return { ...report, state: 'not-found', note: 'no checkout at this path' };
  if (!fs.existsSync(dir)) return { ...report, state: 'out-of-sync', note: `${consumer.prefix} does not exist` };

  // tracked files plus untracked ones that are not ignored, so an uncommitted edit or a stray file is seen too
  const listed = git(repo, ['ls-files', '-co', '--exclude-standard', '--', consumer.prefix]).out.split('\n').filter(Boolean);
  const present = listed.map(f => path.relative(consumer.prefix, f)).filter(f => fs.existsSync(path.join(dir, f)));
  const hashes = git(repo, ['hash-object', '--no-filters', '--stdin-paths'], { input: present.map(f => path.join(consumer.prefix, f)).join('\n') + '\n' }).out.split('\n');
  const carried = new Map(present.map((f, i) => [f, hashes[i]]));

  const generated = consumer.generated ?? [], patched = consumer.patched ?? [];
  for (const [file, hash] of carried) {
    if (generated.includes(file)) continue;
    if (!upstream.files.has(file)) report.extra.push(file);
    else if (upstream.files.get(file) !== hash && !patched.includes(file)) report.differing.push(file);
  }
  for (const file of upstream.files.keys()) if (consumer.takes(file) && !carried.has(file)) report.missing.push(file);

  report.version = consumerVersion(dir);
  report.packs = new Set(present.filter(f => /^packs\/[^/]+\/pack\.json$/.test(f)).map(f => f.split('/')[1])).size;
  const isSame = !report.differing.length && !report.missing.length && !report.extra.length && report.version === upstream.version;
  if (!isSame) report.state = 'out-of-sync';
  return report;
}

function apply(consumer, report, upstream) {
  const repo = report.path;
  if (consumer.mode === 'subtree') {
    // git subtree refuses a modified tree; say so here instead of letting it fail halfway
    if (git(repo, ['status', '--porcelain']).out !== '') return { state: 'blocked', note: 'has uncommitted changes; git subtree needs a clean tree. Commit them, then run again.' };
    const r = spawnSync('git', ['subtree', 'pull', '--prefix', consumer.prefix, upstreamDir, upstream.tag, '--squash', '-m', `Vendor bootleg-vizualizer ${upstream.version}`], { cwd: repo, stdio: ['ignore', process.stderr, process.stderr] });
    return r.status === 0 ? { note: 'pulled; this made a commit in the consumer (not pushed)' } : { state: 'blocked', note: `git subtree pull failed (exit ${r.status}); see the output above` };
  }
  const [program, ...args] = consumer.command;
  const r = spawnSync(program, [...args, upstreamDir], { cwd: repo, stdio: ['ignore', process.stderr, process.stderr] });
  return r.status === 0 ? { note: `copied by ${consumer.command.join(' ')}; the change is uncommitted in the consumer` } : { state: 'blocked', note: `${consumer.command.join(' ')} failed (exit ${r.status})` };
}

function describe(report) {
  const counts = [['differ', report.differing], ['missing', report.missing], ['extra', report.extra]].filter(([, l]) => l.length).map(([n, l]) => `${l.length} ${n}`).join(', ');
  const what = report.version === null ? '' : `${report.version}, ${report.packs} packs`;
  return [report.id.padEnd(34), report.state.padEnd(12), what.padEnd(20), [counts, report.note].filter(Boolean).join(' · ')].join(' ').trimEnd();
}

const options = parseArgs(process.argv.slice(2));
const upstream = readUpstream();
const log = (...a) => console.error(...a);   // the report goes to stderr when --json owns stdout
const selected = CONSUMERS.filter(c => !options.only || options.only.includes(c.id));

log(`bootleg-vizualizer ${upstream.version}, ${upstream.packs.size} packs, compared at ${upstream.ref} (${upstream.head.slice(0, 7)})`);
if (!upstream.tagExists) log(`  note: tag ${upstream.tag} does not exist; comparing against HEAD`);
else if (!upstream.isTagged) log(`  note: HEAD is not ${upstream.tag}; comparing against the tag, not this checkout`);

let reports = selected.map(c => inspect(c, upstream, options));
if (options.apply) {
  if (!upstream.isTagged) fail(`--apply needs HEAD to be the tag ${upstream.tag} (consumers pin by tag). Tag the release first.`);
  if (!upstream.isClean) fail('--apply needs a clean checkout here: the copy scripts take the working tree as it is.');
  reports = reports.map((report, i) => {
    if (report.state !== 'out-of-sync') return report;
    log(`\nupdating ${report.id} …`);
    const result = apply(selected[i], report, upstream);
    const after = inspect(selected[i], upstream, options);   // read back what is really there now
    if (result.state) return { ...after, state: result.state, note: result.note };
    return { ...after, note: after.state === 'in-sync' ? result.note : `still differs after the update · ${result.note}` };
  });
}

log('');
for (const report of reports) log(describe(report));
for (const report of reports) for (const [name, list] of [['differ', report.differing], ['missing', report.missing], ['extra', report.extra]]) {
  if (list.length) log(`  ${report.id}: ${name}: ${list.slice(0, 8).join(', ')}${list.length > 8 ? `, … (${list.length - 8} more)` : ''}`);
}
if (options.json) {
  const upstreamOut = { version: upstream.version, tag: upstream.tag, ref: upstream.ref, commit: upstream.head, isTagged: upstream.isTagged, isClean: upstream.isClean, packs: upstream.packs.size };
  console.log(JSON.stringify({ schema: REPORT_SCHEMA, upstream: upstreamOut, consumers: reports }, null, 2));
}
process.exit(reports.every(r => r.state === 'in-sync') ? 0 : 1);
