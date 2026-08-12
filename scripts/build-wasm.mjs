import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const crate = path.join(root, 'crates', 'ironrdp-iwa');
const glue = path.join(crate, 'pkg', 'ironrdp_web.js');
const adapterPackage = path.join(root, 'vendor', 'IronRDP', 'crates', 'ironrdp-web', 'pkg');

const rustFlags = [
    '-Ctarget-feature=+simd128,+bulk-memory',
    '--cfg getrandom_backend="wasm_js"',
    '-Copt-level=s',
    '-Ccodegen-units=1',
].join(' ');

await run('wasm-pack', ['build', '--release', '--target', 'web', '--out-name', 'ironrdp_web'], crate, {
    ...process.env,
    RUSTUP_TOOLCHAIN: process.env.RUSTUP_TOOLCHAIN ?? '1.94.1',
    RUSTFLAGS: rustFlags,
});

// IronRDP applies the same rewrite in `cargo xtask web build`. It lets Vite
// treat the generated WASM binary as an asset and keeps relative Pages URLs.
let glueSource = await readFile(glue, 'utf8');
const urlExpression = "new URL('ironrdp_web_bg.wasm', import.meta.url)";
const urlImport = "import wasmUrl from './ironrdp_web_bg.wasm?url';";

if (glueSource.includes(urlExpression)) {
    glueSource = `${urlImport}\n\n${glueSource.replaceAll(urlExpression, 'wasmUrl')}`;
    await writeFile(glue, glueSource, 'utf8');
}

// The upstream TypeScript adapter imports this conventional package path.
// Populate it from our IWA transport crate without changing the submodule.
await rm(adapterPackage, { recursive: true, force: true });
await mkdir(adapterPackage, { recursive: true });
await cp(path.join(crate, 'pkg'), adapterPackage, { recursive: true });

function run(command, args, cwd, env) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd,
            env,
            shell: process.platform === 'win32',
            stdio: 'inherit',
        });

        child.on('error', reject);
        child.on('exit', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`${command} exited with code ${code}`));
            }
        });
    });
}
