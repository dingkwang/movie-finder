'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Nav() {
  const path = usePathname();
  const tab = 'px-4 py-2 rounded-lg text-sm font-medium transition-colors';
  const active = 'bg-gray-700 text-white';
  const inactive = 'text-gray-400 hover:text-white';

  return (
    <nav className="flex justify-center gap-2 pt-6 pb-2">
      <Link href="/" className={`${tab} ${path === '/' ? active : inactive}`}>
        院线查询
      </Link>
      <Link href="/ai" className={`${tab} ${path === '/ai' ? active : inactive}`}>
        AI 搜索
      </Link>
    </nav>
  );
}
