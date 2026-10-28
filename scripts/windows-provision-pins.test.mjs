// Portable VM fixtures for the Windows provisioner's version policy: latest
// dist-tag resolution with dynamic lock pinning, the reviewed-supplier table
// with its single fallback re-resolution, and a discovered native bundle
// directory. They prove the validation helper logic, not an installed Windows
// runtime. Adapted from the windows-provision-copy VM region pattern.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const provision = process.argv[2] ?? fileURLToPath(new URL('./provision-gentle-shell-windows.mjs', import.meta.url));
const source = fs.readFileSync(provision, 'utf8');
const refusal = message => { throw Error(`Windows provision refused: ${message}`); };

// Static contract: no static root version survives in the provisioner; install
// declares every root at npm's `latest` dist-tag (rootDeclaration, tested below)
// and only gentle-pi is bound to the reviewed-supplier table.
assert.ok(!source.includes('4.0.0'), 'static gentle-pi 4.0.0 pin removed');
assert.ok(!source.includes("'gentle-pi': ["), 'no pinned [version, integrity] root entries remain');
assert.ok(!source.includes('.gentle-ai/v'), 'hardcoded native version path removed');
assert.ok(source.includes("exclusive(path.join(source, 'package.json'), rootDeclaration(pins));"), 'install declares the roots through rootDeclaration');

function extract(name) {
  const begin = `function ${name}(`;
  const start = source.indexOf(begin);
  assert.ok(start >= 0, `${name} helper present`);
  assert.equal(source.indexOf(begin, start + 1), -1, `${name} helper unique`);
  const end = source.indexOf('\n}', start);
  assert.ok(end > start, `${name} helper terminated`);
  return source.slice(start, end + 2);
}

const sandbox = { fs, path, Buffer, console, setTimeout, reject: refusal, read: file => fs.readFileSync(file) };
sandbox.digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
vm.createContext(sandbox);
for (const name of ['exclusive', 'rootDeclaration', 'rewriteSupplierDeclaration', 'rootAuthorities', 'reviewedSuppliers', 'newestReviewedSupplier', 'supplierFallbackVersion', 'reviewedSupplierEntry', 'reviewedSupplierLock', 'stockNativeDirectory', 'stockNativeIntegrity', 'reviewedSupplierSources']) {
  vm.runInContext(extract(name), sandbox, { filename: `${name}.vm.js` });
}
const run = (code, ...args) => vm.runInContext(code, sandbox, { filename: 'call.vm.js' })(...args);

const names = ['gentle-pi', '@earendil-works/pi-coding-agent', '@earendil-works/pi-tui', '@heyhuynhgiabuu/pi-pretty', 'typebox'];
const sri = bytes => `sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}`;
const record = (name, version, integrity) => ({
  version, integrity, resolved: `https://registry.npmjs.org/${name}/-/${name.split('/').at(-1)}-${version}.tgz`,
});
const lockFixture = (versions, mutations = {}) => ({
  lockfileVersion: 3,
  packages: {
    '': { name: 'gentle-shell-windows-private', dependencies: Object.fromEntries(names.map(name => [name, 'latest'])) },
    ...Object.fromEntries(names.map(name => [`node_modules/${name}`, record(name, versions[name] ?? '1.0.0', sri(name))])),
    ...mutations,
  },
});

let total = 0;
const failures = [];
const scenario = (name, body) => {
  total++;
  try { body(); } catch (error) { failures.push(`${name}: ${error.message}`); }
};

scenario('root-lock-canonical', () => {
  const resolved = run('(lock, list) => rootAuthorities(lock, list)', lockFixture({
    'gentle-pi': '4.3.0', '@earendil-works/pi-coding-agent': '1.3.0', '@earendil-works/pi-tui': '1.3.0',
    '@heyhuynhgiabuu/pi-pretty': '0.7.1', typebox: '1.4.2',
  }), names);
  assert.deepEqual({ ...resolved }, {
    'gentle-pi': '4.3.0', '@earendil-works/pi-coding-agent': '1.3.0', '@earendil-works/pi-tui': '1.3.0',
    '@heyhuynhgiabuu/pi-pretty': '0.7.1', typebox: '1.4.2',
  }, 'exact resolved versions pinned per root package');
});

