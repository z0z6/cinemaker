'use strict';
// Linux: podmienia plik wykonywalny Electrona na skrypt startowy (build/linux/launcher.sh).
// Dzięki temu deb i AppImage same wybierają, czy Chromium może użyć piaskownicy.
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return;
  const exeName = context.packager.executableName;
  const real = path.join(context.appOutDir, exeName);
  const bin = real + '.bin';
  if (!fs.existsSync(real) || fs.existsSync(bin)) return;
  fs.renameSync(real, bin);
  fs.copyFileSync(path.join(__dirname, 'linux', 'launcher.sh'), real);
  fs.chmodSync(real, 0o755);
  fs.chmodSync(bin, 0o755);
};
