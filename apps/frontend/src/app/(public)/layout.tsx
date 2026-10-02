import { ReactNode } from 'react';
import { Plus_Jakarta_Sans } from 'next/font/google';
import styles from './public-layout.module.scss';

const jakartaSans = Plus_Jakarta_Sans({
  weight: ['500', '600', '700'],
  subsets: ['latin'],
});

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${jakartaSans.className} ${styles.body}`}>
        {children}
      </body>
    </html>
  );
}
