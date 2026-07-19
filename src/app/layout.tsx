export const metadata = {
  title: "POS SaaS Backend",
  description: "Backend API untuk aplikasi POS multi-tenant",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
