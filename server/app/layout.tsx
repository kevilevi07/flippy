import "./globals.css";

export const metadata = {
  title: "trupx — self-hosted web terminal tunnel",
  description: "A web terminal and ngrok-style tunnel that runs on your own Fly.io app.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
