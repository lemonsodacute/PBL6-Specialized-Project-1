// The local classroom server must survive independently of a terminal window.
// Remote/production SFUs stay under their own deployment's lifecycle.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const envPath = path.join(root, 'backend', '.env');
const content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
const url = (process.env.LIVEKIT_URL || content.match(/^LIVEKIT_URL=(.*)$/m)?.[1] || '').trim().replace(/^['"]|['"]$/g, '');
if (['ws://localhost:7880', 'ws://127.0.0.1:7880'].includes(url)) {
  if (process.platform !== 'win32') {
    console.info('[classroom] Start the configured local LiveKit server before joining classrooms.');
  } else {
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const result = spawnSync(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'start-classroom-sfu.ps1'), '-Background'], { cwd: root, stdio: 'inherit', windowsHide: true });
    if (result.error || result.status !== 0) {
      console.error('[classroom] Could not start local LiveKit. Follow the diagnostic above; retry with npm run dev:sfu.');
      process.exit(result.status || 1);
    }
  }
}
