import request from "./request";
import { sendMessage } from "@/utils/messaging";

function normalizePageAweme(item: any): DouyinAPI.AwemeV1WebDetail {
    const video = item.video || {};
    const playAddr = Array.isArray(video.playAddr) ? video.playAddr : [];
    const coverUrls = video.coverUrlList || video.cover169UrlList || video.originCoverUrlList || [];
    const images = (item.images || []).map((image: any) => ({
        download_url_list: image.urlList || image.downloadUrlList || [],
        height: image.height || 0,
        width: image.width || 0,
        uri: image.uri || '',
        url_list: image.urlList || image.downloadUrlList || [],
    }));
    const detail: DouyinAPI.AwemeDetail = {
        aweme_id: String(item.awemeId ?? item.aweme_id),
        caption: item.caption || '',
        desc: item.desc || item.itemTitle || '',
        create_time: Number(item.createTime || item.create_time || 0),
        share_url: item.shareInfo?.shareUrl || `https://www.douyin.com/video/${item.awemeId}`,
        media_type: Number(item.mediaType ?? item.media_type ?? (images.length ? 2 : 4)),
        video: {
            duration: Number(video.duration || 0),
            format: 'mp4',
            origin_cover: { uri: video.originCover || video.coverUri || '', height: video.height || 0, width: video.width || 0 },
            cover: { uri: video.coverUri || '', url_key: '', height: video.height || 0, width: video.width || 0, data_size: 0, url_list: coverUrls },
            cover_original_scale: { uri: video.coverUri || '', url_key: '', height: video.height || 0, width: video.width || 0, data_size: 0, url_list: coverUrls },
            download_addr: { uri: video.uri || '', url_key: '', height: video.height || 0, width: video.width || 0, data_size: Number(video.playAddrSize || 0), url_list: playAddr.map((x: any) => x.src).filter(Boolean) },
            play_addr: { uri: video.uri || '', url_key: '', height: video.height || 0, width: video.width || 0, data_size: Number(video.playAddrSize || 0), url_list: [video.playApi, ...playAddr.map((x: any) => x.src)].filter(Boolean) },
        },
        images,
        music: item.music || {},
        statistics: {
            admire_count: Number(item.stats?.admireCount || 0), collect_count: Number(item.stats?.collectCount || 0), comment_count: Number(item.stats?.commentCount || 0), digg_count: Number(item.stats?.diggCount || 0), play_count: Number(item.stats?.playCount || 0), share_count: Number(item.stats?.shareCount || 0),
        },
        author: {
            uid: String(item.authorInfo?.uid || item.authorUserId || ''), unique_id: item.authorInfo?.uniqueId || '', sec_uid: item.authorInfo?.secUid || '', short_id: item.authorInfo?.shortId || '', nickname: item.authorInfo?.nickname || '', signature: item.authorInfo?.signature || '', follower_count: Number(item.authorInfo?.followerCount || 0),
        },
        mix_info: item.mixInfo ? { mix_id: String(item.mixInfo.mixId || item.mixInfo.mix_id || ''), mix_name: item.mixInfo.mixName || item.mixInfo.mix_name || '', statis: { collect_vv: 0, current_episode: 0, play_vv: 0, updated_to_episode: 0 } } : undefined,
    };
    return { aweme_detail: detail, filter_detail: { aweme_id: detail.aweme_id, detail_msg: '', filter_reason: '' } };
}

export async function awemeDetail(awemeId: string): Promise<DouyinAPI.AwemeV1WebDetail> {
    try {
        return await request({
        url: '/aweme/v1/web/aweme/detail/',
        params: {
            aweme_id: awemeId
        },
        });
    } catch (error) {
        const item = await sendMessage('extractDyAweme', { awemeId });
        if (item) return normalizePageAweme(item);
        throw error;
    }
}

export function awemePost(params: DouyinAPI.AwemeV1WebPostParam): Promise<DouyinAPI.AwemeV1WebPost> {
    return request({
        url: '/aweme/v1/web/aweme/post/',
        params,
    })
}

export function mixAweme(params: DouyinAPI.AwemeV1WebMixParam): Promise<DouyinAPI.AwemeV1WebbMix> {
    return request({
        url: '/aweme/v1/web/mix/aweme/',
        params,
    })
}
