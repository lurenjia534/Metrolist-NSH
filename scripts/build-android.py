#!/usr/bin/env python3
"""Build the NSH Android APK and its small Java host without Gradle or Rust."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import secrets
import shutil
import struct
import subprocess
import tarfile
import zipfile
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

PROJECT = Path(__file__).resolve().parent.parent
BUILD_TOOLS = "35.0.1"
ANDROID_API = "35"
NSH_TOOLCHAIN = json.loads((PROJECT / "scripts" / "nsh-toolchain.json").read_text())
RUNTIME_COMMIT = NSH_TOOLCHAIN["commit"]
GOOGLE = "https://dl.google.com/android/repository/"


def run(*args: str | Path, **options) -> None:
    subprocess.run([str(value) for value in args], check=True, **options)


def digest(path: Path, algorithm="sha256") -> str:
    result = hashlib.new(algorithm)
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def source_revision() -> dict:
    revision = {"gitCommit": None, "gitDirty": None}
    if shutil.which("git"):
        commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=PROJECT, capture_output=True, text=True)
        if commit.returncode == 0:
            status = subprocess.run(["git", "status", "--porcelain", "--untracked-files=normal"], cwd=PROJECT, capture_output=True, text=True, check=True)
            revision = {"gitCommit": commit.stdout.strip(), "gitDirty": bool(status.stdout.strip())}
    return revision


def elf_alignment(libraries: Path) -> dict:
    result = {}
    for library in sorted(libraries.glob("*/libnsh.so")):
        data = library.read_bytes()
        endian = "<" if data[5] == 1 else ">"
        bits = data[4]
        if bits == 2:
            offset = struct.unpack_from(endian + "Q", data, 32)[0]
            size, count = struct.unpack_from(endian + "HH", data, 54)
        else:
            offset = struct.unpack_from(endian + "I", data, 28)[0]
            size, count = struct.unpack_from(endian + "HH", data, 42)
        loads = []
        for index in range(count):
            start = offset + index * size
            if struct.unpack_from(endian + "I", data, start)[0] != 1:
                continue
            if bits == 2:
                file_offset, address, alignment = [struct.unpack_from(endian + "Q", data, start + field)[0] for field in (8, 16, 48)]
            else:
                file_offset, address, alignment = [struct.unpack_from(endian + "I", data, start + field)[0] for field in (4, 8, 28)]
            if alignment < 16384 or file_offset % 16384 != address % 16384:
                raise RuntimeError(f"{library.parent.name} PT_LOAD is not compatible with 16 KiB pages")
            loads.append(alignment)
        result[library.parent.name] = {"bytes": library.stat().st_size, "loadSegmentAlignments": loads, "pageSize16KiB": True}
    return result


def download(url: str, destination: Path, expected: str, algorithm="sha256") -> Path:
    if not destination.exists():
        print(f"Downloading {destination.name}", flush=True)
        destination.parent.mkdir(parents=True, exist_ok=True)
        run("curl", "--fail", "--location", "--connect-timeout", "20", "--output", destination, url)
    if digest(destination, algorithm) != expected:
        raise RuntimeError(f"Checksum mismatch: {destination}")
    return destination


def extract_zip(archive: Path, destination: Path) -> None:
    with zipfile.ZipFile(archive) as package:
        package.extractall(destination)
        for item in package.infolist():
            mode = item.external_attr >> 16
            if mode & 0o111:
                (destination / item.filename).chmod(mode & 0o777)


def sdk_tools(toolchain: Path, sdk: Path) -> Path:
    tools = sdk / "build-tools" / BUILD_TOOLS
    if not tools.exists():
        # Fixed Google SDK archives, also available through sdkmanager.
        host = platform.system()
        archives = {
            "Linux": ("build-tools_r35.0.1_linux.zip", "e009a9b188cfeb1d2b4c318ab5cb4f1ddc368861"),
        }
        if host not in archives:
            raise RuntimeError('Install Android SDK build-tools;35.0.1 and platforms;android-35, then set ANDROID_HOME.')
        name, sha1 = archives[host]
        archive = download(GOOGLE + name, toolchain / "downloads" / name, sha1, "sha1")
        extract_zip(archive, sdk / "build-tools")
        (sdk / "build-tools" / "android-15").rename(tools)
    android_jar = sdk / "platforms" / f"android-{ANDROID_API}" / "android.jar"
    if not android_jar.exists():
        name = "platform-35_r02.zip"
        archive = download(GOOGLE + name, toolchain / "downloads" / name, "0bb560a90a7a2cbd0dd8348224d518b638fe7949", "sha1")
        extract_zip(archive, sdk / "platforms")
    return tools


def runtime_sources(toolchain: Path, nsh: Path) -> tuple[Path, Path]:
    version = subprocess.check_output([str(nsh), "--version"], text=True).strip()
    if f"({RUNTIME_COMMIT} " not in version:
        raise RuntimeError(f"This Android host needs NSH {RUNTIME_COMMIT}; found {version}. Run scripts/install-nsh.py --component android.")
    dist = nsh.resolve().parent.parent
    runtime = dist / "runtime" / "android" / "release"
    if not (runtime / "classes.dex").exists():
        item = NSH_TOOLCHAIN["archives"]["android"]
        base = os.environ.get("NSH_DOWNLOAD_BASE", NSH_TOOLCHAIN["downloadBase"]).rstrip("/")
        archive = download(f"{base}/{item['file']}", toolchain / "downloads" / f"nsh-android-{RUNTIME_COMMIT}.tar.gz", item["sha256"])
        with tarfile.open(archive) as package:
            for item in package.getmembers():
                if item.isfile():
                    target = dist / Path(item.name).relative_to("nsh")
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(package.extractfile(item).read())
    metadata = json.loads((dist / "components" / "android.json").read_text())
    if metadata["commit"] != RUNTIME_COMMIT:
        raise RuntimeError(f"This host build uses NSH {RUNTIME_COMMIT}; found {metadata['commit']}. Keep the matching NSH distribution for this release.")
    source = toolchain / "nsh-android-source"
    if not (source / "com" / "longbridge" / "nsh" / "NshView.java").exists():
        archive = download(NSH_TOOLCHAIN["source"]["url"], toolchain / "downloads" / f"nsh-source-{RUNTIME_COMMIT}.tar.gz", NSH_TOOLCHAIN["source"]["sha256"])
        with tarfile.open(archive) as package:
            for item in package.getmembers():
                if item.isfile() and "/crates/nsh-platform-android/java/" in item.name:
                    target = source / item.name.split("/java/", 1)[1]
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(package.extractfile(item).read())
    return source, runtime


def media3_dependencies(toolchain: Path) -> tuple[list[Path], list[Path]]:
    """Use the pinned official Maven artifacts; no Gradle/Maven is needed to rebuild."""
    manifest = json.loads((PROJECT / "android" / "media3-dependencies.json").read_text())
    jars, aars = [], []
    for item in manifest["artifacts"]:
        artifact = download(item["url"], toolchain / "media3" / item["file"], item["sha256"])
        if artifact.suffix == ".jar":
            jars.append(artifact)
        else:
            directory = toolchain / "media3" / artifact.stem
            if not (directory / "classes.jar").exists():
                extract_zip(artifact, directory)
            jars.append(directory / "classes.jar")
            jars.extend(sorted((directory / "libs").glob("*.jar")))
            aars.append(directory)
    return jars, aars


def build_host(source: Path, runtime: Path, sdk: Path, tools: Path, java: str, work: Path,
               jars: list[Path], generated: Path) -> Path:
    prepared = work / "source"
    classes = work / "classes"
    shutil.rmtree(prepared, ignore_errors=True)
    shutil.rmtree(classes, ignore_errors=True)
    shutil.copytree(source, prepared)
    for host_source in (PROJECT / "android").glob("*.java"):
        shutil.copy2(host_source, prepared / "com" / "longbridge" / "nsh" / host_source.name)
    activity = prepared / "com" / "longbridge" / "nsh" / "AppActivity.java"
    text = activity.read_text()
    text = text.replace("private NshView view;", "private NshView view;\n    private MetrolistHost metrolist;")
    text = text.replace("view.useStandaloneLimits();", "view.useStandaloneLimits();\n        metrolist = new MetrolistHost(this, view);")
    text = text.replace("if (view == null || !view.handleBack()) super.onBackPressed();", "if (view == null || !view.handleBack()) moveTaskToBack(true);")
    text = text.replace("        view.destroy();", "        metrolist.close();\n        view.destroy();")
    text = text.replace("    @Override\n    protected void onDestroy()", "    @Override\n    protected void onActivityResult(int request, int result, android.content.Intent data) {\n        if (!metrolist.onActivityResult(request, result, data)) super.onActivityResult(request, result, data);\n    }\n\n    @Override\n    protected void onDestroy()")
    activity.write_text(text)
    classes.mkdir(parents=True)
    android_jar = sdk / "platforms" / f"android-{ANDROID_API}" / "android.jar"
    classpath = os.pathsep.join(str(item) for item in [android_jar, *jars])
    run(java, "-m", "jdk.compiler/com.sun.tools.javac.Main", "-source", "17", "-target", "17", "-Xlint:-options", "-encoding", "UTF-8", "-classpath", classpath, "-d", classes, *sorted(prepared.rglob("*.java")), *sorted(generated.rglob("*.java")))
    jar = work / "classes.jar"
    with zipfile.ZipFile(jar, "w", compression=zipfile.ZIP_DEFLATED) as package:
        for item in sorted(classes.rglob("*.class")):
            package.writestr(zipfile.ZipInfo(item.relative_to(classes).as_posix()), item.read_bytes())
    overlay = work / "runtime"
    release = overlay / "android" / "release"
    release.mkdir(parents=True, exist_ok=True)
    for previous in release.glob("classes*.dex"):
        previous.unlink()
    run(java, "-cp", tools / "lib" / "d8.jar", "com.android.tools.r8.D8", "--release", "--min-api", "26", "--lib", android_jar, "--output", release, jar, *jars)
    shutil.copytree(runtime / "lib", release / "lib", dirs_exist_ok=True)
    return overlay


def signing(toolchain: Path, args, java: str) -> tuple[Path, str]:
    directory = toolchain / "signing"
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    keystore = Path(args.keystore).resolve() if args.keystore else directory / "metrolist-release.jks"
    password_file = Path(args.password_file).resolve() if args.password_file else directory / "metrolist-password"
    password = os.environ.get("NSH_KEYSTORE_PASSWORD")
    if password is None:
        if not password_file.exists():
            password_file.write_text(secrets.token_urlsafe(36))
            password_file.chmod(0o600)
        password = password_file.read_text().strip()
    if not keystore.exists():
        env = {**os.environ, "NSH_KEYSTORE_PASSWORD": password}
        run(java, "-m", "java.base/sun.security.tools.keytool.Main", "-genkeypair", "-keystore", keystore, "-storepass:env", "NSH_KEYSTORE_PASSWORD", "-keypass:env", "NSH_KEYSTORE_PASSWORD", "-alias", args.alias, "-keyalg", "RSA", "-keysize", "3072", "-validity", "10000", "-dname", "CN=Metrolist NSH, O=Miku, C=CN", env=env)
        keystore.chmod(0o600)
    return keystore, password


def media_manifest(apk: Path, work: Path, metadata: dict, sdk: Path, tools: Path, java: str,
                   version: str, build: int, keystore: Path, alias: str, env: dict,
                   source: Path, runtime: Path, jars: list[Path], aars: list[Path]) -> Path:
    """Link app + Media3 resources, generate their R classes, then compile the final host."""
    resources = work / "media-resources"
    shutil.rmtree(resources, ignore_errors=True)
    with zipfile.ZipFile(apk) as package:
        for item in package.infolist():
            if item.filename.startswith("res/") and not item.is_dir():
                target = resources / item.filename
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(package.read(item))
    packages = []
    for library in aars:
        for resource in sorted((library / "res").rglob("*")):
            if resource.is_file():
                relative = resource.relative_to(library / "res")
                filename = re.sub(r"[^a-z0-9_]", "_", library.name.lower() + "_" + resource.stem.lower()) + resource.suffix if relative.parent.name.startswith("values") else relative.name
                target = resources / "res" / relative.parent / filename
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(resource, target)
        if (library / "R.txt").exists() and (library / "R.txt").read_text().strip():
            packages.append(ET.parse(library / "AndroidManifest.xml").getroot().attrib["package"])
    manifest = work / "AndroidManifest.xml"
    xml = (PROJECT / "android" / "AndroidManifest.xml").read_text().format(
        application_id=escape(metadata["id"], {'"': "&quot;"}),
        application_name=escape(metadata["name"], {'"': "&quot;"}),
        cleartext="true",
    )
    manifest.write_text(xml)
    aapt = tools / ("aapt2.exe" if os.name == "nt" else "aapt2")
    compiled = work / "media-resources.zip"
    base = work / "media-base.apk"
    generated = work / "generated"
    shutil.rmtree(generated, ignore_errors=True)
    generated.mkdir(parents=True)
    run(aapt, "compile", "--dir", resources / "res", "-o", compiled)
    run(aapt, "link", "-I", sdk / "platforms" / f"android-{ANDROID_API}" / "android.jar", "--manifest", manifest,
        "--min-sdk-version", "26", "--target-sdk-version", ANDROID_API, "--version-code", str(build), "--version-name", version,
        "--java", generated, "--extra-packages", ":".join(packages), "-o", base, compiled)
    overlay = build_host(source, runtime, sdk, tools, java, work, jars, generated)
    unsigned = work / "media-unsigned.apk"
    with zipfile.ZipFile(unsigned, "w") as output:
        with zipfile.ZipFile(base) as package:
            for item in package.infolist():
                output.writestr(item, package.read(item))
        with zipfile.ZipFile(apk) as package:
            for item in package.infolist():
                if item.filename in ("AndroidManifest.xml", "resources.arsc") or item.filename.startswith(("res/", "META-INF/")) or (item.filename.startswith("classes") and item.filename.endswith(".dex")):
                    continue
                if item.filename == "assets/nsh/app.json":
                    app = json.loads(package.read(item))
                    app["id"] = metadata["id"]
                    output.writestr(item, json.dumps(app, ensure_ascii=False, separators=(",", ":")))
                else:
                    output.writestr(item, package.read(item))
        for dex in sorted((overlay / "android" / "release").glob("classes*.dex")):
            output.write(dex, dex.name, compress_type=zipfile.ZIP_DEFLATED)
        output.write(PROJECT / "android" / "THIRD_PARTY_NOTICES.md", "assets/legal/THIRD_PARTY_NOTICES.md", compress_type=zipfile.ZIP_DEFLATED)
        output.write(PROJECT / "scripts" / "portable" / "NSH-LICENSE-APACHE.txt", "assets/legal/Apache-2.0.txt", compress_type=zipfile.ZIP_DEFLATED)
        output.write(PROJECT / "COPYING", "assets/legal/GPL-3.0.txt", compress_type=zipfile.ZIP_DEFLATED)
    aligned = work / "media-signed.apk"
    run(tools / ("zipalign.exe" if os.name == "nt" else "zipalign"), "-P", "16", "-f", "4", unsigned, aligned)
    run(java, "-jar", tools / "lib" / "apksigner.jar", "sign", "--ks", keystore, "--ks-key-alias", alias,
        "--ks-pass", "env:NSH_KEYSTORE_PASSWORD", aligned, env=env)
    return aligned


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--toolchain", default=str(PROJECT.parent / "toolchain"))
    parser.add_argument("--nsh", default=os.environ.get("NSH_BIN"))
    parser.add_argument("--sdk", default=os.environ.get("ANDROID_HOME", os.environ.get("ANDROID_SDK_ROOT")))
    parser.add_argument("--keystore")
    parser.add_argument("--password-file")
    parser.add_argument("--alias", default="metrolist")
    parser.add_argument("--out", default=str(PROJECT / "releases" / "android"))
    parser.add_argument("--app-version")
    parser.add_argument("--build", type=int)
    parser.add_argument("--abi", default="arm64-v8a,armeabi-v7a,x86_64", help="Comma-separated Android ABIs; arm64-v8a produces the smaller phone APK")
    parser.add_argument("--application-id", help="Android package and NSH app ID for a parallel install")
    parser.add_argument("--application-name", help="Android launcher label and NSH app name")
    args = parser.parse_args()
    toolchain = Path(args.toolchain).resolve()
    toolchain.mkdir(parents=True, exist_ok=True)
    nsh = Path(args.nsh or toolchain / "nsh" / "bin" / ("nsh.exe" if os.name == "nt" else "nsh")).resolve()
    sdk = Path(args.sdk or toolchain / "android-sdk").resolve()
    java = str(Path(os.environ["JAVA_HOME"]) / "bin" / ("java.exe" if os.name == "nt" else "java")) if "JAVA_HOME" in os.environ else "java"
    tools = sdk_tools(toolchain, sdk)
    source, runtime = runtime_sources(toolchain, nsh)
    jars, aars = media3_dependencies(toolchain)
    native_alignment = elf_alignment(runtime / "lib")
    revision = source_revision()
    work = PROJECT / ".nsh" / "android-build"
    keystore, password = signing(toolchain, args, java)
    metadata = json.loads((PROJECT / "nsh.json").read_text())
    source_name = metadata["name"]
    if args.application_id:
        metadata["id"] = args.application_id
    if args.application_name:
        metadata["name"] = args.application_name
    version = args.app_version or metadata["version"]
    build = args.build if args.build is not None else metadata["build"]
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "ANDROID_HOME": str(sdk), "NSH_RUNTIME": str(runtime.parent.parent), "NSH_KEYSTORE_PASSWORD": password}
    run(nsh, "package", "--target", "android", "--abi", args.abi, "--keystore", keystore, "--key-alias", args.alias, "--app-version", version, "--build", str(build), "--out", work / "package", cwd=PROJECT, env=env)
    suffix = "arm64" if args.abi == "arm64-v8a" else "universal" if "," in args.abi else args.abi
    apk = out / f"Metrolist-{version}-{suffix}.apk"
    completed = media_manifest(work / "package" / f"{source_name}.apk", work, metadata, sdk, tools, java,
                               version, build, keystore, args.alias, env, source, runtime, jars, aars)
    shutil.copy2(completed, apk)
    run(java, "-jar", tools / "lib" / "apksigner.jar", "verify", "--verbose", "--print-certs", apk)
    run(tools / ("zipalign.exe" if os.name == "nt" else "zipalign"), "-c", "-P", "16", "4", apk)
    checksum = digest(apk)
    apk.with_suffix(".apk.sha256").write_text(f"{checksum}  {apk.name}\n")
    report = {"file": apk.name, "bytes": apk.stat().st_size, "sha256": checksum, "applicationId": metadata["id"], "version": version, "versionCode": build, "minimumAndroidApi": 26, "targetAndroidApi": int(ANDROID_API), "abis": args.abi.split(","), "nshRuntimeCommit": RUNTIME_COMMIT, "nativeLibraries": {abi: native_alignment[abi] for abi in args.abi.split(",")}, "foregroundMediaPlayback": True, "audioEngine": "Media3 ExoPlayer 1.10.1", "audioCacheBytes": 1073741824, "audioBufferMs": {"minimum": 50000, "maximum": 50000, "playback": 750, "rebuffer": 2000}, **revision, "appSourceSha256": digest(PROJECT / "App.tsx"), "hostSourceSha256": digest(PROJECT / "android" / "MetrolistHost.java"), "audioSourceSha256": digest(PROJECT / "android" / "MetrolistAudio.java"), "mediaServiceSourceSha256": digest(PROJECT / "android" / "MetrolistMediaService.java"), "androidManifestSourceSha256": digest(PROJECT / "android" / "AndroidManifest.xml"), "buildScriptSha256": digest(Path(__file__))}
    (out / "build-info.json").write_text(json.dumps(report, indent=2) + "\n")
    print(f"Built {apk} ({apk.stat().st_size:,} bytes)")
    print(f"SHA-256 {checksum}")
    print(f"Signing key remains outside the app source: {keystore}")


if __name__ == "__main__":
    main()
