import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, Trash2, Play, Pause, Check } from 'lucide-react';
import { formatDuration } from '../../lib/formatters';

interface VoiceRecorderProps {
  onRecordingComplete: (file: { name: string; blob: Blob; duration: number }) => void;
  onClear?: () => void;
}

export const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
  onRecordingComplete,
  onClear,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordTime, setRecordTime] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const elapsedRef = useRef(0);

  // Server accepts voice notes up to ~5 minutes.
  const MAX_SECONDS = 300;

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const startRecording = async () => {
    setMicError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setMicError('Voice recording is not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];

      // Determine supported mimeType (MP4/AAC on iOS Safari, WebM on Chrome/Android)
      let mimeType = 'audio/webm';
      if (!MediaRecorder.isTypeSupported('audio/webm')) {
        if (MediaRecorder.isTypeSupported('audio/mp4')) {
          mimeType = 'audio/mp4';
        } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
          mimeType = 'audio/ogg';
        }
      }

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        setAudioBlob(blob);
        setAudioUrl(url);
        onRecordingComplete({
          name: `voice_note_${Date.now()}.${mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm'}`,
          blob,
          duration: Math.max(1, elapsedRef.current),
        });

        // Stop all audio tracks
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start(250);
      setIsRecording(true);
      setRecordTime(0);
      elapsedRef.current = 0;

      timerRef.current = setInterval(() => {
        elapsedRef.current += 1;
        setRecordTime(elapsedRef.current);
        if (elapsedRef.current >= MAX_SECONDS) stopRecording();
      }, 1000);
    } catch {
      setMicError('Microphone access was blocked. Allow the microphone for this site in your browser settings and try again.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) clearInterval(timerRef.current);
    setIsRecording(false);
  };

  const handleClear = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setAudioBlob(null);
    setRecordTime(0);
    setIsPlayingPreview(false);
    onClear?.();
  };

  const togglePreview = () => {
    if (!previewAudioRef.current) return;
    if (isPlayingPreview) {
      previewAudioRef.current.pause();
      setIsPlayingPreview(false);
    } else {
      previewAudioRef.current.play();
      setIsPlayingPreview(true);
    }
  };

  return (
    <div className="bg-slate-50 border border-slate-200/90 rounded-2xl p-4">
      {audioUrl && (
        <audio
          ref={previewAudioRef}
          src={audioUrl}
          onEnded={() => setIsPlayingPreview(false)}
        />
      )}

      <div className="flex items-center justify-between mb-3">
        <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
          <Mic className="w-4 h-4 text-indigo-600" />
          <span>Voice Note (Optional)</span>
        </label>
        <span className="text-[11px] text-slate-400">
          Android & iPhone compatible
        </span>
      </div>

      {!audioBlob ? (
        <div className="flex items-center gap-3">
          {!isRecording ? (
            <button
              type="button"
              onClick={startRecording}
              className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs sm:text-sm shadow-sm transition-all active:scale-95"
            >
              <Mic className="w-4 h-4" />
              <span>Record Voice Note</span>
            </button>
          ) : (
            <div className="flex items-center gap-3 w-full bg-rose-50 border border-rose-200 p-2.5 rounded-xl">
              <span className="w-3 h-3 rounded-full bg-rose-600 animate-ping shrink-0" />
              <div className="flex-1 font-mono font-bold text-rose-700 text-sm">
                Recording: {formatDuration(recordTime)}
              </div>
              <button
                type="button"
                onClick={stopRecording}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs shadow-xs"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Stop</span>
              </button>
            </div>
          )}
        </div>
      ) : (
        /* Recorded Preview State */
        <div className="flex items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={togglePreview}
              className="w-9 h-9 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center hover:bg-indigo-100 transition-colors"
              aria-label={isPlayingPreview ? 'Pause preview' : 'Play preview'}
            >
              {isPlayingPreview ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
            </button>
            <div>
              <div className="text-xs font-semibold text-slate-800 flex items-center gap-1">
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span>Recorded Voice Note</span>
              </div>
              <div className="text-[11px] text-slate-500 font-mono">
                Duration: {formatDuration(recordTime)}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleClear}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
            title="Delete voice note"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      )}

      {micError && <p className="mt-2 text-[11px] text-rose-700">{micError}</p>}
      {isRecording && recordTime >= MAX_SECONDS - 30 && (
        <p className="mt-2 text-[11px] text-amber-700">Recording stops automatically at 5 minutes.</p>
      )}
    </div>
  );
};
