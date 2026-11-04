import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRequests } from '../../context/RequestContext';
import { useDirectory } from '../../lib/directory';
import {
  GeminiChatMessage,
  sendGeminiVoiceMessage,
  speakMalayalam,
  stopSpeaking,
  isSpeaking,
  getGeminiApiKey,
  setGeminiApiKey,
  DEFAULT_GEMINI_API_KEY,
} from '../../lib/geminiVoiceService';
import { formatINR } from '../../lib/formatters';
import {
  Mic,
  MicOff,
  Send,
  Volume2,
  VolumeX,
  RotateCcw,
  Sparkles,
  Bot,
  ExternalLink,
  Settings,
  Check,
  Loader2,
  Play,
} from 'lucide-react';
import { Modal } from '../../components/common/Modal';

// Web Speech API interfaces
interface IWindow extends Window {
  SpeechRecognition?: any;
  webkitSpeechRecognition?: any;
}

const INITIAL_WELCOME_MALAYALAM =
  'നമസ്കാരം കൊച്ചു മുതലാളി! ഞാൻ നിങ്ങളുടെ Gemini AI വോയ്‌സ് അസിസ്റ്റൻ്റാണ്. അപ്രൂവലുകൾ, റിപ്പോർട്ടുകൾ, പെൻഡിങ് റിക്വസ്റ്റുകൾ, ഡിസ്ബേഴ്സ്മെന്റുകൾ തുടങ്ങിയ എല്ലാ വിവരങ്ങളും എന്നോട് ചോദിക്കാം. എന്താണ് കൊച്ചു മുതലാളിക്ക് ഇന്ന് അറിയേണ്ടത്?';

