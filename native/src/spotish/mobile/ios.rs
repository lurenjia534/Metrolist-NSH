// SPDX-License-Identifier: GPL-3.0-only
//! The iOS App Remote adapter. UIKit and the SDK live on the main queue;
//! these channels carry their replies back to NSH's engine thread.

use std::{
    collections::HashMap,
    ffi::{CStr, CString, c_char},
    sync::{Mutex, OnceLock, atomic::{AtomicU64, Ordering}},
};
use tokio::sync::{oneshot, watch};

type Reply = oneshot::Sender<Result<String, String>>;
static REQUEST_ID: AtomicU64 = AtomicU64::new(1);
static PENDING: OnceLock<Mutex<HashMap<u64, Reply>>> = OnceLock::new();
static EVENTS: OnceLock<watch::Sender<String>> = OnceLock::new();

unsafe extern "C" {
    fn metrolist_spotify_ios_request(
        request_id: u64,
        method: *const c_char,
        payload: *const c_char,
        reply: extern "C" fn(u64, bool, *const c_char),
        event: extern "C" fn(*const c_char),
    );
}

fn pending() -> &'static Mutex<HashMap<u64, Reply>> {
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

fn events() -> &'static watch::Sender<String> {
    EVENTS.get_or_init(|| watch::channel(String::new()).0)
}

extern "C" fn reply(id: u64, success: bool, value: *const c_char) {
    // The Objective-C adapter owns this UTF-8 string through this call.
    let value = unsafe { CStr::from_ptr(value) }.to_string_lossy().into_owned();
    if let Some(sender) = pending().lock().unwrap().remove(&id) {
        let _ = sender.send(if success { Ok(value) } else { Err(value) });
    }
}

extern "C" fn event(value: *const c_char) {
    // As with replies, the adapter's temporary string is copied immediately.
    let value = unsafe { CStr::from_ptr(value) }.to_string_lossy().into_owned();
    events().send_replace(value);
}

/// Requests one native operation. The adapter copies both strings before
/// dispatching to the main queue and completes each request once.
pub async fn request(method: String, payload: String) -> Result<String, String> {
    let method = CString::new(method).map_err(|e| e.to_string())?;
    let payload = CString::new(payload).map_err(|e| e.to_string())?;
    let id = REQUEST_ID.fetch_add(1, Ordering::Relaxed);
    let (sender, receiver) = oneshot::channel();
    pending().lock().unwrap().insert(id, sender);
    unsafe {
        metrolist_spotify_ios_request(id, method.as_ptr(), payload.as_ptr(), reply, event);
    }
    receiver.await.map_err(|e| format!("E_CONNECTION: {e}"))?
}

/// Complete snapshots from App Remote, OAuth and the application lifecycle.
pub fn subscribe() -> watch::Receiver<String> {
    events().subscribe()
}
