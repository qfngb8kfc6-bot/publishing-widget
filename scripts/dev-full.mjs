import { spawn } from 'node:child_process';
import process from 'node:process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [];
let shuttingDown = false;

function run(command, args, env = process.env) {
  const child = spawn(command, args, { stdio: 'inherit', env });
  children.push(child);
  return child;
}

function stopAll(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(exitCode), 250);
}

const build = run(npmCommand, ['run', 'build:server']);
build.once('exit', (code) => {
  if (code !== 0) {
    stopAll(code ?? 1);
    return;
  }
  const apiPort = process.env.API_PORT ?? '8787';
  const api = run(process.execPath, ['server-entry.mjs'], { ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'development', PORT: apiPort });
  api.once('exit', (apiCode) => { if (!shuttingDown) stopAll(apiCode ?? 1); });
  const vite = run(npmCommand, ['run', 'dev'], { ...process.env, API_PROXY_TARGET: process.env.API_PROXY_TARGET ?? `http://localhost:${apiPort}` });
  vite.once('exit', (viteCode) => { if (!shuttingDown) stopAll(viteCode ?? 0); });
});

process.once('SIGINT', () => stopAll(0));
process.once('SIGTERM', () => stopAll(0));
