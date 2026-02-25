import "./globals.css";

export const metadata = {
  title: "Hechos — Vocab Game",
  description: "Juego de vocabulario en Hechos (NA28) con misión diaria"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
