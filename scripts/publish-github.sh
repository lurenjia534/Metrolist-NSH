#!/usr/bin/env bash
set -eu
cd "$(dirname "$0")/.."
repository="${1:-lurenjia534/Metrolist-NSH}"
gh auth status
gh repo create "$repository" --public --source=. --remote=github --push --description "Metrolist in NSH: Android, desktop and web music client" --homepage "https://metrolist-nsh-docs.lurenjia534.chatgpt.site/"
git push github --tags
gh repo view "$repository" --json nameWithOwner,isPrivate,url
