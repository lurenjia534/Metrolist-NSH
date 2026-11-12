// SPDX-License-Identifier: GPL-3.0-only
//! The exported engine's recorded demo on mobile and Web, where the app
//! cannot launch a desktop browser. No processes, sockets or threads start.

use serde_json::Value;
use tokio::sync::{oneshot, watch};

use super::{
    bridge::Command,
    demo,
    model::{EngineError, Health, Player},
};

pub type Answer = Result<Value, EngineError>;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Snapshot {
    pub player: Player,
    pub health: Health,
    pub signed_in: Option<bool>,
    pub auth: u64,
}

#[derive(Clone)]
pub struct Session {
    state: watch::Sender<Snapshot>,
}

impl Session {
    pub fn demo() -> (Self, watch::Receiver<Snapshot>) {
        let (state, receiver) = watch::channel(Snapshot {
            player: demo::player(),
            health: Health::ready(),
            signed_in: Some(true),
            auth: 0,
        });
        (Self { state }, receiver)
    }

    pub fn command(&self, command: Command) -> oneshot::Receiver<Answer> {
        let (reply, receiver) = oneshot::channel();
        let result = demo::answer(&command);
        if result.is_ok() {
            self.state.send_if_modified(|s| demo::control(&mut s.player, &command));
        }
        let _ = reply.send(result);
        receiver
    }

    pub fn sign_in(&self) {
        self.state.send_modify(|s| s.signed_in = Some(true));
    }

    pub fn cancel_sign_in(&self) {}

    pub fn sign_out(&self) {
        self.state.send_modify(|s| {
            s.signed_in = Some(false);
            s.player.playing = false;
        });
    }

    pub fn retry(&self) {
        self.state.send_modify(|s| s.health = Health::ready());
    }

    pub fn set_bridge(&self, _source: String) {}
}
