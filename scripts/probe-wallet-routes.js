const { execFileSync } = require('child_process');
const http = require('http');

const ps = `
$conns = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue
foreach ($c in $conns) {
  $p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $c.OwningProcess)
  Write-Output ("PID=" + $p.ProcessId)
  Write-Output ("CMD=" + $p.CommandLine)
  Write-Output ("EXE=" + $p.ExecutablePath)
}
`;

try {
  console.log(execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }));
} catch (e) {
  console.error('ps failed', e.message);
}

function hit(path) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: '192.168.1.6',
        port: 5000,
        path,
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve({ path, status: res.statusCode, body: d.slice(0, 180) }));
      }
    );
    req.on('error', (e) => resolve({ path, err: e.message }));
    req.end('{}');
  });
}

Promise.all([
  hit('/api/v1/ecart/admin/user/adminshortvideoactivate'),
  hit('/api/v1/ecart/admin/user/rechargeecartwallet'),
  hit('/api/v1/ecart/admin/user/getme'),
  hit('/api/v1/shortvideo/admin/rechargeshortvideowallet'),
]).then((r) => console.log(JSON.stringify(r, null, 2)));
