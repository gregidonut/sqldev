#!/bin/bash
# Runs on the private host. Database passwords are fetched at boot and written mode 0600.
set -euo pipefail

install -d -m 0700 /opt/sqldev /run/sqldev /var/lib/sqldev/postgres

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
        "",
    ]),
    encoding="utf-8",
)
(root / "migrate.env").write_text(
    "\n".join([
        f"ADMIN_DATABASE_URL={admin}",
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
docker run --rm --network host --env-file /run/sqldev/migrate.env "${IMAGE}" migrate

cat > /etc/systemd/system/sqldev-worker.service <<EOF
[Unit]
Description=SQLDev DBOS worker
After=docker.service
Requires=docker.service

[Service]
Restart=always
RestartSec=5
ExecStart=/usr/bin/docker run --rm --name sqldev-worker --network host --env-file /run/sqldev/worker.env ${IMAGE}
ExecStop=/usr/bin/docker stop sqldev-worker

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now sqldev-worker.service
