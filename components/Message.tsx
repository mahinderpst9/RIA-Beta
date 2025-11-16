
import React from 'react';
import { UserIcon, BotIcon, SoundWaveIcon } from './icons';
import type { ConversationTurn } from '../types';

interface MessageProps extends ConversationTurn {
  isPartial?: boolean;
  isSpeaking?: boolean;
}

export const Message: React.FC<MessageProps> = ({ speaker, text, isPartial = false, isSpeaking = false }) => {
  const isModel = speaker === 'model';

  return (
    <div className={`flex items-start gap-4 ${isModel ? '' : 'flex-row-reverse'}`}>
      <div className={`relative flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${isModel ? 'bg-cyan-500' : 'bg-gray-600'}`}>
        {isModel ? <BotIcon className="w-6 h-6 text-white" /> : <UserIcon className="w-6 h-6 text-white" />}
        {isSpeaking && (
          <div className="absolute -right-1 -bottom-1 p-0.5 bg-gray-800 rounded-full">
            <SoundWaveIcon className="w-4 h-4 text-cyan-300" />
          </div>
        )}
      </div>
      <div
        className={`relative px-5 py-3 rounded-2xl max-w-lg lg:max-w-2xl
          ${isModel ? 'bg-gray-800 rounded-bl-none' : 'bg-blue-600 rounded-br-none'}
          ${isPartial ? 'opacity-70' : ''}
        `}
      >
        <p className="text-white whitespace-pre-wrap">
          {text}
          {isPartial && <span className="inline-block w-0.5 h-5 bg-white ml-1 blinking-cursor align-bottom"></span>}
        </p>
      </div>
    </div>
  );
};