export const AdminGeminiVoicePage: React.FC = () => {
  const navigate = useNavigate();
  const { requests, threshold } = useRequests();
  const { shops, departments, users } = useDirectory();

  const [messages, setMessages] = useState<GeminiChatMessage[]>(() => [
    {
      id: 'welcome-1',
      role: 'model',
      text: INITIAL_WELCOME_MALAYALAM,
      timestamp: new Date(),
    },
  ]);

  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [isAudioSpeaking, setIsAudioSpeaking] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [selectedLanguage, setSelectedLanguage] = useState<'ml-IN' | 'en-IN'>('ml-IN');
  const [speechSupported] = useState(() => {
    if (typeof window === 'undefined') return false;
    const win = window as unknown as IWindow;
    return Boolean(win.SpeechRecognition || win.webkitSpeechRecognition);
  });
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [customKeyInput, setCustomKeyInput] = useState(getGeminiApiKey());
  const [keySavedBanner, setKeySavedBanner] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<any>(null);

  // Auto-scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isProcessing, liveTranscript]);

  // Cleanup speech synthesis on unmount
  useEffect(() => {
    return () => {
      stopSpeaking();
    };
  }, []);

  // Speak welcome message on user intent
  const handlePlayWelcome = () => {
    setIsAudioSpeaking(true);
    speakMalayalam(
      INITIAL_WELCOME_MALAYALAM,
      () => setIsAudioSpeaking(true),
      () => setIsAudioSpeaking(false),
      () => setIsAudioSpeaking(false)
    );
  };

  // Stop currently playing speech
  const handleStopSpeaking = () => {
    stopSpeaking();
    setIsAudioSpeaking(false);
  };

  // Replay a specific message's audio
  const handlePlayMessageAudio = (text: string) => {
    if (isSpeaking()) {
      handleStopSpeaking();
      return;
    }
    setIsAudioSpeaking(true);
    speakMalayalam(
      text,
      () => setIsAudioSpeaking(true),
      () => setIsAudioSpeaking(false),
      () => setIsAudioSpeaking(false)
    );
  };

  // Send message to Gemini AI
  const handleSendMessage = useCallback(
    async (textToSend: string) => {
      const trimmed = textToSend.trim();
      if (!trimmed || isProcessing) return;

      stopSpeaking();
      setIsAudioSpeaking(false);

      const userMsg: GeminiChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        text: trimmed,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setInputText('');
      setLiveTranscript('');
      setIsProcessing(true);

      const liveContext = {
        requests,
        shops,
        departments,
        users,
        threshold,
      };

      try {
        const history = messages.map((m) => ({ role: m.role, text: m.text }));
        const res = await sendGeminiVoiceMessage(trimmed, history, liveContext);

        const aiMsg: GeminiChatMessage = {
          id: `ai-${Date.now()}`,
          role: 'model',
          text: res.text,
          timestamp: new Date(),
          widgetData: res.widgetData,
        };

        setMessages((prev) => [...prev, aiMsg]);

        // Speak aloud automatically if autoSpeak is enabled
        if (autoSpeak) {
          setIsAudioSpeaking(true);
          speakMalayalam(
            res.text,
            () => setIsAudioSpeaking(true),
            () => setIsAudioSpeaking(false),
            () => setIsAudioSpeaking(false)
          );
        }
      } catch (err: any) {
        console.error('Gemini Voice Error:', err);
        const errMsg: GeminiChatMessage = {
          id: `err-${Date.now()}`,
          role: 'model',
          text: `ക്ഷമിക്കണം കൊച്ചു മുതലാളി, എന്തോ തടസ്സം നേരിട്ടു: ${err.message || 'Error communicating with Gemini'}`,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, errMsg]);
      } finally {
        setIsProcessing(false);
      }
    },
    [autoSpeak, isProcessing, messages, requests, shops, departments, users, threshold]
  );

  // Toggle voice listening
  const toggleListening = () => {
    if (isListening) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
      }
      setIsListening(false);
      return;
    }

    const win = window as unknown as IWindow;
    const SpeechRecognition = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert('Your browser does not support Speech Recognition. Please use Chrome, Edge, or Safari.');
      return;
    }

    stopSpeaking();
    setIsAudioSpeaking(false);

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = selectedLanguage;
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setIsListening(true);
        setLiveTranscript('');
      };

      recognition.onresult = (event: any) => {
        let interim = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interim += event.results[i][0].transcript;
          }
        }

        const currentText = finalTranscript || interim;
        setLiveTranscript(currentText);

        if (finalTranscript) {
          setIsListening(false);
          handleSendMessage(finalTranscript);
        }
      };

      recognition.onerror = (event: any) => {
        console.warn('Speech recognition error:', event.error);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.error('Failed to start speech recognition:', err);
      setIsListening(false);
    }
  };

  // Quick Prompt Chips
  const quickPrompts = [
    'ഇപ്പോൾ അഡ്മിൻ അപ്രൂവലിന് എത്ര പെൻഡിങ് ഉണ്ട്?',
    'ഇന്നത്തെ ആകെ അപ്രൂവൽ റിപ്പോർട്ട് തരൂ',
    'കൂടുതൽ ഡിസ്കൗണ്ട് പോയ ഷോപ്പുകൾ ഏതെല്ലാം?',
    'ആകെ ഡിസ്ബേഴ്സ് ചെയ്ത തുകയും പഴയ അഡ്വാൻസും',
    'ഷോപ്പുകളുടെ കണക്കുകൾ പരിശോധിക്കുക',
    'ഹൈ വാല്യൂ (ലക്ഷത്തിന് മുകളിലുള്ള) റിക്വസ്റ്റുകൾ',
  ];

  return (
    <div className="flex flex-col h-[calc(100dvh-5.5rem)] max-w-5xl mx-auto">
      {/* Top Header Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 sm:p-4 mb-3 shadow-xl flex items-center justify-between gap-3 shrink-0 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-linear-to-br from-violet-600 via-indigo-600 to-teal-500 p-0.5 shadow-md shadow-violet-500/20">
            <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-violet-400 animate-pulse" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm sm:text-base font-bold text-white font-display flex items-center gap-1.5">
                <span>Gemini Voice</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-violet-950 text-violet-300 border border-violet-700/60 font-black">
                  AI INTELLIGENCE
                </span>
              </h2>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            </div>
            <p className="text-[11px] text-slate-400 font-medium">
              Dedicated Executive Assistant for <strong className="text-amber-300 font-bold">കൊച്ചു മുതലാളി</strong>
            </p>
          </div>
        </div>

        {/* Controls Bar */}
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
          {/* Language Selector */}
          <div className="flex items-center bg-slate-950 rounded-xl p-0.5 border border-slate-800">
            <button
              type="button"
              onClick={() => setSelectedLanguage('ml-IN')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                selectedLanguage === 'ml-IN'
                  ? 'bg-violet-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Voice Recognition: Malayalam"
            >
              മലയാളം
            </button>
            <button
              type="button"
              onClick={() => setSelectedLanguage('en-IN')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                selectedLanguage === 'en-IN'
                  ? 'bg-violet-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Voice Recognition: English / Manglish"
            >
              EN
            </button>
          </div>

          {/* Auto-read Aloud Toggle */}
          <button
            type="button"
            onClick={() => {
              if (isAudioSpeaking) handleStopSpeaking();
              setAutoSpeak(!autoSpeak);
            }}
            className={`p-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer flex items-center gap-1.5 ${
              autoSpeak
                ? 'bg-emerald-950/70 text-emerald-300 border-emerald-700/60 shadow-xs'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
            }`}
            title={autoSpeak ? 'Audio Speech: Active (Click to mute)' : 'Audio Speech: Muted (Click to enable)'}
          >
            {autoSpeak ? <Volume2 className="w-4 h-4 text-emerald-400" /> : <VolumeX className="w-4 h-4" />}
            <span className="hidden sm:inline text-[11px]">{autoSpeak ? 'Audio ON' : 'Audio Muted'}</span>
          </button>

          {/* Settings / API Key Button */}
          <button
            type="button"
            onClick={() => {
              setCustomKeyInput(getGeminiApiKey());
              setShowKeyModal(true);
            }}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs transition-colors cursor-pointer"
            title="Configure Gemini API Key"
          >
            <Settings className="w-4 h-4" />
          </button>

          {/* Welcome Audio Greeting */}
          <button
            type="button"
            onClick={handlePlayWelcome}
            className="px-2.5 py-1.5 rounded-xl bg-violet-950/80 hover:bg-violet-900/90 text-violet-300 border border-violet-700/60 text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5"
            title="Listen to Welcome Greeting (സ്വാഗതം കേൾക്കൂ)"
          >
            <Play className="w-3.5 h-3.5 text-violet-400" />
            <span className="hidden md:inline">സ്വാഗതം</span>
          </button>

          {/* Clear Chat Button */}
          <button
            type="button"
            onClick={() => {
              stopSpeaking();
              setIsAudioSpeaking(false);
              setMessages([
                {
                  id: `welcome-${Date.now()}`,
                  role: 'model',
                  text: INITIAL_WELCOME_MALAYALAM,
                  timestamp: new Date(),
                },
              ]);
            }}
            className="p-2 rounded-xl bg-slate-800 hover:bg-rose-950/60 text-slate-400 hover:text-rose-300 border border-slate-700 transition-colors cursor-pointer"
            title="Clear Chat History"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Audio Waveform Banner when speaking or listening */}
      {(isListening || isAudioSpeaking) && (
        <div className="bg-linear-to-r from-violet-900/40 via-indigo-900/40 to-teal-900/40 border border-violet-500/30 rounded-2xl px-4 py-2.5 mb-2 flex items-center justify-between animate-in fade-in shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-6 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-8 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-5 bg-teal-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              <span className="w-1.5 h-7 bg-violet-300 rounded-full animate-bounce" style={{ animationDelay: '450ms' }} />
            </div>
            <div>
              <p className="text-xs font-bold text-white">
                {isListening ? 'ശ്രദ്ധിച്ചു കേൾക്കുന്നു... സംസാരിക്കൂ' : 'കൊച്ചു മുതലാളിയോട് സംസാരിക്കുന്നു...'}
              </p>
              {liveTranscript && (
                <p className="text-[11px] text-violet-200 font-mono italic">"{liveTranscript}"</p>
              )}
            </div>
          </div>
          {isAudioSpeaking && (
            <button
              type="button"
              onClick={handleStopSpeaking}
              className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition-colors cursor-pointer"
            >
              Stop Audio
            </button>
          )}
        </div>
      )}

      {/* Main Conversation Stream */}
      <div className="flex-1 bg-slate-950 border border-slate-800 rounded-2xl p-3 sm:p-4 overflow-y-auto space-y-4 shadow-inner">
        {messages.map((msg) => {
          const isModel = msg.role === 'model';
          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isModel ? 'items-start' : 'items-end'} animate-in fade-in duration-200`}
            >
              <div className="flex items-start gap-2 max-w-[92%] sm:max-w-[85%]">
                {isModel && (
                  <div className="w-8 h-8 rounded-xl bg-linear-to-br from-violet-600 to-indigo-600 text-white flex items-center justify-center shrink-0 mt-0.5 shadow-md shadow-violet-500/20">
                    <Bot className="w-4 h-4" />
                  </div>
                )}

                <div
                  className={`rounded-2xl p-3.5 sm:p-4 text-xs sm:text-sm leading-relaxed transition-all shadow-md ${
                    isModel
                      ? 'bg-slate-900 border border-slate-800 text-slate-100 rounded-tl-xs'
                      : 'bg-indigo-600 text-white rounded-tr-xs font-medium'
                  }`}
                >
                  {/* Sender title & Audio Action */}
                  <div className="flex items-center justify-between gap-3 mb-1.5 pb-1 border-b border-white/10 text-[11px]">
                    <span className="font-bold tracking-wide text-violet-300">
                      {isModel ? 'Gemini Voice AI' : 'കൊച്ചു മുതലാളി'}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-slate-400">
                        {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {isModel && (
                        <button
                          type="button"
                          onClick={() => handlePlayMessageAudio(msg.text)}
                          className="p-1 rounded-md hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
                          title="Replay Voice (Audio)"
                        >
                          <Volume2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Body Text (Malayalam) */}
                  <div className="whitespace-pre-wrap font-sans space-y-1">
                    {msg.text}
                  </div>

                  {/* Optional Interactive Data Widget */}
                  {msg.widgetData && (
                    <div className="mt-3 pt-2.5 border-t border-slate-800 space-y-2">
                      <div className="flex items-center justify-between text-[11px] font-bold text-violet-400">
                        <span>{msg.widgetData.title}</span>
                      </div>

                      {/* Request items clickable mini-cards */}
                      {msg.widgetData.items && msg.widgetData.items.length > 0 && (
                        <div className="grid grid-cols-1 gap-1.5 max-h-56 overflow-y-auto pr-1">
                          {msg.widgetData.items.map((item) => (
                            <div
                              key={item.id}
                              onClick={() => navigate(`/requests/${item.id}`)}
                              className="p-2 rounded-xl bg-slate-950/80 hover:bg-slate-800/80 border border-slate-800 hover:border-violet-500/50 flex items-center justify-between gap-2 text-xs transition-all cursor-pointer group"
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-mono font-bold text-violet-300">
                                    {item.request_no || 'REQ'}
                                  </span>
                                  <span className="text-slate-300 font-semibold truncate max-w-[200px]">
                                    {item.title}
                                  </span>
                                </div>
                                <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                                  {item.shop_name && <span>Shop: {item.shop_name} • </span>}
                                  <span className="capitalize">{item.status?.replace(/_/g, ' ')}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {typeof item.amount === 'number' && (
                                  <span className="font-bold text-emerald-400 font-mono text-xs">
                                    {formatINR(item.amount)}
                                  </span>
                                )}
                                <ExternalLink className="w-3.5 h-3.5 text-slate-500 group-hover:text-violet-400" />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Stats Overview Pill Cards */}
                      {msg.widgetData.stats && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-1">
                          {Object.entries(msg.widgetData.stats).map(([k, v]) => (
                            <div key={k} className="p-2 rounded-xl bg-slate-950/90 border border-slate-800">
                              <span className="text-[10px] text-slate-400 block truncate capitalize">
                                {k.replace(/_/g, ' ')}
                              </span>
                              <span className="text-xs font-bold text-slate-100 font-mono mt-0.5 block truncate">
                                {String(v)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Processing Indicator */}
        {isProcessing && (
          <div className="flex items-start gap-2 animate-in fade-in">
            <div className="w-8 h-8 rounded-xl bg-linear-to-br from-violet-600 to-indigo-600 text-white flex items-center justify-center shrink-0 mt-0.5">
              <Bot className="w-4 h-4" />
            </div>
            <div className="p-3.5 rounded-2xl bg-slate-900 border border-slate-800 text-slate-300 text-xs flex items-center gap-2 shadow-md">
              <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
              <span>ഡാറ്റ പരിശോധിക്കുന്നു, കൊച്ചു മുതലാളിക്ക് മറുപടി തയ്യാറാക്കുന്നു…</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick Prompt Suggestion Chips */}
      <div className="py-2 overflow-x-auto flex items-center gap-1.5 shrink-0 scrollbar-none">
        <span className="text-[10px] uppercase font-bold text-slate-400 mr-1 shrink-0">
          ചോദിക്കൂ:
        </span>
        {quickPrompts.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => handleSendMessage(q)}
            disabled={isProcessing}
            className="px-2.5 py-1 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 hover:border-violet-500/50 text-[11px] font-medium whitespace-nowrap transition-all cursor-pointer disabled:opacity-50 shrink-0"
          >
            {q}
          </button>
        ))}
      </div>

      {/* Bottom Voice & Text Input Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-2 sm:p-3 shadow-xl shrink-0">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage(inputText);
          }}
          className="flex items-center gap-2"
        >
          {/* Main Glowing Microphone Button */}
          {speechSupported && (
            <button
              type="button"
              onClick={toggleListening}
              disabled={isProcessing}
              className={`p-3 rounded-xl transition-all cursor-pointer shrink-0 relative flex items-center justify-center ${
                isListening
                  ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/50 animate-pulse ring-4 ring-rose-500/30'
                  : 'bg-violet-600 hover:bg-violet-500 text-white shadow-md shadow-violet-600/30'
              }`}
              title={isListening ? 'സംസാരം നിർത്താൻ അമർത്തുക (Stop Listening)' : 'സംസാരിക്കാൻ അമർത്തുക (Tap to Speak in Malayalam)'}
            >
              {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              {isListening && (
                <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-rose-400 animate-ping" />
              )}
            </button>
          )}

          {/* Text Input Field */}
          <div className="relative flex-1">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={
                isListening
                  ? 'നിങ്ങളുടെ ശബ്ദം കേൾക്കുന്നു…'
                  : 'കൊച്ചു മുതലാളിക്ക് എന്തും ചോദിക്കാം (സംസാരിക്കുക അല്ലെങ്കിൽ ടൈപ്പ് ചെയ്യുക)…'
              }
              disabled={isProcessing}
              className="w-full bg-slate-950 border border-slate-800 focus:border-violet-500 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-hidden transition-colors"
            />
          </div>

          {/* Send Button */}
          <button
            type="submit"
            disabled={!inputText.trim() || isProcessing}
            className="p-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer shrink-0 shadow-md shadow-indigo-600/20"
            title="Send Message"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>

      {/* API Key Settings Modal */}
      {showKeyModal && (
        <Modal
          isOpen={showKeyModal}
          onClose={() => setShowKeyModal(false)}
          title="Gemini AI API Key Configuration"
          description="Manage the Google Gemini API key powering Kochu Muthalali's Voice AI."
        >
          <div className="space-y-4">
            {keySavedBanner && (
              <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-800 text-xs flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-600" />
                <span>API Key successfully updated!</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Gemini API Key
              </label>
              <input
                type="text"
                value={customKeyInput}
                onChange={(e) => setCustomKeyInput(e.target.value)}
                placeholder="Enter Gemini API Key"
                className="w-full font-mono text-xs px-3.5 py-2.5 border border-slate-300 rounded-xl focus:ring-1 focus:ring-violet-500 focus:border-violet-500"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Default pre-configured key is active. You can replace it with any Google AI Studio key anytime.
              </p>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setCustomKeyInput(DEFAULT_GEMINI_API_KEY);
                  setGeminiApiKey(DEFAULT_GEMINI_API_KEY);
                  setKeySavedBanner(true);
                  setTimeout(() => setKeySavedBanner(false), 2000);
                }}
                className="text-xs font-bold text-slate-500 hover:text-slate-800"
              >
                Reset to Default Key
              </button>

              <button
                type="button"
                onClick={() => {
                  setGeminiApiKey(customKeyInput);
                  setKeySavedBanner(true);
                  setTimeout(() => {
                    setKeySavedBanner(false);
                    setShowKeyModal(false);
                  }, 1200);
                }}
                className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold text-xs shadow-md transition-colors"
              >
                Save Key
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