scenario('root-lock-missing-package-refused', () => {
  const lock = lockFixture({});
  delete lock.packages['node_modules/@earendil-works/pi-tui'];
  lock.packages[''].dependencies = Object.fromEntries(Object.entries(lock.packages[''].dependencies).filter(([name]) => name !== '@earendil-works/pi-tui'));
  assert.throws(() => run('(lock, list) => rootAuthorities(lock, list)', lock, names), /Windows provision refused: root package set/, 'missing root record refused');
});

scenario('root-lock-extra-package-refused', () => {
  const lock = lockFixture({});
  lock.packages[''].dependencies.foreign = 'latest';
  lock.packages['node_modules/foreign'] = record('foreign', '9.9.9', sri('foreign'));
  assert.throws(() => run('(lock, list) => rootAuthorities(lock, list)', lock, names), /Windows provision refused: root package set/, 'extra root package refused');
});

scenario('root-lock-renamed-package-refused', () => {
  const lock = lockFixture({});
  delete lock.packages[''].dependencies['gentle-pi'];
  lock.packages[''].dependencies['gentle-pi-next'] = 'latest';
  assert.throws(() => run('(lock, list) => rootAuthorities(lock, list)', lock, names), /Windows provision refused: root package set/, 'renamed root package refused');
});

scenario('root-lock-static-pin-refused', () => {
  // A stale static expectation (exact old version with its old SRI) must never be
  // the acceptance criterion; the lock's own resolved exact version is.
  const lock = lockFixture({ 'gentle-pi': '4.3.0' });
  assert.doesNotThrow(() => run('(lock, list) => rootAuthorities(lock, list)', lock, names), 'resolved latest accepted without a static pin');
});

for (const [name, version] of [['latest-literal', 'latest'], ['caret-range', '^4.3.0'], ['prerelease', '4.3.0-beta.1'], ['non-string', 4]]) {
  scenario(`root-lock-version-${name}-refused`, () => {
    const lock = lockFixture({});
    lock.packages['node_modules/gentle-pi'].version = version;
    assert.throws(() => run('(lock, list) => rootAuthorities(lock, list)', lock, names), /Windows provision refused: root SRI\/version/, `${name} version refused`);
  });
}

for (const [name, integrity] of [
  ['wrong-algorithm', 'md5-' + 'A'.repeat(86) + '=='],
  ['truncated', 'sha512-AAAA'],
  ['invalid-base64', `sha512-${'!'.repeat(86)}==`],
  ['missing', undefined],
]) {
  scenario(`root-lock-integrity-${name}-refused`, () => {
    const lock = lockFixture({});
    if (integrity === undefined) delete lock.packages['node_modules/gentle-pi'].integrity;
    else lock.packages['node_modules/gentle-pi'].integrity = integrity;
    assert.throws(() => run('(lock, list) => rootAuthorities(lock, list)', lock, names), /Windows provision refused: root SRI\/version/, `${name} integrity refused`);
  });
}

// Reviewed-supplier table: the Windows stock lane resolves gentle-pi only onto
// reviewed releases; an unreviewed `latest` falls back once to the newest
// reviewed version, and every listed-version deviation fails closed.
scenario('reviewed-table-shape', () => {
  const table = run('() => reviewedSuppliers()');
  assert.ok(table['4.3.0'] && table['4.4.0'] && table['4.5.0'], 'reviewed 4.3.0/4.4.0/4.5.0 listed');
  for (const [version, entry] of Object.entries(table)) {
    assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'exact reviewed version');
    assert.match(entry.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/, 'entry binds the npm tarball SRI');
    assert.match(entry.installer, /^[0-9a-f]{64}$/, 'entry binds the installer SHA-256');
    assert.match(entry.binary, /^[0-9a-f]{64}$/, 'entry binds the binary SHA-256');
  }
});

