#!/bin/bash
# Checks the authored Imagor deployment files. It does not call AWS.
set -euo pipefail

root=$(cd "$(dirname "$0")/../../../.." && pwd)
dockerfile="${root}/packages/backend/selfhost/imagor/Dockerfile"
bootstrap="${root}/packages/backend/selfhost/bootstrap.sh"
host="${root}/infra/host.ts"
secrets="${root}/infra/secrets.ts"
web="${root}/infra/web.ts"

require() {
  local file=$1
  local pattern=$2
  if ! grep -Eq "$pattern" "$file"; then
    echo "missing /$pattern/ in ${file#"$root"/}" >&2
    exit 1
  fi
}

reject() {
  local file=$1
  local pattern=$2
  if grep -Eq "$pattern" "$file"; then
    echo "forbidden /$pattern/ in ${file#"$root"/}" >&2
    exit 1
  fi
}

require "$dockerfile" "IMAGOR_COMMIT=0daee13ecec5df896f15aef91fcbbb0c87aac935"
require "$dockerfile" "IMAGOR_VERSION=v1.9.7"
require "$dockerfile" 'git -C /src rev-parse HEAD'
reject "$dockerfile" "imagor-unsafe|IMAGOR_UNSAFE"

require "$bootstrap" "SERVER_ADDRESS=127.0.0.1"
require "$bootstrap" "IMAGOR_SIGNER_TYPE=sha256"
require "$bootstrap" "IMAGOR_SIGNER_TRUNCATE=40"
require "$bootstrap" "HTTP_LOADER_DISABLE=1"
require "$bootstrap" "IMAGOR_DISABLE_PARAMS_ENDPOINT=1"
require "$bootstrap" "S3_LOADER_BUCKET="
require "$bootstrap" "sqldev-imagor"
require "$bootstrap" "imagor-ready.sh"
require "$bootstrap" "Requires=docker.service sqldev-imagor.service"
require "$bootstrap" 'IMAGOR_URL=http://127.0.0.1:8000'
require "$bootstrap" "BOOTSTRAP_SHA"
reject "$bootstrap" "IMAGOR_UNSAFE|--publish|-p 8000|-p 127.0.0.1:8000"

require "$host" 'stage}-imagor'
require "$host" "ImagorImage"
require "$host" "imagorSecret"
require "$host" "BOOTSTRAP_SHA"
require "$host" "IMAGOR_IMAGE"
require "$host" "userDataReplaceOnChange: true"
require "$host" "repositoryArn, imagorRepositoryArn"
reject "$host" "ImgproxyUrl|imagor-unsafe"

reject "$secrets" "ImgproxyUrl"
reject "$web" "IMGPROXY_URL|imgproxyUrl"

echo "imagor deployment files match the private host contract"
