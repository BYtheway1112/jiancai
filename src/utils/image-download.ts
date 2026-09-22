export interface ImageDownloadFile {
    url: string;
    filename: string;
    /** Position in the original post, retained when a single image is selected. */
    sourceIndex?: number;
}

export interface ImageDownloadRequest {
    platform?: 'xhs' | 'dy';
    folderName: string;
    files: ImageDownloadFile[];
}

export interface ImageDownloadTask extends ImageDownloadRequest {
    createdAt: number;
}

export const IMAGE_DOWNLOAD_TASK_PREFIX = 'image-download:';

export function imageDownloadTaskKey(taskId: string): string {
    return IMAGE_DOWNLOAD_TASK_PREFIX + taskId;
}

function safeSegment(value: string, fallback: string): string {
    const cleaned = value
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
        .trim()
        .replace(/[. ]+$/g, '')
        .slice(0, 80);
    return cleaned || fallback;
}

export function imageDownloadFolderName(id: string, title?: unknown): string {
    const rawTitle = typeof title === 'string' ? title : '';
    const safeId = safeSegment(id, '作品');
    const safeTitle = safeSegment(rawTitle || '无标题', '无标题').slice(0, 52);
    return safeSegment(`${safeTitle}-${safeId}`, safeId || '图文作品');
}

export function safeImageDownloadFolderName(value: unknown, fallback = '图文作品'): string {
    return safeSegment(typeof value === 'string' ? value : '', fallback);
}

export function imageDownloadFilename(filename: string, index: number): string {
    const leaf = String(filename || '').split(/[\\/]/).pop() || '';
    return safeSegment(leaf, `图片-${index + 1}`);
}

export function imageDownloadOutputFilename(index: number, extension: string): string {
    const ext = extension.toLowerCase();
    if (!['jpg', 'png'].includes(ext)) throw new Error('只允许保存 JPG 或 PNG 图片');
    return `图片${String(index + 1).padStart(3, '0')}.${ext}`;
}

export function encodeImageDownloadBytes(bytes: Uint8Array): string {
    const chunkSize = 0x30000;
    let encoded = '';
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const end = Math.min(offset + chunkSize, bytes.length);
        let binary = '';
        for (let index = offset; index < end; index += 1) binary += String.fromCharCode(bytes[index]);
        encoded += btoa(binary);
    }
    return encoded;
}

export function decodeImageDownloadBytes(encoded: string): Uint8Array {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

const imageCdnSuffixes: Record<'xhs' | 'dy', string[]> = {
    xhs: ['xhscdn.com'],
    // Douyin image responses use these signed CDN hosts. Keep page hosts out
    // of this list so the directory image flow fails closed.
    dy: ['douyinpic.com', 'byteimg.com', 'ibytedtos.com', 'pstatp.com', 'snssdk.com', 'bytecdn.cn'],
};

export function validateImageUrl(value: string, platform: 'xhs' | 'dy' = 'xhs'): string {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password ||
        (!(platform === 'xhs' && url.hostname === 'ci.xiaohongshu.com') && !imageCdnSuffixes[platform].some(suffix => url.hostname === suffix || url.hostname.endsWith(`.${suffix}`)))) {
        throw new Error(`图文素材地址不在支持的 ${platform === 'xhs' ? 'XHS CDN' : 'Douyin image CDN'} 范围内`);
    }
    return url.href;
}

export function validateXhsImageUrl(value: string): string {
    return validateImageUrl(value, 'xhs');
}

export function validateDyImageUrl(value: string): string {
    return validateImageUrl(value, 'dy');
}
