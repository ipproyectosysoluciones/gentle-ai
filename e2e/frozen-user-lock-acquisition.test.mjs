import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scripts = fileURLToPath(new URL('../scripts/', import.meta.url));
const reviewed = JSON.parse(fs.readFileSync(path.join(scripts, 'gentle-pi-suppliers.json'), 'utf8')).releases;
function newestReviewedListVersion(table) {
  const order = version => version.split('.').map(Number);
  return Object.keys(table).sort((left, right) => {
    const a = order(left), b = order(right);
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  }).at(-1);
}
const targetVersion = newestReviewedListVersion(reviewed);
const rootNames = ['gentle-pi', '@earendil-works/pi-coding-agent', '@earendil-works/pi-tui', '@heyhuynhgiabuu/pi-pretty', 'typebox'];

function fixture(t, profile = 'modern', change, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frozen-user-lock-'));
  fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['state', 'agent', 'home', 'tmp', 'config', 'runtime/node/bin', 'runtime/node/lib/node_modules/npm/bin', `user-locks/${profile}`]) {
    fs.mkdirSync(path.join(root, name), { recursive: true, mode: 0o700 });
  }
  fs.copyFileSync(process.execPath, path.join(root, 'runtime/node/bin/node'));
  fs.chmodSync(path.join(root, 'runtime/node/bin/node'), 0o700);
  const trace = path.join(root, 'npm-trace.jsonl');
  // Stop at the real child-process boundary: this is not npm-install qualification.
  const stagedLock = path.join(root, `user-locks/${profile}/package-lock.json`);
  const generatedLock = path.join(root, 'runtime/project/package-lock.json');
  const declaration = Object.fromEntries(rootNames.map(name => [name, name === 'gentle-pi' ? targetVersion : 'latest']));
  const generatedIntegrity = options.gentlePiIntegrity ?? reviewed[targetVersion].integrity;
  const generatedVersion = options.gentlePiVersion ?? targetVersion;
  const npmBody = profile === 'modern'
    ? `if (args[0] === 'install') {
  const lock = JSON.parse(require('node:fs').readFileSync(${JSON.stringify(stagedLock)}));
  lock.packages[''].dependencies = ${JSON.stringify(declaration)};
  const gentle = lock.packages['node_modules/gentle-pi'];
  gentle.version = ${JSON.stringify(generatedVersion)};
  gentle.resolved = 'https://registry.npmjs.org/gentle-pi/-/gentle-pi-' + gentle.version + '.tgz';
  gentle.integrity = ${JSON.stringify(generatedIntegrity)};
  require('node:fs').writeFileSync(${JSON.stringify(generatedLock)}, JSON.stringify(lock));
  process.exit(0);
}
process.exit(73);`
    : 'process.exit(73);';
  fs.writeFileSync(path.join(root, 'runtime/node/lib/node_modules/npm/bin/npm-cli.js'),
    `require('node:fs').appendFileSync(${JSON.stringify(trace)}, JSON.stringify(process.argv.slice(2)) + '\\n');${options.npmTraceExtra ?? ''}
const args = process.argv.slice(2);
${npmBody}`, { mode: 0o600 });
  if (profile === 'modern' && !options.omitStagedList) {
    // The Go worker stages the selected reviewed list and the lock-SRI
    // completion helper into every install stage; the fixture mirrors that.
    fs.copyFileSync(path.join(scripts, 'gentle-pi-suppliers.json'), path.join(root, 'gentle-pi-suppliers.json'));
    fs.copyFileSync(path.join(scripts, 'complete-generated-lock-sri.mjs'), path.join(root, 'complete-generated-lock-sri.mjs'));
  }
  const original = fs.readFileSync(path.join(scripts, `user-locks/${profile}/package-lock.json`));
  const lock = JSON.parse(original);
  if (change) change(lock);
  fs.writeFileSync(stagedLock, change ? JSON.stringify(lock) : original, { mode: 0o400 });
  const prefix = path.join(root, 'prefix');
  if (profile === 'prior') {
    const coding = path.join(prefix, 'lib/node_modules/@earendil-works/pi-coding-agent');
    fs.mkdirSync(coding, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(coding, 'package.json'), '{"version":"0.99.2"}', { mode: 0o600 });
    fs.writeFileSync(path.join(root, 'state/prior-global-graph.json'), '[]', { mode: 0o600 });
  }
  const result = spawnSync(process.execPath, [path.join(scripts, 'provision-gentle-shell-private-global.mjs'),
    root, prefix, path.join(root, 'agent'), prefix, root, 'separate', 'install'], {
    env: { HOME: path.join(root, 'home'), PATH: '/usr/bin:/bin' }, timeout: 10000, encoding: 'utf8', maxBuffer: 8192,
  });
  const calls = fs.existsSync(trace) ? fs.readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  return { root, trace, result, calls, lock, original, source: path.join(root, `runtime/${profile === 'prior' ? 'prior' : 'project'}`) };
}

