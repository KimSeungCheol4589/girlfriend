/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 데모 단계에서는 원격 이미지 호스트를 사용하지 않는다. 모든 아트워크는 public/ 아래의 합성 SVG다.
  images: {
    remotePatterns: [],
  },
  eslint: {
    // lint는 별도 `pnpm lint` 스크립트에서 실행한다. build가 lint 실패를 가리지 않도록 분리한다.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
