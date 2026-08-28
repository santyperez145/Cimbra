import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export async function generateMetadata(): Promise<Metadata> {
  const publicUrl = process.env.CIMBRA_PUBLIC_URL ?? process.env.NEXT_PUBLIC_CIMBRA_PUBLIC_URL ?? 'http://localhost:3000';
  return {
    metadataBase: new URL(publicUrl),
    title: 'Cimbra — Infraestructura financiera para Latinoamérica',
    description: 'Cuentas, pagos, tarjetas, crédito y compliance en una plataforma API-first para lanzar y escalar productos financieros.',
    openGraph: {
      title: 'Cimbra — Infraestructura financiera para Latinoamérica',
      description: 'Cuentas, pagos, tarjetas, crédito y compliance en una plataforma API-first para lanzar y escalar productos financieros.',
      url: publicUrl,
      siteName: 'Cimbra',
      locale: 'es_419',
      type: 'website',
      images: [{ url: '/og.png', width: 1536, height: 804, alt: 'Cimbra — Infraestructura financiera para Latinoamérica' }],
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Cimbra — Infraestructura financiera para Latinoamérica',
      description: 'Cuentas, pagos, tarjetas, crédito y compliance en una plataforma API-first.',
      images: ['/og.png'],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
