import Image from 'next/image';

/**
 * 데모 아트워크와 브라우저 미리보기(blob:)를 함께 다루기 때문에 최적화를 끈다.
 * 실제 사진 연동 시에는 Storage 경로와 크기를 받아 최적화 설정을 다시 정한다.
 */
export function Photo({
  src,
  alt,
  className,
  sizes = '(min-width: 768px) 360px, 100vw',
  priority = false,
}: {
  src: string;
  alt: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src={src}
      alt={alt}
      fill
      unoptimized
      sizes={sizes}
      priority={priority}
      className={className ?? 'object-cover'}
    />
  );
}
