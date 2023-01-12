// Common for the Subscription bot and notification server

export interface SubNotification {
    "pd-to-process": string,
    "action-to-process": string,
    "report-endpoint": string,
}

export const ENDPOINT_PATH = 'kar_notification'