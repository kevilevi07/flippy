mod config;
mod login;
mod proto;
mod terminal;
mod tunnel;

use std::fs;
use std::io::Write;

use anyhow::Result;
use clap::{Parser, Subcommand};

#[derive(Parser, Debug)]
#[command(name = "trupx", version, about = "Trupx - web terminal with built-in self-hosted tunnel")]
struct Cli {
    #[command(subcommand)]
    command: Option<Cmd>,

    // ---- terminal server flags (default command) ----
    /// Port to listen on
    #[arg(short = 'p', long = "port", default_value_t = 8090)]
    port: u16,

    /// Credentials in the form user:password
    #[arg(short = 'c', long = "credential", default_value = "admin:@dmin1.@")]
    credential: String,

    /// Shell to spawn (default: powershell.exe on Windows, $SHELL elsewhere)
    #[arg(short = 's', long = "shell")]
    shell: Option<String>,

    // ---- tunnel flags ----
    /// Also open an outbound tunnel to the Vercel server for worldwide access.
    #[arg(long = "tunnel")]
    tunnel: bool,

    /// Tunnel app name (3-32 chars, a-z 0-9 and -). If omitted, uses the
    /// system hostname. Also accepted as a positional: `trupx sherlock`.
    #[arg(long = "name")]
    tunnel_name: Option<String>,

    /// Override the saved tunnel server URL for this run.
    #[arg(long = "server")]
    tunnel_server: Option<String>,

    /// Positional tunnel name — same as `--name`. Lets you type `trupx sherlock`.
    #[arg()]
    positional_name: Option<String>,
}

#[derive(Subcommand, Debug)]
enum Cmd {
    /// Start the local terminal AND open a tunnel with the given name.
    /// Equivalent to `trupx --tunnel --name <NAME>`.
    Start {
        /// Tunnel app name (3-32 chars, a-z 0-9 and -).
        name: Option<String>,
    },
    /// Stop a running trupx instance.
    Stop,
    /// Show daemon + tunnel status.
    Status,
    /// Save tunnel server URL + token.
    Login {
        #[arg(long)]
        token: Option<String>,
    },
    /// Clear tunnel credentials.
    Logout,
    /// Internal: run as background daemon (used by Windows auto-detach spawn).
    #[command(hide = true)]
    Daemon,
}

