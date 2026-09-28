import type { Metadata } from 'next';
import Image from 'next/image';
import { headers } from 'next/headers';
import {
  fetchDeletionStatus,
  normalizeConfirmationCode,
} from '../api/meta/meta-callback.proxy';
import styles from './page.module.scss';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Data deletion request | SocAPI',
  robots: { index: false, follow: false },
};

type PageProps = {
  searchParams: Promise<{ code?: string | string[] }>;
};

export default async function DataDeletionPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rawCode = Array.isArray(params.code) ? params.code[0] : params.code;
  const code = rawCode ? normalizeConfirmationCode(rawCode) : null;
  const requestHeaders = await headers();
  const forwardedFor =
    requestHeaders.get('x-forwarded-for') ||
    requestHeaders.get('x-real-ip') ||
    undefined;
  const status = code ? await fetchDeletionStatus(code, forwardedFor) : null;
  const supportEmail = process.env.SUPPORT_EMAIL?.trim();
  const supportUrl = process.env.NEXT_PUBLIC_DISCORD_SUPPORT?.trim();
  const channelCount = status?.channels ?? 0;

  return (
    <main className={styles.shell}>
      <div className={styles.glow} aria-hidden="true" />
      <section className={styles.card}>
        <header className={styles.brand}>
          <Image
            src="/socapi-icon.png"
            alt=""
            width={44}
            height={44}
            priority
          />
          <span>SocAPI</span>
        </header>

        <div className={styles.eyebrow}>META PRIVACY REQUEST</div>
        <h1>Data deletion request</h1>

        {!rawCode && (
          <div className={styles.content}>
            <p>
              When you remove a SocAPI Meta app or request deletion through
              Meta, SocAPI removes the affected channel credentials, profile
              data, provider identifiers, automation links, and cached
              analytics.
            </p>
            <p>
              Meta will show you a confirmation code after the request is
              completed. Return to this page with that code to check its status.
              Confirmation records are retained for 180 days.
            </p>
          </div>
        )}

        {rawCode && !code && (
          <div className={`${styles.status} ${styles.unknown}`}>
            <span className={styles.statusLabel}>Status</span>
            <strong>Invalid confirmation code</strong>
            <p>The code format is not recognized.</p>
          </div>
        )}

        {code && status && (
          <>
            <div className={styles.codeBlock}>
              <span>Confirmation code</span>
              <code>{code}</code>
            </div>
            <div
              className={`${styles.status} ${
                status.status === 'completed'
                  ? styles.completed
                  : styles.unknown
              }`}
            >
              <span className={styles.statusLabel}>Status</span>
              <strong>
                {status.status === 'completed'
                  ? 'Completed'
                  : 'Unknown or expired'}
              </strong>
              {status.status === 'completed' ? (
                <p>
                  {channelCount}{' '}
                  {channelCount === 1
                    ? 'connected Meta channel'
                    : 'connected Meta channels'}{' '}
                  and the associated Meta-derived data were removed.
                </p>
              ) : (
                <p>
                  No deletion request was found. Confirmation records expire
                  after 180 days.
                </p>
              )}
              {status.status === 'completed' && status.completedAt && (
                <time dateTime={status.completedAt}>
                  Completed {new Date(status.completedAt).toUTCString()}
                </time>
              )}
            </div>
          </>
        )}

        <footer className={styles.footer}>
          <span>Need help?</span>
          {supportEmail ? (
            <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
          ) : supportUrl ? (
            <a href={supportUrl}>Contact SocAPI support</a>
          ) : (
            <span>Contact SocAPI support from your account.</span>
          )}
        </footer>
      </section>
    </main>
  );
}
