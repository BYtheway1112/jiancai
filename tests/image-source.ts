import assert from 'node:assert/strict';
import { test } from 'node:test';
import { douyinImageSource, xhsImageSource, assertCleanImageSource } from '../src/utils/image-source';
import { normalize } from '../src/collector/model';
import { validateImageUrl } from '../src/utils/image-download';

test('Douyin selects signed full-size clean URLs, rejects watermarked fallback and preserves query', () => {
    const preview='https://p3.douyinpic.com/a~tplv-dy-aweme-images-v2:1440:2818:q75.webp?signed=preview';
    const original='https://p3.douyinpic.com/a~tplv-dy-aweme-images-v2:0:0:q75.webp?signed=original';
    const water='https://p3.douyinpic.com/a~tplv-dy-water-v10:3000:3000:q75.webp';
    assert.equal(douyinImageSource({url_list:[preview,original],download_url_list:[water]}),original);
    assert.equal(douyinImageSource({download_url_list:[water]}),undefined);
    assert.equal(douyinImageSource({url_list:[water]}),undefined);
    assert.throws(()=>assertCleanImageSource(water,'dy'),/旧版带水印/);
    assert.throws(()=>normalize('dy',{aweme_id:'test',media_type:2,images:[{url_list:[original]},{download_url_list:[water]}]},'https://www.douyin.com/note/test'),/部分抖音图片/);
});

test('XHS removes signed preview prefix and resizing, and explicitly requests PNG', () => {
    const image={url_default:'https://sns-webpic-qc.xhscdn.com/20260917/signature/1040g2sg123!nd_dft_wlteh_webp_3'};
    assert.equal(xhsImageSource(image),'https://ci.xiaohongshu.com/1040g2sg123?imageView2/format/png');
    const p=normalize('xhs',{noteId:'test',type:'normal',imageList:[{urlDefault:image.url_default}]},'https://www.xiaohongshu.com/explore/test');
    assert.equal(p.media.find(m=>m.field==='笔记图片')?.url,'https://ci.xiaohongshu.com/1040g2sg123?imageView2/format/png');
    assert.equal(xhsImageSource({url_default:'https://sns-img-bd.xhscdn.com/direct.jpg'}),'https://sns-img-bd.xhscdn.com/direct.jpg');
    assert.throws(()=>validateImageUrl('https://ci.xiaohongshu.com.evil.test/a','xhs'));
    assert.throws(()=>validateImageUrl('http://ci.xiaohongshu.com/a','xhs'));
    assert.throws(()=>validateImageUrl('https://user:pw@ci.xiaohongshu.com/a','xhs'));
    assert.throws(()=>validateImageUrl('https://www.xiaohongshu.com/a','xhs'));
});
