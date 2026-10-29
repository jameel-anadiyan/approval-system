import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Compass,
  Minimize2,
  Maximize2,
} from 'lucide-react';

interface PreviewJoystickProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoomLevel: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset?: () => void;
  className?: string;
}

export const PreviewJoystick: React.FC<PreviewJoystickProps> = ({
  containerRef,
  zoomLevel,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  className = '',
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [knobPos, setKnobPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const baseRef = useRef<HTMLDivElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const velocityRef = useRef<{ vx: number; vy: number }>({ vx: 0, vy: 0 });
  const holdIntervalRef = useRef<number | null>(null);

  const MAX_RADIUS = 30; // Maximum distance knob can move from center (px)
  const MAX_SPEED = 18; // Maximum scroll speed (px per frame)
  const STEP_SCROLL = 140; // Step scroll for clicking directional buttons

  // Continuous animation loop for smooth analog scrolling
  const runScrollLoop = useCallback(() => {
    if (
      containerRef.current &&
      (velocityRef.current.vx !== 0 || velocityRef.current.vy !== 0)
    ) {
      containerRef.current.scrollLeft += velocityRef.current.vx;
      containerRef.current.scrollTop += velocityRef.current.vy;
    }
    animFrameRef.current = requestAnimationFrame(runScrollLoop);
  }, [containerRef]);

  // Pointer event handlers for the center joystick knob
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore if pointer capture fails
    }
    setIsDragging(true);

    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = requestAnimationFrame(runScrollLoop);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !baseRef.current) return;
    e.preventDefault();

    const rect = baseRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const dx = e.clientX - centerX;
    const dy = e.clientY - centerY;
    const dist = Math.hypot(dx, dy);

    if (dist === 0) {
      setKnobPos({ x: 0, y: 0 });
      velocityRef.current = { vx: 0, vy: 0 };
      return;
    }

    const angle = Math.atan2(dy, dx);
    const clampedDist = Math.min(dist, MAX_RADIUS);
    const clampedX = Math.cos(angle) * clampedDist;
    const clampedY = Math.sin(angle) * clampedDist;

    setKnobPos({ x: clampedX, y: clampedY });

    // Calculate velocity along X and Y axes
    const speed = (clampedDist / MAX_RADIUS) * MAX_SPEED;
    velocityRef.current = {
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
    };
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    setIsDragging(false);
    setKnobPos({ x: 0, y: 0 });
    velocityRef.current = { vx: 0, vy: 0 };

    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
  };

  // Directional button handlers with click + hold support
  const startHoldScroll = (deltaX: number, deltaY: number) => {
    if (!containerRef.current) return;
    // Initial jump
    containerRef.current.scrollBy({ left: deltaX, top: deltaY, behavior: 'smooth' });

    // Continuous scroll if held down
    if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
    holdIntervalRef.current = window.setInterval(() => {
      if (containerRef.current) {
        containerRef.current.scrollBy({ left: deltaX * 0.4, top: deltaY * 0.4 });
      }
    }, 50);
  };

  const stopHoldScroll = () => {
    if (holdIntervalRef.current) {
      clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
    };
  }, []);

  if (isCollapsed) {
    return (
      <div className={`absolute bottom-4 right-4 z-30 select-none ${className}`}>
        <button
          type="button"
          onClick={() => setIsCollapsed(false)}
          className="w-11 h-11 rounded-full bg-slate-900/70 hover:bg-slate-900/90 text-indigo-300 hover:text-white backdrop-blur-md border border-white/20 shadow-2xl flex items-center justify-center transition-all cursor-pointer group"
          title="Open Navigation Joystick & Zoom"
        >
          <Compass className="w-5 h-5 group-hover:rotate-45 transition-transform" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`absolute bottom-4 right-4 z-30 select-none flex flex-col items-center gap-1.5 ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Top Floating Glassmorphic Zoom Pill */}
      <div className="bg-slate-900/75 hover:bg-slate-900/90 backdrop-blur-md border border-white/20 shadow-2xl rounded-full px-2 py-1 flex items-center gap-1 text-white transition-opacity duration-200">
        <button
          type="button"
          onClick={onZoomOut}
          className="p-1 hover:bg-white/15 rounded-full text-slate-300 hover:text-white transition-colors cursor-pointer"
          title="Zoom Out (-)"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={onZoomReset}
          className="px-1.5 py-0.5 text-[10px] font-mono font-bold text-indigo-300 hover:text-white hover:bg-white/10 rounded transition-colors cursor-pointer"
          title="Reset Zoom to 100%"
        >
          {zoomLevel}%
        </button>

        <button
          type="button"
          onClick={onZoomIn}
          className="p-1 hover:bg-white/15 rounded-full text-slate-300 hover:text-white transition-colors cursor-pointer"
          title="Zoom In (+)"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>

        {onZoomReset && zoomLevel !== 100 && (
          <button
            type="button"
            onClick={onZoomReset}
            className="p-1 hover:bg-white/15 rounded-full text-amber-300 hover:text-amber-200 transition-colors cursor-pointer"
            title="Reset to 100%"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        )}

        <button
          type="button"
          onClick={() => setIsCollapsed(true)}
          className="p-1 ml-0.5 hover:bg-white/15 rounded-full text-slate-400 hover:text-white transition-colors cursor-pointer"
          title="Collapse Joystick"
        >
          <Minimize2 className="w-3 h-3" />
        </button>
      </div>

      {/* Round Joystick Disc */}
      <div
        ref={baseRef}
        className="relative w-[130px] h-[130px] rounded-full bg-slate-900/70 hover:bg-slate-900/85 backdrop-blur-md border border-white/20 shadow-2xl flex items-center justify-center transition-all duration-200"
      >
        {/* Subtle Cross-Hair Axis Lines */}
        <div className="absolute inset-0 pointer-events-none rounded-full flex items-center justify-center overflow-hidden">
          <div className="w-full h-px bg-white/10" />
          <div className="h-full w-px bg-white/10 absolute" />
          <div className="w-[84px] h-[84px] rounded-full border border-white/10 absolute" />
        </div>

        {/* Directional Up Button */}
        <button
          type="button"
          onPointerDown={() => startHoldScroll(0, -STEP_SCROLL)}
          onPointerUp={stopHoldScroll}
          onPointerLeave={stopHoldScroll}
          className="absolute top-1.5 left-1/2 -translate-x-1/2 w-7 h-7 rounded-full bg-white/5 hover:bg-indigo-500/40 text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer active:scale-90"
          title="Scroll Up (Hold or Click)"
          aria-label="Scroll Up"
        >
          <ChevronUp className="w-4 h-4" />
        </button>

        {/* Directional Down Button */}
        <button
          type="button"
          onPointerDown={() => startHoldScroll(0, STEP_SCROLL)}
          onPointerUp={stopHoldScroll}
          onPointerLeave={stopHoldScroll}
          className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-7 h-7 rounded-full bg-white/5 hover:bg-indigo-500/40 text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer active:scale-90"
          title="Scroll Down (Hold or Click)"
          aria-label="Scroll Down"
        >
          <ChevronDown className="w-4 h-4" />
        </button>

        {/* Directional Left Button */}
        <button
          type="button"
          onPointerDown={() => startHoldScroll(-STEP_SCROLL, 0)}
          onPointerUp={stopHoldScroll}
          onPointerLeave={stopHoldScroll}
          className="absolute left-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white/5 hover:bg-indigo-500/40 text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer active:scale-90"
          title="Scroll Left (Hold or Click)"
          aria-label="Scroll Left"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {/* Directional Right Button */}
        <button
          type="button"
          onPointerDown={() => startHoldScroll(STEP_SCROLL, 0)}
          onPointerUp={stopHoldScroll}
          onPointerLeave={stopHoldScroll}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white/5 hover:bg-indigo-500/40 text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer active:scale-90"
          title="Scroll Right (Hold or Click)"
          aria-label="Scroll Right"
        >
          <ChevronRight className="w-4 h-4" />
        </button>

        {/* Center Draggable Analog Stick Knob */}
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{
            transform: `translate(${knobPos.x}px, ${knobPos.y}px)`,
            transition: isDragging ? 'none' : 'transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}
          className={`w-11 h-11 rounded-full flex items-center justify-center cursor-grab active:cursor-grabbing shadow-lg border transition-shadow touch-none ${
            isDragging
              ? 'bg-indigo-600 text-white border-indigo-400 shadow-indigo-500/50 scale-105'
              : 'bg-slate-800/90 text-indigo-300 border-white/30 hover:border-indigo-400/80 shadow-black/40'
          }`}
          title="Drag joystick in any direction to pan document continuously"
        >
          {/* Inner Joystick Nub indicator */}
          <div
            className={`w-4 h-4 rounded-full border transition-all ${
              isDragging
                ? 'bg-white border-white scale-110 shadow-sm'
                : 'bg-indigo-400/60 border-indigo-300/40'
            }`}
          />
        </div>
      </div>
    </div>
  );
};
