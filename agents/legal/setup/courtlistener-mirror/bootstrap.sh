#!/bin/bash
set -Eeuo pipefail
exec > >(tee -a /var/log/courtlistener-import.log) 2>&1
export AWS_DEFAULT_REGION=us-west-2
JOB_BUCKET=courtlistener-import-547107369396-us-west-2
finish() {
  result=$?
  trap - EXIT
  echo "Importer exit code: $result"
  aws s3 cp /var/log/courtlistener-import.log "s3://$JOB_BUCKET/imports/modernbert-768/worker.log" || true
  shutdown -h now
  exit "$result"
}
trap finish EXIT
# Termination is also enforced if installation or the importer hangs.
systemd-run --unit=courtlistener-deadline --on-active=48h /usr/sbin/shutdown -h now
dnf install -y python3.11 python3.11-pip
mkdir -p /opt/courtlistener
python3.11 -m venv /opt/courtlistener/venv
/opt/courtlistener/venv/bin/pip install 'boto3==1.43.93'
aws s3 cp "s3://$JOB_BUCKET/scripts/import_vectors.py" /opt/courtlistener/import_vectors.py
(
  while sleep 60; do
    aws s3 cp /var/log/courtlistener-import.log "s3://$JOB_BUCKET/imports/modernbert-768/worker.log" --only-show-errors || true
  done
) &
MAX_SECONDS=165600 /opt/courtlistener/venv/bin/python -u /opt/courtlistener/import_vectors.py
