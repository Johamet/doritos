# doritos v1.0.0 - simple bot

- Requirements

> Bun [bun.sh](https://bun.sh)

- Install Bun

```bash
# Linux && macOS
curl -fsSL https://bun.sh/install | bash
# Windows
powershell -c "irm bun.sh/install.ps1 | iex"
```

- Run

```bash
bun run start
```

- Configuration (.env)

```env
# development - production - test | default: development
NODE_ENV="development"
# default: "auth"
AUTH_DIR="auth"
# phone number where the 8-digit code (OTP) will be requested
BOT_PN="XXXXXXXXX"
# default: !
BOT_PREFIX="!"
```

Developed by Jose Daniel [jzszdznzzl](https://github.com/jzszdznzzl)
