#!/usr/bin/env python3
"""Protect the 2GB host: stop ONLY the trial project under sustained memory pressure."""

from pathlib import Path
import json, subprocess

BUSINESS_SERVICES = [
    "gateway",
    "user-service",
    "calendar-service",
    "diary-service",
    "nacos",
    "redis",
]


def evaluate(available_kb, swap_free_kb, pressure, previous, containers):
    """结合连续压力计数和容器状态判断是否应停止 Cloud，忽略正常退出与已停止项目。"""
    low = available_kb < 100 * 1024 or swap_free_kb < 384 * 1024 or pressure > 20
    count = previous + 1 if low else 0
    running = any(c["State"]["Status"] == "running" for c in containers)
    failed = any(
        c["State"].get("OOMKilled")
        or (c["State"]["Status"] == "exited" and c["State"].get("ExitCode", 0) not in (0, 143))
        for c in containers
    )
    reason = (
        "container failure/OOM" if failed else "sustained memory pressure" if count >= 3 else None
    )
    return count, reason if running else None


def main():
    """读取主机内存和容器状态，必要时只停止 Cloud 业务栈，保留共享数据库和正式服务。"""
    base = Path("/opt/my-life/calendar-cloud-trial/deploy")
    state = base / "state"
    state.mkdir(mode=0o700, exist_ok=True)
    mem = {}
    for line in Path("/proc/meminfo").read_text().splitlines():
        key, values = line.split(":", 1)
        mem[key] = int(values.strip().split()[0])
    pressure = 0.0
    psi = Path("/proc/pressure/memory")
    if psi.exists():
        for field in psi.read_text().splitlines()[0].split():
            if field.startswith("avg10="):
                pressure = float(field.split("=")[1])
    ids = (
        subprocess.check_output(
            [
                "docker",
                "ps",
                "-aq",
                "--filter",
                "label=com.docker.compose.project=calendar-cloud-trial",
            ]
        )
        .decode()
        .split()
    )
    if not ids:
        return
    containers = json.loads(subprocess.check_output(["docker", "inspect", *ids]))
    counter = state / "pressure-count"
    count, reason = evaluate(
        mem["MemAvailable"],
        mem["SwapFree"],
        pressure,
        int(counter.read_text()) if counter.exists() else 0,
        containers,
    )
    counter.write_text(str(count))
    if reason:
        subprocess.run(
            [
                "docker",
                "compose",
                "-f",
                str(base / "compose.yml"),
                "--env-file",
                str(base / ".env"),
                "stop",
                *BUSINESS_SERVICES,
            ],
            check=True,
        )
        message = "Trial automatically stopped: " + reason
        (state / "auto-stopped.txt").write_text(message + "\n")
        print(message + "; shared MySQL and production containers retained.")


if __name__ == "__main__":
    main()
