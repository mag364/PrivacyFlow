const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const releaseDir = path.join(root, 'release');
const unpackedDir = path.join(releaseDir, 'win-unpacked');
const folderName = 'PrivacyFlow';
const stagingDir = path.join(releaseDir, folderName);
const zipName = `PrivacyFlow-${pkg.releaseVersion || pkg.version}-x64-folder.zip`;
const zipPath = path.join(releaseDir, zipName);

if (!fs.existsSync(unpackedDir)) {
  console.error(`Missing ${path.relative(root, unpackedDir)}. Run electron-builder first.`);
  process.exit(1);
}

fs.rmSync(stagingDir, { recursive: true, force: true });
fs.rmSync(zipPath, { force: true });
fs.cpSync(unpackedDir, stagingDir, { recursive: true });

const result = spawnSync('zip', ['-qr', zipName, folderName], {
  cwd: releaseDir,
  stdio: 'inherit',
});

fs.rmSync(stagingDir, { recursive: true, force: true });

if (result.status !== 0) {
  process.exit(result.status || 1);
}

console.log(`Created release/${zipName}`);