test('prior acquisition uses the complete frozen lock and only npm ci', t => {
  const f = fixture(t, 'prior');
  assert.notEqual(f.result.status, 0, 'the npm fixture deliberately stops acquisition');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][0], 'ci');
  assert.ok(f.calls[0].includes('--install-strategy=shallow'));
  assert.ok(f.calls[0].includes('--ignore-scripts') && f.calls[0].includes('--engine-strict'));
  assert.ok(f.calls[0].includes('--min-release-age=3'));
  assert.deepEqual(fs.readFileSync(path.join(f.source, 'package-lock.json')), f.original);
  const manifest = JSON.parse(fs.readFileSync(path.join(f.source, 'package.json')));
  assert.deepEqual(manifest.dependencies, f.lock.packages[''].dependencies);
  assert.equal(manifest.name, f.lock.packages[''].name);
  assert.equal(manifest.version, f.lock.packages[''].version);
  assert.deepEqual(fs.readdirSync(path.join(f.root, 'agent')), []);
});

test('modern acquisition declares the newest listed gentle-pi and generates the lock', t => {
  const f = fixture(t, 'modern');
  assert.notEqual(f.result.status, 0, 'the npm fixture deliberately stops acquisition');
  assert.deepEqual(f.calls.map(args => args[0]), ['install', 'ci'], f.result.stderr);
  assert.ok(f.calls[0].includes('--package-lock-only'));
  assert.ok(f.calls[0].includes('--min-release-age=0'));
  const manifest = JSON.parse(fs.readFileSync(path.join(f.source, 'package.json')));
  assert.equal(manifest.name, 'gentle-shell-owned-seed');
  assert.deepEqual(manifest.dependencies, Object.fromEntries(rootNames.map(name => [name, name === 'gentle-pi' ? targetVersion : 'latest'])));
  const generated = JSON.parse(fs.readFileSync(path.join(f.source, 'package-lock.json')));
  assert.equal(generated.packages['node_modules/gentle-pi'].version, targetVersion);
  assert.equal(generated.packages['node_modules/gentle-pi'].integrity, reviewed[targetVersion].integrity);
  assert.deepEqual(fs.readdirSync(path.join(f.root, 'agent')), []);
});

test('modern npm ci keeps the reviewed profile without re-resolution flags', t => {
  const f = fixture(t, 'modern');
  assert.notEqual(f.result.status, 0);
  assert.equal(f.calls[1][0], 'ci');
  assert.ok(f.calls[1].includes('--ignore-scripts') && f.calls[1].includes('--engine-strict'));
  assert.ok(f.calls[1].includes('--min-release-age=0'));
  assert.equal(f.calls[1].includes('--install-strategy=shallow'), false);
  assert.equal(f.calls[1].includes('--min-release-age=3'), false);
});

// S23/M4: a Main preview install request stages no reviewed list and keeps
// the frozen modern lock's stock base (gentle-pi 4.3.0), exactly the route
// every modern install took before the reviewed-list route existed.
test('a modern install without the staged reviewed list keeps the frozen lock route', t => {
  const f = fixture(t, 'modern', undefined, { omitStagedList: true });
  assert.notEqual(f.result.status, 0, 'the npm fixture deliberately stops acquisition');
  assert.deepEqual(f.calls.map(args => args[0]), ['ci'], f.result.stderr);
  assert.ok(f.calls[0].includes('--install-strategy=shallow'));
  assert.ok(f.calls[0].includes('--min-release-age=3'));
  const acquired = JSON.parse(fs.readFileSync(path.join(f.source, 'package-lock.json')));
  assert.equal(acquired.packages['node_modules/gentle-pi'].version, '4.3.0', 'Main preview stock base must stay the frozen 4.3.0 lock');
  assert.deepEqual(fs.readdirSync(path.join(f.root, 'agent')), []);
});

