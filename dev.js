const { spawn } = require('node:child_process');

const isWindows = process.platform === 'win32';
const npmCommand = isWindows ? 'npm.cmd' : 'npm';
const children = new Set();
let shuttingDown = false;

function runNpm(args, label) {
  console.log(`\n[dev] Starting ${label}: npm ${args.join(' ')}`);
  const child = spawn(npmCommand, args, {
    stdio: 'inherit',
    shell: isWindows,
    env: process.env,
  });
  children.add(child);
  child.on('exit', (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;
    if (label === 'research self-tests' && code !== 0) {
      console.error('[dev] Research self-tests failed; app and collector will not be started.');
      shutdown(code || 1);
      return;
    }
    if (label !== 'research self-tests' && code !== 0 && code !== null) {
      console.error(`[dev] ${label} exited with code ${code}${signal ? ` (signal ${signal})` : ''}.`);
    }
  });
  child.on('error', (error) => {
    console.error(`[dev] Could not start ${label}:`, error.message);
    if (label === 'research self-tests') shutdown(1);
  });
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    try { child.kill('SIGINT'); } catch {}
  }
  setTimeout(() => process.exit(code), 300);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log('Wingo Intelligence development launcher');
console.log('1/2 Running research/data-integrity self-tests before startup.');
const tests = runNpm(['run', 'research-test'], 'research self-tests');
tests.on('exit', (code) => {
  if (shuttingDown || code !== 0) return;
  console.log('\n[dev] Self-tests passed. Starting collector and Next.js together.');
  console.log('[dev] Stop both processes with Ctrl+C.');
  runNpm(['run', 'collector'], 'data collector');
  runNpm(['run', 'dev:next'], 'Next.js development server');
});
