import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Processor as DyProcessor } from '../src/entrypoints/dy.content/tasks/post-comment/processor';
import { Processor as XhsProcessor } from '../src/entrypoints/xhs.content/tasks/post-comment/processor';

(globalThis as any).generateExcelDownloadOption = (data: any[][]) => data;

test('processors preserve inline replies, continue from cursors, and cap the export rows', async () => {
    const dyRoot = { cid: 'root', aweme_id: 'aweme', text: 'root', reply_comment_total: 2, reply_comment: [{ cid: 'inline', aweme_id: 'aweme', text: 'inline' }] };
    const dyNew = { cid: 'new', aweme_id: 'aweme', text: 'new', reply_id: 'root' };
    const dyPage = { comments: [dyRoot], cursor: 1, has_more: 0, total: 1 };
    const dyReplyPage = { comments: [dyRoot.reply_comment[0], dyNew, { ...dyNew, cid: 'newer' }], cursor: 2, has_more: 1, total: 3 };
    const dy = new (DyProcessor as any)({ urls: [{ id: 'aweme' }], limitPerId: 3, requestInterval: 0 });
    const dyCalls: any[] = [];
    dy.next = async (config: any) => {
        dyCalls.push(config);
        const response = config.key === 'aweme:0'
            ? dyPage
            : config.key === 'aweme:cycle:0'
                ? { comments: [dyNew], cursor: 0, has_more: 1, total: 1 }
                : dyReplyPage;
        dy.dataCache.set(config.key, response);
        return response;
    };
    const dyComments = await dy.getAwemeComments('aweme', 3);
    assert.equal(dy.getCommentCount(dyComments), 3);
    assert.deepEqual(dyComments[0].reply_comment.map((x: any) => x.cid), ['inline', 'new']);
    assert.equal(dyCalls.length, 2);
    assert.equal(dy.dataCache.get('aweme:root:0').comments.length, 3);
    assert.equal(dy.getDataDownloadOption().length, 4);
    assert.equal(dy.getCrawledComments()[0].reply_comment.length, 2);
    const dyCycle = await dy.getCommentReplies('aweme', 'cycle', 2, []);
    assert.equal(dyCycle.length, 1);
    assert.equal(dyCalls.filter((call: any) => call.key === 'aweme:cycle:0').length, 1);

    const xhsRoot = { id: 'root', note_id: 'note', content: 'root', sub_comment_count: '2', sub_comment_cursor: 'after', sub_comment_has_more: true, sub_comments: [{ id: 'inline', note_id: 'note', content: 'inline', pictures: [] }] };
    const xhsNew = { id: 'new', note_id: 'note', content: 'new', pictures: [] };
    const xhs = new (XhsProcessor as any)({ urls: [{ id: 'note', token: 'token', href: 'https://www.xiaohongshu.com/explore/note' }], limitPerId: 3, requestInterval: 0 });
    const xhsCalls: any[] = [];
    xhs.next = async (config: any) => {
        xhsCalls.push(config);
        const response = config.key === 'note:'
            ? { comments: [xhsRoot], cursor: '', has_more: false, time: 0 }
            : config.key === 'note:root:cycle'
                ? { comments: [xhsNew], cursor: 'cycle', has_more: true, time: 0 }
            : { comments: [xhsNew, { ...xhsNew, id: 'newer' }, { ...xhsNew, id: 'newest' }], cursor: 'later', has_more: true, time: 0 };
        xhs.dataCache.set(config.key, response);
        return response;
    };
    const xhsComments = await xhs.getNoteComments(xhs.condition.urls[0], 3);
    assert.equal(xhs.getCommentCount(xhsComments), 3);
    assert.deepEqual(xhsComments[0].sub_comments.map((x: any) => x.id), ['inline', 'new']);
    assert.equal(xhsCalls.length, 2);
    assert.equal(xhsCalls[1].key, 'note:root:after');
    assert.equal(xhs.dataCache.get('note:root:after').comments.length, 3);
    assert.equal(xhs.getDataDownloadOption().length, 4);
    assert.equal(xhs.getCrawledComments()[0].sub_comments.length, 2);
    const xhsCycle = await xhs.getNoteSubComments(xhs.condition.urls[0], 'root', 'cycle', 2);
    assert.equal(xhsCycle.length, 1);
    assert.equal(xhsCalls.filter((call: any) => call.key === 'note:root:cycle').length, 1);
});