test('modern acquisition pins umask 022 over a group-writable login umask', t => {
  const observed = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'provision-umask-')), 'umask.json');
  t.after(() => fs.rmSync(path.dirname(observed), { recursive: true, force: true }));
  const extra = `require('node:fs').writeFileSync(${JSON.stringify(observed)}, JSON.stringify(process.umask()));`;
  // Simulate the Ubuntu/WSL default login umask that npm would otherwise inherit.
  const previous = process.umask(0o002);
  let f;
  try { f = fixture(t, 'modern', undefined, { npmTraceExtra: extra }); } finally { process.umask(previous); }
  assert.notEqual(f.result.status, 0, 'the npm fixture deliberately stops acquisition');
  assert.equal(JSON.parse(fs.readFileSync(observed)), 0o22, 'npm must observe the pinned 022 umask');
});

function changeVersion(entry, version) {
  entry.resolved = entry.resolved.replace(`-${entry.version}.tgz`, `-${version}.tgz`);
  entry.version = version;
}
// A missing integrity is not a refusal case on the generated route: the SRI
// completion helper fills it from the registry metadata like on Windows. Every
// other deviation from the canonical per-package shape refuses before npm ci.
const mutations = {
  'foreign registry': entry => { entry.resolved = 'https://foreign.invalid/package.tgz'; },
  'mismatched name': entry => { entry.name = 'different-package'; },
  'unsafe version': entry => changeVersion(entry, '../outside'),
  'noncanonical version': entry => changeVersion(entry, '01.0.0'),
  'noncanonical prerelease': entry => changeVersion(entry, '1.0.0-01'),
  'linked package': entry => { entry.link = true; },
  'noncanonical SRI': entry => { entry.integrity = entry.integrity.slice(0, -3) + 'B=='; },
};
for (const [name, mutate] of Object.entries(mutations)) {
  test(`${name} refuses the generated lock before npm ci`, t => {
    const f = fixture(t, 'modern', lock => mutate(lock.packages['node_modules/@earendil-works/pi-ai']));
    assert.notEqual(f.result.status, 0);
    assert.deepEqual(f.calls.map(args => args[0]), ['install'], f.result.stderr);
    assert.equal(fs.existsSync(path.join(f.root, 'prefix')), false);
    assert.deepEqual(fs.readdirSync(path.join(f.root, 'agent')), []);
  });
}

test('a generated lock whose gentle-pi SRI differs from the list entry is refused', t => {
  const wrong = reviewed['4.3.0'].integrity;
  assert.notEqual(wrong, reviewed[targetVersion].integrity);
  const f = fixture(t, 'modern', undefined, { gentlePiIntegrity: wrong });
  assert.notEqual(f.result.status, 0);
  assert.match(f.result.stderr, /stock supplier pin/);
  assert.deepEqual(f.calls.map(args => args[0]), ['install'], 'npm ci must not run after a reviewed-list SRI mismatch');
});

test('a generated lock resolving gentle-pi off the listed release is refused', t => {
  const f = fixture(t, 'modern', undefined, { gentlePiVersion: '5.0.0' });
  assert.notEqual(f.result.status, 0);
  assert.match(f.result.stderr, /stock supplier pin/);
  assert.deepEqual(f.calls.map(args => args[0]), ['install']);
});

test('unsafe package placement refuses before npm ci', t => {
  const f = fixture(t, 'modern', lock => { lock.packages['node_modules/../outside'] = lock.packages['node_modules/typebox']; });
  assert.notEqual(f.result.status, 0);
  assert.deepEqual(f.calls.map(args => args[0]), ['install']);
});

test('duplicate package identities cannot supply conflicting integrity', t => {
  const f = fixture(t, 'modern', lock => {
    lock.packages['node_modules/typebox/node_modules/@earendil-works/pi-ai'] = {
      ...lock.packages['node_modules/@earendil-works/pi-ai'], integrity: `sha512-${Buffer.alloc(64).toString('base64')}`,
    };
  });
  assert.notEqual(f.result.status, 0);
  assert.deepEqual(f.calls.map(args => args[0]), ['install']);
});

test('prior root declarations and package identities must agree before npm ci', t => {
  const f = fixture(t, 'prior', lock => { lock.packages[''].dependencies['typebox'] = '9.9.9'; });
  assert.notEqual(f.result.status, 0);
  assert.deepEqual(f.calls, []);
});
