#!/usr/bin/env python3
"""Install this app's matching NSH CLI and components beside the checkout."""

import argparse
from pathlib import Path
import platform
import subprocess
import tarfile
import zipfile
from nsh_archives import PROJECT, LOCK, fetch_archive


def install(target: str, toolchain: Path) -> None:
    item = LOCK["archives"][target]
    archive = fetch_archive(target, toolchain)
    if item['file'].endswith('.zip'):
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
