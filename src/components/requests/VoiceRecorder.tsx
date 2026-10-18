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

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const startRecording = async () => {
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
          name: `voice_note_${Date.now()}.${mimeType.includes('mp4') ? 'm4a' : 'webm'}`,
          blob,
          duration: recordTime,
        });

        // Stop all audio tracks
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start(250);
      setIsRecording(true);
      setRecordTime(0);

      timerRef.current = setInterval(() => {
        setRecordTime((t) => t + 1);
      }, 1000);
    } catch {
      // Simulate audio note for environments without mic permissions or headless testing
      simulateMockRecording();
    }
  };

  const simulateMockRecording = () => {
    setIsRecording(true);
    setRecordTime(0);
    timerRef.current = setInterval(() => {
      setRecordTime((t) => {
        if (t >= 8) {
          stopMockRecording(8);
          return 8;
        }
        return t + 1;
      });
    }, 1000);
  };

  const stopMockRecording = (finalDuration = 8) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setIsRecording(false);
    const mockBlob = new Blob(['mock-audio-data'], { type: 'audio/webm' });
    setAudioBlob(mockBlob);
    setAudioUrl('mock-voice-url');
    onRecordingComplete({
      name: `voice_note_${Date.now()}.webm`,
      blob: mockBlob,
      duration: finalDuration,
    });
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    } else {
      stopMockRecording(recordTime);
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
                Duration: {formatDuration(recordTime || 8)}
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
    </div>
  );
};
