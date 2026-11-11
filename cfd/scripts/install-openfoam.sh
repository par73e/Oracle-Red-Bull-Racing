#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update
sudo apt-get install -y --no-install-recommends ca-certificates curl gnupg
curl -fsSL https://dl.openfoam.org/gpg.key | sudo tee /etc/apt/trusted.gpg.d/openfoam.asc >/dev/null
printf '%s\n' 'deb http://dl.openfoam.org/ubuntu noble main' | sudo tee /etc/apt/sources.list.d/aero-openfoam.list
sudo apt-get update
sudo apt-get install -y --no-install-recommends openfoam14
