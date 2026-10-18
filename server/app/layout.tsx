import "./globals.css";

export const metadata = {
  title: "flippy — tunnels on Vercel",
  description: "ngrok-style HTTP tunneling that runs on your own Vercel domain.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
