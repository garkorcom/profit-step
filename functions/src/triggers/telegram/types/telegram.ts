/**
 * Shared Telegram types for worker bot handlers.
 * Extracted from onWorkerBotMessage.ts for reuse across handler modules.
 */

export interface TelegramUpdate {
    update_id: number;
    message?: {
        message_id: number;
        from: {
            id: number;
            first_name: string;
            username?: string;
        };
        chat: {
            id: number;
        };
        text?: string;
        caption?: string;  // Photo/video caption
        media_group_id?: string;  // Album grouping
        forward_from?: {  // Forwarded message info
            id: number;
            first_name: string;
        };
        photo?: {
            file_id: string;
            file_unique_id: string;
            width: number;
            height: number;
        }[];
        document?: {
            file_id: string;
            file_name?: string;
            mime_type?: string;
        };
        video?: {
            file_id: string;
            mime_type?: string;
        };
        voice?: {
            file_id: string;
            duration: number;
            mime_type?: string;
            file_size?: number;
        };
        location?: {
            latitude: number;
            longitude: number;
        };
    };
    callback_query?: {
        id: string;
        from: {
            id: number;
            first_name: string;
        };
        message: {
            chat: {
                id: number;
            };
            message_id: number;
        };
        data: string;
    };
}
