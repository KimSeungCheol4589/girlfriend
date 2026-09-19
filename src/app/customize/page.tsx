import type { Metadata } from 'next';

import { CustomizeView } from '@/features/customization/components/CustomizeView';

export const metadata: Metadata = {
  title: '꾸미기',
};

export default function CustomizePage() {
  return <CustomizeView />;
}