scenario('reviewed-latest-kept', () => {
  const table = run('() => reviewedSuppliers()');
  assert.deepEqual({ ...run('(version, integrity, table) => reviewedSupplierEntry(version, integrity, table)', '4.5.0', table['4.5.0'].integrity, table) }, { ...table['4.5.0'] }, 'reviewed version with matching integrity accepted');
  assert.equal(run('(version, integrity, table) => supplierFallbackVersion(version, integrity, table)', '4.5.0', table['4.5.0'].integrity, table), null, 'no fallback when latest resolves a reviewed version');
});

scenario('unreviewed-latest-falls-back', () => {
  const table = run('() => reviewedSuppliers()');
  assert.equal(run('(version, integrity, table) => supplierFallbackVersion(version, integrity, table)', '4.6.0', sri('unreviewed'), table), '4.5.0', 'unreviewed latest falls back to the newest reviewed version');
});

scenario('listed-wrong-integrity-refused-no-fallback', () => {
  const table = run('() => reviewedSuppliers()');
  assert.equal(run('(version, integrity, table) => reviewedSupplierEntry(version, integrity, table)', '4.3.0', sri('tampered'), table), null, 'listed version with wrong lock integrity refused');
  assert.equal(run('(version, integrity, table) => supplierFallbackVersion(version, integrity, table)', '4.3.0', sri('tampered'), table), null, 'listed version never falls back on an integrity deviation');
});

scenario('lock-gate-keeps-main-overlay-exemption', () => {
  const table = run('() => reviewedSuppliers()');
  const gate = '(action, mainOverlay, version, integrity, table) => reviewedSupplierLock(action, mainOverlay, version, integrity, table)';
  // Main overlay/verify gentle-pi source is bound by the frozen Main ZIP, so an
  // older stock lock (installed before its version was reviewed) stays verifiable.
  for (const action of ['overlay', 'verify']) {
    assert.doesNotThrow(() => run(gate, action, true, '4.2.0', sri('older'), table), `Main ${action} ignores the stock lock version`);
  }
  assert.throws(() => run(gate, 'verify', false, '4.2.0', sri('older'), table),
    /Windows provision refused: stock native supplier source pin/, 'stable verify of an unreviewed lock refused');
  assert.throws(() => run(gate, 'install', false, '4.3.0', sri('tampered'), table),
    /Windows provision refused: stock native supplier source pin/, 'install of a listed version with a different SRI refused');
  assert.doesNotThrow(() => run(gate, 'verify', false, '4.3.0', table['4.3.0'].integrity, table), 'stable verify of a reviewed 4.3.0 lock accepted');
});

scenario('supplier-digest-mismatch-refused', () => {
  const gentle = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'provision-pins-')), 'gentle-pi');
  fs.mkdirSync(path.join(gentle, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(gentle, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(gentle, 'scripts/gentle-ai-installer.mjs'), 'installer');
  fs.writeFileSync(path.join(gentle, 'runtime/gentle-ai-binary.mjs'), 'binary');
  const table = { '4.5.0': { integrity: sri('tarball'), installer: '0'.repeat(64), binary: '0'.repeat(64) } };
  assert.throws(() => run('(gentle, version, table) => reviewedSupplierSources(gentle, version, table)', gentle, '4.5.0', table),
    /Windows provision refused: stock native supplier source pin/, 'supplier digest mismatch refused');
  assert.throws(() => run('(gentle, version, table) => reviewedSupplierSources(gentle, version, table)', gentle, '4.6.0', table),
    /Windows provision refused: stock native supplier source pin/, 'unlisted version at the supplier check refused');
});

scenario('root-declaration-latest', () => {
  const manifest = JSON.parse(run('(names) => rootDeclaration(names)', names));
  assert.deepEqual(Object.keys(manifest), ['name', 'private', 'version', 'dependencies'], 'declaration shape unchanged');
  assert.deepEqual(manifest.dependencies, Object.fromEntries(names.map(name => [name, 'latest'])), 'every root resolves the latest dist-tag');
});

