
export type Status = 'idle' | 'connecting' | 'listening' | 'error';

export interface ConversationTurn {
  speaker: 'user' | 'model';
  text: string;
}
