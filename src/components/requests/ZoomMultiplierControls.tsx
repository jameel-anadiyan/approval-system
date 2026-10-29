import React, { useRef, useEffect, useState, useCallback } from 'react';
import { MousePointer, ZoomIn } from 'lucide-react';

export interface UseDocumentMouseFollowOptions {
  multiplier: number;
  initialEnabled?: boolean;
  easeSpeed?: number;
}

/**
 * Hook to manage automatic document panning following mouse movement when zoomed in (>1x).
 * Uses smooth lerp interpolation via requestAnimationFrame with a gentle, relaxed speed.
 */
export function useDocumentMouseFollow({
  multiplier,
  initialEnabled = true,
  easeSpeed = 0.05, // Slower, calmer glide pace (reduced from 0.16)
}: UseDocumentMouseFollowOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [mouseFollowEnabled, setMouseFollowEnabled] = useState(initialEnabled);
  const targetPosRef = useRef<{ x: number; y: number } | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement> | MouseEvent) => {
      if (multiplier <= 1 || !mouseFollowEnabled) return;
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      // Relative mouse position from 0 to 1 across the preview viewport
      const relX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const relY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

      const maxScrollX = container.scrollWidth - container.clientWidth;
      const maxScrollY = container.scrollHeight - container.clientHeight;

      if (maxScrollX > 0 || maxScrollY > 0) {
        targetPosRef.current = {
          x: relX * maxScrollX,
          y: relY * maxScrollY,
        };
      }
    },
    [multiplier, mouseFollowEnabled]
  );

  // Smooth lerp loop
  useEffect(() => {
    if (multiplier <= 1 || !mouseFollowEnabled) {
      targetPosRef.current = null;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      return;
    }

    const step = () => {
      const container = containerRef.current;
      const target = targetPosRef.current;
      if (container && target) {
        const currentX = container.scrollLeft;
        const currentY = container.scrollTop;
        const dx = target.x - currentX;
        const dy = target.y - currentY;

        // Smooth glide towards mouse target at a gentle, comfortable pace
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          container.scrollLeft = currentX + dx * easeSpeed;
          container.scrollTop = currentY + dy * easeSpeed;
        }
      }
      animFrameRef.current = requestAnimationFrame(step);
    };

    animFrameRef.current = requestAnimationFrame(step);
    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [multiplier, mouseFollowEnabled]);

  return {
    containerRef,
    mouseFollowEnabled,
    setMouseFollowEnabled,
    handleMouseMove,
  };
}

interface ZoomMultiplierControlsProps {
  multiplier: number;
  onSelectMultiplier: (m: number) => void;
  mouseFollowEnabled?: boolean;
  onToggleMouseFollow?: () => void;
  className?: string;
  multipliers?: number[];
}

export const ZoomMultiplierControls: React.FC<ZoomMultiplierControlsProps> = ({
  multiplier,
  onSelectMultiplier,
  mouseFollowEnabled = true,
  onToggleMouseFollow,
  className = '',
  multipliers = [1, 2, 3, 4, 5],
}) => {
  return (
    <div
      className={`absolute bottom-4 right-4 z-30 select-none flex items-center gap-1.5 bg-slate-900/85 hover:bg-slate-900/95 backdrop-blur-md border border-white/20 shadow-2xl rounded-full p-1.5 text-white transition-all duration-150 ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1 pl-2 pr-1 text-slate-300">
        <ZoomIn className="w-3.5 h-3.5 text-indigo-400" />
        <span className="text-[10px] font-bold uppercase tracking-wider hidden sm:inline text-slate-400">
          Zoom:
        </span>
      </div>

      <div className="flex items-center gap-1">
        {multipliers.map((m) => {
          const active = multiplier === m;
          return (
            <button
              key={m}
              type="button"
              onClick={() => onSelectMultiplier(m)}
              className={`px-3 py-1 rounded-full text-xs font-bold font-mono transition-all cursor-pointer ${
                active
                  ? 'bg-indigo-600 text-white shadow-md ring-2 ring-indigo-400/40 scale-105'
                  : 'bg-white/10 text-slate-300 hover:bg-white/20 hover:text-white'
              }`}
              title={`Zoom ${m}x (${m * 100}%)`}
            >
              {m}x
            </button>
          );
        })}
      </div>

      {multiplier > 1 && onToggleMouseFollow && (
        <button
          type="button"
          onClick={onToggleMouseFollow}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all cursor-pointer ml-1 border ${
            mouseFollowEnabled
              ? 'bg-emerald-600/30 text-emerald-300 border-emerald-500/50 hover:bg-emerald-600/50 shadow-xs'
              : 'bg-white/10 text-slate-400 border-white/15 hover:bg-white/20'
          }`}
          title={
            mouseFollowEnabled
              ? 'Mouse Follow is ACTIVE: Moving your mouse automatically glides the zoomed document. Click to pause.'
              : 'Mouse Follow is PAUSED. Click to activate auto mouse-follow.'
          }
        >
          <MousePointer className={`w-3 h-3 ${mouseFollowEnabled ? 'animate-pulse text-emerald-400' : ''}`} />
          <span className="hidden sm:inline">
            {mouseFollowEnabled ? 'Mouse Follow: ON' : 'Follow: OFF'}
          </span>
        </button>
      )}
    </div>
  );
};
