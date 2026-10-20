// Embed the Windows icon + version info into trupx.exe so File Explorer,
// Task Manager, taskbar, and Alt+Tab show the trupx brand.
fn main() {
    #[cfg(windows)]
    {
        let mut res = winres::WindowsResource::new();
        res.set_icon("icon.ico");
        res.set("ProductName", "Trupx");
        res.set("FileDescription", "Trupx — self-hosted web terminal tunnel");
        res.set("LegalCopyright", "© 2026");
        res.set("CompanyName", "trupx");
        let _ = res.compile();
    }
}
