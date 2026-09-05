//! Ayudas para campos con valor literal: `schema: "qua/session@1"` y `v: 1`.
//!
//! Zod los declara como literales y rechaza cualquier otro valor. Rust tiene que
//! rechazarlos igual o las fixtures dejarían de significar lo mismo en los dos lados.

use serde::de::{Error as DeError, Unexpected};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::constants::{PROTOCOL_VERSION, SCHEMA_SESSION};

/// `"qua/session@1"`, y nada más.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SessionSchemaTag;

impl Serialize for SessionSchemaTag {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(SCHEMA_SESSION)
    }
}

impl<'de> Deserialize<'de> for SessionSchemaTag {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(d)?;
        if raw == SCHEMA_SESSION {
            Ok(SessionSchemaTag)
        } else {
            Err(DeError::invalid_value(
                Unexpected::Str(&raw),
                &SCHEMA_SESSION,
            ))
        }
    }
}

/// `1`, y nada más. Un `v` distinto es `version_mismatch`, no un mensaje raro.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ProtocolVersionTag;

impl Serialize for ProtocolVersionTag {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_u8(PROTOCOL_VERSION)
    }
}

impl<'de> Deserialize<'de> for ProtocolVersionTag {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let raw = u64::deserialize(d)?;
        if raw == u64::from(PROTOCOL_VERSION) {
            Ok(ProtocolVersionTag)
        } else {
            Err(DeError::invalid_value(Unexpected::Unsigned(raw), &"1"))
        }
    }
}
