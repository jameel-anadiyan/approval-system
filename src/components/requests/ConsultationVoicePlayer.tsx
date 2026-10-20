import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { useSignedUrl } from '../../lib/files';
import { VoicePlayer } from './VoicePlayer';

interface ConsultationVoicePlayerProps {
  storagePath: string;
  duration?: number | null;
  title?: string;
}

export const ConsultationVoicePlayer: React.FC<ConsultationVoicePlayerProps> = ({
  storagePath,
  duration,
  title = 'Voice Message',
}) => {
  const { isBackendConnected } = useAuth();
  const signed = useSignedUrl('request-files', storagePath, isBackendConnected);

  return (
    <div className="w-full">
      <VoicePlayer
        url={isBackendConnected ? signed.url || undefined : undefined}
        duration={duration || 20}
        title={title}
      />
    </div>
  );
};
