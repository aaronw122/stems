import type { HumanNeededType } from '../../../shared/types.ts';

const TYPE_INDICATORS: Record<string, { symbol: string; label: string }> = {
  question: { symbol: '?', label: 'Question' },
  error: { symbol: '!', label: 'Error' },
  idle: { symbol: 'zzz', label: 'Idle' },
  permission: { symbol: '?', label: 'Permission' },
};

interface HumanFlashProps {
  needsHuman: boolean;
  humanNeededType: HumanNeededType;
}

export function HumanFlash({ needsHuman, humanNeededType }: HumanFlashProps) {
  if (!needsHuman || !humanNeededType) return null;

  const fallback = { symbol: '!', label: 'Error' };
  const indicator = TYPE_INDICATORS[humanNeededType] ?? fallback;

  return (
    <div className="flex items-center gap-1 mt-1">
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-red-500/30 text-[10px] font-bold text-red-400">
        {indicator.symbol}
      </span>
      <span className="text-[10px] text-red-400">{indicator.label}</span>
    </div>
  );
}
