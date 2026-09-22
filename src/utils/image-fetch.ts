import { assertCleanImageSource } from './image-source';
import { prepareImage } from './image-format';

export async function fetchPreparedImage(value: string, platform: 'xhs' | 'dy') {
    const source = assertCleanImageSource(value, platform);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    try {
        const response = await fetch(source, { credentials: 'omit', cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(`素材请求失败（HTTP ${response.status}），未保存`);
        const finalUrl = assertCleanImageSource(response.url || source, platform);
        const blob = await response.blob();
        if (!blob.size) throw new Error('返回空文件');
        return { ...await prepareImage(blob), finalUrl };
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw new Error('素材请求超时');
        throw error;
    } finally { clearTimeout(timer); }
}
