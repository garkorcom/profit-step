/**
 * @fileoverview Shared voice input hook with auto-restart for long dictation.
 *
 * Features:
 * - Browser SpeechRecognition API with fallback check
 * - Interim results shown in real-time while speaking
 * - Auto-restart: when recognition ends naturally, it restarts
 *   automatically so the user can keep dictating without pressing
 *   the mic button again. Pressing stop explicitly ends the session.
 * - Haptic feedback on start/stop
 * - Immutable baseline approach: captures text before each segment
 *   to prevent word duplication
 */

import { useCallback, useRef, useState } from 'react';

interface UseVoiceInputOptions {
    /** Current text value to append voice results to */
    currentText: string;
    /** Callback to update the text value */
    onTextChange: (text: string) => void;
    /** Language for speech recognition (default: 'ru-RU') */
    lang?: string;
}

interface UseVoiceInputReturn {
    /** Whether the browser supports SpeechRecognition */
    voiceSupported: boolean;
    /** Whether currently listening */
    isListening: boolean;
    /** Toggle voice input on/off */
    toggleVoiceInput: () => void;
    /** Force stop voice input */
    stopVoiceInput: () => void;
}

export const useVoiceInput = ({
    currentText,
    onTextChange,
    lang = 'ru-RU',
}: UseVoiceInputOptions): UseVoiceInputReturn => {
    const [isListening, setIsListening] = useState(false);
    const [voiceSupported] = useState(() =>
        typeof window !== 'undefined' &&
        ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
    );

    const recognitionRef = useRef<any>(null);
    // Track whether user explicitly pressed stop vs natural end
    const userStoppedRef = useRef(false);
    // Accumulated text across auto-restarts within one session
    const sessionTextRef = useRef('');
    // Baseline text captured at session start (text before mic was pressed)
    const baselineRef = useRef('');

    const startRecognition = useCallback(() => {
        if (!voiceSupported) return;

        const SpeechRecognitionAPI =
            (window as any).SpeechRecognition ||
            (window as any).webkitSpeechRecognition;
        const recognition = new SpeechRecognitionAPI();
        recognition.lang = lang;
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        recognition.onresult = (event: any) => {
            let finalText = '';
            let interimText = '';

            for (let i = 0; i < event.results.length; i++) {
                if (event.results[i].isFinal) {
                    finalText += event.results[i][0].transcript;
                } else {
                    interimText += event.results[i][0].transcript;
                }
            }

            if (finalText) {
                // Append final text to session accumulator
                sessionTextRef.current += (sessionTextRef.current ? ' ' : '') + finalText.trim();
            }

            // Display: baseline + accumulated finals + current interim
            const display = interimText
                ? sessionTextRef.current + (sessionTextRef.current ? ' ' : '') + interimText.trim()
                : sessionTextRef.current;

            const fullText = baselineRef.current
                ? baselineRef.current + ' ' + display
                : display;

            onTextChange(fullText);
        };

        recognition.onerror = (event: any) => {
            console.warn('Speech recognition error:', event.error);
            // On "no-speech" or "aborted", try to auto-restart if user didn't stop
            if (event.error === 'no-speech' && !userStoppedRef.current) {
                // Silently restart — user is just pausing
                return;
            }
            setIsListening(false);
            if (event.error === 'not-allowed') {
                alert('Разрешите доступ к микрофону в настройках браузера');
            }
        };

        recognition.onend = () => {
            if (!userStoppedRef.current) {
                // Auto-restart: user is still dictating, just a natural pause
                try {
                    recognition.start();
                    return;
                } catch (e) {
                    console.warn('Auto-restart failed:', e);
                }
            }
            // User explicitly stopped or restart failed
            setIsListening(false);
            recognitionRef.current = null;
        };

        recognitionRef.current = recognition;
        recognition.start();
    }, [voiceSupported, lang, onTextChange]);

    const toggleVoiceInput = useCallback(() => {
        if (!voiceSupported) return;

        if (isListening) {
            // User explicitly stops
            userStoppedRef.current = true;
            recognitionRef.current?.stop();
            setIsListening(false);
            if ('vibrate' in navigator) navigator.vibrate(30);
            return;
        }

        // Start new session
        userStoppedRef.current = false;
        baselineRef.current = currentText;
        sessionTextRef.current = '';

        startRecognition();
        setIsListening(true);

        // Haptic feedback
        if ('vibrate' in navigator) navigator.vibrate([50, 30, 50]);
    }, [voiceSupported, isListening, currentText, startRecognition]);

    const stopVoiceInput = useCallback(() => {
        userStoppedRef.current = true;
        recognitionRef.current?.stop();
        setIsListening(false);
    }, []);

    return {
        voiceSupported,
        isListening,
        toggleVoiceInput,
        stopVoiceInput,
    };
};
