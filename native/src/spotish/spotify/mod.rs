// SPDX-License-Identifier: Apache-2.0
// Adapted for Metrolist NSH; see third-party/spotish/README.md.
//! The Spotify web player, run and driven by the app: the browser it runs in
//! (`chrome`), the DevTools connection (`cdp`), the bridge's protocol
//! (`bridge`), the session that keeps them (`session`), the process's one
//! engine (`engine`), the one-time login import (`import`), where files live
//! (`paths`) and what the bridge answers (`model`).

pub mod bridge;
#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
pub mod cdp;
#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
pub mod chrome;
pub mod demo;
pub mod engine;
#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
pub mod import;
pub mod model;
#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
pub mod paths;
#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
pub mod session;
#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
#[path = "portable.rs"]
pub mod session;

pub use model::*;
pub use session::{Session, Snapshot};
