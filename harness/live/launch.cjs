// node harness/live/launch.cjs <role> <port> <vaultPath>
// (Re)starts a separate Obsidian with its own profile and DevTools port, with background throttling off. The profile
// is the one the gate probes used (FUSION_PROFILES, default C:/Users/joaoo/tabletop-promo-session/obs-profile), where
// the throwaway vault is already trusted.
const fs = require('fs'), path = require('path'), { spawn, execSync } = require('child_process');
const [role = 'fusion', port = '9311', vault = 'C:/Users/joaoo/fusion-gate-vault'] = process.argv.slice(2);
const profiles = process.env.FUSION_PROFILES || 'C:/Users/joaoo/tabletop-promo-session/obs-profile';
const prof = path.join(profiles, role); fs.mkdirSync(prof, { recursive: true });
fs.writeFileSync(path.join(prof, 'obsidian.json'), JSON.stringify({ vaults: { ['promo0000000' + role.padEnd(4, '0')]: { path: vault, ts: 1793700000000, open: true } } }));
try { execSync(`powershell -NoProfile -File "${path.join(__dirname, 'kill.ps1')}" -Role ${role}`); } catch {}
execSync('node -e "setTimeout(()=>{},1500)"');
const exe = process.env.OBSIDIAN_EXE || 'C:/Users/JoãoBento/AppData/Local/Obsidian/Obsidian.exe';
spawn(exe, [`--user-data-dir=${prof}`, `--remote-debugging-port=${port}`, '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion', '--force-device-scale-factor=1'], { detached: true, stdio: 'ignore' }).unref();
console.log('started', role, port);
