// SPDX-License-Identifier: Apache-2.0
// Adapted for Metrolist NSH; see third-party/spotish/README.md.
//! The engine: one session per process, started on first use and shut down
//! with the process.
//!
//! TSX may construct `Spotify` many times (hot reload runs module code
//! again); each is a handle onto this one engine, so there is never a second
//! browser on the same profile. When the process exits (`main` returns or
//! `exit` is called), an `atexit` hook asks the session to close the browser
//! cleanly and waits for it, bounded.

use std::sync::OnceLock;

#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
use std::{
    sync::Mutex,
    thread::JoinHandle,
    time::Duration,
};

use tokio::sync::watch;

use super::session::{Session, Snapshot};

#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
use super::{demo, paths::Paths};

/// The process's engine.
pub struct Engine {
    session: Session,
    state: watch::Receiver<Snapshot>,
    #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
    thread: Mutex<Option<JoinHandle<()>>>,
}

static ENGINE: OnceLock<Engine> = OnceLock::new();

/// How long the exit hook waits for the browser to close.
#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
const SHUTDOWN_WAIT: Duration = Duration::from_secs(8);

/// The engine, started on first call: the real web player, or the recorded
/// demo when `SPOTISH_DEMO` is set (and not `0`).
pub fn engine() -> &'static Engine {
    ENGINE.get_or_init(|| {
        #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
        {
            let demo = std::env::var_os("SPOTISH_DEMO").is_some_and(|v| v != "0");
            let (session, state, thread) = if demo { demo::session() } else { Session::start(Paths::platform()) };
            // SAFETY: registering a plain `extern "C" fn` with the C runtime.
            unsafe {
                libc::atexit(shut_down_at_exit);
            }
            Engine { session, state, thread: Mutex::new(Some(thread)) }
        }
        #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
        {
            let (session, state) = Session::demo();
            Engine { session, state }
        }
    })
}

#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
extern "C" fn shut_down_at_exit() {
    if let Some(engine) = ENGINE.get() {
        engine.shutdown(SHUTDOWN_WAIT);
    }
}

impl Engine {
    /// A handle to ask the session things.
    pub fn session(&self) -> &Session {
        &self.session
    }

    /// The latest snapshot.
    pub fn snapshot(&self) -> Snapshot {
        self.state.borrow().clone()
    }

    /// A receiver of every later snapshot.
    pub fn subscribe(&self) -> watch::Receiver<Snapshot> {
        self.state.clone()
    }

    /// Closes the browser and ends the session (once; later calls return at
    /// once). Waits up to `timeout`.
    #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
    pub fn shutdown(&self, timeout: Duration) {
        let Some(thread) = self.thread.lock().ok().and_then(|mut t| t.take()) else { return };
        if self.session.shutdown(timeout) {
            let _ = thread.join();
        } else {
            log::warn!("the engine did not stop within {timeout:?}");
        }
    }
}
