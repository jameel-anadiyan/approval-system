import React from 'react';
import { VoiceRecorder } from './VoiceRecorder';
import type { ActionVoice } from '../../context/RequestContext';

/** Optional voice message recorded by the Clerk / Head / Admin while acting on a request. */
export const ActionVoiceField: React.FC<{ onChange: (v: ActionVoice | null) => void; label?: string }> = ({
  onChange,
  label = 'Add a voice message for the next person (optional)',
}) => (
  <div>
    <span className="text-xs font-bold text-slate-700 block mb-1">{label}</span>
    <VoiceRecorder
      onRecordingComplete={(r) => onChange({ blob: r.blob, duration: r.duration })}
      onClear={() => onChange(null)}
    />
  </div>
);