scenario('fallback-rewrite-pins-gentle-pi-and-discards-lock', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'provision-pins-'));
  fs.writeFileSync(path.join(directory, 'package.json'), run('(names) => rootDeclaration(names)', names));
  fs.writeFileSync(path.join(directory, 'package-lock.json'), '{"lockfileVersion":3}');
  run('(directory, names, fallback) => rewriteSupplierDeclaration(directory, names, fallback)', directory, names, '4.5.0');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.dependencies, Object.fromEntries(names.map(name => [name, name === 'gentle-pi' ? '4.5.0' : 'latest'])),
    'gentle-pi pinned to the reviewed fallback, the other roots stay latest');
  assert.equal(fs.existsSync(path.join(directory, 'package-lock.json')), false, 'generated lock discarded before re-resolution');
});

scenario('installer-mismatch-with-matching-binary-refused', () => {
  const gentle = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'provision-pins-')), 'gentle-pi');
  fs.mkdirSync(path.join(gentle, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(gentle, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(gentle, 'scripts/gentle-ai-installer.mjs'), 'tampered installer');
  fs.writeFileSync(path.join(gentle, 'runtime/gentle-ai-binary.mjs'), 'binary');
  const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const table = { '4.5.0': { integrity: sri('tarball'), installer: sha256('installer'), binary: sha256('binary') } };
  assert.throws(() => run('(gentle, version, table) => reviewedSupplierSources(gentle, version, table)', gentle, '4.5.0', table),
    /Windows provision refused: stock native supplier source pin/, 'installer digest mismatch refused even when the binary matches');
});

scenario('supplier-digest-match-accepted', () => {
  const gentle = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'provision-pins-')), 'gentle-pi');
  fs.mkdirSync(path.join(gentle, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(gentle, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(gentle, 'scripts/gentle-ai-installer.mjs'), 'installer');
  fs.writeFileSync(path.join(gentle, 'runtime/gentle-ai-binary.mjs'), 'binary');
  const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const table = { '4.5.0': { integrity: sri('tarball'), installer: sha256('installer'), binary: sha256('binary') } };
  assert.doesNotThrow(() => run('(gentle, version, table) => reviewedSupplierSources(gentle, version, table)', gentle, '4.5.0', table), 'matching reviewed supplier digests accepted');
});

scenario('semver-ordering', () => {
  assert.equal(run('(table) => newestReviewedSupplier(table)', { '4.9.0': {}, '4.10.0': {}, '4.2.0': {} }), '4.10.0', '4.10.0 sorts above 4.9.0');
  assert.equal(run('(table) => newestReviewedSupplier(table)', run('() => reviewedSuppliers()')), '4.5.0', 'newest reviewed table entry selected');
});

function nativeFixture(version) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'provision-pins-'));
  const bundle = path.join(root, '.gentle-ai', `v${version}`);
  fs.mkdirSync(bundle, { recursive: true });
  fs.writeFileSync(path.join(bundle, 'gentle-ai.exe'), 'binary');
  fs.writeFileSync(path.join(bundle, 'integrity.json'), JSON.stringify({
    version, method: 'go-sumdb-source-build', moduleChecksum: `h1:${'A'.repeat(43)}=`, binarySha256: sri('binary'),
  }));
  return root;
}

scenario('native-directory-dynamic', () => {
  const root = nativeFixture('4.3.0');
  const located = run('(nativeRoot) => stockNativeDirectory(nativeRoot)', path.join(root, '.gentle-ai'));
  assert.equal(located.directory, path.join(root, '.gentle-ai', 'v4.3.0'), 'dynamic version directory located');
  assert.equal(located.version, '4.3.0', 'dynamic version read from the directory');
});

for (const [name, versions] of [
  ['missing', []],
  ['foreign-only', ['v4.0.0']],
  ['duplicate-extra', ['v4.3.0', 'v4.0.0']],
]) {
  scenario(`native-directory-${name}-refused`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'provision-pins-'));
    fs.mkdirSync(path.join(root, '.gentle-ai'), { recursive: true });
    for (const label of versions) fs.mkdirSync(path.join(root, '.gentle-ai', label));
    assert.throws(() => run('(nativeRoot, version) => stockNativeDirectory(nativeRoot)', path.join(root, '.gentle-ai')),
      /Windows provision refused: stock native source layout/, `${name} native directory refused`);
  });
}

