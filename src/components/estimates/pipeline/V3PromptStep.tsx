import React from 'react';
import { Box, Typography, Button, TextField, FormControl, InputLabel, Select, MenuItem, Alert } from '@mui/material';

export interface PromptConfig {
    templateId: string;
    customInstructions: string;
}

const PROMPT_TEMPLATES = [
    {
        id: 'standard_residential',
        name: 'Standard Residential',
        description: 'Counts all standard residential electrical devices, panels, and lighting.',
        basePrompt: 'Find all electrical receptacles, switches, lights, panels, and appliances.'
    },
    {
        id: 'strict_power_only',
        name: 'Strict Power Only (No LV)',
        description: 'Ignores all low-voltage, data, coax, and fire alarm devices. Only counts high voltage.',
        basePrompt: 'Find only 120V/240V devices. STRICTLY IGNORE all data, coax, TV, telephone, and smoke detectors.'
    },
    {
        id: 'lighting_only',
        name: 'Lighting & Switching Only',
        description: 'Focuses entirely on lighting fixtures and their control switches.',
        basePrompt: 'Find only light fixtures (recessed, surface, pendants) and switches. Ignore receptacles and appliances.'
    }
];

interface V3PromptStepProps {
    config: PromptConfig;
    onChange: (config: PromptConfig) => void;
    onNext: () => void;
    onBack: () => void;
}

export const V3PromptStep: React.FC<V3PromptStepProps> = ({ config, onChange, onNext, onBack }) => {
    
    const selectedTemplate = PROMPT_TEMPLATES.find(t => t.id === config.templateId) || PROMPT_TEMPLATES[0];

    return (
        <Box p={2}>
            <Typography variant="h6" mb={2}>
                Step 3: AI Configuration & Prompt
            </Typography>

            <Typography variant="body2" color="text.secondary" mb={4}>
                Select a base template for the AI, and optionally add specific instructions (e.g., "Do not count circles with 'S' as smoke detectors").
            </Typography>

            <FormControl fullWidth sx={{ mb: 4 }}>
                <InputLabel>Prompt Template</InputLabel>
                <Select
                    value={config.templateId}
                    label="Prompt Template"
                    onChange={(e) => onChange({ ...config, templateId: e.target.value })}
                >
                    {PROMPT_TEMPLATES.map(t => (
                        <MenuItem key={t.id} value={t.id}>
                            <Box>
                                <Typography variant="body1">{t.name}</Typography>
                                <Typography variant="caption" color="text.secondary">{t.description}</Typography>
                            </Box>
                        </MenuItem>
                    ))}
                </Select>
            </FormControl>

            <Alert severity="info" sx={{ mb: 4 }}>
                <strong>Base AI Instruction:</strong> {selectedTemplate.basePrompt}
            </Alert>

            <TextField
                fullWidth
                multiline
                rows={4}
                label="Custom Instructions (Overrides / Additions)"
                placeholder="e.g., 'Assume all bedrooms have 4 recessed cans even if not drawn.'"
                value={config.customInstructions}
                onChange={(e) => onChange({ ...config, customInstructions: e.target.value })}
                helperText="These instructions are appended to the base prompt and given high weight by the AI."
            />

            <Box display="flex" justifyContent="space-between" mt={4}>
                <Button onClick={onBack} variant="outlined">Back</Button>
                <Button 
                    onClick={onNext} 
                    variant="contained" 
                    color="primary"
                >
                    Start AI Analysis
                </Button>
            </Box>
        </Box>
    );
};
