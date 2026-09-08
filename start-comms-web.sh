#!/usr/bin/env bash
set -euo pipefail

DIR="/Users/marcus/code/comms-web"
cd "$DIR"

export PATH="/Users/marcus/.local/share/mise/installs/node/26.5.1/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export PORT=9111
export HOST=127.0.0.1
export NODE_ENV=production

# Rebuild on every start so the served app matches the working tree. A failed
# build must not take the service down, so fall back to the previous build.
if ! pnpm build; then
    echo "build failed; falling back to existing build/" >&2
    if [ ! -f "build/index.js" ]; then
        echo "no previous build to fall back to" >&2
        exit 1
    fi
fi

exec node build/index.js
