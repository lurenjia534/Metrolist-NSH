// SPDX-License-Identifier: GPL-3.0-only
//! File transfers and media transport linked into the NSH application.

use std::collections::BTreeMap;

use nsh_core::prelude::*;

#[cfg(not(target_arch = "wasm32"))]
mod files;
#[cfg(not(target_arch = "wasm32"))]
mod media;
#[cfg(not(target_arch = "wasm32"))]
mod ranges;

pub mod spotish;

/// The native services imported by the application's TSX.
#[native_module("metrolist/native")]
fn native(registry: &mut Registry) {
    registry.module::<NativeFiles>().module::<NativeMedia>().module::<NativeArtwork>();
    spotish::register(registry);
}

/// A media transfer from an already resolved URL to the app's music directory.
#[derive(Clone, JsObject)]
pub struct DownloadInput {
    /// The track's identifier, also used to query progress and cancel.
    pub id: String,
    /// The resolved audio URL.
    pub url: String,
    /// The audio filename, including its extension.
    pub name: String,
    /// The application's absolute music directory.
    pub directory: String,
    /// HTTP headers required by the audio source.
    pub headers: BTreeMap<String, String>,
}

/// A file kept on the device and immediately playable by NSH.
#[derive(Clone, Debug, JsObject)]
pub struct SavedFile {
    /// The display filename, including its extension.
    pub name: String,
    /// The absolute path on the device.
    pub destination: String,
    /// The file URL for the native audio player.
    pub url: String,
    /// The number of bytes saved.
    pub bytes: u64,
}

/// The bytes received by an active download.
#[derive(Clone, Debug, JsObject)]
pub struct DownloadProgress {
    /// Bytes already written.
    pub bytes: u64,
    /// The response's content length, or zero when it is unknown.
    pub total_bytes: u64,
    /// The completed fraction, or zero when the length is unknown.
    pub progress: f64,
}

/// Streaming file transfers, native file dialogs and file-manager integration.
#[module]
pub struct NativeFiles;

#[module]
impl NativeFiles {
    /// Streams an audio response directly to disk and returns its local URL.
    pub fn download(input: DownloadInput) -> Later<SavedFile> {
        #[cfg(not(target_arch = "wasm32"))]
        {
            let transfer = files::download(input);
            Later::new(async move { background(transfer).await.map_err(|e| e.to_string())? })
        }
        #[cfg(target_arch = "wasm32")]
        {
            let _ = input;
            Later::new(async { Err::<SavedFile, _>("Browser downloads use the browser file host") })
        }
    }

    /// Reads the latest byte counts without moving audio bytes through JavaScript.
    pub fn progress(id: String) -> Option<DownloadProgress> {
        #[cfg(not(target_arch = "wasm32"))]
        {
            files::progress(&id)
        }
        #[cfg(target_arch = "wasm32")]
        {
            let _ = id;
            None
        }
    }

    /// Cancels an active request; its promise rejects after its partial file is removed.
    pub fn cancel(id: String) {
        #[cfg(not(target_arch = "wasm32"))]
        files::cancel(&id);
        #[cfg(target_arch = "wasm32")]
        let _ = id;
    }

    /// Removes a saved audio file.
    pub async fn remove(destination: String) -> Result<(), String> {
        #[cfg(not(target_arch = "wasm32"))]
        {
            background(async move {
                tokio::fs::remove_file(destination)
                    .await
                    .map_err(|e| e.to_string())
            })
            .await
            .map_err(|e| e.to_string())?
        }
        #[cfg(target_arch = "wasm32")]
        {
            let _ = destination;
            Err("Browser files use the browser file host".into())
        }
    }

    /// Copies an absolute path or file URL into the music directory without buffering it in JavaScript.
    pub async fn copy_into(
        source: String,
        directory: String,
        name: String,
    ) -> Result<SavedFile, String> {
        #[cfg(not(target_arch = "wasm32"))]
        {
            blocking(move || files::copy_into(std::path::Path::new(&source), &directory, &name))
                .await
                .map_err(|e| e.to_string())?
        }
        #[cfg(target_arch = "wasm32")]
        {
            let _ = (source, directory, name);
            Err("Browser imports use the browser file host".into())
        }
    }

