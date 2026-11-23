#!/usr/bin/env python3
"""Read Docker secrets, construct runtime env, then drop privileges before running the worker."""
import os
import pwd
import sys
from urllib.parse import quote

SECRETS_DIR = "/run/secrets"
SECRET_ENV = {
    "s3_access_key": "S3_ACCESS_KEY",
    "s3_secret_key": "S3_SECRET_KEY",
    "model_config_encryption_key": "MODEL_CONFIG_ENCRYPTION_KEY",
}


def read_secret(name: str, required: bool = True) -> str | None:
    path = os.path.join(SECRETS_DIR, name)
    try:
        with open(path, "r", encoding="utf-8") as fh:
            value = fh.read().strip()
    except FileNotFoundError:
        if required:
            raise SystemExit("missing secret: " + name)
        return None
    if not value:
        if required:
            raise SystemExit("empty secret: " + name)
        return None
    return value


def main() -> None:
    for secret_name, env_name in SECRET_ENV.items():
        value = read_secret(secret_name, required=(secret_name != "model_config_encryption_key"))
        if value is not None:
            os.environ[env_name] = value

    pg_password = read_secret("pg_api_password", required=True)
    host = os.environ.get("DB_HOST", "postgres")
    port = os.environ.get("DB_PORT", "5432")
    name = os.environ.get("DB_NAME", "libiaolink")
    os.environ["DATABASE_URL"] = (
        "postgresql://libiaolink_api:" + quote(pg_password, safe="") + "@" + host + ":" + port + "/" + name
    )

    if os.getuid() == 0:
        user = pwd.getpwnam("docworker")
        os.setgid(user.pw_gid)
        os.setuid(user.pw_uid)
        os.environ["HOME"] = user.pw_dir

    os.execvp(sys.executable, [sys.executable, "/app/worker.py", *sys.argv[1:]])


if __name__ == "__main__":
    main()
