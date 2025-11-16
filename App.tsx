
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, LiveSession } from '@google/genai';
import { SYSTEM_INSTRUCTION } from './constants';
import { decode, encode, decodeAudioData, createBlob } from './utils/audio';
import type { ConversationTurn, Status } from './types';
import { Message } from './components/Message';
import { MicIcon, StopIcon, BotIcon, UserIcon } from './components/icons';

const App: React.FC = () => {
  const [status, setStatus] = useState<Status>('idle');
  const [conversation, setConversation] = useState<ConversationTurn[]>([]);
  const [currentModelResponse, setCurrentModelResponse] = useState<string>('');
  const [currentUserInput, setCurrentUserInput] = useState<string>('');

  const sessionPromiseRef = useRef<Promise<LiveSession> | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  const currentInputTranscriptionRef = useRef('');
  const currentOutputTranscriptionRef = useRef('');

  const handleStartSession = useCallback(async () => {
    if (status !== 'idle') return;

    setStatus('connecting');
    setConversation([]);
    setCurrentUserInput('');
    setCurrentModelResponse('');

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
      
      sessionPromiseRef.current = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          systemInstruction: SYSTEM_INSTRUCTION,
        },
        callbacks: {
          onopen: async () => {
            setStatus('listening');
            // FIX: Cast window to `any` to allow access to the vendor-prefixed `webkitAudioContext` for older browsers, resolving a TypeScript error.
            inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            // FIX: Cast window to `any` to allow access to the vendor-prefixed `webkitAudioContext` for older browsers, resolving a TypeScript error.
            outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
            
            mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaStreamSourceRef.current = inputAudioContextRef.current.createMediaStreamSource(mediaStreamRef.current);
            scriptProcessorRef.current = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);
            
            scriptProcessorRef.current.onaudioprocess = (audioProcessingEvent) => {
              const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              if (sessionPromiseRef.current) {
                sessionPromiseRef.current.then((session) => {
                  session.sendRealtimeInput({ media: pcmBlob });
                });
              }
            };
            
            mediaStreamSourceRef.current.connect(scriptProcessorRef.current);
            scriptProcessorRef.current.connect(inputAudioContextRef.current.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription) {
              currentInputTranscriptionRef.current += message.serverContent.inputTranscription.text;
              setCurrentUserInput(currentInputTranscriptionRef.current);
            }
            if (message.serverContent?.outputTranscription) {
              currentOutputTranscriptionRef.current += message.serverContent.outputTranscription.text;
              setCurrentModelResponse(currentOutputTranscriptionRef.current);
            }

            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData.data;
            if (base64Audio && outputAudioContextRef.current) {
                const audioContext = outputAudioContextRef.current;
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, audioContext.currentTime);
                const audioBuffer = await decodeAudioData(decode(base64Audio), audioContext, 24000, 1);
                const source = audioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(audioContext.destination);
                source.addEventListener('ended', () => {
                    audioSourcesRef.current.delete(source);
                });
                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;
                audioSourcesRef.current.add(source);
            }

            if (message.serverContent?.turnComplete) {
              setConversation(prev => [
                ...prev,
                { speaker: 'user', text: currentInputTranscriptionRef.current },
                { speaker: 'model', text: currentOutputTranscriptionRef.current },
              ]);
              currentInputTranscriptionRef.current = '';
              currentOutputTranscriptionRef.current = '';
              setCurrentUserInput('');
              setCurrentModelResponse('');
            }

            if(message.serverContent?.interrupted){
                for(const source of audioSourcesRef.current.values()){
                    source.stop();
                    audioSourcesRef.current.delete(source);
                }
                nextStartTimeRef.current = 0;
            }
          },
          onerror: (e: Error) => {
            console.error('Session error:', e);
            setStatus('error');
            handleStopSession();
          },
          onclose: () => {
            if (status !== 'idle' && status !== 'error') {
               setStatus('idle');
            }
          },
        },
      });

    } catch (error) {
      console.error('Failed to start session:', error);
      setStatus('error');
    }
  }, [status]);
  
  const handleStopSession = useCallback(async () => {
    if (sessionPromiseRef.current) {
      const session = await sessionPromiseRef.current;
      session.close();
      sessionPromiseRef.current = null;
    }
  
    scriptProcessorRef.current?.disconnect();
    scriptProcessorRef.current = null;
    
    mediaStreamSourceRef.current?.disconnect();
    mediaStreamSourceRef.current = null;

    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    mediaStreamRef.current = null;

    inputAudioContextRef.current?.close();
    outputAudioContextRef.current?.close();
    inputAudioContextRef.current = null;
    outputAudioContextRef.current = null;
    
    audioSourcesRef.current.forEach(source => source.stop());
    audioSourcesRef.current.clear();
    nextStartTimeRef.current = 0;

    currentInputTranscriptionRef.current = '';
    currentOutputTranscriptionRef.current = '';
    setCurrentUserInput('');
    setCurrentModelResponse('');

    setStatus('idle');
  }, []);

  useEffect(() => {
    return () => {
      if (status !== 'idle') {
        handleStopSession();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getStatusText = () => {
    switch (status) {
      case 'idle':
        return 'Click the microphone to start the conversation';
      case 'connecting':
        return 'Connecting to Gemini...';
      case 'listening':
        return 'Listening... Speak now.';
      case 'error':
        return 'An error occurred. Please try again.';
      default:
        return '';
    }
  };

  const isSessionActive = status === 'listening' || status === 'connecting';

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white font-sans">
      <header className="p-4 border-b border-gray-700 shadow-md">
        <h1 className="text-2xl font-bold text-center text-cyan-400">Conversational Voice App</h1>
        <p className="text-center text-gray-400">with Gemini 2.5 Native Audio</p>
      </header>
      
      <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
        <div className="max-w-4xl mx-auto space-y-6">
          {conversation.map((turn, index) => (
            <Message key={index} speaker={turn.speaker} text={turn.text} />
          ))}
          {currentUserInput && <Message speaker="user" text={currentUserInput} isPartial={true} />}
          {currentModelResponse && <Message speaker="model" text={currentModelResponse} isPartial={true} />}
          
          {conversation.length === 0 && !currentUserInput && !currentModelResponse && (
             <div className="flex flex-col items-center justify-center text-center text-gray-500 pt-16">
                <BotIcon className="w-24 h-24 mb-4" />
                <p className="text-lg">I'm Ria, your Zomato support agent.</p>
                <p>How can I help you today?</p>
             </div>
          )}
        </div>
      </main>
      
      <footer className="p-4 bg-gray-900/80 backdrop-blur-sm border-t border-gray-700 sticky bottom-0">
        <div className="flex flex-col items-center justify-center space-y-3">
          <button
            onClick={isSessionActive ? handleStopSession : handleStartSession}
            disabled={status === 'connecting'}
            className={`relative flex items-center justify-center w-20 h-20 rounded-full transition-all duration-300 ease-in-out focus:outline-none focus:ring-4 focus:ring-offset-2 focus:ring-offset-gray-900
              ${status === 'listening' ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500 animate-pulse' : 'bg-cyan-500 hover:bg-cyan-600 focus:ring-cyan-400'}
              ${status === 'connecting' ? 'bg-gray-600 cursor-not-allowed' : ''}
            `}
            aria-label={isSessionActive ? 'Stop session' : 'Start session'}
          >
            {isSessionActive ? <StopIcon className="w-10 h-10 text-white" /> : <MicIcon className="w-10 h-10 text-white" />}
          </button>
          <p className="text-sm text-gray-400 h-5">{getStatusText()}</p>
        </div>
      </footer>
    </div>
  );
};

export default App;