    /// Imports selected audio files with the desktop's file chooser and native file copies.
    pub async fn import_audio(directory: String) -> Result<Vec<SavedFile>, String> {
        #[cfg(not(target_arch = "wasm32"))]
        {
            use nsh_core::file_dialog::{FileFilter, OpenDialog};
            let paths = pick_paths(OpenDialog::files().multiple(true).filter(FileFilter::new(
                "音乐",
                ["mp3", "m4a", "aac", "wav", "ogg", "flac", "opus"],
            )))
            .await?;
            let Some(paths) = paths else {
                return Ok(Vec::new());
            };
            blocking(move || {
                paths
                    .iter()
                    .map(|path| {
                        let name = path.file_name().unwrap_or_default().to_string_lossy();
                        files::copy_into(path, &directory, &name)
                    })
                    .collect()
            })
            .await
            .map_err(|e| e.to_string())?
        }
        #[cfg(target_arch = "wasm32")]
        {
            let _ = directory;
            Err("Browser imports use the browser file host".into())
        }
    }

    /// Saves a copy through the desktop's native save dialog; returns false when cancelled.
    pub async fn export_audio(destination: String, name: String) -> Result<bool, String> {
        #[cfg(not(target_arch = "wasm32"))]
        {
            use nsh_core::file_dialog::SaveDialog;
            let Some(path) = pick_save_path(SaveDialog::new().file_name(name)).await? else {
                return Ok(false);
            };
            blocking(move || {
                std::fs::copy(destination, path)
                    .map(|_| true)
                    .map_err(|e| e.to_string())
            })
            .await
            .map_err(|e| e.to_string())?
        }
        #[cfg(target_arch = "wasm32")]
        {
            let _ = (destination, name);
            Err("Browser exports use the browser file host".into())
        }
    }

    /// Selects a saved file in the desktop's file manager.
    pub async fn reveal(destination: String) -> Result<(), String> {
        #[cfg(not(target_arch = "wasm32"))]
        {
            reveal_path(destination).await
        }
        #[cfg(target_arch = "wasm32")]
        {
            let _ = destination;
            Err("The browser has no desktop file manager".into())
        }
    }
}

/// A local streaming URL and its lifetime handle.
#[derive(Clone, Debug, JsObject)]
pub struct MediaSource {
    /// The URL passed to NSH's native audio player.
    pub url: String,
    /// The source handle to release when the player is disposed.
    pub id: String,
}

/// An in-process HTTP transport for players whose URL API cannot carry source headers.
#[module]
pub struct NativeMedia;

#[module]
impl NativeMedia {
    /// Registers a source with its HTTP headers and returns a local streaming URL.
    pub async fn prepare(
        url: String,
        headers: BTreeMap<String, String>,
    ) -> Result<MediaSource, String> {
        #[cfg(not(target_arch = "wasm32"))]
        {
            background(media::prepare(url, headers))
                .await
                .map_err(|e| e.to_string())?
        }
        #[cfg(target_arch = "wasm32")]
        {
            let _ = (url, headers);
            Err("Browser playback uses its music gateway".into())
        }
    }

    /// Releases a source after its native audio player has been disposed.
    pub fn release(id: String) {
        #[cfg(not(target_arch = "wasm32"))]
        media::release(&id);
        #[cfg(target_arch = "wasm32")]
        let _ = id;
    }
}

/// Cover colours read from the artwork's actual pixels.
#[module]
pub struct NativeArtwork;

#[module]
impl NativeArtwork {
    /// A cover's colours (`#rrggbb`), most telling first; empty when it has none.
    pub async fn colors(url: String) -> Result<Vec<String>, String> {
        #[cfg(not(target_arch = "wasm32"))]
        {
            background(spotish::mobile::palette::cover_colors(url))
                .await
                .map_err(|e| e.to_string())?
        }
        #[cfg(target_arch = "wasm32")]
        {
            let _ = url;
            Err("Browser covers use the browser host".into())
        }
    }
}
