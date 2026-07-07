#!/bin/bash
# Gera igprospect-extension.zip a partir da pasta extension/
# Rode este script sempre que atualizar o código da extensão, antes de fazer deploy.
set -e
cd "$(dirname "$0")"
rm -f igprospect-extension.zip
cd extension
zip -r ../igprospect-extension.zip . -x ".*"
cd ..
echo "OK: igprospect-extension.zip gerado ($(du -h igprospect-extension.zip | cut -f1))"
