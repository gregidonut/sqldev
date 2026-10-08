#!/bin/bash
# Runs on the private host. Database passwords are fetched at boot and written mode 0600.
# BOOTSTRAP_SHA is supplied by user data so a script change replaces the instance.
set -euo pipefail

echo "sqldev bootstrap ${BOOTSTRAP_SHA}"

install -d -m 0700 /opt/sqldev /run/sqldev

volume_token="${DATA_VOLUME_ID//-/}"
device=""
for _ in $(seq 1 90); do
  candidate="/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_${volume_token}"
  if [ -e "$candidate" ]; then
    device=$(readlink -f "$candidate")
    break
  fi
  sleep 2
done
if [ -z "$device" ] || [ ! -b "$device" ]; then
  echo "data volume ${DATA_VOLUME_ID} did not appear" >&2
  exit 1
fi
if ! blkid "$device" >/dev/null 2>&1; then
  mkfs.xfs -L sqldev-data "$device"
fi
install -d /var/lib/sqldev
mount "$device" /var/lib/sqldev
install -d -m 0700 /var/lib/sqldev/postgres /var/lib/sqldev/docker
volume_uuid=$(blkid -s UUID -o value "$device")
grep -q "$volume_uuid" /etc/fstab || printf 'UUID=%s /var/lib/sqldev xfs defaults,nofail 0 2\n' "$volume_uuid" >> /etc/fstab
install -d /etc/docker /etc/systemd/system/docker.service.d
printf '%s\n' '{"data-root":"/var/lib/sqldev/docker"}' > /etc/docker/daemon.json
cat > /etc/systemd/system/docker.service.d/data-volume.conf <<'EOF'
[Unit]
RequiresMountsFor=/var/lib/sqldev
EOF

SECRET_JSON="$(aws secretsmanager get-secret-value --secret-id "${SECRET_ARN}" --query SecretString --output text)"
python3 - "${SECRET_JSON}" <<'PY'
import json, os, pathlib, sys
secret = json.loads(sys.argv[1])
root = pathlib.Path("/run/sqldev")
root.mkdir(mode=0o700, exist_ok=True)
(root / "db.env").write_text(
    "POSTGRES_PASSWORD={postgresPassword}\nJWT_SECRET={jwtSecret}\n".format(**secret),
    encoding="utf-8",
)
admin = "postgres://postgres:{postgresPassword}@127.0.0.1:5432/postgres?sslmode=disable".format(**secret)
# supabase/postgres makes supabase_admin the superuser; only it can create auth.jwt().
roles = "postgres://supabase_admin:{postgresPassword}@127.0.0.1:5432/postgres?sslmode=disable".format(**secret)
worker = "postgres://dbos_worker:{workerPassword}@127.0.0.1:5432/postgres?sslmode=disable".format(**secret)
(root / "worker.env").write_text(
    "\n".join([
        f"AWS_REGION={os.environ['AWS_REGION']}",
        f"APP_NAME={os.environ['APP_NAME']}",
        f"APP_STAGE={os.environ['APP_STAGE']}",
        f"JOB_QUEUE_URL={os.environ['JOB_QUEUE_URL']}",
        f"JOB_TABLE_NAME={os.environ['JOB_TABLE_NAME']}",
        f"JOB_RESULT_BUCKET={os.environ['JOB_RESULT_BUCKET']}",
        f"APP_BUCKET={os.environ['APP_BUCKET']}",
        f"DBOS_SYSTEM_DATABASE_URL={worker}",
        "SKIP_DBOS_MIGRATIONS=true",
        "IMAGOR_URL=http://127.0.0.1:8000",
        f"IMAGOR_SECRET={secret['imagorSecret']}",
        "",
    ]),
    encoding="utf-8",
)
(root / "imagor.env").write_text(
    "\n".join([
        "SERVER_ADDRESS=127.0.0.1",
        "PORT=8000",
        f"IMAGOR_SECRET={secret['imagorSecret']}",
        "IMAGOR_SIGNER_TYPE=sha256",
        "IMAGOR_SIGNER_TRUNCATE=40",
        "IMAGOR_DISABLE_PARAMS_ENDPOINT=1",
        "IMAGOR_DISABLE_ERROR_BODY=1",
        "HTTP_LOADER_DISABLE=1",
        f"AWS_REGION={os.environ['AWS_REGION']}",
        f"S3_LOADER_BUCKET={os.environ['APP_BUCKET']}",
        "IMAGOR_REQUEST_TIMEOUT=30s",
        "IMAGOR_LOAD_TIMEOUT=10s",
        "IMAGOR_PROCESS_TIMEOUT=20s",
        "IMAGOR_PROCESS_CONCURRENCY=1",
        "IMAGOR_PROCESS_QUEUE_SIZE=2",
        "VIPS_MAX_WIDTH=4096",
        "VIPS_MAX_HEIGHT=4096",
        "VIPS_MAX_RESOLUTION=16777216",
        "VIPS_CACHE_SIZE=0",
        "FFMPEG_MAX_ANIMATION_FRAMES=18",
        "",
    ]),
    encoding="utf-8",
)
(root / "migrate.env").write_text(
    "\n".join([
        f"ADMIN_DATABASE_URL={admin}",
        f"ROLES_DATABASE_URL={roles}",
        f"WORKER_DATABASE_URL={worker}",
        f"WORKER_PASSWORD={secret['workerPassword']}",
        "MIGRATIONS_DIR=/migrations",
        "",
    ]),
    encoding="utf-8",
)
for path in root.iterdir():
    path.chmod(0o600)