fn main() {
    let mut cli = Cli::parse();
    let is_daemon = matches!(cli.command, Some(Cmd::Daemon));

    // The `start <name>` subcommand is sugar for `--tunnel --name <name>`.
    if let Some(Cmd::Start { name }) = &cli.command {
        let n = name.clone();
        cli.tunnel = true;
        if n.is_some() { cli.tunnel_name = n; }
        cli.command = None;
    }

    // `trupx <name>` (positional) is sugar for `--tunnel --name <name>`.
    if let Some(n) = cli.positional_name.take() {
        cli.tunnel = true;
        if cli.tunnel_name.is_none() { cli.tunnel_name = Some(n); }
    }

    // Zero-arg: `trupx` by itself always opens a tunnel too.
    // Default name = system hostname; falls back to a random id.
    if cli.command.is_none() && !is_daemon {
        cli.tunnel = true;
        if cli.tunnel_name.is_none() {
            cli.tunnel_name = Some(default_tunnel_name());
        }
    }

    // Non-server subcommands run and exit immediately.
    match &cli.command {
        Some(Cmd::Stop) => std::process::exit(cmd_stop()),
        Some(Cmd::Status) => std::process::exit(cmd_status()),
        Some(Cmd::Login { token }) => {
            std::process::exit(cmd_login(token.clone(), cli.tunnel_server.clone()))
        }
        Some(Cmd::Logout) => std::process::exit(cmd_logout()),
        Some(Cmd::Daemon) | None => {}
        Some(Cmd::Start { .. }) => unreachable!(),
    }

    // Guard against a second instance.
    if !is_daemon {
        if let Some(pid) = terminal::is_running() {
            eprintln!(
                "trupx is already running (pid {}). Use `trupx stop` to stop it first.",
                pid
            );
            std::process::exit(1);
        }

        // Windows: respawn self as a detached child so the user's shell is freed.
        #[cfg(windows)]
        {
            detach_and_exit(&cli);
        }
        // Unix: fall through, run server in foreground.
    }

    let (user, pass) = match cli.credential.split_once(':') {
        Some((u, p)) => (u.to_string(), p.to_string()),
        None => {
            eprintln!("error: --credential must be in the form user:password");
            std::process::exit(2);
        }
    };
    let shell = cli.shell.unwrap_or_else(terminal::default_shell);
    let port = cli.port;
    let tunnel = cli.tunnel;
    let tunnel_name = cli.tunnel_name.clone();
    let tunnel_server = cli.tunnel_server.clone();

    // Write pid file so `trupx stop` can find us.
    let _ = fs::write(terminal::pid_file(), std::process::id().to_string());
    terminal::append_log(&format!(
        "start pid={} port={} user={} tunnel={}",
        std::process::id(),
        port,
        user,
        tunnel
    ));


    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .expect("tokio runtime");

    #[cfg(not(windows))]
    let banner_user = user.clone();
    #[cfg(not(windows))]
    let banner_shell = shell.clone();

    rt.block_on(async move {
        #[cfg(not(windows))]
        {
            println!();
            println!("  Trupx is running on http://localhost:{}", port);
            println!("  Shell:       {}", banner_shell);
            println!("  Credential:  {} / ********", banner_user);
            if tunnel {
                println!("  Tunnel:      starting outbound...");
            }
            println!();
            println!("  Press Ctrl+C to stop.");
            println!();
        }

        // Local HTTP+WS server (always on).
        let server_task = tokio::spawn(terminal::serve(user.clone(), pass, shell, port));

        // Optional outbound tunnel. Server URL is required; token is not.
        let tunnel_task = if tunnel {
            let mut cfg = match config::Config::load() {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("tunnel: cannot load config: {}", e);
                    config::Config::default()
                }
            };
            if let Some(s) = tunnel_server {
                cfg.server = Some(s);
            }
            // Default to the public trupx server if nothing's configured so
            // the user can go from zero to tunnel in one command.
            if cfg.server.is_none() {
                cfg.server = Some("https://trupx.vercel.app".to_string());
            }
            let local_host = "127.0.0.1".to_string();
            terminal::append_log(&format!(
                "tunnel starting: server={} name={:?}",
                cfg.server.as_deref().unwrap_or("?"), tunnel_name
            ));
            Some(tokio::spawn(async move {
                if let Err(e) = tunnel::run(&cfg, &local_host, port, tunnel_name).await {
                    terminal::append_log(&format!("tunnel ended: {}", e));
                }
            }))
        } else {
            None
        };

        tokio::select! {
            _ = server_task => {}
            _ = async {
                if let Some(t) = tunnel_task { let _ = t.await; }
                else { futures_util::future::pending::<()>().await; }
            } => {}
        }
    });
}

/// Build a valid tunnel name from the system hostname.
/// Valid = 2-32 chars, [a-z0-9-], start/end alphanumeric. Falls back to a
/// short random id if the hostname can't be derived.
fn default_tunnel_name() -> String {
    use rand::{distributions::Alphanumeric, Rng};
    let raw = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .filter(|s| !s.trim().is_empty());
    if let Some(h) = raw {
        // Normalize: lowercase, replace non-[a-z0-9-] with '-', trim '-' edges,
        // collapse runs, truncate to 32.
        let mut s: String = h
            .to_ascii_lowercase()
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '-' })
            .collect();
        while s.contains("--") { s = s.replace("--", "-"); }
        let s = s.trim_matches('-').to_string();
        let s: String = s.chars().take(32).collect();
        if s.len() >= 2 && s.chars().next().map_or(false, |c| c.is_ascii_alphanumeric()) {
            return s;
        }
    }
    // Fallback: short random id.
    let suffix: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(6)
        .map(|c| (c as char).to_ascii_lowercase())
        .collect();
    format!("trupx-{}", suffix)
}

