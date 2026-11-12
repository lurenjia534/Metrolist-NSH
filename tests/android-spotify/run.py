#!/usr/bin/env python3
"""Compile the actual Android host/Spotify SDK to DEX, then run protocol checks."""
import argparse
import importlib.util
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
spec = importlib.util.spec_from_file_location("android_build", ROOT / "scripts/build-android.py")
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--toolchain", type=Path, default=ROOT.parent / "toolchain")
args = parser.parse_args()
toolchain = args.toolchain.resolve()
sdk = Path(os.environ.get("ANDROID_HOME", toolchain / "android-sdk"))
java = str(Path(os.environ["JAVA_HOME"]) / "bin/java") if "JAVA_HOME" in os.environ else "java"
nsh = Path(os.environ.get("NSH_BIN", toolchain / "nsh/bin/nsh"))
tools = build.sdk_tools(toolchain, sdk)
source, runtime = build.runtime_sources(toolchain, nsh)
jars, _ = build.media3_dependencies(toolchain)
spotify_jars, _ = build.spotify_dependencies(toolchain)
jars.extend(spotify_jars)
work = ROOT / "target/android-spotify-check"
generated = work / "generated"
generated.mkdir(parents=True, exist_ok=True)
build.build_host(source, runtime, sdk, tools, java, work, jars, generated, copy_libraries=False)
classes = work / "protocol-tests"
classes.mkdir(parents=True, exist_ok=True)
classpath = os.pathsep.join(str(path) for path in spotify_jars)
build.run(java, "-m", "jdk.compiler/com.sun.tools.javac.Main", "-source", "17", "-target", "17", "-encoding", "UTF-8",
          "-classpath", classpath, "-d", classes, ROOT / "android/SpotifyProtocol.java",
          ROOT / "tests/android-spotify/SpotifyProtocolTest.java")
build.run(java, "-cp", str(classes) + os.pathsep + classpath, "com.longbridge.nsh.SpotifyProtocolTest")
print("PASS: Android host and official Spotify App Remote SDK compiled to DEX")
