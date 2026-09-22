import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    decodeImageDownloadBytes,
    encodeImageDownloadBytes,
    imageDownloadFolderName,
    imageDownloadOutputFilename,
    validateDyImageUrl,
    validateXhsImageUrl,
} from '../src/utils/image-download.ts';
import { detectImageExtension } from '../src/utils/image-format.ts';

function response(contentType?: string) {
    return { headers: { get: (name: string) => name.toLowerCase() === 'content-type' ? contentType || null : null } };
}

function ascii(value: string): Uint8Array {
    return Uint8Array.from(value, character => character.charCodeAt(0));
}

function blob(bytes: Uint8Array): Blob {
    return new Blob([Uint8Array.from(bytes).buffer as ArrayBuffer]);
}

test('image download folder names combine a safe title and post ID', () => {
    assert.equal(imageDownloadFolderName('abc/123', '中秋:鱼灯/攻略?'), '中秋鱼灯攻略-abc123');
    assert.equal(imageDownloadFolderName('abc', undefined), '无标题-abc');
});

test('image download accepts only HTTPS XHS CDN URLs', () => {
    assert.equal(validateXhsImageUrl('https://sns-img-bd.xhscdn.com/a.jpg?x=1'), 'https://sns-img-bd.xhscdn.com/a.jpg?x=1');
    for (const url of [
        'http://sns-img-bd.xhscdn.com/a.jpg',
        'https://xhscdn.com.evil.test/a.jpg',
        'https://user:pass@sns-img-bd.xhscdn.com/a.jpg',
    ]) assert.throws(() => validateXhsImageUrl(url), /XHS CDN/);
});

test('image download accepts Douyin image CDNs and rejects page, audio, and video hosts', () => {
    assert.equal(validateDyImageUrl('https://p3.douyinpic.com/img/a.jpg?x=1'), 'https://p3.douyinpic.com/img/a.jpg?x=1');
    assert.equal(validateDyImageUrl('https://p9.byteimg.com/tos-cn-i-abc/a.webp'), 'https://p9.byteimg.com/tos-cn-i-abc/a.webp');
    for (const url of [
        'https://www.douyin.com/note/123',
        'https://p3.douyinvod.com/video.mp4',
        'https://p3.douyinstatic.com/music.mp3',
        'https://douyinpic.com.evil.test/a.jpg',
    ]) assert.throws(() => validateDyImageUrl(url), /Douyin image CDN/);
});

test('image formats use file signatures before response MIME', async () => {
    assert.equal(await detectImageExtension(response('image/webp'), blob(Uint8Array.from([0xff, 0xd8, 0xff, 0x00]))), 'jpg');
    assert.equal(await detectImageExtension(response('application/octet-stream'), blob(Uint8Array.from([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')]))), 'webp');
    const heic = new Uint8Array(20);
    heic.set(ascii('ftyp'), 4);
    heic.set(ascii('heic'), 8);
    assert.equal(await detectImageExtension(response(), blob(heic)), 'heic');
    const avif = new Uint8Array(20);
    avif.set(ascii('ftyp'), 4);
    avif.set(ascii('avif'), 8);
    avif.set(ascii('mif1'), 16);
    assert.equal(await detectImageExtension(response(), blob(avif)), 'avif');
});

test('unknown image formats fail closed and output names keep order', async () => {
    await assert.rejects(detectImageExtension(response('application/octet-stream'), blob(Uint8Array.from([1, 2, 3]))), /无法识别图片格式/);
    await assert.rejects(detectImageExtension(response('image/jpeg'), blob(ascii('<html>error</html>'))), /无法识别图片格式/);
    assert.equal(imageDownloadOutputFilename(0, 'JPG'), '图片001.jpg');
    assert.throws(() => imageDownloadOutputFilename(1, 'webp'), /JPG 或 PNG/);
    assert.equal(imageDownloadOutputFilename(1, 'PNG'), '图片002.png');
});

test('single-image tasks retain the original post index for the output name', () => {
    const selected = {url: 'https://sns-img-bd.xhscdn.com/seventh.jpg', filename: 'post-图片-7.jpg', sourceIndex: 6};
    assert.equal(imageDownloadOutputFilename(selected.sourceIndex ?? 0, 'jpg'), '图片007.jpg');
});

test('large binary image payloads round-trip through base64 without changing 0 or 255 bytes', () => {
    const original = Uint8Array.from({ length: 0x60011 }, (_, index) => index % 2 ? 255 : 0);
    assert.deepEqual(decodeImageDownloadBytes(encodeImageDownloadBytes(original)), original);
});
