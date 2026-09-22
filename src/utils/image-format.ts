function ascii(bytes: Uint8Array, start: number, length: number): string {
    return String.fromCharCode(...bytes.slice(start, start + length));
}

export async function detectImageExtension(
    response: { headers: { get(name: string): string | null } },
    blob: Blob,
): Promise<string> {
    const bytes = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
    const mime = (response.headers.get('content-type') || blob.type || '').split(';', 1)[0].trim().toLowerCase();
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
    if (bytes.length >= 8 && bytes.slice(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index])) return 'png';
    if (ascii(bytes, 0, 6) === 'GIF89a' || ascii(bytes, 0, 6) === 'GIF87a') return 'gif';
    if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp';
    if (ascii(bytes, 4, 4) === 'ftyp') {
        const brands = [ascii(bytes, 8, 4)];
        for (let offset = 16; offset + 4 <= bytes.length; offset += 4) brands.push(ascii(bytes, offset, 4));
        if (brands.some(brand => ['avif', 'avis'].includes(brand))) return 'avif';
        if (brands.some(brand => ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand))) return 'heic';
    }
    throw new Error(`无法识别图片格式（${mime || '未知类型'}），未保存`);
}

/** Keep original JPEG/PNG bytes. Decode every other supported image to lossless PNG.
 * OffscreenCanvas works in both MV3 service workers and content/extension pages.
 */
export async function prepareImage(blob: Blob): Promise<{ blob: Blob; extension: 'jpg' | 'png'; width: number; height: number }> {
    const extension = await detectImageExtension({ headers: { get: () => blob.type } }, blob);
    let bitmap: ImageBitmap;
    try { bitmap = await createImageBitmap(blob); }
    catch { throw new Error('图片无法完整解码，未保存；请重新获取素材'); }
    try {
        const { width, height } = bitmap;
        if (!width || !height) throw new Error('图片尺寸无效，未保存');
        if (extension === 'jpg' || extension === 'png') return { blob, extension, width, height };
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('当前浏览器无法转换图片，未保存');
        context.drawImage(bitmap, 0, 0);
        const converted = await canvas.convertToBlob({ type: 'image/png' });
        if (await detectImageExtension({ headers: { get: () => converted.type } }, converted) !== 'png') {
            throw new Error('PNG 转换失败，未保存');
        }
        return { blob: converted, extension: 'png', width, height };
    } finally { bitmap.close(); }
}
