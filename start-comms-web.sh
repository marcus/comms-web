#!/usr/bin/env bash
set -euo pipefail

DIR="/Users/marcus/code/comms-web"
cd "$DIR"

export PATH="/Users/marcus/.local/share/mise/installs/node/26.5.1/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export PORT=9111
export HOST=127.0.0.1
export NODE_ENV=production

if [ ! -f "build/index.js" ]; then
    pnpm build
fi

exec node build/index.js
