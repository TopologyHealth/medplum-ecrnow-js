// Common for the Subscription bot and notification server

export interface SubNotification {
    pdToProcess: string,
    actionToProcess: string,
}

export const ENDPOINT_PATH = 'kar_notification'