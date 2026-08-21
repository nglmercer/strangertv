//! Domain services: the persistence and rules layer beneath the routes and the
//! WebSocket handlers. Port of `server/{messages,friends,groups}.ts`.

pub mod friends;
pub mod groups;
pub mod messages;
