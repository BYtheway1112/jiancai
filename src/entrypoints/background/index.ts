import { fetchPreparedImage } from '@/utils/image-fetch';
import { registerCollector } from '@/collector/background';
import {
    imageDownloadFilename,
    imageDownloadTaskKey,
    encodeImageDownloadBytes,
    safeImageDownloadFolderName,
    validateImageUrl,
} from '@/utils/image-download';
/**
 * Copyright (c) Andy Zhou. (https://github.com/iszhouhua)
 *
 * This source code is licensed under the GPL-3.0 license found in the
 * LICENSE file in the root directory of this source tree.
 */

export default defineBackground(() => {
    registerCollector();
    onMessage('openPopup', () => {
        return browser.action.openPopup();
    });

    onMessage('openTaskDialog', ({ data, sender }) => {
        return sendMessage('openTaskDialog', data, sender.tab?.id);
    });

    onMessage('fetch', ({ data, sender }) => {
        return browser.scripting.executeScript({
            target: {
                tabId: sender.tab?.id!
            },
            world: "MAIN",
            // @ts-ignore
            func: (data) => window.fetch(data.url, data).then(res => res.json()).catch(() => null),
            args: [data]

        }).then(res => res?.[0]?.result);
    });

    // Some search results are served with a page-scoped signed request that the
    // extension API cannot reproduce. The player already has the complete item
    // in its React props, so use that data as a local fallback for downloads.
    onMessage('extractDyAweme', ({ data, sender }) => {
        return browser.scripting.executeScript({
            target: { tabId: sender.tab?.id! },
            world: 'MAIN',
            func: (awemeId) => {
                const wanted = String(awemeId);
                const active = document.querySelector(`[data-e2e-vid="${CSS.escape(wanted)}"]`);
                if (!active) return null;
                const fiberKey = Object.keys(active).find((key) => key.startsWith('__reactFiber$'));
                let fiber = fiberKey ? (active as any)[fiberKey] : undefined;
                for (let depth = 0; fiber && depth < 24; depth += 1, fiber = fiber.return) {
                    const item = fiber.memoizedProps?.item;
                    if (item && String(item.awemeId ?? item.aweme_id) === wanted) {
                        // Return only the fields used by the downloader. This
                        // keeps React internals and page state out of the
                        // extension message and avoids cloning framework data.
                        return {
                            awemeId: item.awemeId,
                            desc: item.desc,
                            itemTitle: item.itemTitle,
                            caption: item.caption,
                            createTime: item.createTime,
                            mediaType: item.mediaType,
                            shareInfo: item.shareInfo && { shareUrl: item.shareInfo.shareUrl },
                            video: item.video && {
                                uri: item.video.uri,
                                duration: item.video.duration,
                                width: item.video.width,
                                height: item.video.height,
                                playAddr: item.video.playAddr,
                                playAddrSize: item.video.playAddrSize,
                                playApi: item.video.playApi,
                                coverUri: item.video.coverUri,
                                coverUrlList: item.video.coverUrlList,
                                originCover: item.video.originCover,
                            },
                            images: Array.isArray(item.images) ? item.images.map((image: any) => ({
                                urlList: image.urlList,
                                downloadUrlList: image.downloadUrlList,
                                height: image.height,
                                width: image.width,
                                uri: image.uri,
                            })) : [],
                            music: item.music && {
                                playUrl: item.music.playUrl,
                                title: item.music.title,
                                id: item.music.id,
                            },
                            stats: item.stats && {
                                admireCount: item.stats.admireCount,
                                collectCount: item.stats.collectCount,
                                commentCount: item.stats.commentCount,
                                diggCount: item.stats.diggCount,
                                playCount: item.stats.playCount,
                                shareCount: item.stats.shareCount,
                            },
                            authorInfo: item.authorInfo && {
                                uid: item.authorInfo.uid,
                                uniqueId: item.authorInfo.uniqueId,
                                secUid: item.authorInfo.secUid,
                                shortId: item.authorInfo.shortId,
                                nickname: item.authorInfo.nickname,
                                signature: item.authorInfo.signature,
                                followerCount: item.authorInfo.followerCount,
                            },
                            mixInfo: item.mixInfo && {
                                mixId: item.mixInfo.mixId,
                                mixName: item.mixInfo.mixName,
                            },
                        };
                    }
                }
                return null;
            },
            args: [data.awemeId],
        }).then((results) => results?.[0]?.result ?? null);
    });

    onMessage('mnsv2', ({ data, sender }) => {
        return browser.scripting.executeScript({
            target: {
                tabId: sender.tab?.id!
            },
            world: "MAIN",
            func: (a,b,c) => {
                // @ts-ignore
                return window["mnsv2"](a,b,c);
            },
            args: data

        }).then(res => res?.[0]?.result as any);
    });

    onMessage('download', ({ data }) => {
        return browser.downloads.download(data);
    });

    onMessage('fetchImageDownload', async ({ data, sender }) => {
        const page = sender.url ? new URL(sender.url) : undefined;
        const pagePlatform = page?.hostname === 'www.xiaohongshu.com' || page?.hostname === 'xiaohongshu.com'
            ? 'xhs'
            : page?.hostname === 'www.douyin.com' || page?.hostname === 'douyin.com'
                ? 'dy'
                : undefined;
        if (!pagePlatform) {
            throw new Error('图文素材只能从小红书或抖音作品页读取');
        }
        const platform = data.platform || pagePlatform;
        if (platform !== pagePlatform) {
            throw new Error('图片来源平台与当前作品页不一致');
        }
        const prepared = await fetchPreparedImage(data.url, platform);
        return {
            base64: encodeImageDownloadBytes(new Uint8Array(await prepared.blob.arrayBuffer())),
            contentType: prepared.extension === 'jpg' ? 'image/jpeg' : 'image/png',
            finalUrl: prepared.finalUrl,
        };
    });

    onMessage('openImageDownload', async ({ data, sender }) => {
        const source = sender.url ? new URL(sender.url) : undefined;
        const pagePlatform = source?.hostname === 'www.xiaohongshu.com' || source?.hostname === 'xiaohongshu.com'
            ? 'xhs'
            : source?.hostname === 'www.douyin.com' || source?.hostname === 'douyin.com'
                ? 'dy'
                : undefined;
        if (!pagePlatform) {
            throw new Error('图文下载只能从小红书或抖音作品页发起');
        }
        const platform = data.platform || pagePlatform;
        if (platform !== pagePlatform) {
            throw new Error('图片来源平台与当前作品页不一致');
        }
        if (!data?.files?.length) {
            throw new Error('未取得可下载图片');
        }
        const files = data.files.map((file: { url: string; filename: string }, index: number) => ({
            url: validateImageUrl(file.url, platform),
            filename: imageDownloadFilename(file.filename, index),
        }));
        const taskId = crypto.randomUUID();
        const key = imageDownloadTaskKey(taskId);
        await browser.storage.local.set({
            [key]: {
                platform,
                folderName: safeImageDownloadFolderName(data.folderName),
                files,
                createdAt: Date.now(),
            },
        });
        try {
            await browser.tabs.create({
                url: `${browser.runtime.getURL('/image-download.html')}?task=${encodeURIComponent(taskId)}`,
            });
        } catch (error) {
            await browser.storage.local.remove(key);
            throw error;
        }
        return { taskId };
    });
});
