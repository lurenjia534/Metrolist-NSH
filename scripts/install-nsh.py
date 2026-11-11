#!/usr/bin/env python3
"""Install this app's matching NSH CLI and components beside the checkout."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import tarfile
import zipfile

PROJECT = Path(__file__).resolve().parent.parent
LOCK = json.loads((PROJECT / "scripts" / "nsh-toolchain.json").read_text())


def install(target: str, toolchain: Path) -> None:
    item = LOCK["archives"][target]
    filename = item["file"]
    extension = ".zip" if filename.endswith(".zip") else ".tar.gz"
    cached = filename.removesuffix(extension) + "-" + LOCK["commit"] + extension
    archive = toolchain / "downloads" / cached
    archive.parent.mkdir(parents=True, exist_ok=True)
    if not archive.exists():
        base = os.environ.get("NSH_DOWNLOAD_BASE", LOCK["downloadBase"]).rstrip("/")
        temporary = archive.with_name(archive.name + ".part")
        print(f"Downloading {filename} ({LOCK['commit']})", flush=True)
        subprocess.run(["curl", "--fail", "--location", "--silent", "--show-error", "--output", str(temporary), f"{base}/{filename}"], check=True)
        temporary.replace(archive)
    with archive.open("rb") as stream:
        actual = hashlib.file_digest(stream, "sha256").hexdigest()
    if actual != item["sha256"]:
        raise RuntimeError(
            f"{archive.name} does not match NSH {LOCK['commit']}. "
            "The upstream nightly has changed. Restore the pinned archive to the downloads "
            "directory, or set NSH_DOWNLOAD_BASE to a mirror of that release."
        )
    if extension == ".zip":
        with zipfile.ZipFile(archive) as package:
            package.extractall(toolchain)
    else:
        with tarfile.open(archive) as package:
            package.extractall(toolchain, filter="data")
    print(f"Installed {target} ({LOCK['commit']})", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--toolchain", type=Path, default=PROJECT.parent / "toolchain")
    parser.add_argument("--component", action="append", choices=("web", "android", "ios"), default=[])
    args = parser.parse_args()
    toolchain = args.toolchain.resolve()
    system = {"Linux": "linux", "Darwin": "macos", "Windows": "windows"}[platform.system()]
    machine = platform.machine().lower()
    arch = {"arm64": "arm64", "aarch64": "arm64", "amd64": "x86_64", "x86_64": "x86_64"}[machine]
    install(f"{system}-{arch}", toolchain)
    for component in dict.fromkeys(args.component):
        if component == "ios" and (system, arch) != ("macos", "arm64"):
            raise RuntimeError("NSH c5214aa's iOS component requires an Apple Silicon Mac.")
        install(component, toolchain)
    cli = toolchain / "nsh" / "bin" / ("nsh.exe" if system == "windows" else "nsh")
    version = subprocess.check_output([str(cli), "--version"], text=True).strip()
    print(f"{version}\nNSH_BIN={cli}")


if __name__ == "__main__":
    main()
