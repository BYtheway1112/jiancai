import { validateImageUrl } from './image-download';

/** Signed Douyin download_url_list contains dy-water-v10. Never fall back to it. */
export function douyinImageSource(image: any): string | undefined {
    const candidates: string[] = (Array.isArray(image?.url_list) ? image.url_list : [])
        .filter((value: unknown): value is string => typeof value === 'string' && !/water(?:mark)?|imagewater/i.test(value.split('?')[0]));
    // Keep the signed path/query intact. Prefer full size over a bounded preview.
    const score = (value: string) => {
        const match = value.match(/images[^:]*:(\d+):(\d+):q(\d+)/);
        return match ? (Number(match[1]) * Number(match[2]) || 1e12) + Number(match[3]) : 0;
    };
    return candidates.sort((a, b) => score(b) - score(a)).map(value => value.replace(/^http:/, 'https:'))[0];
}

/** XHS web URLs prepend expiry/signature path segments and append preview transforms.
 * Reference: JoeanAmier/XHS-Downloader source/application/image.py (fixed format).
 */
export function xhsImageSource(image: any): string | undefined {
    const source = image?.url_default || image?.info_list?.find((x: any) => x.image_scene === 'WB_DFT')?.url
        || image?.url || image?.url_list?.[0] || image?.url_pre || image?.info_list?.[0]?.url;
    if (typeof source !== 'string') return;
    const value = source.replace(/^http:/, 'https:');
    const url = new URL(validateImageUrl(value, 'xhs'));
    if (url.hostname === 'ci.xiaohongshu.com') return value;
    const parts = url.pathname.slice(1).split('/');
    // Only rewrite the observed signed web image shape; keep other CDN URLs intact.
    if (parts.length < 3) return value;
    const token = parts.slice(2).join('/').split('!')[0];
    if (!token) return value;
    return `https://ci.xiaohongshu.com/${token}?imageView2/format/png`;
}

export function assertCleanImageSource(value: string, platform: 'xhs' | 'dy'): string {
    const source = validateImageUrl(value, platform);
    if (platform === 'dy' && /water(?:mark)?|imagewater/i.test(new URL(source).pathname)) {
        throw new Error('此记录使用旧版带水印图片链接，请回到原作品页重新采集后下载');
    }
    return source;
}
