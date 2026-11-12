// SPDX-License-Identifier: GPL-3.0-only
//! Spotish's native engine and platform integrations, isolated from YouTube Music.

pub mod audio;
pub mod exports;
pub mod media;
pub mod spotify;
pub mod theme;
pub mod version;

#[cfg(test)]
mod shaders;

use nsh_core::prelude::*;

pub(crate) fn register(registry: &mut Registry) {
    registry
        .class::<exports::Spotify>()
        .class::<media::MediaControls>()
        .class::<theme::SystemTheme>()
        .class::<audio::AudioMeter>()
        .module::<version::Version>();
}
