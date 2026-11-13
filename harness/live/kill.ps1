param([string]$Role = 'fusion')
# Stops only the Obsidian started with this role's profile (never the user's own Obsidian).
Get-CimInstance Win32_Process -Filter "Name='Obsidian.exe'" | Where-Object { $_.CommandLine -like "*obs-profile\$Role*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
