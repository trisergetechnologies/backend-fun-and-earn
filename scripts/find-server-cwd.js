const fs = require('fs');
const { execFileSync } = require('child_process');

const script = `
$ErrorActionPreference = 'Stop'
$id = (Get-NetTCPConnection -LocalPort 5000 -State Listen | Select-Object -First 1 -ExpandProperty OwningProcess)
Write-Output "PID=$id"
$p = Get-CimInstance Win32_Process -Filter "ProcessId=$id"
Write-Output "CMD=$($p.CommandLine)"
# Resolve cwd via process handle (Windows 8+)
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class ProcCwd {
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool QueryFullProcessImageName(IntPtr h, int flags, StringBuilder name, ref int size);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool CloseHandle(IntPtr h);
}
"@
$h = [ProcCwd]::OpenProcess(0x1000, $false, [int]$id)
$sb = New-Object System.Text.StringBuilder 1024
$size = 1024
[void][ProcCwd]::QueryFullProcessImageName($h, 0, $sb, [ref]$size)
Write-Output "IMG=$($sb.ToString())"
[void][ProcCwd]::CloseHandle($h)
`;

fs.writeFileSync('scripts/_cwd.ps1', script);
console.log(execFileSync('powershell.exe', ['-NoProfile', '-File', 'scripts/_cwd.ps1'], { encoding: 'utf8' }));
