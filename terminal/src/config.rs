use anyhow::{Context, Result};
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};

#[derive(Default, Serialize, Deserialize, Debug)]
pub struct Config {
    /// Base URL of the flippy server, e.g. https://tunnel.example.com
    pub server: Option<String>,
    /// Vercel OAuth access token.
    pub token: Option<String>,
    /// Reserved tunnel id to re-use across reconnects (set after first successful tunnel).
    pub tunnel_id: Option<String>,
}

pub fn path() -> Result<PathBuf> {
    let dirs = ProjectDirs::from("dev", "flippy", "flippy")
        .context("could not resolve config dir")?;
    Ok(dirs.config_dir().join("config.json"))
}

impl Config {
    pub fn load() -> Result<Self> {
        let p = path()?;
        if !p.exists() {
            return Ok(Self::default());
        }
        let bytes = fs::read(&p).with_context(|| format!("reading {}", p.display()))?;
        Ok(serde_json::from_slice(&bytes).unwrap_or_default())
    }

    pub fn save(&self) -> Result<()> {
        let p = path()?;
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_vec_pretty(self)?;
        fs::write(&p, json).with_context(|| format!("writing {}", p.display()))?;
        Ok(())
    }

    pub fn require_server(&self) -> Result<&str> {
        self.server.as_deref().context(
            "server not set. Pass --server https://your-domain or set it with login.",
        )
    }

    pub fn require_token(&self) -> Result<&str> {
        self.token
            .as_deref()
            .context("not logged in. Run: flippy login")
    }
}