fn cmd_stop() -> i32 {
    let (killed, pid) = terminal::kill_running();
    terminal::append_log(&format!("stop requested, pid={:?}, killed={}", pid, killed));
    match (killed, pid) {
        (true, Some(p)) => println!("trupx stopped (pid {}).", p),
        _ => println!("trupx was not running; cleaned up any stale pid file."),
    }
    0
}

fn cmd_status() -> i32 {
    // Daemon
    match terminal::is_running() {
        Some(pid) => {
            println!("terminal: RUNNING (pid {})", pid);
            println!("log:      {}", terminal::log_file().display());
        }
        None => println!("terminal: NOT running"),
    }
    // Tunnel config
    match config::Config::load() {
        Ok(cfg) => {
            println!(
                "tunnel server:   {}",
                cfg.server.as_deref().unwrap_or("<unset>")
            );
            println!(
                "tunnel token:    {}",
                if cfg.token.is_some() { "set" } else { "<unset>" }
            );
            if let Ok(p) = config::path() {
                println!("tunnel config:   {}", p.display());
            }
        }
        Err(e) => println!("tunnel config:   error loading: {}", e),
    }
    0
}

fn cmd_login(token: Option<String>, server_override: Option<String>) -> i32 {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("tokio runtime");
    let mut cfg = match config::Config::load() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("cannot load config: {}", e);
            return 1;
        }
    };
    if let Some(s) = server_override {
        cfg.server = Some(s.trim().trim_end_matches('/').to_string());
    }
    match rt.block_on(login::run(&mut cfg, token)) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("login failed: {}", e);
            1
        }
    }
}

fn cmd_logout() -> i32 {
    match config::Config::load() {
        Ok(mut cfg) => {
            cfg.token = None;
            if let Err(e) = cfg.save() {
                eprintln!("could not save config: {}", e);
                return 1;
            }
            println!("Logged out.");
            0
        }
        Err(e) => {
            eprintln!("cannot load config: {}", e);
            1
        }
    }
}

/// Spawn self detached (no console) with the same flags + the hidden `daemon`
/// subcommand, then exit the foreground process.
#[cfg(windows)]
fn detach_and_exit(cli: &Cli) -> ! {
    use std::os::windows::process::CommandExt;
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;

    let exe = std::env::current_exe().expect("current_exe");
    let mut cmd = std::process::Command::new(&exe);
    cmd.arg("-p").arg(cli.port.to_string());
    cmd.arg("-c").arg(&cli.credential);
    if let Some(sh) = &cli.shell {
        cmd.arg("-s").arg(sh);
    }
    if cli.tunnel {
        cmd.arg("--tunnel");
    }
    if let Some(n) = &cli.tunnel_name {
        cmd.arg("--name").arg(n);
    }
    if let Some(s) = &cli.tunnel_server {
        cmd.arg("--server").arg(s);
    }
    cmd.arg("daemon");
    cmd.creation_flags(DETACHED_PROCESS | CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::null());
    match cmd.spawn() {
        Ok(child) => {
            println!("trupx started in background (pid {}).", child.id());
            if cli.tunnel {
                // Best-effort: tell the user the public URL we expect.
                let server = cli.tunnel_server.clone().or_else(|| {
                    config::Config::load().ok().and_then(|c| c.server)
                }).unwrap_or_else(|| "https://trupx.vercel.app".to_string());
                let server = server.trim_end_matches('/').to_string();
                let name = cli.tunnel_name.clone().unwrap_or_default();
                if !name.is_empty() {
                    println!("public URL: {}/{}/", server, name);
                } else {
                    println!("public URL will appear in {}/dashboard", server);
                }
            }
            let _ = std::io::stdout().flush();
            std::process::exit(0);
        }
        Err(e) => {
            eprintln!("failed to launch background trupx: {}", e);
            std::process::exit(1);
        }
    }
}
