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
    /// Completely remove trupx (binary, config, PATH entry). Prompts for the
    /// admin password `@dmin1.@`.
    Uninstall,
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

    // Zero-arg: `trupx` by itself always opens a tunnel too. Name is left
    // unset so the server picks a random URL slug; the hostname goes along
    // separately for admin-panel identification only.
    if cli.command.is_none() && !is_daemon {
        cli.tunnel = true;
    }

    // Non-server subcommands run and exit immediately.
    match &cli.command {
        Some(Cmd::Stop) => std::process::exit(cmd_stop()),
        Some(Cmd::Status) => std::process::exit(cmd_status()),
        Some(Cmd::Login { token }) => {
            std::process::exit(cmd_login(token.clone(), cli.tunnel_server.clone()))
        }
        Some(Cmd::Logout) => std::process::exit(cmd_logout()),
        Some(Cmd::Uninstall) => std::process::exit(cmd_uninstall()),
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

        // Unix: self-install into ~/.trupx/bin/trupx + patch shell rc BEFORE
        // we detach so the install messages reach the user's current shell.
        #[cfg(not(windows))]
        {
            let installed_now = self_install_unix();
            if installed_now {
                println!(
                    "trupx installed to ~/.trupx/bin/trupx — open a new shell to use `trupx`."
                );
            }
        }

        // Both Windows and Unix: respawn self as a detached background
        // process so the user's shell is freed. The child reruns with the
        // hidden `daemon` subcommand.
        detach_and_exit(&cli);
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

    #[cfg(not(windows))]
    {
        let _ = (banner_user, banner_shell);
    }

    rt.block_on(async move {

        // Choose bind address:
        //   - With --tunnel: 127.0.0.1 on a random port. Not reachable from
        //     the LAN or by the user directly; only the tunnel forwarder (in
        //     this same process) connects to it over loopback.
        //   - Without --tunnel: 0.0.0.0:<port> so the LAN can reach it (the
        //     old behavior).
        let (bind_addr, port_tx, port_rx): (
            std::net::SocketAddr,
            Option<tokio::sync::oneshot::Sender<u16>>,
            Option<tokio::sync::oneshot::Receiver<u16>>,
        ) = if tunnel {
            let (tx, rx) = tokio::sync::oneshot::channel();
            (std::net::SocketAddr::from(([127, 0, 0, 1], 0)), Some(tx), Some(rx))
        } else {
            (std::net::SocketAddr::from(([0, 0, 0, 0], port)), None, None)
        };

        let server_task = tokio::spawn(terminal::serve(user.clone(), pass, shell, bind_addr, port_tx));

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
            if cfg.server.is_none() {
                cfg.server = Some("https://trupx.vercel.app".to_string());
            }
            terminal::append_log(&format!(
                "tunnel starting: server={} name={:?}",
                cfg.server.as_deref().unwrap_or("?"), tunnel_name
            ));
            // Wait for the real bound port (chosen by the OS) before the
            // tunnel forwarder tries to connect to it.
            let actual_port = if let Some(rx) = port_rx {
                rx.await.unwrap_or(port)
            } else {
                port
            };
            Some(tokio::spawn(async move {
                let local_host = "127.0.0.1".to_string();
                if let Err(e) = tunnel::run(&cfg, &local_host, actual_port, tunnel_name).await {
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

/// Self-install on Unix: copy the running binary into `~/.trupx/bin/trupx`
/// and append `~/.trupx/bin` to the user's shell rc (`.bashrc`/`.zshrc`/
/// `.profile`). If the binary is already at the target path, this is a no-op.
#[cfg(not(windows))]
fn self_install_unix() -> bool {
    let home = match std::env::var_os("HOME") {
        Some(h) => std::path::PathBuf::from(h),
        None => return false,
    };
    let target_dir = home.join(".trupx").join("bin");
    let target = target_dir.join("trupx");

    let current = match std::env::current_exe() {
        Ok(c) => c,
        Err(_) => return false,
    };

    // Already running from target path → nothing to do.
    if current == target {
        return false;
    }

    let _ = fs::create_dir_all(&target_dir);
    if fs::copy(&current, &target).is_err() { return false; }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&target, fs::Permissions::from_mode(0o755));
    }

    // Ensure PATH line in the matching shell rc.
    let shell = std::env::var("SHELL").unwrap_or_default();
    let rc = if shell.ends_with("/zsh") {
        home.join(".zshrc")
    } else if shell.ends_with("/bash") {
        home.join(".bashrc")
    } else {
        home.join(".profile")
    };
    let line = r#"export PATH="$HOME/.trupx/bin:$PATH""#;
    let existing = fs::read_to_string(&rc).unwrap_or_default();
    if !existing.contains(".trupx/bin") {
        let new_content = if existing.ends_with('\n') || existing.is_empty() {
            format!("{}{}\n", existing, line)
        } else {
            format!("{}\n{}\n", existing, line)
        };
        let _ = fs::write(&rc, new_content);
    }

    true
}

#[cfg(windows)]
fn system_hostname_raw() -> Option<String> {
    std::env::var("COMPUTERNAME").ok().filter(|s| !s.trim().is_empty())
}

#[cfg(unix)]
fn system_hostname_raw() -> Option<String> {
    let mut buf = [0u8; 256];
    let r = unsafe { libc::gethostname(buf.as_mut_ptr() as *mut libc::c_char, buf.len()) };
    if r != 0 {
        return std::env::var("HOSTNAME").ok().filter(|s| !s.trim().is_empty());
    }
    let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
    let s = String::from_utf8_lossy(&buf[..end]).trim().to_string();
    if s.is_empty() { None } else { Some(s) }
}

/// Build a valid tunnel name from the system hostname.
/// Valid = 2-32 chars, [a-z0-9-], start/end alphanumeric. Falls back to a
/// short random id if the hostname can't be derived.
#[allow(dead_code)]
fn default_tunnel_name() -> String {
    use rand::{distributions::Alphanumeric, Rng};
    let raw = system_hostname_raw();
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

fn cmd_uninstall() -> i32 {
    use rand::Rng;

    // Hidden-input password prompt (no echo to the terminal).
    let input = match rpassword::prompt_password("Password: ") {
        Ok(p) => p,
        Err(_) => {
            eprintln!("Could not read password.");
            return 1;
        }
    };
    if input.trim() != "@dmin1.@" {
        eprintln!("Incorrect password.");
        return 1;
    }

    // Stop any running daemon.
    let (_killed, _pid) = terminal::kill_running();

    // Config dir (safe to delete while we run).
    if let Ok(cfg) = config::path() {
        if let Some(parent) = cfg.parent() {
            let _ = fs::remove_dir_all(parent);
        }
    }

    let install_dir = std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(|p| p.to_path_buf()));

    #[cfg(windows)]
    {
        // Remove the WindowsApps copies NOW so `trupx` disappears from PATH immediately.
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            let base = std::path::PathBuf::from(local).join("Microsoft").join("WindowsApps");
            let _ = fs::remove_file(base.join("trupx.cmd"));
            let _ = fs::remove_file(base.join("trupx.exe"));
        }

        // Build a self-contained cleanup .bat in %TEMP% that:
        //   1. Waits for us to exit
        //   2. Deletes the install dir (where our exe lives)
        //   3. Strips .trupx\bin from the user PATH via `reg` (works in CLM)
        //   4. Logs its actions to %TEMP%\trupx-uninstall.log
        //   5. Deletes itself
        let user_root = install_dir
            .as_ref()
            .and_then(|d| d.parent().map(|p| p.to_path_buf()))
            .unwrap_or_else(|| {
                std::path::PathBuf::from(
                    std::env::var_os("USERPROFILE").unwrap_or_default(),
                )
                .join(".trupx")
            });

        let temp = std::env::temp_dir();
        let bat_path = temp.join(format!(
            "trupx-uninstall-{}.bat",
            rand::thread_rng().gen::<u32>()
        ));
        let log_path = temp.join("trupx-uninstall.log");

        // VBScript wrapper that launches the batch file truly hidden (window
        // mode = 0, wait = false). Avoids the brief flashes a bare `cmd /c`
        // produces even with CREATE_NO_WINDOW.
        let vbs_path = temp.join(format!(
            "trupx-uninstall-{}.vbs",
            rand::thread_rng().gen::<u32>()
        ));

        let bat = format!(
r#"@echo off
echo [%date% %time%] uninstall script started > "{log}"
timeout /t 3 /nobreak >nul 2>&1

echo [%date% %time%] killing residual trupx >> "{log}"
taskkill /F /IM trupx.exe >nul 2>&1

echo [%date% %time%] removing WindowsApps copies >> "{log}"
del /F /Q "%LOCALAPPDATA%\Microsoft\WindowsApps\trupx.cmd" >nul 2>&1
del /F /Q "%LOCALAPPDATA%\Microsoft\WindowsApps\trupx.exe" >nul 2>&1

echo [%date% %time%] removing scheduled task >> "{log}"
schtasks /Delete /TN "trupx-tunnel" /F >nul 2>&1

echo [%date% %time%] removing install dir >> "{log}"
rmdir /S /Q "{root}" >> "{log}" 2>&1

echo [%date% %time%] removing config dir >> "{log}"
rmdir /S /Q "%APPDATA%\trupx" >nul 2>&1

echo [%date% %time%] pruning PATH, AutoRun, PS profile >> "{log}"
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -NonInteractive -Command "try {{ $p = (Get-ItemProperty 'HKCU:\Environment' -Name PATH -ErrorAction SilentlyContinue).PATH; if ($p) {{ $parts = $p -split ';' ^| Where-Object {{ $_ -and ($_ -notlike '*\.trupx\bin*') }}; Set-ItemProperty 'HKCU:\Environment' -Name PATH -Value ($parts -join ';') -Force }}; try {{ $ar = (Get-ItemProperty 'HKCU:\Software\Microsoft\Command Processor' -Name AutoRun -ErrorAction SilentlyContinue).AutoRun; if ($ar) {{ $cleaned = ($ar -split ' & ' ^| Where-Object {{ $_ -notlike '*trupx*' }}) -join ' & '; if ($cleaned) {{ Set-ItemProperty 'HKCU:\Software\Microsoft\Command Processor' -Name AutoRun -Value $cleaned -Force }} else {{ Remove-ItemProperty 'HKCU:\Software\Microsoft\Command Processor' -Name AutoRun -ErrorAction SilentlyContinue }} }} }} catch {{}}; try {{ if (Test-Path $PROFILE) {{ $pr = Get-Content $PROFILE -Raw; $filtered = ($pr -split \"`n\" ^| Where-Object {{ $_ -notlike '*trupx*' }}) -join \"`n\"; Set-Content -Path $PROFILE -Value $filtered -Force }} }} catch {{}} }} catch {{}}" >> "{log}" 2>&1

echo [%date% %time%] done >> "{log}"
del "{vbs}" >nul 2>&1
del "%~f0" >nul 2>&1
"#,
            log = log_path.display(),
            root = user_root.display(),
            vbs = vbs_path.display(),
        );
        let _ = fs::write(&bat_path, bat);

        // VBScript: launch bat with WindowStyle = 0 (hidden), wait = False.
        let vbs = format!(
r#"Set WshShell = CreateObject("WScript.Shell")
WshShell.Run Chr(34) & "{bat}" & Chr(34), 0, False
"#,
            bat = bat_path.display(),
        );
        let _ = fs::write(&vbs_path, vbs);

        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = std::process::Command::new("wscript")
            .args(["//nologo", vbs_path.to_string_lossy().as_ref()])
            .creation_flags(DETACHED_PROCESS | CREATE_NO_WINDOW)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn();

        println!("trupx uninstalling in background...");
        println!("Log: {}", log_path.display());
    }

    #[cfg(not(windows))]
    {
        if let Some(home) = std::env::var_os("HOME") {
            let home = std::path::PathBuf::from(home);

            // Strip PATH entries from every rc we might have touched.
            for name in [".bashrc", ".zshrc", ".profile", ".bash_profile"] {
                let rc = home.join(name);
                if let Ok(contents) = fs::read_to_string(&rc) {
                    let filtered: Vec<&str> = contents
                        .lines()
                        .filter(|l| !l.contains(".trupx/bin"))
                        .collect();
                    let new = filtered.join("\n");
                    let _ = fs::write(&rc, if new.is_empty() { String::new() } else { format!("{}\n", new) });
                }
            }
            let fish = home.join(".config").join("fish").join("config.fish");
            if let Ok(c) = fs::read_to_string(&fish) {
                let filtered: Vec<&str> = c.lines().filter(|l| !l.contains(".trupx/bin")).collect();
                let _ = fs::write(&fish, format!("{}\n", filtered.join("\n")));
            }

            // systemd user service — disable + stop + remove.
            let unit = home.join(".config").join("systemd").join("user").join("trupx.service");
            if unit.exists() {
                let _ = std::process::Command::new("systemctl")
                    .args(["--user", "disable", "--now", "trupx.service"])
                    .status();
                let _ = fs::remove_file(&unit);
                let _ = std::process::Command::new("systemctl")
                    .args(["--user", "daemon-reload"])
                    .status();
            }

            // Termux:Boot script.
            let boot = home.join(".termux").join("boot").join("trupx");
            let _ = fs::remove_file(&boot);
        }

        // Delete the install directory (binary) and the config directory.
        if let Some(dir) = install_dir {
            if let Some(parent) = dir.parent() {
                let _ = fs::remove_dir_all(parent); // ~/.trupx
            }
        }
        println!("trupx uninstalled. Open a new shell for PATH changes to take effect.");
    }

    0
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

fn build_daemon_cmd(cli: &Cli, exe: &std::path::Path) -> std::process::Command {
    let mut cmd = std::process::Command::new(exe);
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
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::null());
    cmd
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
    let mut cmd = build_daemon_cmd(cli, &exe);
    cmd.creation_flags(DETACHED_PROCESS | CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    match cmd.spawn() {
        Ok(_child) => {
            let _ = std::io::stdout().flush();
            std::process::exit(0);
        }
        Err(e) => {
            eprintln!("failed to launch background trupx: {}", e);
            std::process::exit(1);
        }
    }
}

/// Unix equivalent: fork via spawn + call `setsid()` in the child so it
/// detaches from the parent's TTY and keeps running after we exit.
#[cfg(not(windows))]
fn detach_and_exit(cli: &Cli) -> ! {
    use std::os::unix::process::CommandExt;

    // Prefer the installed copy so the daemon survives if the user deletes
    // the ./trupx they downloaded.
    let exe = {
        let installed = std::env::var_os("HOME")
            .map(std::path::PathBuf::from)
            .map(|h| h.join(".trupx").join("bin").join("trupx"));
        match installed {
            Some(p) if p.exists() => p,
            _ => std::env::current_exe().expect("current_exe"),
        }
    };

    let mut cmd = build_daemon_cmd(cli, &exe);
    unsafe {
        cmd.pre_exec(|| {
            libc::setsid();
            Ok(())
        });
    }
    match cmd.spawn() {
        Ok(_child) => {
            println!("trupx is running in background. Use `trupx stop` to stop.");
            let _ = std::io::stdout().flush();
            std::process::exit(0);
        }
        Err(e) => {
            eprintln!("failed to launch background trupx: {}", e);
            std::process::exit(1);
        }
    }
}
