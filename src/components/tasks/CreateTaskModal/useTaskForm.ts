/**
 * @fileoverview Custom hook для state management формы создания задачи
 */

import { useState, useCallback, useMemo } from 'react';
import {
    TaskFormState,
    TaskTemplate,
    PERSISTENT_FIELDS,
    getDefaultFormState,
    TASK_TEMPLATES,
} from './CreateTaskModal.types';

interface UseTaskFormReturn {
    formState: TaskFormState;
    setField: <K extends keyof TaskFormState>(field: K, value: TaskFormState[K]) => void;
    setError: (field: string, error: string | null) => void;
    validateForm: () => boolean;
    resetForm: (preservePersistent?: boolean) => void;
    applyTemplate: (template: TaskTemplate) => void;
    incrementPeople: () => void;
    decrementPeople: () => void;
    isValid: boolean;
    tasksCreatedInSession: number;
    incrementTasksCreated: () => void;
}

export const useTaskForm = (
    defaultClientId?: string,
    defaultDate?: Date
): UseTaskFormReturn => {
    const [formState, setFormState] = useState<TaskFormState>(() => ({
        ...getDefaultFormState(),
        clientId: defaultClientId || null,
        startDate: defaultDate || new Date(),
    }));

    const [tasksCreatedInSession, setTasksCreatedInSession] = useState(0);

    // Set single field
    const setField = useCallback(<K extends keyof TaskFormState>(
        field: K,
        value: TaskFormState[K]
    ) => {
        setFormState(prev => ({ ...prev, [field]: value }));
    }, []);

    // Set/clear error
    const setError = useCallback((field: string, error: string | null) => {
        setFormState(prev => {
            if (error) {
                return { ...prev, errors: { ...prev.errors, [field]: error } };
            } else {
                const { [field]: _, ...restErrors } = prev.errors;
                return { ...prev, errors: restErrors };
            }
        });
    }, []);

    // Validate form
    const validateForm = useCallback((): boolean => {
        const errors: Record<string, string> = {};

        // Required fields
        if (!formState.clientId) {
            errors.clientId = 'Выберите клиента';
        }
        if (!formState.description.trim()) {
            errors.description = 'Введите описание задачи';
        }
        if (!formState.startDate) {
            errors.startDate = 'Укажите дату начала';
        }

        // Date logic
        if (formState.endDate && formState.startDate && formState.endDate < formState.startDate) {
            errors.endDate = 'Дата окончания не может быть раньше даты начала';
        }

        // Numeric validation
        if (formState.cost < 0) {
            errors.cost = 'Стоимость не может быть отрицательной';
        }
        if (formState.peopleCount < 1) {
            errors.peopleCount = 'Минимум 1 человек';
        }

        setFormState(prev => ({ ...prev, errors }));
        return Object.keys(errors).length === 0;
    }, [formState]);

    // Reset form
    const resetForm = useCallback((preservePersistent = false) => {
        if (preservePersistent) {
            const persistentValues: Partial<TaskFormState> = {};
            for (const field of PERSISTENT_FIELDS) {
                (persistentValues as any)[field] = formState[field];
            }

            setFormState({
                ...getDefaultFormState(),
                ...persistentValues,
            });
        } else {
            setFormState(getDefaultFormState());
        }
    }, [formState]);

    // Apply template
    const applyTemplate = useCallback((template: TaskTemplate) => {
        setFormState(prev => ({
            ...prev,
            templateId: template.id,
            plannedHours: template.defaultHours,
            peopleCount: template.defaultPeople,
            cost: template.defaultCost || prev.cost,
            description: prev.description || template.name,
        }));
    }, []);

    // People stepper
    const incrementPeople = useCallback(() => {
        setFormState(prev => ({ ...prev, peopleCount: prev.peopleCount + 1 }));
    }, []);

    const decrementPeople = useCallback(() => {
        setFormState(prev => ({
            ...prev,
            peopleCount: Math.max(1, prev.peopleCount - 1)
        }));
    }, []);

    // Tasks counter
    const incrementTasksCreated = useCallback(() => {
        setTasksCreatedInSession(prev => prev + 1);
    }, []);

    // Computed: is form valid (for button disabled state)
    const isValid = useMemo(() => {
        return !!(
            formState.clientId &&
            formState.description.trim() &&
            formState.startDate &&
            (!formState.endDate || formState.endDate >= formState.startDate)
        );
    }, [formState]);

    return {
        formState,
        setField,
        setError,
        validateForm,
        resetForm,
        applyTemplate,
        incrementPeople,
        decrementPeople,
        isValid,
        tasksCreatedInSession,
        incrementTasksCreated,
    };
};
