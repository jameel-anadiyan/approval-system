import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, Volume2, Mic } from 'lucide-react';
import { formatDuration } from '../../lib/formatters';

interface VoicePlayerProps {
  url?: string;
  duration?: number | null;
  title?: string;
}

export const VoicePlayer: React.FC<VoicePlayerProps> = ({
  url,
  duration = 20,
  title = 'Voice Note Attachment',
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
    };
  }, []);

  const togglePlay = () => {
    if (!audioRef.current && !url) {
      // Simulate play for demo if no real audio URL
      if (isPlaying) {
        setIsPlaying(false);
      } else {
        setIsPlaying(true);
        const interval = setInterval(() => {
          setCurrentTime((prev) => {
            if (prev >= (duration || 20)) {
              clearInterval(interval);
              setIsPlaying(false);
              return 0;
            }
            return prev + 1;
          });
        }, 1000);
      }
      return;
    }

    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        audioRef.current.play().catch(() => {});
        setIsPlaying(true);
      }
    }
  };

  const currentDuration = duration || 20;
  const progressPercent = Math.min(100, (currentTime / currentDuration) * 100);

  // Decorative waveform bars
  const bars = [40, 70, 30, 85, 60, 95, 45, 80, 55, 90, 75, 40, 65, 85, 50, 70, 35, 60];

  return (
    <div className="bg-indigo-50/60 rounded-2xl p-4 border border-indigo-100/90 flex flex-col gap-3">
      {url && <audio ref={audioRef} src={url} preload="metadata" />}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center shadow-xs">
            <Mic className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-800">{title}</h4>
            <span className="text-[10px] text-indigo-700 font-medium">
              Audio Recording
            </span>
          </div>
        </div>

        <div className="text-xs font-mono font-bold text-indigo-900 bg-white/80 px-2 py-0.5 rounded-md border border-indigo-200/50">
          {formatDuration(currentTime)} / {formatDuration(currentDuration)}
        </div>
      </div>

      {/* Waveform & Play button */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          className="w-11 h-11 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center shrink-0 shadow-md shadow-indigo-200 transition-transform active:scale-95"
          aria-label={isPlaying ? 'Pause voice note' : 'Play voice note'}
        >
          {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
        </button>

        {/* Interactive Waveform Display */}
        <div className="flex-1 flex items-center gap-1 h-8 bg-white/70 px-3 rounded-xl border border-indigo-100 overflow-hidden">
          {bars.map((height, i) => {
            const barProgress = (i / bars.length) * 100;
            const isPassed = progressPercent >= barProgress;
            return (
              <div
                key={i}
                style={{ height: `${height}%` }}
                className={`flex-1 min-w-[3px] rounded-full transition-colors ${
                  isPassed
                    ? 'bg-indigo-600'
                    : isPlaying
                    ? 'bg-indigo-200 animate-pulse'
                    : 'bg-indigo-200'
                }`}
              />
            );
          })}
        </div>

        <Volume2 className="w-4 h-4 text-indigo-400 shrink-0 hidden sm:block" />
      </div>
    </div>
  );
};
