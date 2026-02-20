import { Timestamp } from 'firebase/firestore';

export interface ContactPhone {
    number: string;
    label: string; // e.g., 'Рабочий', 'Личный', 'Мобильный'
}

export interface Contact {
    id?: string;
    name: string;
    roles: string[]; // e.g., ['Инспектор', 'Поставщик', 'Электрик']
    phones: ContactPhone[];
    emails: string[];
    messengers: {
        whatsapp?: string;
        telegram?: string;
    };
    defaultCity?: string;
    linkedProjects: string[]; // Array of client/project IDs
    notes?: string;

    // System History
    createdAt: Timestamp;
    createdBy: string; // User ID
    createdLocation?: { lat: number; lng: number } | string; // Coordinates or Project ID
}
