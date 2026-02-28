import React, { useState, useRef, useEffect } from 'react';
import {
    Box,
    TextField,
    IconButton,
    InputAdornment,
    CircularProgress,
    Paper,
    Typography,
    Tooltip
} from '@mui/material';
import MicIcon from '@mui/icons-material/Mic';
import StopIcon from '@mui/icons-material/Stop';
import SendIcon from '@mui/icons-material/Send';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';

interface SmartCockpitInputProps {
    onCommandSubmit: (command: string) => Promise<void>;
    isLoading: boolean;
}

export const SmartCockpitInput: React.FC<SmartCockpitInputProps> = ({ onCommandSubmit, isLoading }) => {
    const [text, setText] = useState('');
    const [isRecording, setIsRecording] = useState(false);

    // Recording state
    const recognitionRef = useRef<any>(null);

    // Initialize Speech Recognition
    useEffect(() => {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (SpeechRecognition) {
            recognitionRef.current = new SpeechRecognition();
            recognitionRef.current.continuous = true; // Let it run until user stops
            recognitionRef.current.interimResults = true; // Show words as they speak
            recognitionRef.current.lang = 'ru-RU';

            recognitionRef.current.onresult = (event: any) => {
                let currentTranscript = '';
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    currentTranscript += event.results[i][0].transcript;
                }
                // Avoid duplicating the text if interim results fire rapidly. 
                // A simpler, safer approach is just rewriting the text field while recording
                setText(currentTranscript);
            };

            recognitionRef.current.onerror = (event: any) => {
                console.error("Speech recognition error", event.error);
                setIsRecording(false);
            };

            recognitionRef.current.onend = () => {
                // If they paused talking but didn't stop, it might disconnect. 
                // We'll manage state manually via Stop button.
                setIsRecording(false);
            };
        }
    }, []);

    const toggleRecording = () => {
        if (!recognitionRef.current) {
            alert('Voice input is not supported in your browser.');
            return;
        }

        if (isRecording) {
            recognitionRef.current.stop();
            setIsRecording(false);
            // Optionally auto-submit when they stop recording?
            // Let's leave it manual for now so they can edit the text.
        } else {
            setText(''); // clear previous before speaking
            recognitionRef.current.start();
            setIsRecording(true);
        }
    };

    const handleSend = async () => {
        if (!text.trim() || isLoading) return;

        // Stop recording if active
        if (isRecording && recognitionRef.current) {
            recognitionRef.current.stop();
            setIsRecording(false);
        }

        const cmd = text.trim();
        setText(''); // Clear immediately for UX

        try {
            await onCommandSubmit(cmd);
        } catch (err) {
            // Restore text if failed
            setText(cmd);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <Paper
            variant="outlined"
            sx={{
                p: 1.5,
                mb: 3,
                borderRadius: 2,
                bgcolor: 'rgba(232, 245, 233, 0.3)', // Subtle green/AI tint
                borderColor: 'success.light',
                display: 'flex',
                flexDirection: 'column',
                gap: 1
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 0.5 }}>
                <AutoAwesomeIcon fontSize="small" color="success" />
                <Typography variant="subtitle2" color="success.main" fontWeight={600}>
                    AI-Ассистент
                </Typography>
                <Typography variant="caption" color="text.secondary">
                    Скажите, что нужно изменить в задаче (например: "добавь в чеклист проверку щитка")
                </Typography>
            </Box>

            <TextField
                fullWidth
                multiline
                maxRows={4}
                placeholder="Или напишите команду здесь..."
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading}
                InputProps={{
                    sx: { borderRadius: 2, bgcolor: 'background.paper' },
                    endAdornment: (
                        <InputAdornment position="end">
                            {isLoading ? (
                                <CircularProgress size={24} sx={{ mr: 1 }} color="success" />
                            ) : (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <Tooltip title={isRecording ? "Остановить запись" : "Голосовой ввод"}>
                                        <IconButton
                                            color={isRecording ? "error" : "default"}
                                            onClick={toggleRecording}
                                            sx={{
                                                animation: isRecording ? 'pulse 1.5s infinite' : 'none',
                                                '@keyframes pulse': {
                                                    '0%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(220, 53, 69, 0.4)' },
                                                    '70%': { transform: 'scale(1.1)', boxShadow: '0 0 0 8px rgba(220, 53, 69, 0)' },
                                                    '100%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(220, 53, 69, 0)' }
                                                }
                                            }}
                                        >
                                            {isRecording ? <StopIcon /> : <MicIcon />}
                                        </IconButton>
                                    </Tooltip>

                                    <Tooltip title="Отправить AI">
                                        <IconButton
                                            color="success"
                                            onClick={handleSend}
                                            disabled={!text.trim() || isRecording}
                                        >
                                            <SendIcon />
                                        </IconButton>
                                    </Tooltip>
                                </Box>
                            )}
                        </InputAdornment>
                    )
                }}
            />
        </Paper>
    );
};
