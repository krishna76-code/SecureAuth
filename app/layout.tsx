import type { Metadata } from 'next'
import './globals.css'
import { AuthProvider } from '@/contexts/AuthContext'
import { SessionBatcher } from '@/components/SessionBatcher';
import { TransactionEventProvider } from '@/contexts/TransactionEventContext';
import { Toaster } from '@/components/ui/toaster';

export const metadata: Metadata = {
  title: 'SecureAuth Portal',
  description: 'Secure Banking Authentication with Behavioral Biometrics anomaly detection',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <TransactionEventProvider>
            <SessionBatcher />
            {children}
            <Toaster />
          </TransactionEventProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
