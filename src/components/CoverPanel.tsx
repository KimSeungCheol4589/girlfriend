import { Photo } from '@/components/Photo';
import { daysTogether, formatKoreanDate } from '@/lib/dates';
import type { DemoCoverPreview, DemoSpace } from '@/lib/demo/types';

/**
 * 홈 커버.
 *
 * 기본 배경은 테마별 합성 그라데이션(--cover-gradient)이다. 외부 사진을 내려받지 않는다.
 * 꾸미기 화면에서 커버 이미지를 고르면 이 브라우저에서만 만든 미리보기를 대신 보여 준다.
 * 업로드와 공유 저장은 아직 없다.
 */
export function CoverPanel({
  space,
  coverPreview = null,
  today,
}: {
  space: DemoSpace;
  coverPreview?: DemoCoverPreview | null;
  today?: string;
}) {
  const dayCount = daysTogether(space.relationshipStartDate, today);

  return (
    <section
      aria-labelledby="cover-space-name"
      className="relative overflow-hidden rounded-card border border-border shadow-card"
      style={{ backgroundImage: 'var(--cover-gradient)' }}
    >
      {coverPreview ? (
        <>
          <div className="absolute inset-0">
            <Photo
              src={coverPreview.objectUrl}
              alt={coverPreview.alt}
              priority
              sizes="(min-width: 768px) 1120px, 100vw"
            />
          </div>
          {/* 어떤 사진이 와도 글자가 읽히도록 밝은 막을 덮는다. */}
          <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-[#fffdfa]/95 via-[#fffdfa]/60 to-[#fffdfa]/20" />
        </>
      ) : null}

      <div className="relative flex min-h-[220px] flex-col justify-end gap-2 px-5 py-6 sm:min-h-[300px] sm:px-8 sm:py-8">
        <span className="chip w-fit bg-[#fffdfa]/80 text-[#3a332e]">우리 공간</span>
        <h1 id="cover-space-name" className="text-2xl font-bold text-[#3a332e] sm:text-3xl">
          {space.name}
        </h1>
        <p className="max-w-xl text-sm leading-relaxed text-[#584e46] sm:text-base">
          {space.introduction}
        </p>

        {/* DESIGN.md 9: 시작일이 없으면 날짜 배지를 숨긴다. */}
        {dayCount.status === 'ok' ? (
          <p className="mt-1 inline-flex w-fit items-center gap-2 rounded-pill bg-[#fffdfa]/85 px-3.5 py-1.5 text-sm font-semibold text-[#3a332e]">
            <span aria-hidden>💗</span>
            함께한 지 {dayCount.days.toLocaleString('ko-KR')}일
            {space.relationshipStartDate ? (
              <span className="font-normal text-[#6f655c]">
                ({formatKoreanDate(space.relationshipStartDate)}부터)
              </span>
            ) : null}
          </p>
        ) : null}

        {dayCount.status === 'future' ? (
          <p className="mt-1 w-fit rounded-pill bg-[#fffdfa]/85 px-3.5 py-1.5 text-sm font-semibold text-[#7A2E28]">
            시작일이 오늘보다 뒤예요. 설정에서 다시 확인해 주세요.
          </p>
        ) : null}
      </div>

      <p className="relative border-t border-white/40 bg-[#fffdfa]/70 px-5 py-2 text-[11px] text-[#6f655c] sm:px-8">
        {coverPreview
          ? `커버 미리보기: ${coverPreview.fileName} — 이 브라우저에서만 보입니다. 업로드하지 않았고 상대방에게 전달되지 않아요.`
          : '커버 사진 업로드는 아직 없습니다. 지금은 테마별 합성 배경을 보여 줍니다.'}
      </p>
    </section>
  );
}
