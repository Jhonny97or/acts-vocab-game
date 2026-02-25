import "./globals.css";

export const metadata = {
  title: "Hechos — Vocab Game",
  description: "Juego de vocabulario en Hechos (griego NA28 / texto cargado)"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
