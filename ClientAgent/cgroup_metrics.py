"""Read this container's own resource usage from the cgroup filesystem.

Unlike host-level tools (e.g. psutil), this reports what *this container*
consumes, so several agents on one host show distinct figures — provided the
containers have CPU/memory limits set (otherwise the memory denominator is the
whole host/VM and percentages collapse to near-zero).

cgroup v2 is tried first; v1 is used as a fallback for older Docker setups.
"""

import os
import shutil
import time

CGROUP_V2_ROOT = "/sys/fs/cgroup"

# How long to sample CPU usage between two reads, in seconds.
_CPU_SAMPLE_SECONDS = 1.0


def collect_resource_usage():
    """Return (cpu_usage_pct, ram_usage_pct, disk_usage_pct) as floats."""
    return (
        round(_read_cpu_percent(), 1),
        round(_read_ram_percent(), 1),
        round(_read_disk_percent(), 1),
    )


# ── CPU ────────────────────────────────────────────────────────────────

def _read_cpu_percent():
    sample = _cpu_sampler()
    if sample is None:
        return 0.0

    read_usage, get_quota = sample
    usage_start = read_usage()
    time.sleep(_CPU_SAMPLE_SECONDS)
    usage_end = read_usage()

    used_seconds = usage_end - usage_start
    # Divide by the number of CPUs the container may actually use, so a
    # container pinned to 0.5 CPU that is fully busy reports ~100%, not 50%.
    cores = get_quota()
    if cores <= 0:
        cores = os.cpu_count() or 1

    pct = (used_seconds / (_CPU_SAMPLE_SECONDS * cores)) * 100.0
    return max(0.0, min(100.0, pct))


def _cpu_sampler():
    """Return (read_usage_seconds, get_allowed_cores) for the active cgroup version."""
    v2_stat = os.path.join(CGROUP_V2_ROOT, "cpu.stat")
    if os.path.exists(v2_stat):
        def read_usage():
            return _read_kv(v2_stat).get("usage_usec", 0) / 1_000_000.0

        def get_cores():
            return _v2_cpu_cores()

        return read_usage, get_cores

    v1_usage = "/sys/fs/cgroup/cpuacct/cpuacct.usage"
    if os.path.exists(v1_usage):
        def read_usage():
            return _read_int(v1_usage) / 1_000_000_000.0  # nanoseconds → seconds

        def get_cores():
            return _v1_cpu_cores()

        return read_usage, get_cores

    return None


def _v2_cpu_cores():
    # cpu.max holds "<quota> <period>"; "max" means unlimited.
    raw = _read_text(os.path.join(CGROUP_V2_ROOT, "cpu.max"))
    if not raw:
        return 0.0
    parts = raw.split()
    if len(parts) != 2 or parts[0] == "max":
        return 0.0
    quota, period = int(parts[0]), int(parts[1])
    return quota / period if period else 0.0


def _v1_cpu_cores():
    quota = _read_int("/sys/fs/cgroup/cpu/cpu.cfs_quota_us")
    period = _read_int("/sys/fs/cgroup/cpu/cpu.cfs_period_us")
    if quota <= 0 or period <= 0:
        return 0.0
    return quota / period


# ── Memory ─────────────────────────────────────────────────────────────

def _read_ram_percent():
    v2_current = os.path.join(CGROUP_V2_ROOT, "memory.current")
    v2_max = os.path.join(CGROUP_V2_ROOT, "memory.max")
    if os.path.exists(v2_current):
        used = _read_int(v2_current)
        limit = _read_memory_limit(v2_max)
        return _ratio_pct(used, limit)

    v1_usage = "/sys/fs/cgroup/memory/memory.usage_in_bytes"
    v1_limit = "/sys/fs/cgroup/memory/memory.limit_in_bytes"
    if os.path.exists(v1_usage):
        used = _read_int(v1_usage)
        limit = _read_memory_limit(v1_limit)
        return _ratio_pct(used, limit)

    return 0.0


def _read_memory_limit(path):
    raw = _read_text(path)
    if not raw or raw == "max":
        return 0
    try:
        value = int(raw)
    except ValueError:
        return 0
    # cgroup v1 reports a huge sentinel value when unlimited; treat as no limit.
    if value > (1 << 62):
        return 0
    return value


def _ratio_pct(used, limit):
    if limit <= 0:
        return 0.0
    return max(0.0, min(100.0, (used / limit) * 100.0))


# ── Disk ───────────────────────────────────────────────────────────────

def _read_disk_percent():
    # Disk per container is ambiguous; report usage of the container root fs.
    usage = shutil.disk_usage("/")
    if usage.total == 0:
        return 0.0
    return (usage.used / usage.total) * 100.0


# ── Low-level file helpers ─────────────────────────────────────────────

def _read_text(path):
    try:
        with open(path, "r") as fh:
            return fh.read().strip()
    except OSError:
        return ""


def _read_int(path):
    raw = _read_text(path)
    try:
        return int(raw)
    except ValueError:
        return 0


def _read_kv(path):
    result = {}
    for line in _read_text(path).splitlines():
        parts = line.split()
        if len(parts) == 2:
            try:
                result[parts[0]] = int(parts[1])
            except ValueError:
                continue
    return result
