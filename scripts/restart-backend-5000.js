const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const killPs = `
$conns = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue
foreach ($c in $conns) {
  $procId = $c.OwningProcess
  if ($procId -and $procId -ne 0) {
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    Write-Output "killed $procId"
  }
}
`;
fs.writeFileSync(path.join(__dirname, '_kill5000.ps1'), killPs);
console.log(execFileSync('powershell.exe', ['-NoProfile', '-File', path.join(__dirname, '_kill5000.ps1')], { encoding: 'utf8' }));

const cwd = path.join(__dirname, '..');
const logFile = path.join(__dirname, '_server-out.log');
const out = fs.openSync(logFile, 'w');
const child = spawn('node', ['./src/server.js'], {
  cwd,
  detached: true,
  stdio: ['ignore', out, out],
  env: process.env,
});
child.unref();
console.log('spawned pid', child.pid, 'cwd', cwd);

setTimeout(() => {
  console.log(fs.readFileSync(logFile, 'utf8').slice(0, 1500));
  process.exit(0);
}, 5000);
