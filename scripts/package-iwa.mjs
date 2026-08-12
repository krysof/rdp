import { rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const key = process.env.IWA_SIGNING_KEY;

if (!key) {
    throw new Error('Set IWA_SIGNING_KEY to an Ed25519 or ECDSA P-256 PEM private key path.');
}

const unsigned = path.join(root, 'rdp.wbn');
const signed = path.join(root, 'rdp.swbn');
await rm(unsigned, { force: true });
await rm(signed, { force: true });

await run(path.join(root, 'node_modules/wbn/bin/wbn.js'), [
    '--dir', path.join(root, 'dist'),
    '--output', unsigned,
]);
await run(path.join(root, 'node_modules/wbn-sign/bin/wbn-sign.js'), [
    'sign', unsigned, key, '--output', signed,
]);
await rm(unsigned, { force: true });

function run(script, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [script, ...args], {
            cwd: root,
            env: process.env,
            stdio: 'inherit',
        });
        child.on('error', reject);
        child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${script} exited with code ${code}`)));
    });
}
