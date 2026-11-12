// SPDX-License-Identifier: GPL-3.0-only
//! The iOS Spotify App Remote bridge exported to NSH's TSX runtime.

#[cfg(target_os = "ios")]
mod ios;
#[cfg(not(target_arch = "wasm32"))]
mod palette;

use std::{cell::RefCell, rc::Rc};
use nsh_core::prelude::*;

#[derive(Default)]
struct Listeners {
    next: u64,
    items: Vec<(u64, Callback<String>)>,
}

/// A handle to Spotify on iOS. Android and web use the NSH host channel.
#[class]
pub struct SpotifyMobile {
    listeners: Rc<RefCell<Listeners>>,
}

#[class]
impl SpotifyMobile {
    /// Subscribes to the native player's real session and playback events.
    pub fn new(cx: CallCx<'_>) -> Self {
        let listeners = Rc::new(RefCell::new(Listeners::default()));
        #[cfg(target_os = "ios")]
        {
            let weak = Rc::downgrade(&listeners);
            let mut events = ios::subscribe();
            cx.start(async move {
                while events.changed().await.is_ok() {
                    let snapshot = events.borrow_and_update().clone();
                    let Some(listeners) = weak.upgrade() else { break };
                    for (_, listener) in &listeners.borrow().items {
                        listener.post(snapshot.clone());
                    }
                }
            });
        }
        #[cfg(not(target_os = "ios"))]
        let _ = cx;
        Self { listeners }
    }

    /// Calls a native Spotify method; JSON carries the shared host protocol.
    pub async fn request(this: Instance<Self>, method: String, payload: String) -> Result<String, String> {
        let _ = this;
        #[cfg(not(target_arch = "wasm32"))]
        if method == "coverColors" {
            let args: serde_json::Value = serde_json::from_str(&payload).map_err(|e| e.to_string())?;
            let image_url = args["imageUrl"].as_str().ok_or("E_BAD_ARGS: imageUrl is required")?.to_owned();
            let colors = background(palette::cover_colors(image_url)).await.map_err(|e| e.to_string())??;
            return serde_json::to_string(&colors).map_err(|e| e.to_string());
        }
        #[cfg(target_os = "ios")]
        { ios::request(method, payload).await }
        #[cfg(not(target_os = "ios"))]
        {
            let _ = (method, payload);
            Err("E_PLATFORM: SpotifyMobile is the iOS player bridge".into())
        }
    }

    /// Receives each actual session/player snapshot until stopped.
    pub fn on_event(&self, #[args(snapshot)] listener: Callback<String>) -> Stop {
        let id = {
            let mut listeners = self.listeners.borrow_mut();
            let id = listeners.next;
            listeners.next += 1;
            listeners.items.push((id, listener));
            id
        };
        let listeners = self.listeners.clone();
        Stop::new(move || listeners.borrow_mut().items.retain(|(key, _)| *key != id))
    }
}
