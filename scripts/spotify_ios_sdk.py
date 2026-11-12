#!/usr/bin/env python3
"""Download and embed the pinned official Spotify iOS App Remote SDK."""
import argparse
import hashlib
import json
from pathlib import Path
import plistlib
import shlex
import shutil
import subprocess
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
LOCK = json.loads((ROOT / "scripts/spotify-ios-sdk.json").read_text())
RPATH = "@executable_path/Frameworks"


def ensure_sdk(cache=None):
    directory = Path(cache) if cache else ROOT / ".nsh/spotify-ios-sdk"
    directory.mkdir(parents=True, exist_ok=True)
    source = directory / f"ios-sdk-{LOCK['revision']}"
    framework = source / "SpotifyiOS.xcframework"
    if not framework.exists():
        archive = directory / f"{LOCK['revision']}.tar.gz"
        with urllib.request.urlopen(LOCK["archive"], timeout=60) as response, archive.open("wb") as output:
            shutil.copyfileobj(response, output)
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        if digest != LOCK["sha256"]:
            raise RuntimeError(f"Spotify iOS SDK archive hash differs from the pinned release: {digest}")
        with tarfile.open(archive) as package:
            package.extractall(directory, filter="data")
    return framework.resolve()


def build_environment(environment, framework):
    result = dict(environment)
    result["SPOTIFY_IOS_SDK"] = str(framework)
    # A dependency's cargo:rustc-link-arg does not reach its caller's binary.
    # Apply the runtime search path to the actual NSH iOS runner link instead.
    flags = result.get("CARGO_ENCODED_RUSTFLAGS")
    parts = [flag for flag in flags.split("\x1f") if flag] if flags is not None else shlex.split(result.get("RUSTFLAGS", ""))
    parts.extend(["-C", f"link-arg=-Wl,-rpath,{RPATH}"])
    result["CARGO_ENCODED_RUSTFLAGS"] = "\x1f".join(parts)
    return result


def embed_framework(app, target, framework, identity):
    slice_name = "ios-arm64_x86_64-simulator" if target == "ios-simulator" else "ios-arm64"
    source = framework / slice_name / "SpotifyiOS.framework"
    destination = app / "Frameworks/SpotifyiOS.framework"
    shutil.copytree(source, destination)
    binary = destination / "SpotifyiOS"
    if target == "ios-simulator":
        # The distributed simulator binary also contains x86_64. Metrolist's
        # pinned simulator runner is ARM64, so ship exactly its architecture.
        thin = destination / "SpotifyiOS.arm64"
        subprocess.run(["lipo", str(binary), "-thin", "arm64", "-output", str(thin)], check=True)
        thin.replace(binary)
    subprocess.run(["codesign", "--force", "--sign", identity or "-", "--timestamp=none", str(destination)], check=True)
    legal = app / "legal/spotify-ios-sdk"
    legal.mkdir(parents=True, exist_ok=True)
    shutil.copy2(framework.parent / "README.md", legal / "README.md")
    shutil.copytree(framework.parent / "Licenses", legal / "Licenses")
    (legal / "version.json").write_text(json.dumps(LOCK, indent=2) + "\n")


def inspect_framework(app):
    info = plistlib.loads((app / "Info.plist").read_bytes())
    executable = app / info["CFBundleExecutable"]
    libraries = subprocess.check_output(["otool", "-L", str(executable)], text=True)
    expected = "@rpath/SpotifyiOS.framework/SpotifyiOS"
    if expected not in libraries:
        raise RuntimeError("The packaged iOS runner does not link Spotify App Remote.")
    commands = subprocess.check_output(["otool", "-l", str(executable)], text=True)
    if f"path {RPATH} " not in commands:
        raise RuntimeError("The packaged iOS runner has no search path for embedded frameworks.")
    binary = app / "Frameworks/SpotifyiOS.framework/SpotifyiOS"
    architecture = subprocess.check_output(["lipo", "-archs", str(binary)], text=True).strip()
    if architecture != "arm64":
        raise RuntimeError(f"The embedded Spotify framework has unexpected architectures: {architecture}")
    return {"version": LOCK["version"], "revision": LOCK["revision"], "architecture": architecture,
            "framework": "Frameworks/SpotifyiOS.framework", "playback": "Spotify App Remote"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path)
    args = parser.parse_args()
    print(ensure_sdk(args.cache))