scenario('native-directory-absent-refused', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'provision-pins-'));
  assert.throws(() => run('(nativeRoot, version) => stockNativeDirectory(nativeRoot)', path.join(root, '.gentle-ai')),
    /Windows provision refused: stock native source layout/, 'absent .gentle-ai refused');
});

scenario('native-directory-file-refused', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'provision-pins-'));
  fs.mkdirSync(path.join(root, '.gentle-ai'), { recursive: true });
  fs.writeFileSync(path.join(root, '.gentle-ai', 'v4.3.0'), 'not a directory');
  assert.throws(() => run('(nativeRoot, version) => stockNativeDirectory(nativeRoot)', path.join(root, '.gentle-ai')),
    /Windows provision refused: stock native source layout/, 'non-directory version entry refused');
});

const nativeSandbox = { path, digest: bytes => sri(bytes), read: file => fs.readFileSync(file), reject: refusal };
const integrityFn = vm.runInNewContext(`(${extract('stockNativeIntegrity')})`, nativeSandbox, { filename: 'integrity.vm.js' });
scenario('native-manifest-canonical', () => {
  const root = nativeFixture('4.3.0');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, '.gentle-ai/v4.3.0/integrity.json')));
  integrityFn(manifest, path.join(root, '.gentle-ai/v4.3.0'), '4.3.0');
});

for (const [name, mutate] of [
  ['version-mismatch', manifest => { manifest.version = '4.0.0'; }],
  ['method-swapped', manifest => { manifest.method = 'signed-release-asset'; }],
  ['checksum-malformed', manifest => { manifest.moduleChecksum = 'changed'; }],
  ['digest-mismatch', manifest => { manifest.binarySha256 = 'owned-native'; }],
]) {
  scenario(`native-manifest-${name}-refused`, () => {
    const root = nativeFixture('4.3.0');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, '.gentle-ai/v4.3.0/integrity.json')));
    mutate(manifest);
    assert.throws(() => integrityFn(manifest, path.join(root, '.gentle-ai/v4.3.0'), '4.3.0'),
    /Windows provision refused: stock native source manifest/, `${name} manifest refused`);
  });
}

// Live evidence that npm's `latest` dist-tag resolves to exact versions with
// SRI, and that the root validator accepts the real generated lock. Skipped
// only when npm or the registry is unavailable; the Guest install itself has
// registry access.
scenario('latest-resolution-live', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'provision-pins-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'gentle-shell-windows-private', private: true, version: '1.0.0',
    dependencies: Object.fromEntries(names.map(name => [name, 'latest'])),
  }));
  const npm = spawnSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--engine-strict', '--no-audit', '--no-fund', '--min-release-age=0', '--registry=https://registry.npmjs.org/'], { cwd: root, encoding: 'utf8', timeout: 240000 });
  if (npm.error || npm.status !== 0) {
    console.log(`SKIP latest-resolution-live: npm unavailable or registry unreachable (${npm.error?.code ?? `status=${npm.status}`})`);
    return;
  }
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  assert.equal(lock.packages[''].dependencies['gentle-pi'], 'latest', 'root spec stays the dist-tag');
  const resolved = run('(lock, list) => rootAuthorities(lock, list)', lock, names);
  for (const name of names) {
    assert.match(resolved[name], /^\d+\.\d+\.\d+$/, `${name} resolved to an exact version`);
    assert.notEqual(resolved[name], name === 'gentle-pi' ? '4.0.0' : '1.0.0', `${name} is not the retired static pin`);
  }
});

console.log(`windows-provision-pins: ${total - failures.length}/${total} scenarios passed`);
for (const failure of failures) console.log(`FAIL ${failure}`);
process.exitCode = failures.length === 0 ? 0 : 1;
