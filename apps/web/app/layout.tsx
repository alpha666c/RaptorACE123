import type { Metadata } from 'next';
import './globals.css';
import { Shell } from '../components/Shell';
import { ApprovalModal } from '../components/ApprovalModal';

export const metadata: Metadata = {
  title: 'Personal Coding Agent — Oversight',
  description: 'Local oversight UI for your coding agent.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Shell>{children}</Shell>
        <ApprovalModal />
      </body>
    </html>
  );
}
