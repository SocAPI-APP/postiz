import { internalFetch } from '@gitroom/helpers/utils/internal.fetch';
import { sanitizePostContent } from '@gitroom/helpers/utils/sanitize.post.content';
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';
import Link from 'next/link';
import { CommentsComponents } from '@gitroom/frontend/components/preview/comments.components';
import { PreviewCommentsProvider } from '@gitroom/frontend/components/preview/preview.comments.context';
import { PostContentClient } from '@gitroom/frontend/components/preview/post.content.client';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { VideoOrImage } from '@gitroom/react/helpers/video.or.image';
import { CopyClient } from '@gitroom/frontend/components/preview/copy.client';
import { getT } from '@gitroom/react/translation/get.translation.service.backend';
import { RenderPreviewDateClient } from '@gitroom/frontend/components/preview/render.preview.date.client';
import { CreationMethodBadge } from '@gitroom/frontend/components/launches/creation.method.badge';

dayjs.extend(utc);

const postStateStyles: Record<string, { badge: string; dot: string }> = {
  QUEUE: {
    badge: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
    dot: 'bg-amber-300',
  },
  PUBLISHED: {
    badge: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
    dot: 'bg-emerald-300',
  },
  DRAFT: {
    badge: 'border-slate-400/30 bg-slate-400/10 text-slate-300',
    dot: 'bg-slate-300',
  },
  ERROR: {
    badge: 'border-red-400/30 bg-red-400/10 text-red-300',
    dot: 'bg-red-300',
  },
};

export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'Postiz' : 'Gitroom'} Preview`,
  description: '',
};
export default async function Auth(props: {
  params: Promise<{
    id: string;
  }>;
  searchParams?: Promise<{
    share?: string;
  }>;
}) {
  const searchParams = await props.searchParams;
  const params = await props.params;

  const { id } = params;

  const post = await (await internalFetch(`/public/posts/${id}`)).json();
  const t = await getT();
  if (!post.length) {
    return (
      <div className="text-newTextColor fixed start-0 top-0 w-full h-full flex justify-center items-center text-[20px]">
        {t('post_not_found', 'Post not found')}
      </div>
    );
  }

  const state = post[0].state || 'UNKNOWN';
  const stateStyle = postStateStyles[state] || {
    badge: 'border-sky-400/30 bg-sky-400/10 text-sky-300',
    dot: 'bg-sky-300',
  };
  const releaseURL = post[0].releaseURL;

  return (
<PreviewCommentsProvider
  previewId={id}
  postIds={post.map((p: any) => p.id)}
  organizationId={post[0].organizationId}
>
  <div className="mx-auto w-full max-w-[1346px] p-[12px] flex flex-col gap-[8px] text-newTextColor">
    <div className="flex bg-newBgColorInner rounded-[12px] min-h-[80px] px-[20px] py-[12px] items-center gap-[20px] flex-wrap">
      <Link
        href="/"
        className="flex items-center gap-[10px] text-textColor"
      >
        <div className="flex items-center gap-[10px]">
          <img
            src="/socapi-icon.png"
            width={32}
            height={32}
            alt="SocAPI"
            className="h-[32px] w-[32px] object-contain"
          />
          <span className="text-[26px] font-semibold leading-none tracking-[-0.5px]">
            SocAPI
          </span>
        </div>
      </Link>

      <div className="flex-1" />

      <div className="flex items-center gap-[20px] text-[14px] text-textItemBlur">
        <div>
          {t('publication_date', 'Publication Date:')}{' '}
          <span className="text-newTextColor">
            <RenderPreviewDateClient date={post[0].publishDate} />
          </span>
            </div>
            {!!searchParams?.share && (
              <>
                <div className="w-[1px] h-[20px] bg-blockSeparator" />
                <CopyClient />
              </>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-3 rounded-xl border border-white/10 bg-gradient-to-r from-white/[0.07] to-white/[0.03] p-3 shadow-[0_12px_35px_rgba(0,0,0,0.22)] sm:flex-row sm:items-center sm:px-4">
          <div className="flex items-center gap-3 sm:pe-5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
              {t('post_status', 'Status')}
            </span>
            <span
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold tracking-wide ${stateStyle.badge}`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full shadow-[0_0_8px_currentColor] ${stateStyle.dot}`}
              />
              {state}
            </span>
          </div>

          <div className="hidden h-8 w-px bg-white/10 sm:block" />

          <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3 sm:ps-2">
            <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
              {t('post_url', 'Post URL')}
            </span>
            {releaseURL ? (
              <a
                href={releaseURL}
                target="_blank"
                rel="noreferrer"
                className="group flex min-w-0 items-center gap-2 text-sm text-sky-300 transition-colors hover:text-sky-200"
              >
                <span className="truncate underline decoration-sky-400/30 underline-offset-4 group-hover:decoration-sky-300">
                  {releaseURL}
                </span>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className="h-4 w-4 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path d="M14 5h5v5M10 14 19 5M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
                </svg>
              </a>
            ) : (
              <span className="text-sm text-gray-500">
                {t(
                  'post_url_available_after_publication',
                  'Available after publication'
                )}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-[8px]">
          <div className="flex-1 flex flex-col gap-[8px]">
            {post.map((p: any, index: number) => (
              <div
                key={String(p.id)}
                className="bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[20px]"
              >
                <div className="flex gap-[12px]">
                  <div>
                    <div className="flex shrink-0 rounded-full relative">
                      <div className="w-[50px] h-[50px] z-[20]">
                        <img
                          className="w-full h-full relative z-[20] bg-newBgColor aspect-square rounded-full"
                          alt={post[0].integration.name}
                          src={post[0].integration.picture}
                        />
                      </div>
                      <div className="absolute -end-[5px] -bottom-[5px] w-[24px] h-[24px] z-[20]">
                        <img
                          className="w-full h-full bg-newBgColor aspect-square rounded-full"
                          alt={post[0].integration.providerIdentifier}
                          src={`/icons/platforms/${post[0].integration.providerIdentifier}.png`}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex-1 flex flex-col gap-[8px] min-w-0">
                    <div className="flex items-center gap-[8px]">
                      <h2 className="text-[14px] font-[600]">
                        {post[0].integration.name}
                      </h2>
                      <span className="text-[14px] text-textItemBlur">
                        @{post[0].integration.profile}
                      </span>
                      {index === 0 && (
                        <CreationMethodBadge
                          creationMethod={p.creationMethod}
                          size="md"
                        />
                      )}
                    </div>
                    <div className="flex flex-col gap-[16px]">
                      <PostContentClient
                        postId={p.id}
                        html={sanitizePostContent(p.content)}
                      />
                      {!!JSON.parse(p?.image || '[]').length && (
                        <div className="flex w-full gap-[10px]">
                          {JSON.parse(p?.image || '[]').map((p: any) => (
                            <div
                              key={p.name}
                              className="flex-1 rounded-[10px] max-h-[500px] overflow-hidden"
                            >
                              <VideoOrImage
                                isContain={true}
                                src={p.path}
                                autoplay={true}
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="w-full lg:w-[380px] lg:flex-shrink-0">
            <div className="bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[20px] lg:sticky lg:top-[12px]">
              <CommentsComponents previewId={id} />
            </div>
          </div>
        </div>
      </div>
    </PreviewCommentsProvider>
  );
}
