import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import McpDirectoryPopup from './components/McpDirectoryPopup';
import { ChatMessage } from '../shared/domain/chat';
import { McpTools } from './components/McpTools';
import MessageContent from './components/MessageContent';
import ToolManager from './components/ToolManager';
import ModelManager from './components/ModelManager';
import LogViewer from './components/LogViewer';
import type { McpToolCall, McpToolResult } from '../shared/domain/mcp';
import './styles.css';

const App: React.FC = () => {
  const [models, setModels] = useState<string[]>([]); // local Ollama models
  const [externalModels, setExternalModels] = useState<any[]>([]); // enabled external models
  const [model, setModel] = useState(''); // selected model (local name or ext:<id>)
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Live streaming progress (external models)
  const [streamingContent, setStreamingContent] = useState<string>('');
  const [streamStage, setStreamStage] = useState<string>('');
  const [streamCycle, setStreamCycle] = useState<number>(0);
  const [streamSimulation, setStreamSimulation] = useState<{ detected:boolean; indicators:string[] }>({ detected:false, indicators:[] });
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [imagePath, setImagePath] = useState<string | undefined>();
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful assistant.');
  const [activeTab, setActiveTab] = useState<'chat' | 'tools'>('chat');
  const [isToolManagerOpen, setIsToolManagerOpen] = useState(false);
  const [isModelManagerOpen, setIsModelManagerOpen] = useState(false);
  const [toolsStatus, setToolsStatus] = useState<{ enabled: number; total: number; limit: number } | null>(null);
  const [isLogViewerOpen, setIsLogViewerOpen] = useState(false);
  const [isMcpDirectoryOpen, setIsMcpDirectoryOpen] = useState(false);
  
  // States for history and autocompletion
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [availableTools, setAvailableTools] = useState<any[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  // Speech-to-text states
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeechSupported, setIsSpeechSupported] = useState<boolean | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [recognitionLang, setRecognitionLang] = useState<string>('');
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [langMenuDirection, setLangMenuDirection] = useState<'down'|'up'>('down');
  const langMenuRef = useRef<HTMLDivElement | null>(null);
  const [autoSendOnStop, setAutoSendOnStop] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const recognitionRef = useRef<any>(null);
  // STT keep-alive & autosend helper refs (must NOT be inside a function)
  const sttKeepAliveRef = useRef(false);
  const inputForAutoSendRef = useRef('');
  // Fallback (Whisper) states
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const fallbackChunksRef = useRef<Blob[]>([]);
  const whisperRetryRef = useRef(false); // evita múltiples auto-reintentos
  const [usingFallback, setUsingFallback] = useState(false);
  const [fallbackError, setFallbackError] = useState<string | null>(null);
  // HQ audio capture (raw PCM -> WAV) option
  const [hqAudio, setHqAudio] = useState(false);
  const [hqSampleRate, setHqSampleRate] = useState<number>(16000); // target output (16k default, can switch to 24k)
  const [vadEnabled, setVadEnabled] = useState<boolean>(true);
  const audioContextRef = useRef<AudioContext | null>(null);
  const scriptNodeRef = useRef<ScriptProcessorNode | null>(null); // ScriptProcessor still widely supported; AudioWorklet would be ideal
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const sourceStreamRef = useRef<MediaStream | null>(null);
  const vadStartedRef = useRef(false);
  const lastSpeechTimeRef = useRef<number>(0);
  // Whisper endpoint (fallback STT). Migration: auto-correct older saved endpoint (port 5005 /transcribe) to the new OpenAI-compatible path on 9000.
  const [whisperEndpoint, setWhisperEndpoint] = useState<string>(() => {
    const saved = localStorage.getItem('whisper-endpoint');
    if (saved) {
      if (/localhost:5005\/transcribe/.test(saved)) {
        const corrected = 'http://localhost:9000/v1/audio/transcriptions';
        console.log('🎙️ Migrating stored whisper endpoint from', saved, 'to', corrected);
        localStorage.setItem('whisper-endpoint', corrected);
        return corrected;
      }
      return saved;
    }
    return 'http://localhost:9000/v1/audio/transcriptions';
  });
  
  const chatRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const loadExternalModels = async () => {
    try {
      const res = await (window as any).externalModels?.getAll();
      if (res?.success) {
        const enabled = (res.models || []).filter((m: any) => m.enabled);
        setExternalModels(enabled);
        if (!model) {
          if (enabled[0]) setModel(`ext:${enabled[0].id}`); else if (models[0]) setModel(models[0]);
        }
      }
    } catch (e) {
      console.error('Error loading external models for dropdown', e);
    }
  };

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  // Listen to external model progress events for streaming UI
  useEffect(() => {
    (window as any).externalModels?.onProgress?.((p: any) => {
      // Only track if current selected model matches
      if (!model.startsWith('ext:')) return;
      if (!p || !p.modelId) return;
      const currentId = model.slice(4);
      if (p.modelId !== currentId) return;
      setStreamStage(p.stage);
      setStreamCycle(p.cycle || 0);
      setStreamingContent(p.content || '');
      setStreamSimulation({ detected: !!p.simulationDetected, indicators: p.simulationIndicators || [] });
      if (p.stage === 'complete' || p.stage === 'terminated') {
        // Append final content as assistant message if not already appended by generate flow
        if (p.content && p.content.trim()) {
          setMessages(prev => [...prev, { role: 'assistant', content: p.content }]);
        }
        setIsLoading(false);
        setTimeout(() => { setStreamingContent(''); setStreamStage(''); }, 400);
      }
    });
  }, [model]);

  // Track latest input for autosend
  useEffect(() => { inputForAutoSendRef.current = input; }, [input]);

  // Initialize speech recognition or mark unsupported
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setIsSpeechSupported(false);
      setRecognitionLang(navigator.language || 'en-US');
      return;
    }
    setIsSpeechSupported(true);
    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    const lang = navigator.language || 'en-US';
    rec.lang = lang;
    setRecognitionLang(lang);
    rec.onresult = (e: any) => {
      console.log('🎙️ Speech result received:', e);
      let interim = '';
      let finalText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      console.log('🎙️ Final text:', finalText, 'Interim:', interim);
      if (finalText) {
        setInterimTranscript('');
        console.log('🎙️ Setting input with final text:', finalText);
        setInput(prev => {
          const newValue = prev.endsWith(' ') || prev.length===0 ? prev + finalText.trim() + ' ' : prev + ' ' + finalText.trim() + ' ';
          console.log('🎙️ Input updated from:', prev, 'to:', newValue);
          return newValue;
        });
      } else if (interim) {
        console.log('🎙️ Setting interim transcript:', interim);
        setInterimTranscript(interim.trim());
      }
    };
    rec.onerror = (e: any) => {
      console.warn('🎙️ Speech recognition error:', e.error);
      if (['not-allowed','service-not-allowed'].includes(e.error)) {
        sttKeepAliveRef.current = false;
        setIsRecording(false);
        setMicError('Permiso de micrófono denegado');
        return;
      }
      // Network/connectivity issues - switch to fallback after 2 failures
      if (['network','service-not-allowed','aborted'].includes(e.error)) {
        console.warn('🎙️ Network/service error, switching to fallback recording');
        sttKeepAliveRef.current = false;
        setIsRecording(false);
        // Switch to fallback immediately on network errors
        if (!usingFallback) {
          setMicError('Problema de conectividad, usando grabación local...');
          setTimeout(() => startFallbackRecording(), 500);
        }
        return;
      }
      if (sttKeepAliveRef.current && ['no-speech'].includes(e.error)) {
        try { rec.stop(); } catch {}
        setTimeout(() => { if (sttKeepAliveRef.current) { try { rec.start(); setIsRecording(true); } catch {} } }, 400);
      }
    };
    rec.onend = () => {
      if (sttKeepAliveRef.current) {
        try { rec.start(); setIsRecording(true); } catch (err) { console.warn('🎙️ Auto-restart failed:', err); setIsRecording(false); }
      } else {
        setIsRecording(false);
        setInterimTranscript('');
        if (autoSendOnStop) {
          const trimmed = inputForAutoSendRef.current.trim();
          if (trimmed.length) send();
        }
      }
    };
    recognitionRef.current = rec;
    return () => { try { rec.stop(); } catch {} };
  }, [autoSendOnStop]);

  // Microphone permission proactive check
  const ensureMicPermission = async (): Promise<boolean> => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) return true; // skip check
      // Query permissions API if available
      // @ts-ignore
      if (navigator.permissions?.query) {
        try {
          // @ts-ignore
          const status = await navigator.permissions.query({ name: 'microphone' as any });
          if (status.state === 'denied') {
            setMicError('Permiso de micrófono denegado. Actívalo en el sistema.');
            return false;
          }
        } catch {}
      }
      // Trigger permission prompt silently
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t=>t.stop());
      return true;
    } catch (e:any) {
      setMicError('No se pudo acceder al micrófono: '+(e?.message||e));
      return false;
    }
  };

  // Persist whisper endpoint
  useEffect(() => { localStorage.setItem('whisper-endpoint', whisperEndpoint); }, [whisperEndpoint]);

  const availableLanguages = [
  'auto','es-ES','es-MX','en-US','en-GB','pt-BR','fr-FR','de-DE','it-IT','ja-JP','ko-KR'
  ];

  const changeLanguage = (lang: string) => {
    setRecognitionLang(lang);
    if (recognitionRef.current) {
      try { 
        recognitionRef.current.lang = lang === 'auto' ? (navigator.language || 'en-US') : lang; 
        // If currently recording, restart to ensure language change applies
        if (isRecording) {
          try { recognitionRef.current.stop(); } catch {}
          setTimeout(()=>{ if (sttKeepAliveRef.current){ try { recognitionRef.current.start(); } catch {} } }, 200);
        }
      } catch {}
    }
    setShowLangMenu(false);
  };

  // Close lang menu on outside click
  useEffect(() => {
    if (!showLangMenu) return;
    const onClick = (e: MouseEvent) => {
      if (!langMenuRef.current) return;
      if (!(langMenuRef.current.contains(e.target as Node))) {
        setShowLangMenu(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [showLangMenu]);

  // Keyboard navigation in lang menu
  const handleLangKey = (e: React.KeyboardEvent) => {
    if (!showLangMenu) return;
    const idx = availableLanguages.indexOf(recognitionLang || 'en-US');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = availableLanguages[(idx + 1) % availableLanguages.length];
      changeLanguage(next);
      setShowLangMenu(true); // reopen
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = availableLanguages[(idx - 1 + availableLanguages.length) % availableLanguages.length];
      changeLanguage(prev);
      setShowLangMenu(true);
    } else if (e.key === 'Escape') {
      setShowLangMenu(false);
    }
  };

  // Utility: downsample Float32 PCM to target sample rate (simple averaging)
  const downsampleBuffer = (buffer: Float32Array, inputSampleRate: number, targetRate: number): Float32Array => {
    if (targetRate >= inputSampleRate) return buffer; // no upsampling
    const ratio = inputSampleRate / targetRate;
    const newLength = Math.floor(buffer.length / ratio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
      const nextOffsetBuffer = Math.floor((offsetResult + 1) * ratio);
      let accum = 0, count = 0;
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) { accum += buffer[i]; count++; }
      result[offsetResult] = accum / count;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    return result;
  };

  const encodeWav = (samples: Float32Array, sampleRate: number): Blob => {
    // Convert float32 -> 16-bit PCM
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const writeString = (off: number, s: string) => { for (let i=0;i<s.length;i++) view.setUint8(off+i, s.charCodeAt(i)); };
    const floatTo16 = (out: DataView, offset: number, input: Float32Array) => {
      let pos = offset;
      for (let i=0;i<input.length;i++, pos+=2) {
        let s = Math.max(-1, Math.min(1, input[i]));
        out.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      }
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // PCM chunk size
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // byte rate
    view.setUint16(32, 2, true); // block align
    view.setUint16(34, 16, true); // bits per sample
    writeString(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    floatTo16(view, 44, samples);
    return new Blob([buffer], { type: 'audio/wav' });
  };

  // Fallback recording (either MediaRecorder Opus or Raw PCM -> WAV) -> Whisper endpoint
  const startFallbackRecording = async () => {
    console.log('🎙️ Starting fallback recording', hqAudio ? '(HQ WAV mode)' : '(Opus/webm)');
    try {
      const constraints: MediaStreamConstraints = { audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } } as any;
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setUsingFallback(true);
      setIsRecording(true);
      setFallbackError(null);
      setMicError(hqAudio ? '🎤 Grabando HQ (WAV 16k)...' : '🎤 Grabando (Opus)...');
      if (hqAudio) {
        // Web Audio path
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        const ctx = audioContextRef.current!;
        const source = ctx.createMediaStreamSource(stream);
        sourceStreamRef.current = stream;
        const processor = ctx.createScriptProcessor(4096, 1, 1);
        pcmChunksRef.current = [];
        processor.onaudioprocess = (e) => {
          const input = e.inputBuffer.getChannelData(0);
          const cloned = new Float32Array(input);
          pcmChunksRef.current.push(cloned);
          if (vadEnabled) {
            // Simple energy-based VAD
            let sumSq = 0;
            for (let i=0;i<cloned.length;i++) { const v = cloned[i]; sumSq += v*v; }
            const rms = Math.sqrt(sumSq / cloned.length);
            const now = performance.now();
            const startThreshold = 0.004; // adjust based on mic level
            const contThreshold = 0.0025;
            if (!vadStartedRef.current && rms > startThreshold) {
              vadStartedRef.current = true;
              lastSpeechTimeRef.current = now;
              console.log('🎙️ VAD: speech started (rms:', rms.toFixed(4), ')');
            } else if (vadStartedRef.current) {
              if (rms > contThreshold) {
                lastSpeechTimeRef.current = now;
              } else if (now - lastSpeechTimeRef.current > 1500) { // 1.5s silence
                console.log('🎙️ VAD: auto-stop after silence');
                vadStartedRef.current = false;
                // Use async to avoid stopping mid-callback
                setTimeout(()=> stopFallbackRecording(), 20);
              }
            }
          }
        };
        source.connect(processor);
        processor.connect(ctx.destination);
        scriptNodeRef.current = processor;
        console.log('🎙️ HQ recording started, sampleRate:', ctx.sampleRate);
      } else {
        // Opus MediaRecorder path
        const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
        const rec = new MediaRecorder(stream, { mimeType: mime });
        fallbackChunksRef.current = [];
        rec.ondataavailable = ev => { if (ev.data && ev.data.size > 0) { fallbackChunksRef.current.push(ev.data); } };
        rec.onstop = () => {
          setIsRecording(false);
          const blob = new Blob(fallbackChunksRef.current, { type: mime });
          console.log('🎙️ Fallback (Opus) blob size:', blob.size);
          transcribeFallbackAudio(blob);
        };
        mediaRecorderRef.current = rec;
        rec.start();
        console.log('🎙️ Opus recording started');
      }
    } catch (e:any) {
      console.warn('🎙️ Fallback recording start failed:', e);
      setFallbackError(e?.message || 'No se pudo iniciar el micrófono');
      setMicError('Error: ' + (e?.message || 'No se pudo acceder al micrófono'));
      setIsRecording(false);
      setUsingFallback(false);
    }
  };

  const stopFallbackRecording = () => {
    if (hqAudio) {
      try {
        scriptNodeRef.current?.disconnect();
        audioContextRef.current?.close();
      } catch {}
      const ctx = audioContextRef.current;
      const sampleRate = ctx?.sampleRate || 48000;
      // Merge Float32 chunks
      const totalLength = pcmChunksRef.current.reduce((acc,c)=>acc+c.length,0);
      const merged = new Float32Array(totalLength);
      let offset = 0; for (const c of pcmChunksRef.current) { merged.set(c, offset); offset += c.length; }
      // Downsample to 16k for Whisper efficiency
      const targetRate = hqSampleRate;
      const ds = downsampleBuffer(merged, sampleRate, targetRate);
      // RMS normalization
      let sumSq = 0; for (let i=0;i<ds.length;i++){ const v = ds[i]; sumSq += v*v; }
      const rms = Math.sqrt(sumSq/ds.length) || 1e-6;
      const targetRms = 0.08; // ~ -22 dBFS
      let gain = targetRms / rms;
      const maxGain = 5.0; if (gain > maxGain) gain = maxGain;
      if (gain > 1.05) {
        for (let i=0;i<ds.length;i++){ ds[i] = Math.max(-1, Math.min(1, ds[i]*gain)); }
        console.log('🎙️ Normalized audio RMS from', rms.toFixed(4), 'to target', targetRms, 'gain', gain.toFixed(2));
      } else {
        console.log('🎙️ RMS within range', rms.toFixed(4), 'no significant gain applied');
      }
      const wavBlob = encodeWav(ds, targetRate);
      console.log('🎙️ HQ WAV size:', wavBlob.size, 'durationApprox(s):', (ds.length/targetRate).toFixed(2), 'targetRate:', targetRate);
      setIsRecording(false);
      sourceStreamRef.current?.getTracks().forEach(t=>t.stop());
      transcribeFallbackAudio(wavBlob);
    } else {
      try { mediaRecorderRef.current?.stop(); } catch {}
      mediaRecorderRef.current?.stream.getTracks().forEach(t => t.stop());
    }
  };

  const transcribeFallbackAudio = async (blob: Blob) => {
    console.log('🎙️ Transcribing fallback audio, blob size:', blob.size, 'endpoint:', whisperEndpoint);
    try {
      setFallbackError(null);
      setMicError('🔄 Transcribiendo audio...');
      
      // Convert blob to ArrayBuffer (no direct Buffer usage in renderer)
      const arrayBuffer = await blob.arrayBuffer();
      console.log('🎙️ Passing raw ArrayBuffer to IPC, byteLength:', arrayBuffer.byteLength, 'endpoint:', whisperEndpoint);
      
      // Use IPC instead of direct fetch to bypass CORS (conversion to Buffer happens in preload)
      const result = await window.whisper.transcribe(
        arrayBuffer,
        whisperEndpoint,
        recognitionLang && recognitionLang !== 'auto' ? recognitionLang.split('-')[0] : undefined
      );
      
      console.log('🎙️ IPC Transcription result:', result);
      
      if (!result.success) {
        throw new Error(result.error || 'Transcription failed');
      }
      
      const text = result.text || '';
      console.log('🎙️ Transcribed text:', text);
      
      if (text) {
        console.log('🎙️ Adding transcribed text to input:', text);
        setInput(prev => {
          const newValue = prev.endsWith(' ')||prev.length===0 ? prev + text.trim() + ' ' : prev + ' ' + text.trim() + ' ';
          console.log('🎙️ Input updated from:', prev, 'to:', newValue);
          return newValue;
        });
        setMicError('✅ Transcrito: "' + text.substring(0, 30) + (text.length > 30 ? '...' : '') + '"');
      } else {
        setMicError('⚠️ No se detectó texto en el audio');
      }
      
      if (autoSendOnStop && text) {
        console.log('🎙️ Auto-sending message with transcribed text');
        setTimeout(() => send(), 100);
      }
    } catch (e: any) {
      console.warn('🎙️ Whisper IPC transcription failed:', e);
      let errorMsg = e?.message || 'Error en transcripción';
      
      // Provide helpful error messages
      if (errorMsg.includes('Failed to fetch') || errorMsg.includes('ERR_CONNECTION_REFUSED') || errorMsg.includes('ECONNREFUSED')) {
        errorMsg = 'No se pudo conectar al servidor Whisper. ¿Está corriendo en ' + whisperEndpoint + '?';
      } else if (errorMsg.includes('Content Security Policy') || errorMsg.includes('CORS')) {
        errorMsg = 'Error de CORS resuelto con IPC, pero servidor no responde correctamente.';
      }

      // Auto-retry: si endpoint actual no es el default y hay fallo de conexión, probar con 9000 una sola vez
      const defaultEp = 'http://localhost:9000/v1/audio/transcriptions';
      if (!whisperRetryRef.current && whisperEndpoint !== defaultEp && (e?.message||'').match(/ECONNREFUSED|Failed to fetch|ERR_CONNECTION_REFUSED/)) {
        whisperRetryRef.current = true;
        console.log('🎙️ Auto-retry: cambiando endpoint Whisper a', defaultEp, 'tras fallo con', whisperEndpoint);
        setMicError('Reintentando con endpoint por defecto...');
        try {
          const arrayBuffer = await blob.arrayBuffer();
          const retry = await window.whisper.transcribe(
            arrayBuffer,
            defaultEp,
            recognitionLang && recognitionLang !== 'auto' ? recognitionLang.split('-')[0] : undefined
          );
          console.log('🎙️ Resultado reintento Whisper:', retry);
          if (retry.success && retry.text) {
            setWhisperEndpoint(defaultEp);
            localStorage.setItem('whisper-endpoint', defaultEp);
            const rtext = (retry.text || '').trim();
            if (rtext) {
              setInput(prev => prev + (prev.endsWith(' ')||prev.length===0 ? '' : ' ') + rtext + ' ');
              setMicError('✅ Transcrito (endpoint corregido)');
            } else {
              setMicError('⚠️ Reintento sin texto');
            }
            return;
          }
        } catch (retryErr:any) {
          console.warn('🎙️ Reintento Whisper falló:', retryErr);
        }
      }
      
      setFallbackError(errorMsg);
      setMicError('❌ ' + errorMsg);
    }
  };

  const toggleRecording = () => {
    console.log('🎙️ Toggle recording called, isSpeechSupported:', isSpeechSupported, 'isRecording:', isRecording, 'usingFallback:', usingFallback);
    
    // If already using fallback, handle fallback recording
    if (usingFallback) {
      if (isRecording) { stopFallbackRecording(); return; }
      startFallbackRecording();
      return;
    }
    
    if (isSpeechSupported) {
      const rec = recognitionRef.current;
      if (!rec) {
        console.warn('🎙️ No recognition ref available, switching to fallback');
        startFallbackRecording();
        return;
      }
      if (isRecording) {
        console.log('🎙️ Stopping recording');
        try { sttKeepAliveRef.current = false; rec.stop(); } catch {}
        return;
      }
      console.log('🎙️ Starting recording');
      setInterimTranscript('');
      setMicError(null);
      ensureMicPermission().then(ok => {
        if (!ok) {
          console.warn('🎙️ Mic permission failed, trying fallback');
          // Try auto fallback if permission failed
          if (!usingFallback) startFallbackRecording();
          return;
        }
        try { 
          sttKeepAliveRef.current = true; 
          console.log('🎙️ Starting recognition with language:', rec.lang);
          rec.start(); 
          setIsRecording(true); 
          setMicError(null);
          // If no interim/final result arrives in 3s, assume SpeechRecognition broken -> fallback
          setTimeout(() => {
            if (sttKeepAliveRef.current && isRecording && !interimTranscript) {
              console.warn('🎙️ No transcript after 3s, switching to fallback');
              // Switch to fallback if still empty transcript
              try { sttKeepAliveRef.current = false; rec.stop(); } catch {}
              if (!usingFallback) {
                setMicError('Sin respuesta del servicio, usando grabación local...');
                startFallbackRecording();
              }
            }
          }, 3000);
        } catch (e:any) { 
          sttKeepAliveRef.current = false; 
          console.warn('🎙️ Unable to start recognition:', e); 
          setMicError('Error al iniciar reconocimiento, usando fallback...');
          // fallback
          if (!usingFallback) setTimeout(() => startFallbackRecording(), 500);
        }
      });
    } else {
      if (isRecording) { stopFallbackRecording(); return; }
      startFallbackRecording();
    }
  };

  // Live tool update listener
  useEffect(() => {
    (window as any).mcp?.onToolsUpdated?.((payload: any) => {
      console.log('🔄 Tools update event received:', payload?.reason, 'count:', payload?.toolsCount);
      if (Array.isArray(payload?.tools)) {
        setAvailableTools(payload.tools);
      } else {
        // Fallback fetch
        loadAvailableTools();
      }
      // Also refresh status if model selected
      if (model) loadToolsStatus();
    });
  }, [model]);

  useEffect(() => {
  window.ollama.listModels().then((ms: string[]) => { setModels(ms); });
  // Load external models
  loadExternalModels();
    
    // Load prompt history from localStorage
    const savedHistory = localStorage.getItem('ollama-chat-prompt-history');
    if (savedHistory) {
      try {
        const parsedHistory = JSON.parse(savedHistory);
        setPromptHistory(parsedHistory);
        console.log('📚 Loaded prompt history:', parsedHistory.length, 'items');
      } catch (error) {
        console.error('Error loading prompt history:', error);
      }
    } else {
      console.log('📚 No prompt history found in localStorage');
    }
    
    // Load available tools for autocompletion
    loadAvailableTools();
    const handler = () => {
      console.log('🌐 External models updated event received, reloading');
      loadExternalModels();
    };
    window.addEventListener('external-models-updated', handler);
    return () => window.removeEventListener('external-models-updated', handler);
  }, []);

  // Reload tools when activeTab changes to ensure fresh data
  useEffect(() => {
    if (activeTab === 'chat') {
      loadAvailableTools();
    }
  }, [activeTab]);

  const loadAvailableTools = async () => {
    try {
      const toolsResponse = await (window as any).mcp?.getTools();
      if (toolsResponse && toolsResponse.tools) {
        setAvailableTools(toolsResponse.tools);
        console.log('🛠️ Loaded available tools:', toolsResponse.tools.length);
      } else if (toolsResponse && Array.isArray(toolsResponse)) {
        setAvailableTools(toolsResponse);
        console.log('🛠️ Loaded available tools (array):', toolsResponse.length);
      } else {
        console.warn('🛠️ No tools found in response:', toolsResponse);
      }
    } catch (error) {
      console.error('Error loading available tools:', error);
    }
  };

  // Load tool status when model changes
  useEffect(() => {
    if (model) {
      loadToolsStatus();
    }
  }, [model]);

  const loadToolsStatus = async () => {
    try {
      // Get all available tools
      const toolsResponse = await (window as any).electronAPI?.getAvailableTools();
      if (toolsResponse && toolsResponse.success) {
        const allTools = toolsResponse.tools;
        const enabledTools = allTools.filter((tool: any) => tool.enabled);
        
        // Get model limits
        const limitsResponse = await (window as any).electronAPI?.getModelLimits();
        const modelLimit = limitsResponse?.success 
          ? (limitsResponse.limits[model] || limitsResponse.limits['default'] || 25)
          : 25;

        setToolsStatus({
          enabled: enabledTools.length,
          total: allTools.length,
          limit: modelLimit
        });
      }
    } catch (error) {
      console.error('Error loading tools status:', error);
    }
  };

  // Functions to handle prompt history
  const addToHistory = (prompt: string) => {
    if (!prompt.trim()) return;
    
    const newHistory = [prompt, ...promptHistory.filter(p => p !== prompt)].slice(0, 50); // Keep last 50
    setPromptHistory(newHistory);
    localStorage.setItem('ollama-chat-prompt-history', JSON.stringify(newHistory));
    setHistoryIndex(-1);
    
    console.log('📝 Prompt added to history:', prompt);
    console.log('📚 History length:', newHistory.length);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // If suggestions are visible, handle them first
    if (showSuggestions) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowSuggestions(false);
        return;
      }
      // Don't process other keys if suggestions are visible
      return;
    }
    
    // Handle history navigation only if no suggestions
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (promptHistory.length > 0 && historyIndex < promptHistory.length - 1) {
        const newIndex = historyIndex + 1;
        setHistoryIndex(newIndex);
        setInput(promptHistory[newIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInput(promptHistory[newIndex]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setInput('');
      }
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      setHistoryIndex(-1);
    }
  };

  const getToolSuggestions = () => {
    const text = input.toLowerCase();
    
    // Check if contains keywords for tools (even without space after)
    const hasUse = text.includes('use');
    const hasRun = text.includes('run');
    const hasExecute = text.includes('execute');
    
    if (!hasUse && !hasRun && !hasExecute) {
      return [];
    }
    
    console.log('🔍 Looking for tool suggestions, input:', input);
    console.log('🔍 Available tools count:', availableTools.length);
    
    // Get the word after the keyword
    let searchTerm = '';
    const useIndex = text.lastIndexOf('use');
    const runIndex = text.lastIndexOf('run');
    const executeIndex = text.lastIndexOf('execute');
    
    const maxIndex = Math.max(
      hasUse ? useIndex : -1,
      hasRun ? runIndex : -1, 
      hasExecute ? executeIndex : -1
    );
    
    if (maxIndex >= 0) {
      // Determine which command was used
      const command = hasExecute && executeIndex === maxIndex ? 'execute' :
                     hasUse && useIndex === maxIndex ? 'use' :
                     hasRun && runIndex === maxIndex ? 'run' : '';
      
      if (command) {
        const afterCommand = input.slice(maxIndex + command.length).trim();
        searchTerm = afterCommand;
      }
    }
    
    console.log('🔍 Search term:', searchTerm);
    
    if (searchTerm === '') {
      const result = availableTools.slice(0, 5); // Show first 5 tools if no search term
      console.log('🔍 Returning first 5 tools:', result.length);
      return result;
    }
    
    const filtered = availableTools.filter(tool => 
      tool.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tool.description?.toLowerCase().includes(searchTerm.toLowerCase())
    ).slice(0, 5);
    
    console.log('🔍 Filtered tools:', filtered.length);
    return filtered;
  };

  const insertToolSuggestion = (tool: any) => {
    const text = input;
    const lowerText = text.toLowerCase();
    
    const useIndex = lowerText.lastIndexOf('use');
    const runIndex = lowerText.lastIndexOf('run');
    const executeIndex = lowerText.lastIndexOf('execute');
    
    const maxIndex = Math.max(useIndex, runIndex, executeIndex);
    if (maxIndex >= 0) {
      // Determine which command was used
      const command = executeIndex === maxIndex ? 'execute' :
                     useIndex === maxIndex ? 'use' :
                     runIndex === maxIndex ? 'run' : '';
      
      if (command) {
        // Replace from command to end
        const beforeCommand = text.slice(0, maxIndex);
        let newText = beforeCommand + command + ' ' + tool.name;
        
        // If tool has required parameters, add placeholder
        if (tool.inputSchema?.properties && Object.keys(tool.inputSchema.properties).length > 0) {
          const requiredParams = Object.entries(tool.inputSchema.properties)
            .filter(([_, def]: [string, any]) => def.required)
            .map(([key, _]) => key);
          
          if (requiredParams.length > 0) {
            newText += ` {${requiredParams.join(', ')}}`;
          }
        }
        
        setInput(newText);
      }
    }
    
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const send = async () => {
    if (!input.trim() || !model) return;
    
    // Add to history
    addToHistory(input.trim());
    const baseMessages = messages.length === 0 && systemPrompt.trim()
      ? [{ role: 'system', content: systemPrompt } as ChatMessage, ...messages]
      : messages;
    let images: string[] | undefined;
    if (imagePath) {
      // If it's a blob URL, fetch and persist to a temp file so main can read it.
      if (imagePath.startsWith('blob:')) {
        try {
          const res = await fetch(imagePath);
          const buf = await res.arrayBuffer();
          // Save via IPC helper (reuse existing openImage? we add minimal inline impl if exposed)
          const array = new Uint8Array(buf);
          // Use a simple bridge: write a temp file using window.ollama.saveTempImage if available
          if ((window as any).ollama?.saveTempImage) {
            const savedPath = await (window as any).ollama.saveTempImage(Array.from(array));
            if (savedPath) images = [savedPath];
          } else {
            // Fallback: cannot persist; keep blob URL (main will skip if not fs.existsSync)
            images = [imagePath];
          }
        } catch (e) {
          console.warn('Failed to persist blob image', e);
          images = [imagePath];
        }
      } else {
        images = [imagePath];
      }
    }
    const newMsg: ChatMessage = { role: 'user', content: input, imagePath, images };
    const newMessages = [...baseMessages, newMsg];
    setMessages(newMessages);
    setInput('');
    setImagePath(undefined);
    setIsLoading(true);
    
    try {
      console.log('🚀 UI: Sending chat request...');
      console.log('📝 UI: Messages being sent:', newMessages);
      console.log('🤖 UI: Model:', model);
      
      let reply: string = '';
      if (model.startsWith('ext:')) {
        const extId = model.slice(4);
        // For external models rely on progress streaming; only call generate and then wait
        const r = await (window as any).externalModels.generate(extId, newMessages);
        if (!r?.success && !r?.partial) throw new Error(r?.error || 'External model error');
        reply = r.content; // May be initial content; streaming events will append completion
      } else {
        reply = await window.ollama.sendChat({ model, messages: newMessages });
      }
      
      console.log('📨 UI: Received reply from main process:', reply);
      console.log('📏 UI: Reply length:', reply?.length || 0);
      console.log('🔤 UI: Reply type:', typeof reply);
      
      if (model.startsWith('ext:')) {
        // External model: show initial content streaming block instead of final message duplication
        if (reply && reply.trim()) {
          setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
        }
      } else if (!reply || reply.trim() === '') {
        console.warn('⚠️ UI: Empty or null reply received');
        setMessages([...newMessages, { 
          role: 'assistant', 
          content: '⚠️ Received empty response from AI model. Please try again.' 
        }]);
      } else {
        console.log('✅ UI: Adding reply to messages');
        setMessages([...newMessages, { role: 'assistant', content: reply }]);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      let userFriendly = errorMessage;
      if (/google/i.test(errorMessage) && /429/.test(errorMessage)) {
        // Extract retry seconds if present (e.g., PT37S or 37s formats)
        const retryMatch = errorMessage.match(/retry (?:after )?(\d+\w?)/i);
        userFriendly = `⚠️ Google rate limit reached. ${retryMatch ? `Suggested wait: ${retryMatch[1]}.` : ''} Reduce request frequency or upgrade quota.`;
      }
      setMessages([...newMessages, { 
        role: 'assistant', 
        content: `❌ Error: ${userFriendly}` 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const pickImage = async () => {
    const p = await window.ollama.openImage();
    if (p) setImagePath(p);
  };

  // Handle file drops
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = Array.from(e.dataTransfer.files);
    const imageFile = files.find(file => file.type.startsWith('image/'));
    
    if (imageFile) {
      // Create a temporary object URL for preview
      const imageUrl = URL.createObjectURL(imageFile);
      setImagePath(imageUrl);
      
      // Optional: You could also convert to base64 here if needed
      console.log('📁 Image dropped:', imageFile.name, imageFile.type);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    const hasImageFile = Array.from(e.dataTransfer.items).some(
      item => item.type.startsWith('image/')
    );
    if (hasImageFile) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    // Only hide drag overlay if leaving the input container completely
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setIsDragOver(false);
    }
  };

  // Handle paste events for images
  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find(item => item.type.startsWith('image/'));
    
    if (imageItem) {
      e.preventDefault();
      const file = imageItem.getAsFile();
      if (file) {
        // Create a temporary object URL for preview
        const imageUrl = URL.createObjectURL(file);
        setImagePath(imageUrl);
        
        console.log('📋 Image pasted:', file.type);
      }
    }
  };

  const handleToolCall = async (call: McpToolCall) => {
    try {
      setIsLoading(true);
      const result: McpToolResult = await window.mcp.callTool(call);
      
      const serialized = JSON.stringify(result.result || result.error, null, 2);
      const toolMessage: ChatMessage = {
        role: 'system',
        content: `Tool executed: ${call.tool}\nResult:\n\n\`\`\`json\n${serialized}\n\`\`\``
      };
      
      setMessages(prev => [...prev, toolMessage]);
      
      // Switch to chat tab to show result
      setActiveTab('chat');
    } catch (error) {
      console.error('Tool call failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="app" role="main">
      <div className="topbar">
        <div className="logo"><span className="brand">Local</span> Ollama Chat</div>
        <div className="tab-buttons">
          <button 
            className={`tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveTab('chat')}
          >
            💬 Chat
          </button>
          <button 
            className={`tab-btn ${activeTab === 'tools' ? 'active' : ''}`}
            onClick={() => setActiveTab('tools')}
          >
            🛠️ Tools
          </button>
          <button 
            className="tab-btn tool-manager-btn"
            onClick={() => setIsToolManagerOpen(true)}
            title="Manage available tools for the model"
          >
            ⚙️ Configure
          </button>
          <button 
            className="tab-btn model-manager-btn"
            onClick={() => setIsModelManagerOpen(true)}
            title="Manage external models (OpenAI, Anthropic, GitHub Copilot)"
          >
            🌐 Models
          </button>
          <button 
            className="tab-btn"
            onClick={() => {
              loadAvailableTools();
              loadToolsStatus();
            }}
            title="Refresh tools and status"
          >
            🔄 Refresh
          </button>
          <button
            className="tab-btn"
            onClick={() => setIsLogViewerOpen(true)}
            title="Open backend log viewer"
          >
            📜 Logs
          </button>
          <button
            className="tab-btn"
            onClick={() => setIsMcpDirectoryOpen(true)}
            title="Buscar e instalar MCP servers"
          >
            🔍 MCP
          </button>
        </div>
        <div className="actions">
          <button onClick={() => setMessages([])} disabled={!messages.length || isLoading}>Clear</button>
        </div>
      </div>
      <div className="toolbar">
        <div className="model-select">
          <label htmlFor="modelSelect">Model:</label>
          <select id="modelSelect" value={model} onChange={e => setModel(e.target.value)} aria-label="Select model">
            {externalModels.length > 0 && <optgroup label="External">{externalModels.map(em => <option key={em.id} value={`ext:${em.id}`}>{`${em.name || em.model} (${em.provider})`}</option>)}</optgroup>}
            <optgroup label="Local (Ollama)">{models.map(m => <option key={m} value={m}>{m}</option>)}</optgroup>
          </select>
        </div>
        
        {/* Tool status indicator */}
        {toolsStatus && (
          <div className="tools-status" title={`${toolsStatus.enabled} tools enabled of ${toolsStatus.total} available (limit: ${toolsStatus.limit})`}>
            🛠️ {toolsStatus.enabled}/{toolsStatus.total}
            {toolsStatus.enabled > toolsStatus.limit && (
              <span className="warning-indicator" title="Exceeds model limit">⚠️</span>
            )}
          </div>
        )}
        
  <button onClick={pickImage} aria-label="Attach image" className="image-btn">📷 Image</button>
        {imagePath && (
          <span className="image-chip">
            {imagePath.startsWith('blob:') ? 'Uploaded image' : imagePath.split(/\\|\//).pop()} 
            <button onClick={() => setImagePath(undefined)} aria-label="Remove image">✕</button>
          </span>
        )}
        {/* Unified voice controls bar */}
        <div className="voice-controls">
          {isSpeechSupported && (
            <button
              type="button"
              onClick={toggleRecording}
              className={`mic-button ${isRecording ? 'recording' : ''} ${usingFallback ? 'fallback' : ''}`}
              title={isRecording ? (usingFallback ? 'Detener grabación local' : 'Detener voz') : (usingFallback ? 'Iniciar grabación local' : 'Iniciar voz')}
            >
              {isRecording ? '🛑' : '🎙️'}
              <span className="vc-label">
                {isRecording ? 'Grabando' : 'Voz'}
                {usingFallback && <span className="fallback-indicator">📱</span>}
              </span>
            </button>
          )}
          {!isSpeechSupported && (
            <div className="mic-unsupported" title="Speech recognition not supported">🚫🎙️</div>
          )}
          <div className="lang-wrapper">
            <button 
              type="button" 
              className="lang-btn" 
              onClick={e=>{
                const rect = (e.target as HTMLElement).getBoundingClientRect();
                const spaceBelow = window.innerHeight - rect.bottom;
                setLangMenuDirection(spaceBelow < 260 ? 'up' : 'down');
                setShowLangMenu(s=>!s);
              }} 
              title="Idioma reconocimiento" 
              onKeyDown={handleLangKey}
            >
              🌐 {recognitionLang || 'lang'}
            </button>
            {showLangMenu && (
              <div ref={langMenuRef} className={`lang-menu ${langMenuDirection==='up'?'up':'down'}`}>
                {availableLanguages.map(l => (
                  <div 
                    key={l} 
                    className={`lang-item ${l===recognitionLang?'active':''}`} 
                    onClick={()=>changeLanguage(l)}
                  >{l}</div>
                ))}
              </div>
            )}
          </div>
          <label className="autosend-toggle" title="Enviar automáticamente al detener">
            <input type="checkbox" checked={autoSendOnStop} onChange={e=>setAutoSendOnStop(e.target.checked)} /> Auto
          </label>
          <label className="autosend-toggle" title="Audio de alta calidad (WAV 16k)">
            <input type="checkbox" checked={hqAudio} onChange={e=>setHqAudio(e.target.checked)} /> HQ
          </label>
          {hqAudio && (
            <>
              <label className="autosend-toggle" title="Voice Activity Detection (auto stop silencio)">
                <input type="checkbox" checked={vadEnabled} onChange={e=>setVadEnabled(e.target.checked)} /> VAD
              </label>
              <select
                value={hqSampleRate}
                onChange={e=>setHqSampleRate(parseInt(e.target.value))}
                className="hq-sr-select"
                title="Sample rate de salida para Whisper"
              >
                <option value={16000}>16k</option>
                <option value={24000}>24k</option>
              </select>
            </>
          )}
          {isRecording && <div className="listening-indicator" title="Escuchando (reinicio automático activo)">🔴</div>}
        </div>
      </div>
      {activeTab === 'chat' && (
        <>
          <div className="layout">
            <div className="chat-wrapper">
              <div className="scroll-fade-top" />
              <div className="scroll-fade-bottom" />
              <div 
                ref={chatRef} 
                className="chat" 
                aria-live="polite"
                onContextMenu={e => { e.stopPropagation(); }}
              >
                {model.startsWith('ext:') && streamingContent && (
                  <div className={`msg assistant streaming ${streamSimulation.detected ? 'sim-flag' : ''}`}> 
                    <span className="msg-role">assistant</span>
                    <div className="msg-content">
                      <MessageContent content={streamingContent + (streamStage==='cycle-start' ? '\n\n⏱️ Executing tool(s)...' : '')} />
                      <div className="stream-meta">
                        <span>{streamStage} {streamCycle?`#${streamCycle}`:''}</span>
                        {streamSimulation.detected && <span className="sim-badge" title={streamSimulation.indicators.join(', ')}>⚠️ possible simulation</span>}
                      </div>
                    </div>
                  </div>
                )}
                {messages.map((m,i) => (
                  <div key={i} className={`msg ${m.role}`}>
                    <span className="msg-role">{m.role}</span>
                    <div className="msg-content">
                      <MessageContent content={m.content} />
                      {i === messages.length-1 && streamSimulation.detected && m.role==='assistant' && !streamingContent && (
                        <div className="sim-badge-inline" title={streamSimulation.indicators.join(', ')}>⚠️ simulation indicators</div>
                      )}
                    </div>
                    {m.imagePath && <div className="attachment">Attached image</div>}
                  </div>
                ))}
                {isLoading && <div className="msg assistant loading">Thinking...</div>}
              </div>
            </div>
            <aside className="side-panel" aria-label="Options">
              <div className="panel">
                <div className="info-line">System Prompt</div>
                <textarea className="system-textarea" value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} placeholder="Assistant instructions" />
              </div>
              <div className="panel flex1">
                <div className="info-line">Help</div>
                <p className="help-text">
                  Type your message and press Send. You can attach an image for vision models. The first message will include the system prompt if defined.
                </p>
              </div>
            </aside>
          </div>
          <div className="footer">
            <label htmlFor="chatInput" className="visually-hidden">Message</label>
            <div 
              className={`input-container ${isDragOver ? 'drag-over' : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              {isDragOver && (
                <div className="drag-overlay">
                  <div className="drag-overlay-content">
                    <span className="drag-icon">📁</span>
                    <span>Drop image here</span>
                  </div>
                </div>
              )}
              <textarea 
                id="chatInput" 
                ref={inputRef}
                value={input} 
                onChange={e => {
                  const newValue = e.target.value;
                  setInput(newValue);
                  setHistoryIndex(-1);
                  const suggestions = getToolSuggestions();
                  const shouldShow = suggestions.length > 0 && newValue.trim().length > 0;
                  setShowSuggestions(shouldShow);
                }}
                placeholder="Type your message (↑/↓ for history, 'use/run/execute <tool>' for suggestions). Right-click for copy/paste. Drag & drop images here." 
                onKeyDown={e => { 
                  handleKeyDown(e);
                  if (e.key === 'Enter' && !e.shiftKey && !showSuggestions) { e.preventDefault(); send(); }
                }}
                onPaste={handlePaste}
                onContextMenu={e => { e.stopPropagation(); }}
                className="chat-input-textarea"
              />
              {isRecording && interimTranscript && (
                <div className="stt-interim-overlay" aria-live="polite">{interimTranscript}</div>
              )}
              {!isSpeechSupported && (
                <div className="fallback-config">
                  <select 
                    value={whisperEndpoint} 
                    onChange={e=>setWhisperEndpoint(e.target.value)}
                    className="fallback-endpoint-select"
                    title="Seleccionar servidor Whisper"
                  >
                    <option value="http://localhost:9000/v1/audio/transcriptions">Faster-Whisper Server (puerto 9000)</option>
                    <option value="http://localhost:8000/v1/audio/transcriptions">OpenAI-compatible (puerto 8000)</option>
                    <option value="http://localhost:5005/transcribe">Whisper Server (puerto 5005)</option>
                    <option value="custom">Personalizado...</option>
                  </select>
                  {whisperEndpoint === 'custom' && (
                    <input
                      type="text"
                      value={whisperEndpoint}
                      onChange={e=>setWhisperEndpoint(e.target.value)}
                      placeholder="http://localhost:9000/v1/audio/transcriptions"
                      className="fallback-endpoint-input"
                    />
                  )}
                </div>
              )}
              {fallbackError && <div className="fallback-error" title={fallbackError}>⚠️ {fallbackError}</div>}
              {micError && <div className="fallback-error" title={micError}>⚠️ {micError}</div>}
              {showSuggestions && (
                <div className="suggestions-dropdown">
                  {getToolSuggestions().map(tool => (
                    <div 
                      key={tool.name}
                      className="suggestion-item"
                      onClick={() => insertToolSuggestion(tool)}
                    >
                      <div className="suggestion-name">🛠️ {tool.name}</div>
                      <div className="suggestion-description">{tool.description}</div>
                      {tool.inputSchema?.properties && (
                        <div className="suggestion-params">Params: {Object.keys(tool.inputSchema.properties).join(', ')}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button className="primary send-button" onClick={send} disabled={isLoading || !input.trim()}>{isLoading ? 'Generating…' : 'Send'}</button>
          </div>
        </>
      )}
      {activeTab === 'tools' && (
        <div className="tools-container">
          <McpTools onToolCall={handleToolCall} />
        </div>
      )}

      <ToolManager 
        isOpen={isToolManagerOpen}
        onClose={() => {
          setIsToolManagerOpen(false);
          loadToolsStatus();
          loadAvailableTools();
        }}
        currentModel={model}
      />
      <ModelManager 
        isOpen={isModelManagerOpen}
        onClose={() => {
          setIsModelManagerOpen(false);
          loadAvailableTools();
        }}
      />
      <LogViewer isOpen={isLogViewerOpen} onClose={() => setIsLogViewerOpen(false)} />
      <McpDirectoryPopup
        isOpen={isMcpDirectoryOpen}
        onClose={() => setIsMcpDirectoryOpen(false)}
        onInstall={async (pkg: string) => { await (window as any).mcp.installPackages([pkg]); }}
        quickAddServer={async (entry: any, opts?: { start?: boolean }) => {
          const command = entry.command || 'npx';
          const args = entry.args ? entry.args : [entry.package];
          const servers = await (window as any).mcp.getServers();
          const desiredId = (entry.id || entry.package || entry.name).replace(/[^a-zA-Z0-9_-]/g,'-');
            const existing = servers.find((s: any) => s.id === desiredId || s.name === entry.name);
            if (!existing) {
              await (window as any).mcp.addServer({
                id: desiredId,
                name: entry.name,
                type: 'stdio',
                command,
                args,
                enabled: true
              });
            }
            if (opts?.start) {
              try { await (window as any).mcp.startServer(desiredId); } catch (e) { console.error('Failed to start server', desiredId, e); }
            }
            setTimeout(() => { loadAvailableTools(); }, 600);
        }}
      />
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<App />);
