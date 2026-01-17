/**
 * @fileoverview Компоненты для отображения защищённых полей
 * 
 * SecureField — обёртка для полей ввода с проверкой прав
 * SecureValue — обёртка для отображения значений (замаскированных при необходимости)
 */

import React from 'react';
import { TextField, TextFieldProps, Typography, Tooltip, Box } from '@mui/material';
import { VisibilityOff as HiddenIcon } from '@mui/icons-material';
import useFieldAccess from '../../hooks/useFieldAccess';
import { SensitiveField } from '../../types/rbac.types';

// ================================
// SecureValue — для отображения значения
// ================================

interface SecureValueProps {
    /** Тип чувствительного поля */
    field: SensitiveField;

    /** Значение для отображения */
    value: string | number | null | undefined;

    /** Формат отображения (по умолчанию текст) */
    format?: 'text' | 'currency' | 'percent';

    /** Суффикс (например, ₽, $, %) */
    suffix?: string;

    /** Prefix (например, $) */
    prefix?: string;

    /** Дополнительные стили */
    sx?: object;

    /** Компонент типографики */
    variant?: 'body1' | 'body2' | 'h6' | 'caption';
}

/**
 * Компонент для безопасного отображения значений
 * Показывает *** если пользователь не имеет доступа
 */
export const SecureValue: React.FC<SecureValueProps> = ({
    field,
    value,
    format = 'text',
    suffix = '',
    prefix = '',
    sx = {},
    variant = 'body1',
}) => {
    const { checkFieldAccess } = useFieldAccess();
    const access = checkFieldAccess(field);

    // Если поле скрыто — показываем маску
    if (access.hidden) {
        return (
            <Tooltip title="Недостаточно прав для просмотра">
                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: 'text.disabled', ...sx }}>
                    <HiddenIcon fontSize="small" />
                    <Typography variant={variant} component="span" color="text.disabled">
                        ***
                    </Typography>
                </Box>
            </Tooltip>
        );
    }

    // Форматируем значение
    let displayValue = value;
    if (value !== null && value !== undefined) {
        if (format === 'currency' && typeof value === 'number') {
            displayValue = value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        } else if (format === 'percent' && typeof value === 'number') {
            displayValue = `${(value * 100).toFixed(1)}`;
        }
    }

    return (
        <Typography variant={variant} component="span" sx={sx}>
            {prefix}{displayValue}{suffix}
        </Typography>
    );
};

// ================================
// SecureField — для полей ввода
// ================================

interface SecureFieldProps extends Omit<TextFieldProps, 'onChange'> {
    /** Тип чувствительного поля */
    field: SensitiveField;

    /** Callback при изменении значения */
    onChange?: (value: string) => void;

    /** Показывать placeholder при отсутствии доступа */
    hiddenPlaceholder?: string;
}

/**
 * Защищённое поле ввода
 * Скрывает или делает readonly при отсутствии прав
 */
export const SecureField: React.FC<SecureFieldProps> = ({
    field,
    onChange,
    hiddenPlaceholder = '******',
    disabled,
    ...props
}) => {
    const { checkFieldAccess } = useFieldAccess();
    const access = checkFieldAccess(field);

    // Если поле скрыто — показываем заглушку
    if (access.hidden) {
        return (
            <TextField
                {...props}
                value={hiddenPlaceholder}
                disabled
                InputProps={{
                    ...props.InputProps,
                    readOnly: true,
                    startAdornment: <HiddenIcon sx={{ mr: 1, color: 'text.disabled' }} />,
                }}
                helperText="Недостаточно прав для просмотра"
            />
        );
    }

    // Если только чтение
    const isReadOnly = access.readOnly || disabled;

    return (
        <TextField
            {...props}
            disabled={isReadOnly}
            onChange={(e) => {
                if (!isReadOnly && onChange) {
                    onChange(e.target.value);
                }
            }}
            InputProps={{
                ...props.InputProps,
                readOnly: access.readOnly,
            }}
            helperText={access.readOnly ? 'Только просмотр' : props.helperText}
        />
    );
};

// ================================
// SecureCurrency — shorthand для денежных значений
// ================================

interface SecureCurrencyProps {
    field: SensitiveField;
    value: number | null | undefined;
    currency?: '$' | '₽' | '€';
    variant?: 'body1' | 'body2' | 'h6' | 'caption';
    sx?: object;
}

export const SecureCurrency: React.FC<SecureCurrencyProps> = ({
    field,
    value,
    currency = '$',
    variant = 'body1',
    sx,
}) => {
    return (
        <SecureValue
            field={field}
            value={value}
            format="currency"
            prefix={currency}
            variant={variant}
            sx={sx}
        />
    );
};

// ================================
// SecurePercent — shorthand для процентов
// ================================

interface SecurePercentProps {
    field: SensitiveField;
    value: number | null | undefined;
    variant?: 'body1' | 'body2' | 'h6' | 'caption';
    sx?: object;
}

export const SecurePercent: React.FC<SecurePercentProps> = ({
    field,
    value,
    variant = 'body1',
    sx,
}) => {
    return (
        <SecureValue
            field={field}
            value={value}
            format="percent"
            suffix="%"
            variant={variant}
            sx={sx}
        />
    );
};

export default SecureField;
