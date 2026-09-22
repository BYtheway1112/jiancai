import { defineExtensionMessaging } from '@webext-core/messaging';
import type { ImageDownloadRequest } from './image-download';

export interface ProtocolMap {
    compact(data: {action: string; data?: any}): any;
    fetch(data: RequestInit & { url: string }): any;
    webmsxyw(data: { path: string, body: any }): { 'X-s': string; 'X-t': string; };
    mnsv2(args: any): string;
    openPopup(): void;
    openTaskDialog(data: { name: string } & Record<string, any>): void;
    download(options: TaskDownloadOption): number;
    openImageDownload(data: ImageDownloadRequest): { taskId: string };
    fetchImageDownload(data: { url: string; platform?: 'xhs' | 'dy' }): { base64: string; contentType: string; finalUrl: string };
}

export const { sendMessage, onMessage } = defineExtensionMessaging<ProtocolMap>();