PY

dnf install -y docker
systemctl daemon-reload
systemctl enable --now docker
aws ecr get-login-password --region "${AWS_REGION}" | docker login --username AWS --password-stdin "${REGISTRY}"

set -a
# shellcheck disable=SC1091
source /run/sqldev/db.env
set +a
docker pull supabase/postgres:17.6.1.136
if ! docker inspect sqldev-db >/dev/null 2>&1; then
  docker run -d --name sqldev-db --restart unless-stopped \
    -p 127.0.0.1:5432:5432 \
    -e POSTGRES_PASSWORD \
    -e JWT_SECRET \
    -e JWT_EXP=3600 \
    -e POSTGRES_DB=postgres \
    -v /var/lib/sqldev/postgres:/var/lib/postgresql/data \
    supabase/postgres:17.6.1.136
fi

for _ in $(seq 1 60); do
  if docker exec sqldev-db pg_isready -U postgres -h localhost; then
    break
  fi
  sleep 2
done

docker pull "${IMAGE}"
docker pull "${IMAGOR_IMAGE}"
docker run --rm --network host --env-file /run/sqldev/migrate.env "${IMAGE}" migrate

cat > /opt/sqldev/imagor-ready.sh <<'EOF'
#!/bin/bash
set -euo pipefail
python3 - <<'PY'
import time
import urllib.request

for _ in range(60):
    try:
        with urllib.request.urlopen("http://127.0.0.1:8000/healthcheck", timeout=2) as response:
            if response.status == 200:
                raise SystemExit(0)
    except SystemExit:
        raise
    except Exception:
        time.sleep(1)
raise SystemExit("imagor did not become ready")
PY
EOF
chmod 755 /opt/sqldev/imagor-ready.sh

cat > /etc/systemd/system/sqldev-imagor.service <<EOF
[Unit]
Description=SQLDev Imagor
After=docker.service
Requires=docker.service

[Service]
Restart=always
RestartSec=5
TimeoutStartSec=90
ExecStartPre=-/usr/bin/docker rm -f sqldev-imagor
ExecStart=/usr/bin/docker run --rm --name sqldev-imagor --network host --env-file /run/sqldev/imagor.env ${IMAGOR_IMAGE}
ExecStartPost=/opt/sqldev/imagor-ready.sh
ExecStop=/usr/bin/docker stop sqldev-imagor

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/sqldev-worker.service <<EOF
[Unit]
Description=SQLDev DBOS worker
After=docker.service sqldev-imagor.service
Requires=docker.service sqldev-imagor.service

[Service]
Restart=always
RestartSec=5
ExecStart=/usr/bin/docker run --rm --name sqldev-worker --network host --env-file /run/sqldev/worker.env ${IMAGE}
ExecStop=/usr/bin/docker stop sqldev-worker

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now sqldev-imagor.service
systemctl enable --now sqldev-worker.service
