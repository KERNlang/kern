'use client';

import { useTranslation } from 'react-i18next';

export function Dashboard() {
  const { t } = useTranslation();

  return (
    <div className="bg-gray-50 space-y-8">
      <div className="p-4 justify-between items-center flex">
        <span className="text-2xl font-bold">{t('fitvt', 'FITVT')}</span>
        <img src="/avatar.png" alt="avatar" className="w-[40px] h-[40px] rounded-[20px]" />
      </div>
      <div className="p-4 rounded-xl bg-white m-4">
        <div className="mb-3">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-zinc-300">Calories</span>
            <span className="text-zinc-400">1840/2200 kcal</span>
          </div>
          <div className="h-2 bg-zinc-700 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-[#FF6B6B]" style={{ width: '84%' }} />
          </div>
        </div>
        <div className="mb-3">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-zinc-300">Protein</span>
            <span className="text-zinc-400">96/140 g</span>
          </div>
          <div className="h-2 bg-zinc-700 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-[#4ECDC4]" style={{ width: '69%' }} />
          </div>
        </div>
        <div className="mb-3">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-zinc-300">Carbs</span>
            <span className="text-zinc-400">210/260 g</span>
          </div>
          <div className="h-2 bg-zinc-700 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-[#FFD166]" style={{ width: '81%' }} />
          </div>
        </div>
        <div className="mb-3">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-zinc-300">Fat</span>
            <span className="text-zinc-400">58/70 g</span>
          </div>
          <div className="h-2 bg-zinc-700 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-[#6C5CE7]" style={{ width: '83%' }} />
          </div>
        </div>
      </div>
      <button className="w-full rounded-lg bg-[#007AFF] p-4" onClick={() => {}}>
        {t('logMeal', 'Log Meal')}
      </button>
      <div className="space-y-2">
        <div>
        </div>
        <div>
        </div>
        <div>
        </div>
        <div>
        </div>
        <div>
        </div>
      </div>
      <nav className="flex">
        <button>{t('dashboard', 'Dashboard')}</button>
        <button>{t('log', 'Log')}</button>
        <button>{t('stats', 'Stats')}</button>
        <button>{t('settings', 'Settings')}</button>
      </nav>
    </div>
  );
}