// SPDX-License-Identifier: GPL-3.0-only
//! Builds the iOS App Remote adapter into the app's native crate.

use std::{env, path::PathBuf};

fn main() {
    println!("cargo:rerun-if-env-changed=SPOTIFY_IOS_SDK");
    println!("cargo:rerun-if-changed=src/spotish/mobile/ios_bridge.m");
    println!("cargo:rerun-if-changed=src/spotish/mobile/ios_bridge.h");
    println!("cargo:rerun-if-changed=src/spotish/mobile/ios_auth.m");
    println!("cargo:rerun-if-changed=src/spotish/mobile/ios_auth.h");
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("ios") {
        return;
    }
    let sdk = PathBuf::from(env::var_os("SPOTIFY_IOS_SDK").expect(
        "Run python scripts/spotify_ios_sdk.py and set SPOTIFY_IOS_SDK to its xcframework path; scripts/build-ios.py does this automatically",
    ));
    let target = env::var("TARGET").unwrap();
    let slice = if target.ends_with("-sim") || target.starts_with("x86_64-") {
        "ios-arm64_x86_64-simulator"
    } else {
        "ios-arm64"
    };
    let framework = sdk.join(slice);
    cc::Build::new()
        .file("src/spotish/mobile/ios_auth.m")
        .file("src/spotish/mobile/ios_bridge.m")
        .flag("-fobjc-arc")
        .flag("-fblocks")
        .flag("-F")
        .flag(framework.to_str().unwrap())
        .compile("metrolist_spotify_ios");
    println!("cargo:rustc-link-search=framework={}", framework.display());
    for name in ["SpotifyiOS", "Foundation", "UIKit", "AuthenticationServices", "Security"] {
        println!("cargo:rustc-link-lib=framework={name}");
    }
}
