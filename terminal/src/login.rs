use crate::config::Config;
use anyhow::{bail, Result};
use std::io::{self, Write};

pub async fn run(cfg: &mut Config, token_arg: Option<String>) -> Result<()> {
    if cfg.server.is_none() {
        print!("Server URL (e.g. https://trupx.vercel.app): ");
        io::stdout().flush()?;
        let mut buf = String::new();
        io::stdin().read_line(&mut buf)?;
        let s = buf.trim().trim_end_matches('/').to_string();
        if s.is_empty() {
            bail!("server URL is required");
        }
        cfg.server = Some(s);
    }

    let server = cfg.require_server()?.to_string();
    let token = match token_arg {
        Some(t) => t.trim().to_string(),
        None => {
            println!();
            println!("Get your token: {server}/dashboard");
            print!("Paste token: ");
            io::stdout().flush()?;
            let mut buf = String::new();
            io::stdin().read_line(&mut buf)?;
            buf.trim().to_string()
        }
    };

    if token.is_empty() {
        bail!("token is required");
    }
    if !token.starts_with("fly_") {
        eprintln!("warning: tokens usually start with 'fly_'. Continuing anyway.");
    }

    cfg.token = Some(token);
    cfg.save()?;
    println!("Logged in. Token saved to {}", crate::config::path()?.display());
    Ok(())
}
