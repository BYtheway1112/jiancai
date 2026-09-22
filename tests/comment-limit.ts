import assert from 'node:assert/strict';
import { test } from 'node:test';
import { limitNested, nestedCount } from '../src/utils/comment-limit';
test('Douyin page limit counts parents and replies as export rows', () => {
    const comments = Array.from({ length: 20 }, (_, index) => ({
        cid: `root-${index}`,
        reply_comment: [],
    }));
    const limited = limitNested(comments, 2, comment => comment.reply_comment, (comment, reply_comment) => ({ ...comment, reply_comment }));
    assert.equal(limited.length, 2);
    assert.equal(nestedCount(limited, comment => comment.reply_comment), 2);
    assert.deepEqual(limited.map(comment => comment.cid), ['root-0', 'root-1']);
});

test('Douyin keeps the parent when the final row is a reply', () => {
    const comments = [{
        cid: 'root',
        reply_comment: [{ cid: 'reply-1' }, { cid: 'reply-2' }],
    }];
    const limited = limitNested(comments, 2, comment => comment.reply_comment, (comment, reply_comment) => ({ ...comment, reply_comment }));
    assert.deepEqual(limited, [{ cid: 'root', reply_comment: [{ cid: 'reply-1' }] }]);
    assert.equal(nestedCount(limited, comment => comment.reply_comment), 2);
});

test('Xiaohongshu uses the same bound for sub_comments and keeps available rows', () => {
    const comments = [{
        id: 'root',
        sub_comments: [{ id: 'sub-1' }],
    }];
    const limited = limitNested(comments, 5, comment => comment.sub_comments, (comment, sub_comments) => ({ ...comment, sub_comments }));
    assert.deepEqual(limited, comments);
    assert.equal(nestedCount(limited, comment => comment.sub_comments), 2);
});

test('zero limit produces no rows and never detaches a reply', () => {
    const comments = [{ cid: 'root', reply_comment: [{ cid: 'reply' }] }];
    const limited = limitNested(comments, 0, comment => comment.reply_comment, (comment, reply_comment) => ({ ...comment, reply_comment }));
    assert.deepEqual(limited, []);
    assert.equal(nestedCount(limited as typeof comments, comment => comment.reply_comment), 0);
});
