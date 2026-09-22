import type {Platform} from './model';

export interface ImageObservation {
    source?: string;
    explicitIndex?: number;
    active?: boolean;
    visible?: boolean;
    distance?: number;
    order: number;
}

function sourceKey(value: string | undefined): string | undefined {
    if (!value) return;
    try {
        const url = new URL(value, typeof location === 'undefined' ? 'https://localhost/' : location.href);
        return `${url.hostname}${url.pathname}`.toLowerCase();
    } catch {
        return value.split('?')[0].toLowerCase();
    }
}

function mediaIndex(value: string | null | undefined): number | undefined {
    if (!value) return;
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 ? n : undefined;
}

function labelIndex(value: string | null | undefined): number | undefined {
    if (!value) return;
    const match = value.match(/(?:第\s*)?(\d+)\s*(?:\/|of|张|页)/i);
    if (!match) return;
    const n = Number(match[1]);
    return Number.isInteger(n) && n > 0 ? n - 1 : undefined;
}

function explicitIndex(element: Element): number | undefined {
    for (const attr of ['data-index', 'data-swiper-slide-index', 'data-slide-index']) {
        const index = mediaIndex(element.getAttribute(attr));
        if (index !== undefined) return index;
    }
    return labelIndex(element.getAttribute('aria-label')) ?? labelIndex(element.textContent);
}

function isActive(element: Element): boolean {
    const className = typeof (element as HTMLElement).className === 'string'
        ? (element as HTMLElement).className
        : '';
    return /(?:^|[-_ ])(?:active|current|selected|visible)(?:$|[-_ ])/i.test(className)
        || element.getAttribute('aria-current') === 'true'
        || element.getAttribute('aria-selected') === 'true'
        || element.getAttribute('aria-hidden') === 'false';
}

function isVisible(element: Element): boolean {
    const node = element as HTMLElement;
    if (node.hidden || node.getAttribute('aria-hidden') === 'true') return false;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 8 && rect.height > 8 && rect.bottom > 0 && rect.right > 0
        && rect.top < innerHeight && rect.left < innerWidth;
}

function imageRoots(platform: Platform): Element[] {
    const selectors = platform === 'xhs'
        ? ['#noteContainer .media-container', '#noteContainer']
        : [
            '[data-e2e="player-container"].note-detail-container.newVideoPlayer',
            '[data-e2e="feed-active-video"]',
            '[data-e2e="player-container"]',
        ];
    return selectors.map(selector => document.querySelector(selector)).filter((root): root is Element => !!root);
}

function observationsFromDom(platform: Platform): ImageObservation[] {
    const root = imageRoots(platform)[0];
    if (!root) return [];
    const rootRect = root.getBoundingClientRect();
    const centerX = rootRect.left + rootRect.width / 2;
    const centerY = rootRect.top + rootRect.height / 2;
    const images = [...root.querySelectorAll<HTMLImageElement>('img')];
    return images.map((image, order) => {
        const slide = image.closest('[data-index], [data-swiper-slide-index], [data-slide-index], [class*="slide"], [class*="Slide"]') || image;
        const rect = image.getBoundingClientRect();
        const source = image.currentSrc || image.src || image.getAttribute('data-src') || image.getAttribute('data-original') || undefined;
        const distance = Math.hypot((rect.left + rect.width / 2) - centerX, (rect.top + rect.height / 2) - centerY);
        return {
            source,
            explicitIndex: explicitIndex(slide),
            active: isActive(slide),
            visible: isVisible(image),
            distance: Number.isFinite(distance) ? distance : undefined,
            order,
        };
    });
}

export function chooseCurrentImageIndex(observations: ImageObservation[], mediaUrls: string[]): number | undefined {
    if (mediaUrls.length === 1) return 0;
    const keys = mediaUrls.map(sourceKey);
    const valid = (index: number | undefined): index is number => index !== undefined && index >= 0 && index < mediaUrls.length;
    const matched = (observation: ImageObservation): number | undefined => {
        const key = sourceKey(observation.source);
        if (!key) return;
        const exact = keys.findIndex(candidate => candidate === key);
        if (exact >= 0) return exact;
        const suffix = key.split('/').pop();
        return suffix ? keys.findIndex(candidate => candidate?.split('/').pop() === suffix) : undefined;
    };
    const active = observations.filter(item => item.active && item.visible !== false);
    const activeExplicit = active.map(item => item.explicitIndex).find(valid);
    if (activeExplicit !== undefined) return activeExplicit;
    const activeMatched = active.map(matched).find(valid);
    if (activeMatched !== undefined) return activeMatched;
    if (active.length === 1) {
        const order = active[0].order;
        if (valid(order)) return order;
    }
    const visibleMatched = observations.filter(item => item.visible).map(matched).find(valid);
    if (visibleMatched !== undefined) return visibleMatched;
    const visible = observations.filter(item => item.visible && item.distance !== undefined).sort((a, b) => (a.distance || 0) - (b.distance || 0));
    if (visible.length === 1 && valid(visible[0].order)) return visible[0].order;
    if (visible.length > 1 && visible[0].distance !== visible[1].distance && valid(visible[0].order)) return visible[0].order;
    return undefined;
}

export function currentImageIndex(platform: Platform, mediaUrls: string[]): number {
    const index = chooseCurrentImageIndex(observationsFromDom(platform), mediaUrls);
    if (index === undefined) throw new Error('未识别当前显示的图片，请先切换到目标图片后重试；也可以选择下载全部图片');
    return index;
}
